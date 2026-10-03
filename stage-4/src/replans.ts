// Seating changes after a table closure (stage 4): a manager previews a plan that reseats
// every confirmed booking overlapping the proposed closure, then applies it atomically.
import {
  PLANNING_MAX_COMBINATIONS, PLANNING_MAX_CONSIDERED, PLANNING_MAX_PAIRS, PLANNING_MAX_TABLES,
} from './constants';
import { db } from './db';
import { conflict, notFound, unprocessable, validationFailed } from './errors';
import { stringField } from './fields';
import { record } from './history';
import { newId } from './ids';
import type { Outcome } from './idempotency';
import { managedRestaurant } from './policies';
import { bumpSeries, closuresOf, updateBooking, view } from './reservations';
import { overlaps, type Occupancy } from './schedule';
import type { JsonObject } from './shape';
import {
  RESERVATION_COLUMNS, bumpRestaurantRevision, fromDbRow, insertClosure, insertPlan, planDbRow, planFromDb,
  restaurantRevision, selectPlanStmt, type Assignment, type PlanRow, type ReservationRow, type Restaurant,
} from './state';
import { formatInstant } from './time';

const selectConfirmed = db.prepare(
  `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE restaurant_id = ? AND status = 'confirmed'`);
const selectByReference = db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE reference = ?`);
const markApplied = db.prepare('UPDATE plans SET applied = 1 WHERE id = ?');

/** An RFC 3339 instant with an explicit offset (`Z` or ±HH:MM). */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(text: string, name: string): number {
  const ms = INSTANT_RE.test(text) ? Date.parse(text) : NaN;
  if (Number.isNaN(ms)) throw validationFailed(`${name} must be an RFC 3339 instant with an explicit offset`);
  return ms;
}

const byReference = (a: { reference: string }, b: { reference: string }) =>
  (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
const sameSet = (a: string[], b: string[]) => [...a].sort().join('+') === [...b].sort().join('+');

/** A seating the planner may give a booking: singles in fixture order, then declared pairs; rank = position. */
interface Candidate {
  table_ids: string[];
  rank: number;
  unused: number;
  changed: boolean;
}

interface Best {
  picks: Candidate[];
  moved: number;
  unused: number;
}

/** True when (moved, unused, ranks) of `a` is lexicographically smaller than `b`'s. */
function better(a: Best, b: Best): boolean {
  if (a.moved !== b.moved) return a.moved < b.moved;
  if (a.unused !== b.unused) return a.unused < b.unused;
  for (let i = 0; i < a.picks.length; i++) {
    if (a.picks[i].rank !== b.picks[i].rank) return a.picks[i].rank < b.picks[i].rank;
  }
  return false;
}

/**
 * Exhaustive search for the best seating of `considered` (in reference order), minimising
 * moved bookings, then unused seats, then the rank vector. Capacity is judged under each
 * booking's own accepted terms; `blocked` holds fixed bookings and closures. Null if infeasible.
 */
export function bestSeating(restaurant: Restaurant, considered: ReservationRow[], blocked: Occupancy[]): Best | null {
  const options = [
    ...restaurant.tables.map((t) => [t.id]),
    ...restaurant.combinable.map((pair) => [...pair]),
  ];
  const candidates = considered.map((b) => options
    .map((ids, rank) => {
      const capacity = ids.reduce((sum, id) => sum + (b.accepted_terms.capacities[id] ?? 0), 0);
      return { table_ids: ids, rank, unused: capacity - b.party_size, changed: !sameSet(ids, b.table_ids) };
    })
    .filter((c) => c.unused >= 0 && !blocked.some((h) => overlaps(h, { ...b, table_ids: c.table_ids }))));

  const overLimits = restaurant.tables.length > PLANNING_MAX_TABLES || restaurant.combinable.length > PLANNING_MAX_PAIRS
    || considered.length > PLANNING_MAX_CONSIDERED;
  if (overLimits && candidates.reduce((n, c) => n * Math.max(c.length, 1), 1) > PLANNING_MAX_COMBINATIONS) {
    throw unprocessable('planning_limit', 'This closure affects too many bookings to plan');
  }

  let best: Best | null = null;
  const picks: Candidate[] = [];
  const walk = (i: number, moved: number, unused: number) => {
    // Moved and unused only grow, so a partial plan already worse on them cannot win.
    if (best && (moved > best.moved || (moved === best.moved && unused > best.unused))) return;
    if (i === considered.length) {
      const plan = { picks: [...picks], moved, unused };
      if (!best || better(plan, best)) best = plan;
      return;
    }
    for (const c of candidates[i]) {
      const hold = { ...considered[i], table_ids: c.table_ids };
      if (picks.some((p, j) => overlaps(hold, { ...considered[j], table_ids: p.table_ids }))) continue;
      picks.push(c);
      walk(i + 1, moved + (c.changed ? 1 : 0), unused + c.unused);
      picks.pop();
    }
  };
  walk(0, 0, 0);
  return best as Best | null; // assigned inside walk(); TypeScript cannot see that
}

function planView(plan: PlanRow) {
  return {
    plan_id: plan.id,
    restaurant_revision: plan.restaurant_revision,
    closure: { table_id: plan.table_id, from: plan.closure_from, to: plan.closure_to },
    assignments: plan.assignments,
    moved_count: plan.moved_count,
    unused_seats: plan.unused_seats,
  };
}

/**
 * POST /restaurants/{id}/replans (inside the idempotency transaction). Stores only the plan:
 * no closure, occupancy, revision or history changes.
 */
export function previewReplan(userId: string, restaurantId: string, body: JsonObject): Outcome {
  const restaurant = managedRestaurant(userId, restaurantId);
  const tableId = stringField(body, 'table_id', true)!;
  const from = stringField(body, 'from', true)!;
  const to = stringField(body, 'to', true)!;
  const fromMs = parseInstant(from, 'from');
  const toMs = parseInstant(to, 'to');
  if (fromMs >= toMs) throw validationFailed('from must be before to');
  if (!restaurant.tables.some((t) => t.id === tableId)) throw notFound('No such table at this restaurant');

  const confirmed = selectConfirmed.all(restaurant.id).map(fromDbRow);
  const window: Occupancy = { table_ids: [tableId], start_ms: fromMs, end_ms: toMs };
  const isConsidered = (r: ReservationRow) => r.start_ms < toMs && r.end_ms > fromMs;
  const considered = confirmed.filter(isConsidered).sort(byReference);
  const blocked = [...confirmed.filter((r) => !isConsidered(r)), ...closuresOf(restaurant.id), window];
  const best = bestSeating(restaurant, considered, blocked);
  if (!best) throw conflict('no_feasible_plan', 'No seating avoids the closure for every affected booking');

  const assignments: Assignment[] = considered.map((r, i) => ({
    reference: r.reference, table_ids: best.picks[i].table_ids, changed: best.picks[i].changed,
  }));
  const plan: PlanRow = {
    id: newId('pln'), restaurant_id: restaurant.id, restaurant_revision: restaurantRevision(restaurant.id),
    table_id: tableId, closure_from: from, closure_to: to, from_ms: fromMs, to_ms: toMs,
    assignments, moved_count: best.moved, unused_seats: best.unused, applied: false,
  };
  insertPlan.run(planDbRow(plan));
  return { status: 201, body: planView(plan) };
}

/**
 * POST /restaurants/{id}/replans/{plan_id}/apply (inside the idempotency transaction).
 * Records the closure and every assignment together, with one restaurant revision.
 */
export function applyReplan(userId: string, restaurantId: string, planId: string): Outcome {
  const restaurant = managedRestaurant(userId, restaurantId);
  const row = selectPlanStmt.get(planId);
  const plan = row ? planFromDb(row) : undefined;
  if (!plan || plan.restaurant_id !== restaurant.id) throw notFound('No such plan');
  if (plan.applied) throw conflict('plan_already_applied', 'This plan has already been applied');
  if (plan.restaurant_revision !== restaurantRevision(restaurant.id)) {
    throw conflict('stale_plan', 'The restaurant has changed since this plan was made');
  }
  const affectedSeries = new Set<string>();
  const results = plan.assignments.map((a) => {
    const before = fromDbRow(selectByReference.get(a.reference));
    if (!a.changed) return before;
    const after: ReservationRow = { ...before, table_ids: a.table_ids, revision: before.revision + 1 };
    updateBooking(after);
    record(after, 'reassigned', [{ field: 'table_ids', from: before.table_ids, to: a.table_ids }], plan.id);
    if (after.series_id) affectedSeries.add(after.series_id);
    return after;
  });
  insertClosure.run({
    restaurant_id: restaurant.id, table_id: plan.table_id, from_ms: plan.from_ms, to_ms: plan.to_ms, plan_id: plan.id,
  });
  markApplied.run(plan.id);
  bumpRestaurantRevision(restaurant.id);
  for (const seriesId of affectedSeries) bumpSeries(seriesId);
  return {
    status: 201,
    body: { plan_id: plan.id, restaurant_revision: restaurantRevision(restaurant.id), reservations: results.map(view) },
  };
}

/** GET /restaurants/{id}/closures: applied closures, public, so screens can say "closed". */
export function listClosures(restaurant: Restaurant): Outcome {
  return {
    status: 200,
    body: {
      closures: closuresOf(restaurant.id).map((c) => ({
        table_id: c.table_ids[0], from: formatInstant(restaurant.timezone, c.start_ms), to: formatInstant(restaurant.timezone, c.end_ms),
      })),
    },
  };
}

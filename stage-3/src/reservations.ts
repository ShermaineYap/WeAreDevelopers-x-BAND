// Booking rules: create, read, cancel, amend and atomic batch moves (§8, §11), under dated
// policies with revisions, accepted terms and history (stage 3). Every function here is
// synchronous and runs inside one transaction, so its checks and its writes see the same state.
import { MAX_MOVES, MIN_MOVES } from './constants';
import { db, inTransaction } from './db';
import { conflict, notFound, unprocessable, validationFailed } from './errors';
import { assertStringTyped, assertTableSetTyped, partySizeField, stringField, tableSetField } from './fields';
import { amendmentChanges, creationChanges, entriesOf, record } from './history';
import { newId, newReference } from './ids';
import type { Outcome } from './idempotency';
import { termsFor } from './policies';
import {
  bookingTiming, cutoffPassed, overlaps, parseStartsAtLocal, type Occupancy, type Timing,
} from './schedule';
import { hasField, isInteger, isObject, type JsonObject } from './shape';
import {
  RESERVATION_COLUMNS, bumpRestaurantRevision, declaredPair, findRestaurant, fromDbRow, insertReservation,
  toDbRow, type Restaurant, type ReservationRow,
} from './state';
import { termsView, type Terms } from './terms';
import { formatDate, formatLocalDateTime, formatUtcNow, parseLocalDateTime, type LocalDateTime } from './time';

const selectByReference = db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE reference = ?`);
const selectByUser = db.prepare(
  `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE user_id = ? ORDER BY start_ms DESC, rowid DESC`);
const selectOverlapping = db.prepare(
  `SELECT id, table_ids, start_ms, end_ms FROM reservations
    WHERE restaurant_id = ? AND status = 'confirmed' AND start_ms < ? AND end_ms > ?`);
const selectConfirmedForRestaurant = db.prepare(
  `SELECT table_ids, start_ms, end_ms FROM reservations WHERE restaurant_id = ? AND status = 'confirmed'`);
const updateBookingStmt = db.prepare(
  `UPDATE reservations SET table_ids = @table_ids, party_size = @party_size,
          starts_at_local = @starts_at_local, starts_at = @starts_at, ends_at = @ends_at,
          start_ms = @start_ms, end_ms = @end_ms, revision = @revision, accepted_terms = @accepted_terms,
          exception = @exception
    WHERE id = @id`);
const updateCancelled = db.prepare("UPDATE reservations SET status = 'cancelled', revision = ? WHERE id = ?");
const bumpSeriesStmt = db.prepare('UPDATE series SET revision = revision + 1 WHERE id = ?');
const updateBooking = (row: ReservationRow) => updateBookingStmt.run(toDbRow(row));

const readHold = (r: { table_ids: string }) => JSON.parse(r.table_ids) as string[];

/**
 * The public shape of a reservation (§8 create response). `table_ids` is always present;
 * `table_id` only when the set has exactly one member (stage 2); `revision` and
 * `accepted_terms` from stage 3.
 */
export function view(r: ReservationRow) {
  return {
    reservation_id: r.id,
    reference: r.reference,
    restaurant_id: r.restaurant_id,
    ...(r.table_ids.length === 1 ? { table_id: r.table_ids[0] } : {}),
    table_ids: [...r.table_ids],
    party_size: r.party_size,
    status: r.status,
    starts_at_local: r.starts_at_local,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    created_at: r.created_at,
    revision: r.revision,
    accepted_terms: termsView(r.accepted_terms),
  };
}

export function occupancyOf(restaurantId: string): Occupancy[] {
  return (selectConfirmedForRestaurant.all(restaurantId) as (Omit<Occupancy, 'table_ids'> & { table_ids: string })[])
    .map((r) => ({ ...r, table_ids: readHold(r) }));
}

/** The caller's reservation by reference; anyone else's (or no caller) is indistinguishable from none. */
export function ownReservation(userId: string | null, reference: string): ReservationRow {
  const row = selectByReference.get(reference);
  if (!row || userId === null || (row as ReservationRow).user_id !== userId) throw notFound('No such reservation');
  return fromDbRow(row);
}

const referenceTaken = (reference: string) => selectByReference.get(reference) !== undefined;

/** Counts one change to a series (stage 3 series revision). */
export function bumpSeries(seriesId: string): void {
  bumpSeriesStmt.run(seriesId);
}

// ---------- the shared validation of a booking's table, time and party ----------

interface ChangeRequest {
  table_ids?: string[];
  starts_at_local?: LocalDateTime;
  party_size?: number;
}

/** Reads the amendable fields: wrong JSON types first (400), then missing/invalid values (422). */
function readChange(body: JsonObject, required: boolean): ChangeRequest {
  assertTableSetTyped(body);
  assertStringTyped(body, ['starts_at_local']);
  const table_ids = tableSetField(body, required);
  const startsAtLocal = stringField(body, 'starts_at_local', required);
  const party_size = partySizeField(body, required);
  return {
    table_ids,
    party_size,
    starts_at_local: startsAtLocal === undefined ? undefined : parseStartsAtLocal(startsAtLocal),
  };
}

export type Booking = Timing & { table_ids: string[]; party_size: number; accepted_terms: Terms };

/** A pair in `combinable` order when it is declared; anything else unchanged. */
function canonicalTables(restaurant: Restaurant, tableIds: string[]): string[] {
  const pair = tableIds.length === 2 ? declaredPair(restaurant, tableIds[0], tableIds[1]) : undefined;
  return pair ? [...pair] : tableIds;
}

/**
 * Tables (each known, a pair only if declared), then — under the policy for the local start
 * date — time (existence, hours, grid) and capacity summed over the set, as for POST
 * /reservations. A pair is kept in `combinable` order.
 */
export function resolveBooking(restaurant: Restaurant, tableIds: string[], local: LocalDateTime, partySize: number): Booking {
  if (!tableIds.every((id) => restaurant.tables.some((t) => t.id === id))) {
    throw notFound('No such table at this restaurant');
  }
  if (tableIds.length === 2 && !declaredPair(restaurant, tableIds[0], tableIds[1])) {
    throw unprocessable('combination_not_allowed', 'Those tables cannot be combined');
  }
  const terms = termsFor(restaurant, formatDate(local));
  const timing = bookingTiming(restaurant, terms, local);
  const capacity = tableIds.reduce((sum, id) => sum + terms.capacities[id], 0);
  if (partySize > capacity) {
    throw unprocessable('party_exceeds_capacity', 'party_size exceeds the capacity of the chosen tables');
  }
  return { ...timing, table_ids: canonicalTables(restaurant, tableIds), party_size: partySize, accepted_terms: terms };
}

const tableUnavailable = () => conflict('table_unavailable', 'The table is taken for an overlapping time');

/** 409 when `booking` overlaps a confirmed reservation other than those in `exclude`. */
export function assertFree(restaurantId: string, booking: Occupancy, exclude: ReadonlySet<string>): void {
  const clashes = selectOverlapping.all(restaurantId, booking.end_ms, booking.start_ms) as
    (Omit<Occupancy, 'table_ids'> & { id: string; table_ids: string })[];
  if (clashes.some((c) => !exclude.has(c.id) && overlaps(booking, { ...c, table_ids: readHold(c) }))) {
    throw tableUnavailable();
  }
}

/** Stores a new confirmed reservation at revision 1 with its `created` history entry. */
export function insertNewReservation(
  userId: string, restaurantId: string, booking: Booking, series: { id: string; index: number } | null,
): ReservationRow {
  const row: ReservationRow = {
    id: newId('res'),
    reference: newReference(referenceTaken),
    user_id: userId,
    restaurant_id: restaurantId,
    status: 'confirmed',
    created_at: formatUtcNow(),
    ...booking,
    revision: 1,
    series_id: series ? series.id : null,
    series_index: series ? series.index : null,
    exception: false,
  };
  insertReservation(row);
  record(row, 'created', creationChanges(row));
  return row;
}

// ---------- endpoints ----------

export function createReservation(userId: string, body: JsonObject): Outcome {
  assertTableSetTyped(body);
  assertStringTyped(body, ['restaurant_id', 'starts_at_local']);
  const restaurantId = stringField(body, 'restaurant_id', true)!;
  const change = readChange(body, true);
  const restaurant = findRestaurant(restaurantId);
  if (!restaurant) throw notFound('No such restaurant');
  const booking = resolveBooking(restaurant, change.table_ids!, change.starts_at_local!, change.party_size!);
  assertFree(restaurant.id, booking, new Set());
  const row = insertNewReservation(userId, restaurant.id, booking, null);
  bumpRestaurantRevision(restaurant.id);
  return { status: 201, body: view(row) };
}

export function listReservations(userId: string): Outcome {
  const rows = selectByUser.all(userId).map(fromDbRow);
  return { status: 200, body: { reservations: rows.map(view) } };
}

export function getReservation(userId: string, reference: string): Outcome {
  return { status: 200, body: view(ownReservation(userId, reference)) };
}

/** Owner-only, and 404 (not 401) for anyone else, signed in or not (stage 3). */
export function getHistory(userId: string | null, reference: string): Outcome {
  const row = ownReservation(userId, reference);
  return { status: 200, body: { reference: row.reference, entries: entriesOf(row.id) } };
}

export function getDecision(userId: string | null, reference: string): Outcome {
  const row = ownReservation(userId, reference);
  return { status: 200, body: { reference: row.reference, revision: row.revision, accepted_terms: termsView(row.accepted_terms) } };
}

export const cutoffError = () =>
  conflict('cutoff_passed', 'The booking is within its cancellation cutoff and can no longer change');

/** The booking's own accepted cutoff, against its current start (stage 3). */
export const pastCutoff = (row: ReservationRow) => cutoffPassed(row.accepted_terms.cancellation_cutoff_minutes, row.start_ms);

export function cancelReservation(userId: string, reference: string): Outcome {
  return inTransaction(() => {
    const row = ownReservation(userId, reference);
    if (row.status === 'cancelled') return { status: 200, body: view(row) };
    if (pastCutoff(row)) throw cutoffError();
    const cancelled: ReservationRow = { ...row, status: 'cancelled', revision: row.revision + 1 };
    updateCancelled.run(cancelled.revision, row.id);
    record(cancelled, 'cancelled', []);
    bumpRestaurantRevision(row.restaurant_id);
    if (row.series_id) bumpSeries(row.series_id);
    return { status: 200, body: view(cancelled) };
  });
}

/** `expected_revision` (stage 3): absent, or a positive integer; anything else is 422. */
function expectedRevision(body: JsonObject): number | undefined {
  if (!hasField(body, 'expected_revision')) return undefined;
  const value = body.expected_revision;
  if (!isInteger(value) || value < 1) throw validationFailed('expected_revision must be a positive integer');
  return value;
}

interface Plan {
  before: ReservationRow;
  after: ReservationRow;
  changed: boolean;
}

/**
 * The reservation as `body` would leave it, or the first rule it breaks: a stale
 * `expected_revision`, cancelled, the old accepted cutoff, then the ordinary POST validation
 * of all resulting fields under the policy for the resulting date. Occupancy is not checked
 * here. A change to the current values is a no-op: it keeps terms, end time and revision.
 */
function planAmendment(row: ReservationRow, body: JsonObject): Plan {
  const expected = expectedRevision(body);
  if (expected !== undefined && expected !== row.revision) {
    throw conflict('stale_revision', `The reservation is at revision ${row.revision}`);
  }
  if (row.status === 'cancelled') throw conflict('reservation_cancelled', 'The reservation is cancelled');
  if (pastCutoff(row)) throw cutoffError();
  const change = readChange(body, false);
  const restaurant = findRestaurant(row.restaurant_id)!;
  const tableIds = canonicalTables(restaurant, change.table_ids ?? row.table_ids);
  const local = change.starts_at_local ?? parseLocalDateTime(row.starts_at_local)!;
  const partySize = change.party_size ?? row.party_size;
  const unchanged = tableIds.join('+') === row.table_ids.join('+')
    && formatLocalDateTime(local) === row.starts_at_local && partySize === row.party_size;
  if (unchanged) return { before: row, after: row, changed: false };
  const booking = resolveBooking(restaurant, tableIds, local, partySize);
  const after: ReservationRow = {
    ...row, ...booking, revision: row.revision + 1, exception: row.series_id !== null || row.exception,
  };
  return { before: row, after, changed: true };
}

/** Writes a real amendment: the booking, its `changed` history entry. */
function applyAmendment(plan: Plan): void {
  updateBooking(plan.after);
  record(plan.after, 'changed', amendmentChanges(plan.before, plan.after));
}

export function amendReservation(userId: string, reference: string, body: JsonObject): Outcome {
  return inTransaction(() => {
    const plan = planAmendment(ownReservation(userId, reference), body);
    if (!plan.changed) return { status: 200, body: view(plan.before) };
    assertFree(plan.after.restaurant_id, plan.after, new Set([plan.after.id]));
    applyAmendment(plan);
    bumpRestaurantRevision(plan.after.restaurant_id);
    if (plan.after.series_id) bumpSeries(plan.after.series_id);
    return { status: 200, body: view(plan.after) };
  });
}

/** Validates the batch's shape: 1..8 objects with distinct string references. */
function readMoves(body: JsonObject): JsonObject[] {
  const moves = body.moves;
  if (!Array.isArray(moves) || moves.length < MIN_MOVES || moves.length > MAX_MOVES) {
    throw validationFailed(`moves must hold ${MIN_MOVES} to ${MAX_MOVES} items`);
  }
  const references = new Set<string>();
  for (const item of moves) {
    if (!isObject(item) || typeof item.reference !== 'string') {
      throw validationFailed('every move must be an object with a string reference');
    }
    if (references.has(item.reference)) throw validationFailed('moves must name distinct references');
    references.add(item.reference);
  }
  return moves as JsonObject[];
}

/**
 * All moves commit or none do. Each item follows PATCH semantics; non-occupancy errors win in
 * input order; occupancy is then judged on the resulting state, against each other and every
 * unlisted confirmed booking. Each changed booking gains one revision and one history entry;
 * each affected series and the restaurant gain one revision for the whole batch.
 */
export function moveReservations(userId: string, body: JsonObject): Outcome {
  const items = readMoves(body);
  let restaurantId: string | undefined;
  const plans = items.map((item) => {
    const row = ownReservation(userId, item.reference as string);
    restaurantId ??= row.restaurant_id;
    if (row.restaurant_id !== restaurantId) throw validationFailed('all moved bookings must belong to one restaurant');
    return planAmendment(row, item);
  });
  const results = plans.map((p) => p.after);
  const listed = new Set(results.map((r) => r.id));
  results.forEach((r, i) => {
    if (results.some((q, j) => j !== i && overlaps(r, q))) throw tableUnavailable();
    assertFree(r.restaurant_id, r, listed);
  });
  const changed = plans.filter((p) => p.changed);
  for (const plan of changed) applyAmendment(plan);
  for (const seriesId of new Set(changed.map((p) => p.after.series_id).filter((id): id is string => id !== null))) {
    bumpSeries(seriesId);
  }
  if (changed.length > 0) bumpRestaurantRevision(restaurantId!);
  return { status: 201, body: { reservations: results.map(view) } };
}

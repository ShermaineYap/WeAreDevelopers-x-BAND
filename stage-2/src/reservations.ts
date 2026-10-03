// Booking rules: create, read, cancel, amend and atomic batch moves (§8, §11).
// Every function here is synchronous and is called inside one transaction, so its checks
// and its writes see the same state.
import { MAX_MOVES, MIN_MOVES } from './constants';
import { db, inTransaction } from './db';
import { conflict, notFound, unprocessable, validationFailed } from './errors';
import { assertStringTyped, assertTableSetTyped, partySizeField, stringField, tableSetField } from './fields';
import { newId, newReference } from './ids';
import type { Outcome } from './idempotency';
import {
  bookingTiming, cutoffPassed, overlaps, parseStartsAtLocal, type Occupancy, type Timing,
} from './schedule';
import { isObject, type JsonObject } from './shape';
import {
  RESERVATION_COLUMNS, declaredPair, findRestaurant, fromDbRow, insertReservation, toDbRow,
  type Restaurant, type ReservationRow,
} from './state';
import { formatUtcNow, parseLocalDateTime, type LocalDateTime } from './time';

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
          start_ms = @start_ms, end_ms = @end_ms
    WHERE id = @id`);
const updateStatus = db.prepare('UPDATE reservations SET status = ? WHERE id = ?');
const updateBooking = (row: ReservationRow) => updateBookingStmt.run(toDbRow(row));

const readHold = (r: { table_ids: string }) => JSON.parse(r.table_ids) as string[];

/**
 * The public shape of a reservation (§8 create response). `table_ids` is always present;
 * `table_id` only when the set has exactly one member (stage 2).
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
  };
}

export function occupancyOf(restaurantId: string): Occupancy[] {
  return (selectConfirmedForRestaurant.all(restaurantId) as (Omit<Occupancy, 'table_ids'> & { table_ids: string })[])
    .map((r) => ({ ...r, table_ids: readHold(r) }));
}

/** The caller's reservation by reference; anyone else's is indistinguishable from none. */
function ownReservation(userId: string, reference: string): ReservationRow {
  const row = selectByReference.get(reference);
  if (!row || (row as ReservationRow).user_id !== userId) throw notFound('No such reservation');
  return fromDbRow(row);
}

const referenceTaken = (reference: string) => selectByReference.get(reference) !== undefined;

// ---------- the shared validation of a booking's table, time and party ----------

interface Change {
  table_ids?: string[];
  starts_at_local?: LocalDateTime;
  party_size?: number;
}

/** Reads the amendable fields: wrong JSON types first (400), then missing/invalid values (422). */
function readChange(body: JsonObject, required: boolean): Change {
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

type Booking = Timing & { table_ids: string[]; party_size: number };

/**
 * Tables (each known, a pair only if declared), then time (existence, hours, grid), then
 * capacity summed over the set, as for POST /reservations. A pair is kept in `combinable` order.
 */
function resolveBooking(restaurant: Restaurant, tableIds: string[], local: LocalDateTime, partySize: number): Booking {
  const tables = tableIds.map((id) => restaurant.tables.find((t) => t.id === id));
  if (tables.some((t) => t === undefined)) throw notFound('No such table at this restaurant');
  let ids = tableIds;
  if (tableIds.length === 2) {
    const pair = declaredPair(restaurant, tableIds[0], tableIds[1]);
    if (!pair) throw unprocessable('combination_not_allowed', 'Those tables cannot be combined');
    ids = [...pair];
  }
  const timing = bookingTiming(restaurant, local);
  const capacity = tables.reduce((sum, t) => sum + t!.capacity, 0);
  if (partySize > capacity) {
    throw unprocessable('party_exceeds_capacity', 'party_size exceeds the capacity of the chosen tables');
  }
  return { ...timing, table_ids: ids, party_size: partySize };
}

const tableUnavailable = () => conflict('table_unavailable', 'The table is taken for an overlapping time');

/** 409 when `booking` overlaps a confirmed reservation other than those in `exclude`. */
function assertFree(restaurantId: string, booking: Occupancy, exclude: ReadonlySet<string>): void {
  const clashes = selectOverlapping.all(restaurantId, booking.end_ms, booking.start_ms) as
    (Omit<Occupancy, 'table_ids'> & { id: string; table_ids: string })[];
  if (clashes.some((c) => !exclude.has(c.id) && overlaps(booking, { ...c, table_ids: readHold(c) }))) {
    throw tableUnavailable();
  }
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
  const row: ReservationRow = {
    id: newId('res'),
    reference: newReference(referenceTaken),
    user_id: userId,
    restaurant_id: restaurant.id,
    status: 'confirmed',
    created_at: formatUtcNow(),
    ...booking,
  };
  insertReservation(row);
  return { status: 201, body: view(row) };
}

export function listReservations(userId: string): Outcome {
  const rows = selectByUser.all(userId).map(fromDbRow);
  return { status: 200, body: { reservations: rows.map(view) } };
}

export function getReservation(userId: string, reference: string): Outcome {
  return { status: 200, body: view(ownReservation(userId, reference)) };
}

const cutoffError = () =>
  conflict('cutoff_passed', 'The booking is within its cancellation cutoff and can no longer change');

export function cancelReservation(userId: string, reference: string): Outcome {
  return inTransaction(() => {
    const row = ownReservation(userId, reference);
    if (row.status === 'cancelled') return { status: 200, body: view(row) };
    if (cutoffPassed(findRestaurant(row.restaurant_id)!, row.start_ms)) throw cutoffError();
    updateStatus.run('cancelled', row.id);
    return { status: 200, body: view({ ...row, status: 'cancelled' }) };
  });
}

/**
 * The reservation as `body` would leave it, or the first rule it breaks: cancelled, then the
 * cutoff against the current start, then the ordinary POST validation. Occupancy is not
 * checked here. An empty change keeps every existing value.
 */
function planAmendment(row: ReservationRow, body: JsonObject): ReservationRow {
  if (row.status === 'cancelled') throw conflict('reservation_cancelled', 'The reservation is cancelled');
  const restaurant = findRestaurant(row.restaurant_id)!;
  if (cutoffPassed(restaurant, row.start_ms)) throw cutoffError();
  const change = readChange(body, false);
  if (change.table_ids === undefined && change.starts_at_local === undefined && change.party_size === undefined) {
    return row;
  }
  const booking = resolveBooking(
    restaurant,
    change.table_ids ?? row.table_ids,
    change.starts_at_local ?? parseLocalDateTime(row.starts_at_local)!,
    change.party_size ?? row.party_size,
  );
  return { ...row, ...booking };
}

export function amendReservation(userId: string, reference: string, body: JsonObject): Outcome {
  return inTransaction(() => {
    const planned = planAmendment(ownReservation(userId, reference), body);
    assertFree(planned.restaurant_id, planned, new Set([planned.id]));
    updateBooking(planned);
    return { status: 200, body: view(planned) };
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
 * All moves commit or none do. Non-occupancy errors win in input order; occupancy is then
 * judged on the resulting state, against each other and every unlisted confirmed booking.
 */
export function moveReservations(userId: string, body: JsonObject): Outcome {
  const items = readMoves(body);
  let restaurantId: string | undefined;
  const planned = items.map((item) => {
    const row = ownReservation(userId, item.reference as string);
    restaurantId ??= row.restaurant_id;
    if (row.restaurant_id !== restaurantId) throw validationFailed('all moved bookings must belong to one restaurant');
    return planAmendment(row, item);
  });
  const listed = new Set(planned.map((p) => p.id));
  planned.forEach((p, i) => {
    if (planned.some((q, j) => j !== i && overlaps(p, q))) throw tableUnavailable();
    assertFree(p.restaurant_id, p, listed);
  });
  for (const p of planned) updateBooking(p);
  return { status: 201, body: { reservations: planned.map(view) } };
}

// The whole service state as plain records: how it is read, replaced (reset/import) and
// exported. Reset, import and export all go through replaceState/snapshotState, so there is
// one definition of "all state".
import { REFERENCE_PATTERN, STATE_SCHEMA, WEEKDAYS, type Weekday } from './constants';
import { db, inTransaction } from './db';
import { validationFailed } from './errors';
import {
  expectArray, expectDistinct, expectId, expectInteger, expectObject, expectString, hasField,
  isObject, type JsonObject,
} from './shape';
import { isValidZone, parseClock, parseLocalDateTime } from './time';

export interface OpeningHours {
  weekday: Weekday;
  opens: string;
  closes: string;
}

export interface TableRecord {
  id: string;
  label?: string;
  capacity: number;
}

export interface Restaurant {
  id: string;
  name: string;
  timezone: string;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHours[];
  tables: TableRecord[];
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
}

export interface TokenRow {
  token_hash: string;
  user_id: string;
}

export type ReservationStatus = 'confirmed' | 'cancelled';

export interface ReservationRow {
  id: string;
  reference: string;
  user_id: string;
  restaurant_id: string;
  table_id: string;
  party_size: number;
  status: ReservationStatus;
  starts_at_local: string;
  starts_at: string;
  ends_at: string;
  start_ms: number;
  end_ms: number;
  created_at: string;
}

export interface IdempotencyRow {
  user_id: string;
  path: string;
  key: string;
  request_hash: string;
  response: string;
}

export interface StoreState {
  users: UserRow[];
  tokens: TokenRow[];
  restaurants: Restaurant[];
  reservations: ReservationRow[];
  idempotency: IdempotencyRow[];
}

/** Case-insensitive identity of an email address. */
export const emailKey = (email: string) => email.toLowerCase();

// ---------- restaurants ----------

/** Validates a restaurant in the fixture's shape (§4). Used by reset and import alike. */
export function parseRestaurant(value: unknown, path: string): Restaurant {
  const r = expectObject(value, path);
  const timezone = expectString(r, 'timezone', path);
  if (!isValidZone(timezone)) throw validationFailed(`${path}.timezone is not an IANA zone`);
  const opening_hours = expectArray(r.opening_hours, `${path}.opening_hours`).map((h, i) =>
    parseOpeningHours(h, `${path}.opening_hours[${i}]`));
  const tables = expectArray(r.tables, `${path}.tables`).map((t, i) =>
    parseTable(t, `${path}.tables[${i}]`));
  expectDistinct(tables.map((t) => t.id), `table id in ${path}`);
  return {
    id: expectId(r, 'id', path),
    name: expectString(r, 'name', path),
    timezone,
    slot_minutes: expectInteger(r, 'slot_minutes', path, 1),
    reservation_duration_minutes: expectInteger(r, 'reservation_duration_minutes', path, 1),
    cancellation_cutoff_minutes: expectInteger(r, 'cancellation_cutoff_minutes', path, 0),
    opening_hours,
    tables,
  };
}

function parseOpeningHours(value: unknown, path: string): OpeningHours {
  const h = expectObject(value, path);
  const weekday = expectString(h, 'weekday', path);
  if (!(WEEKDAYS as readonly string[]).includes(weekday)) {
    throw validationFailed(`${path}.weekday must be one of ${WEEKDAYS.join(' ')}`);
  }
  const opens = expectString(h, 'opens', path);
  const closes = expectString(h, 'closes', path);
  const [o, c] = [parseClock(opens), parseClock(closes)];
  if (o === null || c === null) throw validationFailed(`${path} opens/closes must be HH:MM`);
  if (c <= o) throw validationFailed(`${path}.closes must be later than opens`);
  return { weekday: weekday as Weekday, opens, closes };
}

function parseTable(value: unknown, path: string): TableRecord {
  const t = expectObject(value, path);
  const table: TableRecord = { id: expectId(t, 'id', path), capacity: expectInteger(t, 'capacity', path, 1) };
  if (hasField(t, 'label') && t.label !== null) table.label = expectString(t, 'label', path);
  return table;
}

type RestaurantDbRow = Omit<Restaurant, 'opening_hours' | 'tables'> & { opening_hours: string };

const selectRestaurants = db.prepare(
  `SELECT id, name, timezone, slot_minutes, reservation_duration_minutes,
          cancellation_cutoff_minutes, opening_hours
     FROM restaurants ORDER BY position`);
const selectRestaurant = db.prepare(
  `SELECT id, name, timezone, slot_minutes, reservation_duration_minutes,
          cancellation_cutoff_minutes, opening_hours
     FROM restaurants WHERE id = ?`);
const selectTables = db.prepare(
  'SELECT id, label, capacity FROM restaurant_tables WHERE restaurant_id = ? ORDER BY position');

function hydrate(row: RestaurantDbRow): Restaurant {
  const tables = (selectTables.all(row.id) as { id: string; label: string | null; capacity: number }[])
    .map(({ id, label, capacity }) => (label === null ? { id, capacity } : { id, label, capacity }));
  return { ...row, opening_hours: JSON.parse(row.opening_hours) as OpeningHours[], tables };
}

export function listRestaurants(): Restaurant[] {
  return (selectRestaurants.all() as RestaurantDbRow[]).map(hydrate);
}

export function findRestaurant(id: string): Restaurant | undefined {
  const row = selectRestaurant.get(id) as RestaurantDbRow | undefined;
  return row && hydrate(row);
}

// ---------- replace / snapshot ----------

const insertUser = db.prepare(
  `INSERT INTO users (id, email, email_key, password_hash, display_name)
   VALUES (@id, @email, @email_key, @password_hash, @display_name)`);
const insertToken = db.prepare('INSERT INTO tokens (token_hash, user_id) VALUES (@token_hash, @user_id)');
const insertRestaurant = db.prepare(
  `INSERT INTO restaurants (id, position, name, timezone, slot_minutes, reservation_duration_minutes,
                            cancellation_cutoff_minutes, opening_hours)
   VALUES (@id, @position, @name, @timezone, @slot_minutes, @reservation_duration_minutes,
           @cancellation_cutoff_minutes, @opening_hours)`);
const insertTable = db.prepare(
  `INSERT INTO restaurant_tables (restaurant_id, id, position, label, capacity)
   VALUES (@restaurant_id, @id, @position, @label, @capacity)`);
export const insertReservation = db.prepare(
  `INSERT INTO reservations (id, reference, user_id, restaurant_id, table_id, party_size, status,
                             starts_at_local, starts_at, ends_at, start_ms, end_ms, created_at)
   VALUES (@id, @reference, @user_id, @restaurant_id, @table_id, @party_size, @status,
           @starts_at_local, @starts_at, @ends_at, @start_ms, @end_ms, @created_at)`);
const insertIdempotency = db.prepare(
  `INSERT INTO idempotency (user_id, path, key, request_hash, response)
   VALUES (@user_id, @path, @key, @request_hash, @response)`);

const ALL_TABLES = ['users', 'tokens', 'restaurants', 'restaurant_tables', 'reservations', 'idempotency'];

/** Atomically replace everything with `state`. Constraint violations roll back and are 422. */
export function replaceState(state: StoreState): void {
  try {
    inTransaction(() => {
      for (const table of ALL_TABLES) db.prepare(`DELETE FROM ${table}`).run();
      for (const u of state.users) insertUser.run({ ...u, email_key: emailKey(u.email) });
      for (const t of state.tokens) insertToken.run(t);
      state.restaurants.forEach((r, position) => {
        insertRestaurant.run({
          id: r.id, position, name: r.name, timezone: r.timezone, slot_minutes: r.slot_minutes,
          reservation_duration_minutes: r.reservation_duration_minutes,
          cancellation_cutoff_minutes: r.cancellation_cutoff_minutes,
          opening_hours: JSON.stringify(r.opening_hours),
        });
        r.tables.forEach((t, i) => insertTable.run({
          restaurant_id: r.id, id: t.id, position: i, label: t.label ?? null, capacity: t.capacity,
        }));
      });
      for (const r of state.reservations) insertReservation.run(r);
      for (const i of state.idempotency) insertIdempotency.run(i);
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
      throw validationFailed(`state is inconsistent: ${err.message}`);
    }
    throw err;
  }
}

/** A consistent read of all state (one synchronous read transaction). */
export function snapshotState(): StoreState {
  return inTransaction(() => ({
    users: db.prepare('SELECT id, email, password_hash, display_name FROM users ORDER BY rowid').all() as UserRow[],
    tokens: db.prepare('SELECT token_hash, user_id FROM tokens ORDER BY rowid').all() as TokenRow[],
    restaurants: listRestaurants(),
    reservations: db.prepare(
      `SELECT id, reference, user_id, restaurant_id, table_id, party_size, status, starts_at_local,
              starts_at, ends_at, start_ms, end_ms, created_at
         FROM reservations ORDER BY rowid`).all() as ReservationRow[],
    idempotency: db.prepare(
      'SELECT user_id, path, key, request_hash, response FROM idempotency ORDER BY rowid').all() as IdempotencyRow[],
  }));
}

// ---------- the opaque export format ----------

export function serializeState(state: StoreState): JsonObject {
  return { schema: STATE_SCHEMA, ...state };
}

/**
 * Validates an exported `state` object. Anything this service could not have produced is
 * rejected with 422 before the destination is touched.
 */
export function deserializeState(value: unknown): StoreState {
  const s = expectObject(value, 'state');
  if (s.schema !== STATE_SCHEMA) throw validationFailed('state was not produced by this service');
  const users = expectArray(s.users, 'state.users').map((v, i) => {
    const p = `state.users[${i}]`; const u = expectObject(v, p);
    return { id: expectId(u, 'id', p), email: expectString(u, 'email', p),
      password_hash: expectString(u, 'password_hash', p), display_name: expectString(u, 'display_name', p) };
  });
  const userIds = new Set(users.map((u) => u.id));
  const knownUser = (id: string, p: string) => {
    if (!userIds.has(id)) throw validationFailed(`${p} names an unknown user`);
    return id;
  };
  const tokens = expectArray(s.tokens, 'state.tokens').map((v, i) => {
    const p = `state.tokens[${i}]`; const t = expectObject(v, p);
    return { token_hash: expectString(t, 'token_hash', p), user_id: knownUser(expectString(t, 'user_id', p), p) };
  });
  const restaurants = expectArray(s.restaurants, 'state.restaurants').map((r, i) =>
    parseRestaurant(r, `state.restaurants[${i}]`));
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const reservations = expectArray(s.reservations, 'state.reservations').map((v, i) => {
    const p = `state.reservations[${i}]`; const r = expectObject(v, p);
    const row: ReservationRow = {
      id: expectId(r, 'id', p), reference: expectString(r, 'reference', p),
      user_id: knownUser(expectString(r, 'user_id', p), p),
      restaurant_id: expectString(r, 'restaurant_id', p), table_id: expectString(r, 'table_id', p),
      party_size: expectInteger(r, 'party_size', p, 1), status: expectString(r, 'status', p) as ReservationStatus,
      starts_at_local: expectString(r, 'starts_at_local', p), starts_at: expectString(r, 'starts_at', p),
      ends_at: expectString(r, 'ends_at', p), start_ms: expectInteger(r, 'start_ms', p, -8.64e15),
      end_ms: expectInteger(r, 'end_ms', p, -8.64e15), created_at: expectString(r, 'created_at', p),
    };
    const restaurant = byId.get(row.restaurant_id);
    if (!restaurant || !restaurant.tables.some((t) => t.id === row.table_id)) {
      throw validationFailed(`${p} names an unknown restaurant or table`);
    }
    if (!REFERENCE_PATTERN.test(row.reference)) throw validationFailed(`${p}.reference is malformed`);
    if (row.status !== 'confirmed' && row.status !== 'cancelled') throw validationFailed(`${p}.status is unknown`);
    if (!parseLocalDateTime(row.starts_at_local) || Date.parse(row.starts_at) !== row.start_ms
      || Date.parse(row.ends_at) !== row.end_ms || row.end_ms <= row.start_ms
      || Number.isNaN(Date.parse(row.created_at))) {
      throw validationFailed(`${p} has inconsistent times`);
    }
    return row;
  });
  const idempotency = expectArray(s.idempotency, 'state.idempotency').map((v, i) => {
    const p = `state.idempotency[${i}]`; const r = expectObject(v, p);
    const row = { user_id: knownUser(expectString(r, 'user_id', p), p), path: expectString(r, 'path', p),
      key: expectString(r, 'key', p), request_hash: expectString(r, 'request_hash', p),
      response: expectString(r, 'response', p) };
    try {
      if (!isObject(JSON.parse(row.response))) throw new Error();
    } catch {
      throw validationFailed(`${p}.response is not a stored response`);
    }
    return row;
  });
  return { users, tokens, restaurants, reservations, idempotency };
}

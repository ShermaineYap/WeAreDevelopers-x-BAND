// The whole service state as plain records: how it is read, replaced (reset/import) and
// exported. Reset, import and export all go through replaceState/snapshotState, so there is
// one definition of "all state".
import {
  REFERENCE_PATTERN, STAGE1_STATE_SCHEMA, STAGE2_STATE_SCHEMA, STATE_SCHEMA,
} from './constants';
import { db, inTransaction } from './db';
import { validationFailed } from './errors';
import { parseOpeningHours, type OpeningHours } from './hours';
import {
  expectArray, expectDistinct, expectId, expectInteger, expectObject, expectString, hasField,
  isObject, type JsonObject,
} from './shape';
import { parsePolicyBody, parseTerms, policyZero, type Policy, type Terms } from './terms';
import { isValidZone, parseLocalDateTime } from './time';

export type { OpeningHours } from './hours';

export interface TableRecord {
  id: string;
  label?: string;
  capacity: number;
}

/** A declared combinable pair, in the order the fixture gave it. */
export type TablePair = [string, string];

/** A restaurant in its fixture shape (what GET /restaurants/{id} returns). */
export interface Restaurant {
  id: string;
  name: string;
  timezone: string;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHours[];
  tables: TableRecord[];
  combinable: TablePair[];
  manager_user_ids: string[];
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
export const RESERVATION_STATUSES: readonly string[] = ['confirmed', 'cancelled'];

export interface ReservationRow {
  id: string;
  reference: string;
  user_id: string;
  restaurant_id: string;
  /** One table, or a declared pair in `combinable` order. */
  table_ids: string[];
  party_size: number;
  status: ReservationStatus;
  starts_at_local: string;
  starts_at: string;
  ends_at: string;
  start_ms: number;
  end_ms: number;
  created_at: string;
  revision: number;
  accepted_terms: Terms;
  series_id: string | null;
  series_index: number | null;
  /** A series occurrence a diner changed individually (permanent). */
  exception: boolean;
}

export type HistoryEvent = 'created' | 'changed' | 'cancelled';
export const HISTORY_EVENTS: readonly string[] = ['created', 'changed', 'cancelled'];

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

export interface HistoryRow {
  reservation_id: string;
  seq: number;
  at: string;
  event: HistoryEvent;
  changes: Change[];
  revision: number;
  accepted_terms: Terms;
}

export interface SeriesRow {
  id: string;
  user_id: string;
  restaurant_id: string;
  interval_weeks: number;
  revision: number;
}

export type PolicyRow = Policy & { restaurant_id: string };

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
  /** Restaurant revision counters, by restaurant id (0 when absent). */
  restaurant_revisions: Record<string, number>;
  policies: PolicyRow[];
  reservations: ReservationRow[];
  history: HistoryRow[];
  series: SeriesRow[];
  idempotency: IdempotencyRow[];
}

/** Case-insensitive identity of an email address. */
export const emailKey = (email: string) => email.toLowerCase();

/** The declared pair holding exactly these two tables, in either order. */
export function declaredPair(restaurant: Restaurant, a: string, b: string): TablePair | undefined {
  return restaurant.combinable.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ---------- restaurants ----------

/**
 * Validates a restaurant in the fixture's shape (§4, stage 2 `combinable`, stage 3
 * `manager_user_ids`). Used by reset and import.
 */
export function parseRestaurant(value: unknown, path: string): Restaurant {
  const r = expectObject(value, path);
  const timezone = expectString(r, 'timezone', path);
  if (!isValidZone(timezone)) throw validationFailed(`${path}.timezone is not an IANA zone`);
  const opening_hours = expectArray(r.opening_hours, `${path}.opening_hours`).map((h, i) =>
    parseOpeningHours(h, `${path}.opening_hours[${i}]`));
  const tables = expectArray(r.tables, `${path}.tables`).map((t, i) =>
    parseTable(t, `${path}.tables[${i}]`));
  expectDistinct(tables.map((t) => t.id), `table id in ${path}`);
  const managers = hasField(r, 'manager_user_ids') && r.manager_user_ids !== null
    ? expectArray(r.manager_user_ids, `${path}.manager_user_ids`) : [];
  if (managers.some((id) => typeof id !== 'string')) throw validationFailed(`${path}.manager_user_ids must hold user ids`);
  const restaurant: Restaurant = {
    id: expectId(r, 'id', path),
    name: expectString(r, 'name', path),
    timezone,
    slot_minutes: expectInteger(r, 'slot_minutes', path, 1),
    reservation_duration_minutes: expectInteger(r, 'reservation_duration_minutes', path, 1),
    cancellation_cutoff_minutes: expectInteger(r, 'cancellation_cutoff_minutes', path, 0),
    opening_hours,
    tables,
    combinable: [],
    manager_user_ids: managers as string[],
  };
  const pairs = hasField(r, 'combinable') && r.combinable !== null
    ? expectArray(r.combinable, `${path}.combinable`) : [];
  pairs.forEach((pair, i) => {
    const p = `${path}.combinable[${i}]`;
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((id) => typeof id !== 'string')) {
      throw validationFailed(`${p} must be a pair of table ids`);
    }
    const [a, b] = pair as string[];
    if (a === b || !tables.some((t) => t.id === a) || !tables.some((t) => t.id === b)) {
      throw validationFailed(`${p} must name two different tables of this restaurant`);
    }
    if (declaredPair(restaurant, a, b)) throw validationFailed(`${p} repeats a declared pair`);
    restaurant.combinable.push([a, b]);
  });
  return restaurant;
}

function parseTable(value: unknown, path: string): TableRecord {
  const t = expectObject(value, path);
  const table: TableRecord = { id: expectId(t, 'id', path), capacity: expectInteger(t, 'capacity', path, 1) };
  if (hasField(t, 'label') && t.label !== null) table.label = expectString(t, 'label', path);
  return table;
}

type RestaurantDbRow = Omit<Restaurant, 'opening_hours' | 'tables' | 'combinable' | 'manager_user_ids'> & {
  opening_hours: string;
  combinable: string;
  manager_user_ids: string;
};

const RESTAURANT_COLUMNS = `id, name, timezone, slot_minutes, reservation_duration_minutes,
  cancellation_cutoff_minutes, opening_hours, combinable, manager_user_ids`;
const selectRestaurants = db.prepare(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants ORDER BY position`);
const selectRestaurant = db.prepare(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants WHERE id = ?`);
const selectTables = db.prepare(
  'SELECT id, label, capacity FROM restaurant_tables WHERE restaurant_id = ? ORDER BY position');
const bumpRevisionStmt = db.prepare('UPDATE restaurants SET revision = revision + 1 WHERE id = ?');

function hydrate(row: RestaurantDbRow): Restaurant {
  const tables = (selectTables.all(row.id) as { id: string; label: string | null; capacity: number }[])
    .map(({ id, label, capacity }) => (label === null ? { id, capacity } : { id, label, capacity }));
  return {
    ...row,
    opening_hours: JSON.parse(row.opening_hours) as OpeningHours[],
    tables,
    combinable: JSON.parse(row.combinable) as TablePair[],
    manager_user_ids: JSON.parse(row.manager_user_ids) as string[],
  };
}

export function listRestaurants(): Restaurant[] {
  return (selectRestaurants.all() as RestaurantDbRow[]).map(hydrate);
}

export function findRestaurant(id: string): Restaurant | undefined {
  const row = selectRestaurant.get(id) as RestaurantDbRow | undefined;
  return row && hydrate(row);
}

/** Counts one successful state change at the restaurant (stage 3/4 restaurant revision). */
export function bumpRestaurantRevision(restaurantId: string): void {
  bumpRevisionStmt.run(restaurantId);
}

// ---------- reservation rows ----------

/** Column list matching ReservationDbRow; JSON columns hold table_ids and accepted_terms. */
export const RESERVATION_COLUMNS = `id, reference, user_id, restaurant_id, table_ids, party_size, status,
  starts_at_local, starts_at, ends_at, start_ms, end_ms, created_at, revision, accepted_terms,
  series_id, series_index, exception`;

type ReservationDbRow = Omit<ReservationRow, 'table_ids' | 'accepted_terms' | 'exception'> & {
  table_ids: string;
  accepted_terms: string;
  exception: number;
};

export const toDbRow = (r: ReservationRow): ReservationDbRow => ({
  ...r, table_ids: JSON.stringify(r.table_ids), accepted_terms: JSON.stringify(r.accepted_terms), exception: r.exception ? 1 : 0,
});
export const fromDbRow = (r: unknown): ReservationRow => {
  const row = r as ReservationDbRow;
  return {
    ...row,
    table_ids: JSON.parse(row.table_ids) as string[],
    accepted_terms: JSON.parse(row.accepted_terms) as Terms,
    exception: row.exception === 1,
  };
};

const insertReservationStmt = db.prepare(
  `INSERT INTO reservations (${RESERVATION_COLUMNS})
   VALUES (@id, @reference, @user_id, @restaurant_id, @table_ids, @party_size, @status,
           @starts_at_local, @starts_at, @ends_at, @start_ms, @end_ms, @created_at, @revision,
           @accepted_terms, @series_id, @series_index, @exception)`);

export function insertReservation(row: ReservationRow): void {
  insertReservationStmt.run(toDbRow(row));
}

// ---------- replace / snapshot ----------

const insertUser = db.prepare(
  `INSERT INTO users (id, email, email_key, password_hash, display_name)
   VALUES (@id, @email, @email_key, @password_hash, @display_name)`);
const insertToken = db.prepare('INSERT INTO tokens (token_hash, user_id) VALUES (@token_hash, @user_id)');
const insertRestaurant = db.prepare(
  `INSERT INTO restaurants (id, position, name, timezone, slot_minutes, reservation_duration_minutes,
                            cancellation_cutoff_minutes, opening_hours, combinable, manager_user_ids, revision)
   VALUES (@id, @position, @name, @timezone, @slot_minutes, @reservation_duration_minutes,
           @cancellation_cutoff_minutes, @opening_hours, @combinable, @manager_user_ids, @revision)`);
const insertTable = db.prepare(
  `INSERT INTO restaurant_tables (restaurant_id, id, position, label, capacity)
   VALUES (@restaurant_id, @id, @position, @label, @capacity)`);
export const insertPolicy = db.prepare(
  `INSERT INTO policies (restaurant_id, policy_version, effective_from, slot_minutes,
                         reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours, capacities)
   VALUES (@restaurant_id, @policy_version, @effective_from, @slot_minutes,
           @reservation_duration_minutes, @cancellation_cutoff_minutes, @opening_hours, @capacities)`);
export const insertHistory = db.prepare(
  `INSERT INTO history (reservation_id, seq, at, event, changes, revision, accepted_terms)
   VALUES (@reservation_id, @seq, @at, @event, @changes, @revision, @accepted_terms)`);
export const insertSeries = db.prepare(
  `INSERT INTO series (id, user_id, restaurant_id, interval_weeks, revision)
   VALUES (@id, @user_id, @restaurant_id, @interval_weeks, @revision)`);
const insertIdempotency = db.prepare(
  `INSERT INTO idempotency (user_id, path, key, request_hash, response)
   VALUES (@user_id, @path, @key, @request_hash, @response)`);

const ALL_TABLES = ['users', 'tokens', 'restaurants', 'restaurant_tables', 'policies', 'reservations',
  'history', 'series', 'idempotency'];

export const policyDbRow = (p: PolicyRow) => ({
  ...p, opening_hours: JSON.stringify(p.opening_hours), capacities: JSON.stringify(p.capacities),
});
export const historyDbRow = (h: HistoryRow) => ({
  ...h, changes: JSON.stringify(h.changes), accepted_terms: JSON.stringify(h.accepted_terms),
});

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
          combinable: JSON.stringify(r.combinable),
          manager_user_ids: JSON.stringify(r.manager_user_ids),
          revision: state.restaurant_revisions[r.id] ?? 0,
        });
        r.tables.forEach((t, i) => insertTable.run({
          restaurant_id: r.id, id: t.id, position: i, label: t.label ?? null, capacity: t.capacity,
        }));
      });
      for (const p of state.policies) insertPolicy.run(policyDbRow(p));
      for (const r of state.reservations) insertReservation(r);
      for (const h of state.history) insertHistory.run(historyDbRow(h));
      for (const s of state.series) insertSeries.run(s);
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
    restaurant_revisions: Object.fromEntries(
      (db.prepare('SELECT id, revision FROM restaurants ORDER BY position').all() as { id: string; revision: number }[])
        .map((r) => [r.id, r.revision])),
    policies: (db.prepare(
      `SELECT restaurant_id, policy_version, effective_from, slot_minutes, reservation_duration_minutes,
              cancellation_cutoff_minutes, opening_hours, capacities FROM policies ORDER BY rowid`).all() as
      (Omit<PolicyRow, 'opening_hours' | 'capacities'> & { opening_hours: string; capacities: string })[])
      .map((p) => ({ ...p, opening_hours: JSON.parse(p.opening_hours), capacities: JSON.parse(p.capacities) })),
    reservations: db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM reservations ORDER BY rowid`).all().map(fromDbRow),
    history: (db.prepare(
      'SELECT reservation_id, seq, at, event, changes, revision, accepted_terms FROM history ORDER BY rowid').all() as
      (Omit<HistoryRow, 'changes' | 'accepted_terms'> & { changes: string; accepted_terms: string })[])
      .map((h) => ({ ...h, changes: JSON.parse(h.changes), accepted_terms: JSON.parse(h.accepted_terms) })),
    series: db.prepare('SELECT id, user_id, restaurant_id, interval_weeks, revision FROM series ORDER BY rowid').all() as SeriesRow[],
    idempotency: db.prepare(
      'SELECT user_id, path, key, request_hash, response FROM idempotency ORDER BY rowid').all() as IdempotencyRow[],
  }));
}

// ---------- the opaque export format ----------

export function serializeState(state: StoreState): JsonObject {
  return { schema: STATE_SCHEMA, ...state };
}

/** Reads a reservation's table set: `table_ids`, or `table_id` in stage-1 exports. */
function exportedTableIds(r: JsonObject, path: string, stage1: boolean): string[] {
  if (stage1) return [expectString(r, 'table_id', path)];
  const ids = expectArray(r.table_ids, `${path}.table_ids`);
  if (ids.some((id) => typeof id !== 'string')) throw validationFailed(`${path}.table_ids must hold strings`);
  return ids as string[];
}

/**
 * The history a booking that did not come through the API starts with (a seed, or one
 * imported from a stage-1 or stage-2 export): its creation (and cancellation) as of its
 * current values, at its current revision and terms.
 */
export function initialHistory(r: ReservationRow): HistoryRow[] {
  const base = { reservation_id: r.id, at: r.created_at, revision: r.revision, accepted_terms: r.accepted_terms };
  const tables: Change = r.table_ids.length === 1
    ? { field: 'table_id', from: null, to: r.table_ids[0] }
    : { field: 'table_ids', from: null, to: r.table_ids };
  const created: HistoryRow = {
    ...base, seq: 1, event: 'created',
    changes: [tables, { field: 'starts_at_local', from: null, to: r.starts_at_local }, { field: 'party_size', from: null, to: r.party_size }],
  };
  return r.status === 'cancelled' ? [created, { ...base, seq: 2, event: 'cancelled', changes: [] }] : [created];
}

function optionalId(r: JsonObject, name: string, path: string): string | null {
  return r[name] === null || r[name] === undefined ? null : expectString(r, name, path);
}

/**
 * Validates an exported `state` object, including stage-1 and stage-2 exports, which are
 * upgraded on the way in (revision 1, policy-0 terms, a synthesised creation history). Anything
 * this service could not have produced is rejected with 422 before the destination is touched.
 */
export function deserializeState(value: unknown): StoreState {
  const s = expectObject(value, 'state');
  const known = [STATE_SCHEMA, STAGE1_STATE_SCHEMA, STAGE2_STATE_SCHEMA];
  if (!known.includes(s.schema as string)) throw validationFailed('state was not produced by this service');
  const stage1 = s.schema === STAGE1_STATE_SCHEMA;
  const legacy = s.schema !== STATE_SCHEMA;
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
  const restaurantOf = (id: string, p: string) => {
    const restaurant = byId.get(id);
    if (!restaurant) throw validationFailed(`${p} names an unknown restaurant`);
    return restaurant;
  };

  const restaurant_revisions: Record<string, number> = {};
  if (!legacy) {
    const revisions = expectObject(s.restaurant_revisions, 'state.restaurant_revisions');
    for (const id of Object.keys(revisions)) {
      restaurantOf(id, 'state.restaurant_revisions');
      restaurant_revisions[id] = expectInteger(revisions, id, 'state.restaurant_revisions', 0);
    }
  }
  const policies: PolicyRow[] = legacy ? [] : expectArray(s.policies, 'state.policies').map((v, i) => {
    const p = `state.policies[${i}]`; const o = expectObject(v, p);
    const restaurant = restaurantOf(expectString(o, 'restaurant_id', p), p);
    return { restaurant_id: restaurant.id, policy_version: expectInteger(o, 'policy_version', p, 1), ...parsePolicyBody(o, restaurant) };
  });
  const series: SeriesRow[] = legacy ? [] : expectArray(s.series, 'state.series').map((v, i) => {
    const p = `state.series[${i}]`; const o = expectObject(v, p);
    return { id: expectId(o, 'id', p), user_id: knownUser(expectString(o, 'user_id', p), p),
      restaurant_id: restaurantOf(expectString(o, 'restaurant_id', p), p).id,
      interval_weeks: expectInteger(o, 'interval_weeks', p, 1), revision: expectInteger(o, 'revision', p, 1) };
  });
  const seriesIds = new Set(series.map((x) => x.id));

  const reservations = expectArray(s.reservations, 'state.reservations').map((v, i) => {
    const p = `state.reservations[${i}]`; const r = expectObject(v, p);
    const restaurant = restaurantOf(expectString(r, 'restaurant_id', p), p);
    const row: ReservationRow = {
      id: expectId(r, 'id', p), reference: expectString(r, 'reference', p),
      user_id: knownUser(expectString(r, 'user_id', p), p),
      restaurant_id: restaurant.id, table_ids: exportedTableIds(r, p, stage1),
      party_size: expectInteger(r, 'party_size', p, 1), status: expectString(r, 'status', p) as ReservationStatus,
      starts_at_local: expectString(r, 'starts_at_local', p), starts_at: expectString(r, 'starts_at', p),
      ends_at: expectString(r, 'ends_at', p), start_ms: expectInteger(r, 'start_ms', p, -8.64e15),
      end_ms: expectInteger(r, 'end_ms', p, -8.64e15), created_at: expectString(r, 'created_at', p),
      revision: legacy ? 1 : expectInteger(r, 'revision', p, 1),
      accepted_terms: legacy ? policyZero(restaurant) : parseTerms(r.accepted_terms, `${p}.accepted_terms`, restaurant),
      series_id: legacy ? null : optionalId(r, 'series_id', p),
      series_index: legacy || r.series_index === null ? null : expectInteger(r, 'series_index', p, 0),
      exception: legacy ? false : r.exception === true,
    };
    const [a, b, ...rest] = row.table_ids;
    const knownTables = row.table_ids.length > 0 && row.table_ids.every((id) => restaurant.tables.some((t) => t.id === id));
    if (!knownTables || rest.length > 0 || (b !== undefined && !declaredPair(restaurant, a, b))) {
      throw validationFailed(`${p} names an unknown table or combination`);
    }
    if (!REFERENCE_PATTERN.test(row.reference)) throw validationFailed(`${p}.reference is malformed`);
    if (!RESERVATION_STATUSES.includes(row.status)) throw validationFailed(`${p}.status is unknown`);
    if (row.series_id !== null && (!seriesIds.has(row.series_id) || row.series_index === null)) {
      throw validationFailed(`${p} names an unknown series`);
    }
    if (!parseLocalDateTime(row.starts_at_local) || Date.parse(row.starts_at) !== row.start_ms
      || Date.parse(row.ends_at) !== row.end_ms || row.end_ms <= row.start_ms
      || Number.isNaN(Date.parse(row.created_at))) {
      throw validationFailed(`${p} has inconsistent times`);
    }
    return row;
  });
  const reservationsById = new Map(reservations.map((r) => [r.id, r]));

  const history: HistoryRow[] = legacy ? reservations.flatMap(initialHistory)
    : expectArray(s.history, 'state.history').map((v, i) => {
      const p = `state.history[${i}]`; const o = expectObject(v, p);
      const owner = reservationsById.get(expectString(o, 'reservation_id', p));
      if (!owner) throw validationFailed(`${p} names an unknown reservation`);
      const event = expectString(o, 'event', p);
      if (!HISTORY_EVENTS.includes(event)) throw validationFailed(`${p}.event is unknown`);
      const changes = expectArray(o.changes, `${p}.changes`).map((c, j) => {
        const q = `${p}.changes[${j}]`; const ch = expectObject(c, q);
        return { field: expectString(ch, 'field', q), from: ch.from ?? null, to: ch.to ?? null };
      });
      return { reservation_id: owner.id, seq: expectInteger(o, 'seq', p, 1), at: expectString(o, 'at', p),
        event: event as HistoryEvent, changes, revision: expectInteger(o, 'revision', p, 1),
        accepted_terms: parseTerms(o.accepted_terms, `${p}.accepted_terms`, restaurantOf(owner.restaurant_id, p)) };
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
  return { users, tokens, restaurants, restaurant_revisions, policies, reservations, history, series, idempotency };
}

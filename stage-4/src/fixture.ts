// POST /_test/reset fixtures (§3.3, §4) turned into a complete StoreState.
import { MAX_TABLES_PER_BOOKING, MS_PER_MINUTE, REFERENCE_PATTERN } from './constants';
import { hashPassword } from './auth';
import { validationFailed } from './errors';
import { overlaps } from './schedule';
import {
  expectArray, expectDistinct, expectId, expectInteger, expectObject, expectString, hasField, optionalArray,
  type JsonObject,
} from './shape';
import {
  RESERVATION_STATUSES, declaredPair, emailKey, initialHistory, parseRestaurant, type Restaurant, type ReservationRow,
  type ReservationStatus, type StoreState,
} from './state';
import { policyZero } from './terms';
import { formatInstant, formatLocalDateTime, formatUtcNow, parseLocalDateTime, resolveLocal } from './time';

interface SeedUser {
  id: string;
  email: string;
  password: string;
  display_name: string;
}

function parseUser(value: unknown, path: string): SeedUser {
  const u = expectObject(value, path);
  return {
    id: expectId(u, 'id', path),
    email: expectString(u, 'email', path),
    password: expectString(u, 'password', path),
    display_name: expectString(u, 'display_name', path),
  };
}

/**
 * A seeded reservation has the POST body's fields plus id, reference and user_id, and is
 * confirmed unless it carries `status: "cancelled"`. It may name `table_id` or `table_ids`.
 * Its start may be any date (including the past) and is not held to the slot grid; it must
 * name a real local time and declared tables that seat the party, and a confirmed seed must
 * not overlap another.
 */
function parseSeed(
  value: unknown, path: string, restaurants: Map<string, Restaurant>, userIds: Set<string>, createdAt: string,
): ReservationRow {
  const r = expectObject(value, path);
  const userId = expectId(r, 'user_id', path);
  if (!userIds.has(userId)) throw validationFailed(`${path}.user_id names an unknown user`);
  const reference = expectString(r, 'reference', path);
  if (!REFERENCE_PATTERN.test(reference)) throw validationFailed(`${path}.reference must match ${REFERENCE_PATTERN}`);
  const restaurant = restaurants.get(expectId(r, 'restaurant_id', path));
  if (!restaurant) throw validationFailed(`${path}.restaurant_id names an unknown restaurant`);
  const tableIds = seedTables(r, path, restaurant);
  const capacity = tableIds.reduce((sum, id) => sum + restaurant.tables.find((t) => t.id === id)!.capacity, 0);
  const partySize = expectInteger(r, 'party_size', path, 1);
  if (partySize > capacity) throw validationFailed(`${path}.party_size exceeds the tables' capacity`);
  const status = hasField(r, 'status') ? expectString(r, 'status', path) : 'confirmed';
  if (!RESERVATION_STATUSES.includes(status)) throw validationFailed(`${path}.status must be confirmed or cancelled`);
  const local = parseLocalDateTime(expectString(r, 'starts_at_local', path));
  if (!local) throw validationFailed(`${path}.starts_at_local must be a local YYYY-MM-DDTHH:MM`);
  const startMs = resolveLocal(restaurant.timezone, local);
  if (startMs === null) throw validationFailed(`${path}.starts_at_local does not exist in ${restaurant.timezone}`);
  const endMs = startMs + restaurant.reservation_duration_minutes * MS_PER_MINUTE;
  return {
    id: expectId(r, 'id', path),
    reference,
    user_id: userId,
    restaurant_id: restaurant.id,
    table_ids: tableIds,
    party_size: partySize,
    status: status as ReservationStatus,
    starts_at_local: formatLocalDateTime(local),
    starts_at: formatInstant(restaurant.timezone, startMs),
    ends_at: formatInstant(restaurant.timezone, endMs),
    start_ms: startMs,
    end_ms: endMs,
    created_at: createdAt,
    revision: 1,
    accepted_terms: policyZero(restaurant),
    series_id: null,
    series_index: null,
    exception: false,
  };
}

/** A seed's table set: `table_id` or `table_ids`, known tables, a pair only if declared. */
function seedTables(r: JsonObject, path: string, restaurant: Restaurant): string[] {
  if (hasField(r, 'table_id') === hasField(r, 'table_ids')) {
    throw validationFailed(`${path} must carry exactly one of table_id and table_ids`);
  }
  const ids = hasField(r, 'table_id')
    ? [expectId(r, 'table_id', path)]
    : expectArray(r.table_ids, `${path}.table_ids`);
  if (ids.length === 0 || ids.length > MAX_TABLES_PER_BOOKING || ids.some((id) => typeof id !== 'string')) {
    throw validationFailed(`${path}.table_ids must hold one table or a declared pair`);
  }
  const tableIds = ids as string[];
  if (!tableIds.every((id) => restaurant.tables.some((t) => t.id === id))) {
    throw validationFailed(`${path} names a table that is not in that restaurant`);
  }
  if (tableIds.length === 2) {
    const pair = declaredPair(restaurant, tableIds[0], tableIds[1]);
    if (!pair) throw validationFailed(`${path}.table_ids is not a declared combination`);
    return [...pair];
  }
  return tableIds;
}

/** Validates a whole fixture (422 on any defect) and hashes its passwords. */
export async function stateFromFixture(value: unknown): Promise<StoreState> {
  const fx = expectObject(value, 'fixture');
  const users = optionalArray(fx, 'users', 'fixture').map((u, i) => parseUser(u, `users[${i}]`));
  expectDistinct(users.map((u) => u.id), 'user id');
  expectDistinct(users.map((u) => emailKey(u.email)), 'user email');
  const restaurants = optionalArray(fx, 'restaurants', 'fixture').map((r, i) => parseRestaurant(r, `restaurants[${i}]`));
  expectDistinct(restaurants.map((r) => r.id), 'restaurant id');
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const createdAt = formatUtcNow();
  const userIds = new Set(users.map((u) => u.id));
  const reservations = optionalArray(fx, 'reservations', 'fixture').map((r, i) =>
    parseSeed(r, `reservations[${i}]`, byId, userIds, createdAt));
  expectDistinct(reservations.map((r) => r.id), 'reservation id');
  expectDistinct(reservations.map((r) => r.reference), 'reservation reference');
  reservations.forEach((r, i) => {
    const confirmed = (x: ReservationRow) => x.status === 'confirmed';
    if (confirmed(r) && reservations.some((o, j) => j < i && confirmed(o) && o.restaurant_id === r.restaurant_id && overlaps(o, r))) {
      throw validationFailed(`reservations[${i}] overlaps another seeded reservation`);
    }
  });
  const hashes = await Promise.all(users.map((u) => hashPassword(u.password)));
  return {
    users: users.map((u, i) => ({ id: u.id, email: u.email, password_hash: hashes[i], display_name: u.display_name })),
    tokens: [],
    restaurants,
    restaurant_revisions: {},
    policies: [],
    reservations,
    history: reservations.flatMap(initialHistory),
    series: [],
    plans: [],
    closures: [],
    idempotency: [],
  };
}

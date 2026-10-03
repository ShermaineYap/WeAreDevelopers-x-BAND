// POST /_test/reset fixtures (§3.3, §4) turned into a complete StoreState.
import { MS_PER_MINUTE, REFERENCE_PATTERN } from './constants';
import { hashPassword } from './auth';
import { validationFailed } from './errors';
import { overlaps } from './schedule';
import {
  expectDistinct, expectId, expectInteger, expectObject, expectString, optionalArray,
} from './shape';
import { emailKey, parseRestaurant, type Restaurant, type ReservationRow, type StoreState } from './state';
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
 * A seeded reservation is a confirmed booking with the POST body's fields plus id, reference
 * and user_id. Its start may be any date (including the past) and is not held to the slot
 * grid; it must name a real local time, fit its table and not overlap another seed.
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
  const tableId = expectId(r, 'table_id', path);
  const table = restaurant.tables.find((t) => t.id === tableId);
  if (!table) throw validationFailed(`${path}.table_id is not a table of that restaurant`);
  const partySize = expectInteger(r, 'party_size', path, 1);
  if (partySize > table.capacity) throw validationFailed(`${path}.party_size exceeds the table's capacity`);
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
    table_id: tableId,
    party_size: partySize,
    status: 'confirmed',
    starts_at_local: formatLocalDateTime(local),
    starts_at: formatInstant(restaurant.timezone, startMs),
    ends_at: formatInstant(restaurant.timezone, endMs),
    start_ms: startMs,
    end_ms: endMs,
    created_at: createdAt,
  };
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
    if (reservations.some((o, j) => j < i && o.restaurant_id === r.restaurant_id && overlaps(o, r))) {
      throw validationFailed(`reservations[${i}] overlaps another seeded reservation`);
    }
  });
  const hashes = await Promise.all(users.map((u) => hashPassword(u.password)));
  return {
    users: users.map((u, i) => ({ id: u.id, email: u.email, password_hash: hashes[i], display_name: u.display_name })),
    tokens: [],
    restaurants,
    reservations,
    idempotency: [],
  };
}

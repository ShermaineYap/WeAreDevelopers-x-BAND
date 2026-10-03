// Stage-2 helpers: a fixture with combinable pairs and human table labels. Builds on lib.mjs.
import { PASSWORD, USERS, THU, FRI, MON, post, newKey, assertStatus } from './lib.mjs';

export * from './lib.mjs';

/**
 * r_pairs (Europe/Berlin, thu+fri 18:00-23:00, 30-minute slots, 90-minute stays).
 * Tables in fixture order: t_1 Window(2), t_2 Bar(4), t_3 Garden(2), t_4 Terrace(8).
 * Pairs, in combinable order: [t_2,t_1] (6), [t_2,t_3] (6), [t_3,t_4] (10).
 * {t_1,t_3} is NOT combinable (non-transitive through t_2).
 */
export const PAIRS = {
  id: 'r_pairs', name: 'Harbour Kitchen', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
  opening_hours: [{ weekday: 'thu', opens: '18:00', closes: '23:00' }, { weekday: 'fri', opens: '18:00', closes: '23:00' }],
  tables: [
    { id: 't_1', label: 'Window', capacity: 2 },
    { id: 't_2', label: 'Bar', capacity: 4 },
    { id: 't_3', label: 'Garden', capacity: 2 },
    { id: 't_4', label: 'Terrace', capacity: 8 },
  ],
  combinable: [['t_2', 't_1'], ['t_2', 't_3'], ['t_3', 't_4']],
};

export const TWO = {
  id: 'r_two', name: 'Little Fig', timezone: 'Europe/Berlin', slot_minutes: 60,
  reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120,
  opening_hours: [{ weekday: 'thu', opens: '17:00', closes: '22:00' }, { weekday: 'fri', opens: '17:00', closes: '22:00' }],
  tables: [{ id: 't_x', label: 'Alcove', capacity: 4 }, { id: 't_y', label: 'Booth', capacity: 4 }],
};

export const UTC2 = {
  id: 'r_utc2', name: 'Night Owl', timezone: 'UTC', slot_minutes: 30,
  reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120,
  opening_hours: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(w => ({ weekday: w, opens: '00:00', closes: '23:30' })),
  tables: [{ id: 't_n1', label: 'Corner', capacity: 4 }, { id: 't_n2', label: 'Hall', capacity: 4 }],
  combinable: [['t_n1', 't_n2']],
};

export function fixture2({ users, reservations = [], restaurants } = {}) {
  return {
    users: users ?? Object.values(USERS),
    restaurants: restaurants ?? [structuredClone(PAIRS), structuredClone(TWO), structuredClone(UTC2)],
    reservations,
  };
}

export async function reset2(fx = fixture2()) {
  const r = await post('/_test/reset', fx, { timeout: 10000 });
  assertStatus(r, 204);
}

export async function login2(u) {
  const r = await post('/auth/login', { email: u.email, password: u.password ?? PASSWORD });
  assertStatus(r, 200);
  return r.body.token;
}

export async function world2(fx) {
  await reset2(fx);
  return { ada: await login2(USERS.ada), bob: await login2(USERS.bob), cy: await login2(USERS.cy) };
}

export function body2(over = {}) {
  const b = { restaurant_id: 'r_pairs', starts_at_local: `${THU}T19:00`, party_size: 2, ...over };
  if (!('table_id' in over) && !('table_ids' in over)) b.table_id = 't_1';
  return b;
}

export const book2 = (token, over = {}, key = newKey()) => post('/reservations', body2(over), { token, key });

export { THU, FRI, MON };

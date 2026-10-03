// Stage-3 helpers: managed restaurants, policies, history, decision, series. Builds on lib2.mjs.
import assert from 'node:assert/strict';
import { PASSWORD, USERS, THU, post, get, patch, newKey, assertStatus, addDays, todayIn, weekday } from './lib2.mjs';

export * from './lib2.mjs';

export const MAX = { id: 'u_max', email: 'max@example.com', password: PASSWORD, display_name: 'Max' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const allWeek = (opens = '18:00', closes = '23:00') => ALL.map(w => ({ weekday: w, opens, closes }));

/** r_pol (Europe/Berlin): Window(2), Bar(4), Garden(6); pair [t_2,t_1]; every day 18:00-23:00; 30/90/120. */
export const POL = {
  id: 'r_pol', name: 'Policy House', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120, opening_hours: allWeek(),
  tables: [{ id: 't_1', label: 'Window', capacity: 2 }, { id: 't_2', label: 'Bar', capacity: 4 }, { id: 't_3', label: 'Garden', capacity: 6 }],
  combinable: [['t_2', 't_1']],
  manager_user_ids: ['u_max'],
};
/** r_soon (UTC): every day 00:00-23:30; 30/60/120; for cutoff tests close to now. */
export const SOON = {
  id: 'r_soon', name: 'Corner Cafe', timezone: 'UTC', slot_minutes: 30,
  reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120, opening_hours: allWeek('00:00', '23:30'),
  tables: [{ id: 't_s1', label: 'Nook', capacity: 4 }, { id: 't_s2', label: 'Sofa', capacity: 4 }],
  manager_user_ids: ['u_max'],
};
/** r_dst (Europe/Berlin): Sundays 00:00-08:00; 30/90/0. */
export const DST = {
  id: 'r_dst', name: 'Night Kitchen', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 0,
  opening_hours: [{ weekday: 'sun', opens: '00:00', closes: '08:00' }],
  tables: [{ id: 't_d1', label: 'Hearth', capacity: 4 }],
};
/** r_other: a second managed restaurant, for per-restaurant version numbering. */
export const OTHER = {
  id: 'r_other3', name: 'Other Place', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120, opening_hours: allWeek(),
  tables: [{ id: 't_o', label: 'Only', capacity: 4 }], manager_user_ids: ['u_max'],
};

export function fixture3({ reservations = [], restaurants } = {}) {
  return {
    users: [...Object.values(USERS), MAX],
    restaurants: restaurants ?? [structuredClone(POL), structuredClone(SOON), structuredClone(DST), structuredClone(OTHER)],
    reservations,
  };
}

export async function world3(fx = fixture3()) {
  assertStatus(await post('/_test/reset', fx, { timeout: 10000 }), 204);
  const tok = async (u) => (await post('/auth/login', { email: u.email, password: PASSWORD })).body.token;
  return { ada: await tok(USERS.ada), bob: await tok(USERS.bob), cy: await tok(USERS.cy), max: await tok(MAX) };
}

/** A complete policy for r_pol that equals its fixture rules unless overridden. */
export function policy(effective_from, over = {}) {
  return {
    effective_from, slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
    opening_hours: allWeek(), capacities: { t_1: 2, t_2: 4, t_3: 6 }, ...over,
  };
}

export const publish = (token, body, { rid = 'r_pol', key = newKey() } = {}) =>
  post(`/restaurants/${rid}/policies`, body, { token, key });

export async function mustPublish(token, body, opts) {
  const r = await publish(token, body, opts);
  assertStatus(r, 201);
  return r.body;
}

export function bookP(token, over = {}, key = newKey()) {
  const b = { restaurant_id: 'r_pol', starts_at_local: `${THU}T19:00`, party_size: 2, ...over };
  if (!('table_id' in over) && !('table_ids' in over)) b.table_id = 't_2';
  return post('/reservations', b, { token, key });
}

export async function mustBookP(token, over = {}) {
  const r = await bookP(token, over);
  assertStatus(r, 201);
  return r.body;
}

export const history = (ref, token) => get(`/reservations/${ref}/history`, { token });
export const decision = (ref, token) => get(`/reservations/${ref}/decision`, { token });
export const amend = (ref, body, token) => patch(`/reservations/${ref}`, body, { token });
export const cancel = (ref, token) => post(`/reservations/${ref}/cancel`, {}, { token });
export const adopt = (token, body, key = newKey()) => post('/series', body, { token, key });

export async function entries(ref, token) {
  const r = await history(ref, token);
  assertStatus(r, 200);
  return r.body.entries;
}

/** Policy 0 terms of r_pol as accepted_terms should report them. */
export const POL_TERMS0 = {
  policy_version: 0, slot_minutes: 30, reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
  opening_hours: allWeek(), capacities: { t_1: 2, t_2: 4, t_3: 6 },
};

/** Compares accepted_terms ignoring opening_hours entry order. */
export function assertTerms(actual, expected, msg) {
  const norm = (t) => ({ ...t, opening_hours: [...t.opening_hours].map(h => ({ weekday: h.weekday, opens: h.opens, closes: h.closes })).sort((a, b) => a.weekday.localeCompare(b.weekday)) });
  assert.deepEqual(norm(actual), norm(expected), msg);
}

/** Next Sunday-of-month DST dates in Europe/Berlin for a year after this one. */
export function berlinTransitions() {
  const y = Number(todayIn('Europe/Berlin').slice(0, 4)) + 1;
  const lastSunday = (m) => { let d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== 0) d = new Date(d - 86400000); return d.toISOString().slice(0, 10); };
  return { spring: lastSunday(2), fall: lastSunday(9) };
}

export const SOON_DAY = addDays(todayIn('UTC'), 3);
export { addDays, weekday, THU };

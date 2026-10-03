// Shared helpers for the stage-1 acceptance tests. Black-box HTTP only; no product code.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
export const PASSWORD = 'correct horse';

export async function req(method, path, { token, key, body, raw, headers = {}, timeout = 10000 } = {}) {
  const h = { ...headers };
  if (token !== undefined) h.Authorization = `Bearer ${token}`;
  if (key !== undefined) h['Idempotency-Key'] = key;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const t0 = Date.now();
  const res = await fetch(BASE_URL + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, body: json, text, headers: res.headers, ms: Date.now() - t0 };
}

export const get = (path, opts) => req('GET', path, opts);
export const post = (path, body, opts = {}) => req('POST', path, { ...opts, body });
export const patch = (path, body, opts = {}) => req('PATCH', path, { ...opts, body });
export const newKey = () => `k-${randomUUID()}`;

export function assertError(res, status, code) {
  assert.equal(res.status, status, `expected ${status} ${code}, got ${res.status} ${res.text}`);
  assert.ok(res.body && typeof res.body.error === 'object', `error envelope missing: ${res.text}`);
  assert.equal(res.body.error.code, code, `expected code ${code}, got ${res.text}`);
  assert.equal(typeof res.body.error.message, 'string');
}

export function assertStatus(res, status) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status} ${res.text}`);
}

// ---------- calendar helpers (Intl only, no deps) ----------

function offsetAt(zone, ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName').value; // "GMT+02:00" | "GMT"
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

function fmtOffset(min) {
  const s = min < 0 ? '-' : '+'; const a = Math.abs(min);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function localParts(zone, ms) {
  const o = offsetAt(zone, ms);
  const d = new Date(ms + o * 60000).toISOString(); // YYYY-MM-DDTHH:MM:SS
  return { local: d.slice(0, 19), offset: fmtOffset(o) };
}

/** RFC 3339 string a correct service returns for local 'YYYY-MM-DDTHH:MM' in zone (first occurrence). null in a gap. */
export function expectedInstant(zone, local) {
  const naive = Date.parse(local + ':00Z');
  const cands = new Set([offsetAt(zone, naive - 86400000), offsetAt(zone, naive), offsetAt(zone, naive + 86400000)]);
  const valid = [...cands].filter(o => offsetAt(zone, naive - o * 60000) === o);
  if (!valid.length) return null;
  const o = Math.max(...valid); // larger offset = earlier instant = first occurrence
  return { ms: naive - o * 60000, rfc: `${local}:00${fmtOffset(o)}` };
}

/** RFC 3339 for an instant shown in zone. */
export function rfcIn(zone, ms) { const p = localParts(zone, ms); return p.local + p.offset; }

export function sameInstant(a, b) { return Date.parse(a) === Date.parse(b); }

export function addDays(date, n) {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function weekday(date) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
}
export function todayIn(zone) { return localParts(zone, Date.now()).local.slice(0, 10); }

// Dates relative to now so cutoffs never interfere: next Thursday at least 21 days ahead.
let d = addDays(todayIn('Europe/Berlin'), 21);
while (weekday(d) !== 'thu') d = addDays(d, 1);
export const THU = d;
export const FRI = addDays(THU, 1);
export const MON = addDays(THU, 4); // closed at r_anker
export const YESTERDAY_UTC = addDays(todayIn('UTC'), -1);
export const SOON_UTC = addDays(todayIn('UTC'), 20); // within r_long's 100000-minute cutoff

// ---------- fixture ----------

const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const user = (id, name) => ({ id, email: `${name.toLowerCase()}@example.com`, password: PASSWORD, display_name: name });
export const USERS = { ada: user('u_ada', 'Ada'), bob: user('u_bob', 'Bob'), cy: user('u_cy', 'Cy') };

export function fixture({ users, extraRestaurants = [], reservations = [] } = {}) {
  return {
    users: users ?? Object.values(USERS),
    restaurants: [
      {
        id: 'r_anker', name: 'Zum Anker', timezone: 'Europe/Berlin', slot_minutes: 30,
        reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
        opening_hours: [{ weekday: 'thu', opens: '18:00', closes: '23:00' }, { weekday: 'fri', opens: '18:00', closes: '23:30' }],
        // Deliberately not in id or capacity order: availability must follow fixture order.
        tables: [{ id: 't_1', label: '1', capacity: 2 }, { id: 't_3', label: '3', capacity: 6 }, { id: 't_2', label: '2', capacity: 4 }],
      },
      {
        id: 'r_other', name: 'Other', timezone: 'Europe/Berlin', slot_minutes: 30,
        reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120,
        opening_hours: [{ weekday: 'thu', opens: '18:00', closes: '23:00' }],
        tables: [{ id: 't_9', label: '9', capacity: 4 }],
      },
      {
        id: 'r_odd', name: 'Odd', timezone: 'Europe/Berlin', slot_minutes: 45,
        reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120,
        opening_hours: [{ weekday: 'thu', opens: '18:00', closes: '21:00' }],
        tables: [{ id: 't_o1', label: 'O1', capacity: 4 }],
      },
      ...['Europe/Berlin', 'America/New_York'].map((tz, i) => ({
        id: i ? 'r_ny' : 'r_berlin', name: tz, timezone: tz, slot_minutes: 30,
        reservation_duration_minutes: 90, cancellation_cutoff_minutes: 0,
        opening_hours: [{ weekday: 'sun', opens: '00:00', closes: '08:00' }],
        tables: [{ id: i ? 't_ny1' : 't_be1', label: '1', capacity: 4 }, { id: i ? 't_ny2' : 't_be2', label: '2', capacity: 4 }],
      })),
      {
        id: 'r_utc', name: 'UTC', timezone: 'UTC', slot_minutes: 30,
        reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120,
        opening_hours: ALL.map(w => ({ weekday: w, opens: '00:00', closes: '23:30' })),
        tables: [{ id: 't_u1', label: 'U1', capacity: 4 }, { id: 't_u2', label: 'U2', capacity: 4 }],
      },
      {
        id: 'r_long', name: 'Long cutoff', timezone: 'UTC', slot_minutes: 30,
        reservation_duration_minutes: 60, cancellation_cutoff_minutes: 100000,
        opening_hours: ALL.map(w => ({ weekday: w, opens: '00:00', closes: '23:30' })),
        tables: [{ id: 't_l1', label: 'L1', capacity: 4 }],
      },
      ...extraRestaurants,
    ],
    reservations,
  };
}

export async function reset(fx = fixture()) {
  const r = await post('/_test/reset', fx, { timeout: 10000 });
  assertStatus(r, 204);
}

export async function login(u) {
  const r = await post('/auth/login', { email: u.email, password: u.password ?? PASSWORD });
  assertStatus(r, 200);
  return r.body.token;
}

/** Reset with the default fixture; returns tokens for ada, bob, cy. */
export async function world(fx) {
  await reset(fx);
  return { ada: await login(USERS.ada), bob: await login(USERS.bob), cy: await login(USERS.cy) };
}

export function bookBody(over = {}) {
  return { restaurant_id: 'r_anker', table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 4, ...over };
}

export async function book(token, over = {}, key = newKey()) {
  return post('/reservations', bookBody(over), { token, key });
}

export async function mustBook(token, over = {}) {
  const r = await book(token, over);
  assertStatus(r, 201);
  return r.body;
}

export async function availability(rid, date, party, extra = '') {
  return get(`/availability?restaurant_id=${encodeURIComponent(rid)}&date=${encodeURIComponent(date)}&party_size=${encodeURIComponent(party)}${extra}`);
}

export async function slotMap(rid, date, party) {
  const r = await availability(rid, date, party);
  assertStatus(r, 200);
  return Object.fromEntries(r.body.slots.map(s => [s.starts_at_local.slice(11), s.available_table_ids]));
}

export async function burst(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i).catch(e => ({ status: 0, error: e, text: String(e), ms: 99999 }))));
}

export function tally(results) {
  const c = {};
  for (const r of results) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

export function noServerErrors(results) {
  for (const r of results) {
    assert.ok(r.status > 0, `request failed or timed out: ${r.text}`);
    assert.ok(r.status < 500, `5xx under load: ${r.status} ${r.text}`);
  }
}

// Stage 2 "Existing clients after an upgrade": a stage-1 export imported into this service.
// Needs the stage-1 service running at PREVIOUS_BASE_URL; skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_URL, get, post, fixture, USERS, PASSWORD, THU, bookBody, newKey, assertError, assertStatus, availability,
} from './lib2.mjs';

const PREV = (process.env.PREVIOUS_BASE_URL || '').replace(/\/+$/, '');
const skip = PREV ? false : 'set PREVIOUS_BASE_URL to the stage-1 service to run upgrade checks';

async function prev(method, path, { token, key, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(PREV + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : undefined, text };
}

test('S2-035 S2-037 a stage-1 export imports into stage 2 with tokens, logins, receipts and failed keys intact', { skip }, async () => {
  assert.notEqual(PREV, BASE_URL, 'PREVIOUS_BASE_URL must be a different service');
  assertStatus(await prev('POST', '/_test/reset', { body: fixture() }), 204);
  const ada = (await prev('POST', '/auth/login', { body: { email: USERS.ada.email, password: PASSWORD } })).body.token;
  const signup = await prev('POST', '/auth/signup', { body: { email: 'old@example.com', password: 'old client pass', display_name: 'Old' } });
  assertStatus(signup, 201);
  const key = newKey();
  const first = await prev('POST', '/reservations', { token: ada, key, body: bookBody() });
  assertStatus(first, 201);
  const cancelled = await prev('POST', '/reservations', { token: ada, key: newKey(), body: bookBody({ table_id: 't_3', starts_at_local: `${THU}T21:00` }) });
  assertStatus(await prev('POST', `/reservations/${cancelled.body.reference}/cancel`, { token: ada, body: {} }), 200);
  const failedKey = newKey();
  assertStatus(await prev('POST', '/reservations', { token: signup.body.token, key: failedKey, body: bookBody({ party_size: 0 }) }), 422);
  const moveKey = newKey();
  const moveBody = { moves: [{ reference: first.body.reference, party_size: 3 }] };
  const moved = await prev('POST', '/reservation-moves', { token: ada, key: moveKey, body: moveBody });
  assertStatus(moved, 201);
  const exported = await prev('GET', '/_test/export');
  assertStatus(exported, 200);

  // Destination holds unrelated stage-2 state that import must replace.
  assertStatus(await post('/_test/reset', fixture({ users: [] })), 204);
  assertStatus(await post('/_test/import', exported.body, { timeout: 10000 }), 204);

  // Existing bearer tokens keep working; the reservation is the same and carries the stage-2 shape.
  const mine = await get(`/reservations/${first.body.reference}`, { token: ada });
  assertStatus(mine, 200);
  assert.equal(mine.body.reservation_id, first.body.reservation_id);
  assert.equal(mine.body.created_at, first.body.created_at);
  assert.equal(mine.body.party_size, 3);
  assert.equal(mine.body.table_id, 't_2');
  assert.deepEqual(mine.body.table_ids, ['t_2']);
  assert.equal((await get(`/reservations/${cancelled.body.reference}`, { token: ada })).body.status, 'cancelled');
  // A retry whose response was lost before the upgrade replays the original.
  const rep = await post('/reservations', bookBody(), { token: ada, key });
  assertStatus(rep, 200);
  assert.equal(rep.body.reference, first.body.reference);
  assert.equal(rep.body.reservation_id, first.body.reservation_id);
  assert.equal(rep.body.party_size, 4, 'the replay is the original response, not the current state');
  assertError(await post('/reservations', bookBody({ party_size: 2 }), { token: ada, key }), 409, 'idempotency_key_reuse');
  const mrep = await post('/reservation-moves', moveBody, { token: ada, key: moveKey });
  assertStatus(mrep, 200);
  assert.equal(mrep.body.reservations[0].reference, first.body.reference);
  // Failed keys stay reusable; hashed passwords still log in; signup tokens still work.
  assertStatus(await post('/reservations', bookBody({ table_id: 't_1', party_size: 2 }), { token: signup.body.token, key: failedKey }), 201);
  assertStatus(await post('/auth/login', { email: 'old@example.com', password: 'old client pass' }), 200);
  assertError(await post('/auth/login', { email: 'old@example.com', password: 'wrong pass' }), 401, 'unauthenticated');
  // Stage-2 behaviour applies to imported restaurants (no combinable pairs: singles only).
  const av = await availability('r_anker', THU, 2);
  assertStatus(av, 200);
  const s = av.body.slots.find(x => x.starts_at_local === `${THU}T19:00`);
  assert.deepEqual(s.available_options.map(o => o.table_ids), s.available_table_ids.map(id => [id]));
  // Imported bookings occupy their tables.
  assertError(await post('/reservations', bookBody(), { token: signup.body.token, key: newKey() }), 409, 'table_unavailable');
});

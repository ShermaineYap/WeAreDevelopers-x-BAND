import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, req, reset, world, fixture, login, USERS, THU, FRI, PASSWORD,
  assertError, assertStatus, mustBook, slotMap, newKey,
} from './lib.mjs';

test('S1-001 GET /health is 200 {"status":"ok"}', async () => {
  const r = await get('/health');
  assertStatus(r, 200);
  assert.deepEqual(r.body, { status: 'ok' });
});

test('S1-003 POST /_test/reset is 204 without authentication', async () => {
  const r = await post('/_test/reset', fixture());
  assertStatus(r, 204);
});

test('S1-004 reset replaces users, restaurants, reservations and tokens', async () => {
  const t = await world();
  const signup = await post('/auth/signup', { email: 'new@example.com', password: PASSWORD, display_name: 'New' });
  assertStatus(signup, 201);
  await mustBook(t.ada);
  await reset(fixture({ users: [USERS.bob] }));
  assertError(await post('/auth/login', { email: USERS.ada.email, password: PASSWORD }), 401, 'unauthenticated');
  assertError(await post('/auth/login', { email: 'new@example.com', password: PASSWORD }), 401, 'unauthenticated');
  assertError(await get('/reservations', { token: t.ada }), 401, 'unauthenticated');
  assertError(await get('/reservations', { token: signup.body.token }), 401, 'unauthenticated');
  const bob = await login(USERS.bob);
  assert.deepEqual((await get('/reservations', { token: bob })).body, { reservations: [] });
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3', 't_2']);
  // The new fixture's restaurant set only.
  const fx = fixture(); fx.restaurants = [fx.restaurants[0]];
  await reset(fx);
  const list = await get('/restaurants');
  assert.deepEqual(list.body.restaurants.map(r => r.id), ['r_anker']);
  assertError(await get('/restaurants/r_other'), 404, 'not_found');
});

test('S1-005 repeated resets are supported', async () => {
  for (let i = 0; i < 3; i++) await reset();
  const t = await world();
  await mustBook(t.ada);
});

test('S1-006 responses are application/json; charset=utf-8', async () => {
  const t = await world();
  for (const r of [await get('/health'), await get('/restaurants'), await get('/reservations', { token: t.ada }),
    await get('/reservations', {}), await get('/restaurants/nope')]) {
    const ct = r.headers.get('content-type') || '';
    assert.match(ct, /^application\/json/i, `content-type was ${ct}`);
    assert.match(ct, /charset=utf-8/i, `content-type was ${ct}`);
  }
});

test('S1-008 unknown body fields are ignored on signup, login, reservations and PATCH', async () => {
  const t = await world();
  assertStatus(await post('/auth/signup', { email: 'x@example.com', password: PASSWORD, display_name: 'X', admin: true, extra: { a: 1 } }), 201);
  assertStatus(await post('/auth/login', { email: 'x@example.com', password: PASSWORD, remember: true }), 200);
  const b = await mustBook(t.ada, { note: 'window please', status: 'cancelled' });
  assert.equal(b.status, 'confirmed');
  const p = await patch(`/reservations/${b.reference}`, { party_size: 3, reference: 'ZZZZZZ', colour: 'red' }, { token: t.ada });
  assertStatus(p, 200);
  assert.equal(p.body.reference, b.reference);
  assert.equal(p.body.party_size, 3);
  assertStatus(await post(`/reservations/${b.reference}/cancel`, { reason: 'x' }, { token: t.ada }), 200);
});

test('S1-010 reset rejects a fixture ID longer than 64 characters', async () => {
  for (const fx of [
    fixture({ users: [{ ...USERS.ada, id: 'u'.repeat(65) }] }),
    (() => { const f = fixture(); f.restaurants[0].id = 'r'.repeat(65); return f; })(),
    (() => { const f = fixture(); f.restaurants[0].tables[0].id = 't'.repeat(65); return f; })(),
  ]) assertError(await post('/_test/reset', fx), 422, 'validation_failed');
});

test('S1-011 reset accepts IDs of exactly 64 characters', async () => {
  const f = fixture({ users: [{ ...USERS.ada, id: 'u'.repeat(64) }] });
  f.restaurants[0].id = 'r'.repeat(64);
  f.restaurants[0].tables[2].id = 't'.repeat(64);
  await reset(f);
  const tok = await login(USERS.ada);
  const r = await post('/reservations', { restaurant_id: 'r'.repeat(64), table_id: 't'.repeat(64), starts_at_local: `${THU}T19:00`, party_size: 4 }, { token: tok, key: newKey() });
  assertStatus(r, 201);
});

const seeded = (over = {}) => ({
  id: 'res_seed', reference: 'SEED01', user_id: 'u_ada', restaurant_id: 'r_anker',
  table_id: 't_2', starts_at_local: `${FRI}T19:00`, party_size: 4, ...over,
});

test('S1-013 seeded reservations are confirmed, owned by user_id, and occupy their table', async () => {
  const t = await world(fixture({ reservations: [seeded()] }));
  const r = await get('/reservations/SEED01', { token: t.ada });
  assertStatus(r, 200);
  assert.equal(r.body.reservation_id, 'res_seed');
  assert.equal(r.body.reference, 'SEED01');
  assert.equal(r.body.status, 'confirmed');
  assert.equal(r.body.starts_at_local, `${FRI}T19:00`);
  assertError(await get('/reservations/SEED01', { token: t.bob }), 404, 'not_found');
  const slots = await slotMap('r_anker', FRI, 4);
  assert.deepEqual(slots['19:00'], ['t_3']);
  assertError(await post('/reservations', { restaurant_id: 'r_anker', table_id: 't_2', starts_at_local: `${FRI}T20:00`, party_size: 2 }, { token: t.bob, key: newKey() }), 409, 'table_unavailable');
  assertStatus(await post('/reservations/SEED01/cancel', {}, { token: t.ada }), 200);
  assert.deepEqual((await slotMap('r_anker', FRI, 4))['19:00'], ['t_3', 't_2']);
});

test('S1-014 reset rejects seeded references outside A-Z0-9{6,12}', async () => {
  for (const reference of ['ABC12', 'lower01', 'ABCDEFGHIJKLM', 'AB-123']) {
    assertError(await post('/_test/reset', fixture({ reservations: [seeded({ reference })] })), 422, 'validation_failed');
  }
});

test('S1-017 every 4xx carries {"error":{"code","message"}}', async () => {
  await world();
  for (const r of [
    await get('/reservations'),
    await get('/restaurants/nope'),
    await get('/availability?restaurant_id=r_anker'),
    await req('POST', '/auth/login', { raw: '{not json' }),
  ]) {
    assert.ok(r.status >= 400 && r.status < 500);
    assert.equal(typeof r.body?.error?.code, 'string', r.text);
    assert.equal(typeof r.body?.error?.message, 'string', r.text);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, world, reset, fixture, login, USERS, THU, PASSWORD, assertError, assertStatus, mustBook,
  bookBody, newKey,
} from './lib.mjs';

const exportState = async () => { const r = await get('/_test/export', { timeout: 10000 }); assertStatus(r, 200); return r.body; };
const importState = (body) => post('/_test/import', body, { timeout: 10000 });

test('S1-036 passwords are never stored in plaintext (export carries no password)', async () => {
  await world();
  assertStatus(await post('/auth/signup', { email: 'p@example.com', password: 'very secret phrase', display_name: 'P' }), 201);
  const text = JSON.stringify(await exportState());
  assert.ok(!text.includes(PASSWORD), 'seeded plaintext password found in export');
  assert.ok(!text.includes('very secret phrase'), 'signed-up plaintext password found in export');
});

test('S1-091 export is 200 {track:"tablekeeper", format_version:1, state:{...}} without auth', async () => {
  await world();
  const e = await exportState();
  assert.equal(e.track, 'tablekeeper');
  assert.equal(e.format_version, 1);
  assert.equal(typeof e.state, 'object');
  assert.ok(e.state && !Array.isArray(e.state));
});

test('S1-092..094 import restores reservations, tokens, logins, idempotent receipts and reusable failed keys', async () => {
  const t = await world();
  const s = await post('/auth/signup', { email: 'sig@example.com', password: 'signup pass', display_name: 'Sig' });
  assertStatus(s, 201);
  const key = newKey();
  const first = await post('/reservations', bookBody(), { token: s.body.token, key });
  assertStatus(first, 201);
  const cancelled = await mustBook(t.ada, { table_id: 't_3', starts_at_local: `${THU}T21:00` });
  assertStatus(await post(`/reservations/${cancelled.reference}/cancel`, {}, { token: t.ada }), 200);
  const failedKey = newKey();
  assertError(await post('/reservations', bookBody({ party_size: 0 }), { token: s.body.token, key: failedKey }), 422, 'validation_failed');
  const adaList = (await get('/reservations', { token: t.ada })).body;
  const e = await exportState();

  await reset(fixture({ users: [] }));
  assertError(await get('/reservations', { token: s.body.token }), 401, 'unauthenticated');
  assertStatus(await importState(e), 204);

  // S1-092 reservations, references, statuses and timestamps unchanged.
  assert.deepEqual((await get(`/reservations/${first.body.reference}`, { token: s.body.token })).body, first.body);
  assert.deepEqual((await get('/reservations', { token: t.ada })).body, adaList);
  assert.deepEqual((await get('/restaurants/r_anker')).body.tables.map(x => x.id), ['t_1', 't_3', 't_2']);
  // S1-093 existing tokens and hashed-password login.
  assertStatus(await get('/reservations', { token: t.bob }), 200);
  const l = await post('/auth/login', { email: 'sig@example.com', password: 'signup pass' });
  assertStatus(l, 200);
  assert.equal(l.body.user_id, s.body.user_id);
  await login(USERS.ada);
  assertError(await post('/auth/login', { email: 'sig@example.com', password: 'wrong pass' }), 401, 'unauthenticated');
  assertError(await post('/auth/signup', { email: 'sig@example.com', password: 'signup pass', display_name: 'Sig' }), 409, 'email_taken');
  // S1-094 replay returns the original; a different body is still a reuse conflict; failed key reusable.
  const rep = await post('/reservations', bookBody(), { token: s.body.token, key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assertError(await post('/reservations', bookBody({ party_size: 3 }), { token: s.body.token, key }), 409, 'idempotency_key_reuse');
  assertStatus(await post('/reservations', bookBody({ table_id: 't_1', party_size: 2 }), { token: s.body.token, key: failedKey }), 201);
  // The occupancy came back too.
  assertError(await post('/reservations', bookBody(), { token: t.bob, key: newKey() }), 409, 'table_unavailable');
});

test('S1-095 import is replacement, and repeating it duplicates nothing', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const e = await exportState();
  const late = await post('/auth/signup', { email: 'late@example.com', password: PASSWORD, display_name: 'Late' });
  await mustBook(t.ada, { table_id: 't_3' });
  assertStatus(await importState(e), 204);
  assertStatus(await importState(e), 204);
  assertError(await post('/auth/login', { email: 'late@example.com', password: PASSWORD }), 401, 'unauthenticated');
  assertError(await get('/reservations', { token: late.body.token }), 401, 'unauthenticated');
  const list = (await get('/reservations', { token: t.ada })).body.reservations;
  assert.deepEqual(list.map(x => x.reference), [b.reference]);
  // Destination data that never existed in the source is gone too.
  await reset(fixture({ users: [{ id: 'u_zed', email: 'zed@example.com', password: PASSWORD, display_name: 'Zed' }] }));
  assertStatus(await importState(e), 204);
  assertError(await post('/auth/login', { email: 'zed@example.com', password: PASSWORD }), 401, 'unauthenticated');
  assert.deepEqual((await get('/reservations', { token: t.ada })).body.reservations.map(x => x.reference), [b.reference]);
});

test('S1-096 invalid imports are rejected and leave the destination unchanged', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const e = await exportState();
  // A different state the bad imports must not leak into.
  await reset(fixture({ users: [USERS.cy] }));
  const cy = await login(USERS.cy);
  const c = await mustBook(cy, { table_id: 't_3' });
  const bad = [
    { track: 'tablekeeper', format_version: 1 },
    { format_version: 1, state: e.state },
    { track: 'tablekeeper', state: e.state },
    { track: 'pocketful', format_version: 1, state: e.state },
    { track: 'tablekeeper', format_version: 2, state: e.state },
    { track: 'tablekeeper', format_version: 0, state: e.state },
    { track: 'tablekeeper', format_version: 1, state: { nonsense: true } },
    {},
  ];
  for (const body of bad) assertError(await importState(body), 422, 'validation_failed');
  assertError(await req('POST', '/_test/import', { raw: '{"track": "tablekeeper",' }), 400, 'malformed_request');
  // Destination unchanged: Cy's world is intact, nothing of the exported state leaked in.
  assert.deepEqual((await get('/reservations', { token: cy })).body.reservations.map(x => x.reference), [c.reference]);
  assertError(await get('/reservations', { token: t.ada }), 401, 'unauthenticated');
  assertError(await post('/auth/login', { email: USERS.ada.email, password: PASSWORD }), 401, 'unauthenticated');
  assertError(await get(`/reservations/${b.reference}`, { token: cy }), 404, 'not_found');
  assert.deepEqual((await get('/restaurants/r_anker')).body.tables.length, 3);
});

test('S1-097 an export is a snapshot; importing it later drops subsequent writes', async () => {
  const t = await world();
  const a = await mustBook(t.ada);
  const e = await exportState();
  const snapshot = JSON.stringify(e);
  const b = await mustBook(t.ada, { table_id: 't_3' });
  assertStatus(await post(`/reservations/${a.reference}/cancel`, {}, { token: t.ada }), 200);
  assert.notDeepEqual(await exportState(), e);
  assert.equal(JSON.stringify(e), snapshot);
  assertStatus(await importState(e), 204);
  assert.equal((await get(`/reservations/${a.reference}`, { token: t.ada })).body.status, 'confirmed');
  assertError(await get(`/reservations/${b.reference}`, { token: t.ada }), 404, 'not_found');
});

test('S1-098 reset clears imported state', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const e = await exportState();
  await reset(fixture({ users: [] }));
  assertStatus(await importState(e), 204);
  await reset(fixture({ users: [USERS.bob] }));
  assertError(await get('/reservations', { token: t.ada }), 401, 'unauthenticated');
  assertError(await post('/auth/login', { email: USERS.ada.email, password: PASSWORD }), 401, 'unauthenticated');
  const bob = await login(USERS.bob);
  assertError(await get(`/reservations/${b.reference}`, { token: bob }), 404, 'not_found');
});

test('S1-099 export preserves batch-move receipts and their results', async () => {
  const t = await world();
  const a = await mustBook(t.ada, { table_id: 't_1', party_size: 2 });
  const key = newKey();
  const body = { moves: [{ reference: a.reference, starts_at_local: `${THU}T21:00` }] };
  const first = await post('/reservation-moves', body, { token: t.ada, key });
  assertStatus(first, 201);
  const e = await exportState();
  await reset(fixture({ users: [] }));
  assertStatus(await importState(e), 204);
  const rep = await post('/reservation-moves', body, { token: t.ada, key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal((await get(`/reservations/${a.reference}`, { token: t.ada })).body.starts_at_local, `${THU}T21:00`);
});

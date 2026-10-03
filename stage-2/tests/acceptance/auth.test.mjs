import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, req, world, USERS, PASSWORD, assertError, assertStatus, mustBook, newKey } from './lib.mjs';

test('S1-012 seeded users can log in immediately', async () => {
  await world();
  const r = await post('/auth/login', { email: USERS.ada.email, password: PASSWORD });
  assertStatus(r, 200);
  assert.equal(r.body.user_id, 'u_ada');
  assert.equal(r.body.display_name, 'Ada');
  assert.equal(typeof r.body.token, 'string');
});

test('S1-028 signup is 201 {user_id, display_name, token} and the token works', async () => {
  await world();
  const r = await post('/auth/signup', { email: 'dee@example.com', password: PASSWORD, display_name: 'Dee' });
  assertStatus(r, 201);
  assert.equal(typeof r.body.user_id, 'string');
  assert.ok(r.body.user_id.length >= 1 && r.body.user_id.length <= 64);
  assert.equal(r.body.display_name, 'Dee');
  assert.equal(typeof r.body.token, 'string');
  assert.deepEqual((await get('/reservations', { token: r.body.token })).body, { reservations: [] });
});

test('S1-029 login returns the same user_id as signup', async () => {
  await world();
  const s = await post('/auth/signup', { email: 'eve@example.com', password: PASSWORD, display_name: 'Eve' });
  const l = await post('/auth/login', { email: 'eve@example.com', password: PASSWORD });
  assertStatus(l, 200);
  assert.equal(l.body.user_id, s.body.user_id);
  assert.equal(l.body.display_name, 'Eve');
});

test('S1-030 duplicate email is 409 email_taken (seeded and signed-up)', async () => {
  await world();
  assertError(await post('/auth/signup', { email: USERS.ada.email, password: PASSWORD, display_name: 'A2' }), 409, 'email_taken');
  assertStatus(await post('/auth/signup', { email: 'f@example.com', password: PASSWORD, display_name: 'F' }), 201);
  assertError(await post('/auth/signup', { email: 'f@example.com', password: PASSWORD, display_name: 'F' }), 409, 'email_taken');
});

test('S1-031 password shorter than 8 is 422; exactly 8 is accepted', async () => {
  await world();
  assertError(await post('/auth/signup', { email: 'g@example.com', password: '1234567', display_name: 'G' }), 422, 'validation_failed');
  assertError(await post('/auth/signup', { email: 'g@example.com', password: '', display_name: 'G' }), 422, 'validation_failed');
  assertStatus(await post('/auth/signup', { email: 'g@example.com', password: '12345678', display_name: 'G' }), 201);
  assertStatus(await post('/auth/login', { email: 'g@example.com', password: '12345678' }), 200);
});

test('S1-032 email not of the form local@domain is 422', async () => {
  await world();
  for (const email of ['plain', '@example.com', 'local@', '', 'a b@example.com@x']) {
    assertError(await post('/auth/signup', { email, password: PASSWORD, display_name: 'H' }), 422, 'validation_failed');
  }
});

test('S1-033 wrong password or unknown email on login is 401', async () => {
  await world();
  assertError(await post('/auth/login', { email: USERS.ada.email, password: 'wrong password' }), 401, 'unauthenticated');
  assertError(await post('/auth/login', { email: 'nobody@example.com', password: PASSWORD }), 401, 'unauthenticated');
});

test('S1-034 every protected endpoint rejects missing, malformed and unknown bearer tokens', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const calls = [
    (h) => req('GET', '/reservations', { headers: h }),
    (h) => req('GET', `/reservations/${b.reference}`, { headers: h }),
    (h) => req('POST', '/reservations', { headers: { ...h, 'Idempotency-Key': newKey() }, body: { restaurant_id: 'r_anker', table_id: 't_1', starts_at_local: b.starts_at_local, party_size: 2 } }),
    (h) => req('POST', `/reservations/${b.reference}/cancel`, { headers: h, body: {} }),
    (h) => req('PATCH', `/reservations/${b.reference}`, { headers: h, body: { party_size: 2 } }),
    (h) => req('POST', '/reservation-moves', { headers: { ...h, 'Idempotency-Key': newKey() }, body: { moves: [{ reference: b.reference, party_size: 2 }] } }),
  ];
  for (const headers of [{}, { Authorization: `Token ${t.ada}` }, { Authorization: 'Bearer' }, { Authorization: 'Bearer ' }, { Authorization: 'Bearer not-a-real-token' }, { Authorization: t.ada }]) {
    for (const call of calls) assertError(await call(headers), 401, 'unauthenticated');
  }
  // Nothing changed.
  const after = await get(`/reservations/${b.reference}`, { token: t.ada });
  assert.equal(after.body.status, 'confirmed');
  assert.equal(after.body.party_size, 4);
});

test('S1-035 an account may hold several valid tokens at once', async () => {
  await world();
  const s = await post('/auth/signup', { email: 'multi@example.com', password: PASSWORD, display_name: 'M' });
  const l1 = await post('/auth/login', { email: 'multi@example.com', password: PASSWORD });
  const l2 = await post('/auth/login', { email: 'multi@example.com', password: PASSWORD });
  const b = await mustBook(l1.body.token);
  for (const tok of [s.body.token, l1.body.token, l2.body.token]) {
    const r = await get('/reservations', { token: tok });
    assertStatus(r, 200);
    assert.deepEqual(r.body.reservations.map(x => x.reference), [b.reference]);
  }
});

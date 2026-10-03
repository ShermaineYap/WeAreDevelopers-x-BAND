import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, req, world, THU, FRI, assertError, assertStatus, mustBook, bookBody, newKey, slotMap,
} from './lib.mjs';

const create = (body, token, key) => post('/reservations', body, { token, key });
const moves = (body, token, key) => post('/reservation-moves', body, { token, key });
const count = async (token) => (await get('/reservations', { token })).body.reservations.length;

test('S1-026 Idempotency-Key must be 1..255 characters', async () => {
  const t = await world();
  assertError(await create(bookBody(), t.ada, 'k'.repeat(256)), 422, 'validation_failed');
  assert.equal(await count(t.ada), 0);
  const ok = await create(bookBody(), t.ada, 'k'.repeat(255));
  assertStatus(ok, 201);
  assertStatus(await create(bookBody({ table_id: 't_3' }), t.ada, 'x'), 201);
  assertError(await moves({ moves: [{ reference: ok.body.reference, party_size: 3 }] }, t.ada, 'm'.repeat(256)), 422, 'validation_failed');
  assert.equal((await get(`/reservations/${ok.body.reference}`, { token: t.ada })).body.party_size, 4);
});

test('S1-038 an absent or empty Idempotency-Key is 400 missing_idempotency_key on both write paths', async () => {
  const t = await world();
  assertError(await create(bookBody(), t.ada), 400, 'missing_idempotency_key');
  assertError(await create(bookBody(), t.ada, ''), 400, 'missing_idempotency_key');
  const b = await mustBook(t.ada);
  assertError(await moves({ moves: [{ reference: b.reference, party_size: 3 }] }, t.ada), 400, 'missing_idempotency_key');
  assertError(await moves({ moves: [{ reference: b.reference, party_size: 3 }] }, t.ada, ''), 400, 'missing_idempotency_key');
  assert.equal(await count(t.ada), 1);
  assert.equal((await get(`/reservations/${b.reference}`, { token: t.ada })).body.party_size, 4);
});

test('S1-039 first use is 201, replay is 200 with an identical body and no second booking', async () => {
  const t = await world();
  const key = newKey();
  const first = await create(bookBody(), t.ada, key);
  assertStatus(first, 201);
  const again = await create(bookBody(), t.ada, key);
  assertStatus(again, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(await count(t.ada), 1);
});

test('S1-040 "same body" is JSON-value equality: key order and whitespace do not matter', async () => {
  const t = await world();
  const key = newKey();
  const first = await req('POST', '/reservations', { token: t.ada, key, raw: JSON.stringify(bookBody()) });
  assertStatus(first, 201);
  const b = bookBody();
  const shuffled = `{\n  "party_size" : ${b.party_size},\n\t"starts_at_local":"${b.starts_at_local}",  "table_id": "${b.table_id}", "restaurant_id":"${b.restaurant_id}"\n}`;
  const again = await req('POST', '/reservations', { token: t.ada, key, raw: shuffled });
  assertStatus(again, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(await count(t.ada), 1);
});

test('S1-041 same key with a different body is 409 idempotency_key_reuse', async () => {
  const t = await world();
  const key = newKey();
  assertStatus(await create(bookBody(), t.ada, key), 201);
  assertError(await create(bookBody({ party_size: 3 }), t.ada, key), 409, 'idempotency_key_reuse');
  assertError(await create(bookBody({ table_id: 't_3' }), t.ada, key), 409, 'idempotency_key_reuse');
  assertError(await create({ ...bookBody(), note: 'extra field' }, t.ada, key), 409, 'idempotency_key_reuse');
  assert.equal(await count(t.ada), 1);
});

test('S1-042 key reuse is decided before field validation and resource checks', async () => {
  const t = await world();
  const key = newKey();
  assertStatus(await create(bookBody(), t.ada, key), 201);
  const missing = bookBody(); delete missing.table_id;
  for (const body of [bookBody({ party_size: 0 }), bookBody({ party_size: '4' }), bookBody({ restaurant_id: 'r_nope' }),
    bookBody({ table_id: 't_nope' }), bookBody({ starts_at_local: `${THU}T19:15` }), bookBody({ starts_at_local: 'garbage' }),
    bookBody({ party_size: 99 }), missing, {}]) {
    assertError(await create(body, t.ada, key), 409, 'idempotency_key_reuse');
  }
  const b = await mustBook(t.ada, { table_id: 't_3' });
  const mkey = newKey();
  assertStatus(await moves({ moves: [{ reference: b.reference, party_size: 5 }] }, t.ada, mkey), 201);
  for (const body of [{ moves: [] }, { moves: [{ reference: 'NOSUCH99' }] }, { moves: [{ reference: b.reference, party_size: 0 }] }, {}]) {
    assertError(await moves(body, t.ada, mkey), 409, 'idempotency_key_reuse');
  }
});

test('S1-043 keys are scoped per user', async () => {
  const t = await world();
  const key = newKey();
  const a = await create(bookBody(), t.ada, key);
  assertStatus(a, 201);
  // Bob, same key, a different body: no reuse conflict.
  const b = await create(bookBody({ table_id: 't_3' }), t.bob, key);
  assertStatus(b, 201);
  assert.notEqual(b.body.reference, a.body.reference);
  // Ada frees the table; Bob, same key and the exact same body as Ada's: a new booking, not Ada's replay.
  assertStatus(await post(`/reservations/${a.body.reference}/cancel`, {}, { token: t.ada }), 200);
  const c = await create(bookBody(), t.cy, key);
  assertStatus(c, 201);
  assert.notEqual(c.body.reference, a.body.reference);
  assert.equal(await count(t.cy), 1);
});

test('S1-044 same key and same body on a different path is a new request', async () => {
  const t = await world();
  const a = await mustBook(t.ada, { table_id: 't_1', starts_at_local: `${THU}T18:00`, party_size: 2 });
  const key = newKey();
  // Valid for both endpoints: unknown fields are ignored by each.
  const body = { ...bookBody(), moves: [{ reference: a.reference, starts_at_local: `${THU}T21:00` }] };
  const r1 = await create(body, t.ada, key);
  assertStatus(r1, 201);
  assert.equal(r1.body.table_id, 't_2');
  const r2 = await moves(body, t.ada, key);
  assertStatus(r2, 201);
  assert.equal(r2.body.reservations[0].reference, a.reference);
  assert.equal(r2.body.reservations[0].starts_at_local, `${THU}T21:00`);
  // Each path replays its own original.
  assert.deepEqual((await create(body, t.ada, key)).body, r1.body);
  const rep = await moves(body, t.ada, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, r2.body);
  assert.equal(await count(t.ada), 2);
});

test('S1-045 a key whose original request failed with 4xx is treated as a first use', async () => {
  const t = await world();
  const key = newKey();
  assertError(await create(bookBody({ party_size: 0 }), t.ada, key), 422, 'validation_failed');
  assertError(await create(bookBody({ party_size: 0 }), t.ada, key), 422, 'validation_failed');
  const ok = await create(bookBody(), t.ada, key);
  assertStatus(ok, 201);
  assertStatus(await create(bookBody(), t.ada, key), 200);
  // Original failed with 409 table_unavailable, later reused with a different body.
  const k2 = newKey();
  assertError(await create(bookBody({ starts_at_local: `${THU}T19:30` }), t.bob, k2), 409, 'table_unavailable');
  assertStatus(await create(bookBody({ starts_at_local: `${FRI}T19:30` }), t.bob, k2), 201);
  // Original failed with 404.
  const k3 = newKey();
  assertError(await create(bookBody({ table_id: 't_nope' }), t.cy, k3), 404, 'not_found');
  assertStatus(await create(bookBody({ table_id: 't_3' }), t.cy, k3), 201);
  // Moves: a failed batch leaves its key reusable.
  const mk = newKey();
  assertError(await moves({ moves: [{ reference: ok.body.reference, party_size: 9 }] }, t.ada, mk), 422, 'party_exceeds_capacity');
  assertStatus(await moves({ moves: [{ reference: ok.body.reference, party_size: 3 }] }, t.ada, mk), 201);
});

test('S1-046 a missing key wins over an invalid body', async () => {
  const t = await world();
  assertError(await create(bookBody({ party_size: 0 }), t.ada), 400, 'missing_idempotency_key');
  assertError(await create({}, t.ada), 400, 'missing_idempotency_key');
});

test('S1-048 a replay returns the original body after cancel or amend and changes nothing', async () => {
  const t = await world();
  const key = newKey();
  const first = await create(bookBody(), t.ada, key);
  assertStatus(first, 201);
  const ref = first.body.reference;
  assertStatus(await patch(`/reservations/${ref}`, { party_size: 3 }, { token: t.ada }), 200);
  let rep = await create(bookBody(), t.ada, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal((await get(`/reservations/${ref}`, { token: t.ada })).body.party_size, 3);
  assertStatus(await post(`/reservations/${ref}/cancel`, {}, { token: t.ada }), 200);
  rep = await create(bookBody(), t.ada, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal(rep.body.status, 'confirmed');
  // No re-booking happened.
  const list = (await get('/reservations', { token: t.ada })).body.reservations;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'cancelled');
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3', 't_2']);
});

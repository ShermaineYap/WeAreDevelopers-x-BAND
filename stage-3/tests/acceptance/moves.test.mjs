import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, req, world, THU, FRI, YESTERDAY_UTC, assertError, assertStatus, mustBook, newKey, slotMap,
} from './lib.mjs';

const moves = (list, token, key = newKey()) => post('/reservation-moves', { moves: list }, { token, key });
const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;

async function setup() {
  const t = await world();
  const A = await mustBook(t.ada, { table_id: 't_1', starts_at_local: `${THU}T19:00`, party_size: 2 });
  const B = await mustBook(t.ada, { table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 });
  const C = await mustBook(t.ada, { table_id: 't_3', starts_at_local: `${THU}T21:00`, party_size: 2 });
  return { t, A, B, C };
}

test('S1-100 success is 201 {reservations:[...]} in input order including unchanged items', async () => {
  const { t, A, B, C } = await setup();
  const r = await moves([{ reference: C.reference, party_size: 3 }, { reference: B.reference }, { reference: A.reference, starts_at_local: `${THU}T20:30` }], t.ada);
  assertStatus(r, 201);
  assert.deepEqual(r.body.reservations.map(x => x.reference), [C.reference, B.reference, A.reference]);
  assert.equal(r.body.reservations[0].party_size, 3);
  assert.deepEqual(r.body.reservations[1], B);
  assert.equal(r.body.reservations[2].starts_at_local, `${THU}T20:30`);
  for (const x of r.body.reservations) assert.deepEqual(await read(x.reference, t.ada), x);
});

test('S1-101 moves must hold 1..8 objects with distinct references', async () => {
  const t = await world();
  const refs = [];
  for (const table_id of ['t_1', 't_3', 't_2']) for (const hm of ['18:00', '19:30', '21:00']) {
    refs.push((await mustBook(t.ada, { table_id, starts_at_local: `${THU}T${hm}`, party_size: 2 })).reference);
  }
  assertError(await moves([], t.ada), 422, 'validation_failed');
  assertError(await moves(refs.map(reference => ({ reference })), t.ada), 422, 'validation_failed');
  assertError(await moves([{ reference: refs[0] }, { reference: refs[0], party_size: 1 }], t.ada), 422, 'validation_failed');
  assertError(await post('/reservation-moves', {}, { token: t.ada, key: newKey() }), 422, 'validation_failed');
  assertError(await moves([{ party_size: 2 }], t.ada), 422, 'validation_failed');
  const eight = await moves(refs.slice(0, 8).map(reference => ({ reference })), t.ada);
  assertStatus(eight, 201);
  assert.equal(eight.body.reservations.length, 8);
});

test('S1-102 unknown or foreign reference is 404, mixed restaurants 422, no token 401, no key 400', async () => {
  const { t, A, B } = await setup();
  const bobs = await mustBook(t.bob, { table_id: 't_3', starts_at_local: `${FRI}T19:00`, party_size: 2 });
  const other = await mustBook(t.ada, { restaurant_id: 'r_other', table_id: 't_9', starts_at_local: `${THU}T19:00`, party_size: 2 });
  assertError(await moves([{ reference: 'NOSUCH99', party_size: 1 }], t.ada), 404, 'not_found');
  assertError(await moves([{ reference: A.reference }, { reference: bobs.reference, party_size: 1 }], t.ada), 404, 'not_found');
  assertError(await moves([{ reference: A.reference, party_size: 1 }, { reference: other.reference, party_size: 1 }], t.ada), 422, 'validation_failed');
  assertError(await req('POST', '/reservation-moves', { key: newKey(), body: { moves: [{ reference: A.reference, party_size: 1 }] } }), 401, 'unauthenticated');
  assertError(await post('/reservation-moves', { moves: [{ reference: A.reference, party_size: 1 }] }, { token: t.ada }), 400, 'missing_idempotency_key');
  assert.deepEqual(await read(A.reference, t.ada), A);
  assert.deepEqual(await read(B.reference, t.ada), B);
  assert.equal((await read(bobs.reference, t.bob)).party_size, 2);
});

test('S1-103 cancelled bookings are 409 reservation_cancelled; the cutoff applies', async () => {
  const { t, A, B } = await setup();
  assertStatus(await post(`/reservations/${B.reference}/cancel`, {}, { token: t.ada }), 200);
  assertError(await moves([{ reference: A.reference, party_size: 1 }, { reference: B.reference, party_size: 1 }], t.ada), 409, 'reservation_cancelled');
  const past = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${YESTERDAY_UTC}T12:00`, party_size: 2 });
  assertError(await moves([{ reference: past.reference, party_size: 3 }], t.ada), 409, 'cutoff_passed');
  assert.equal((await read(A.reference, t.ada)).party_size, 2);
});

test('S1-104 errors take precedence in input order, cutoff first per booking, non-occupancy before occupancy', async () => {
  const { t, A, B } = await setup();
  assertError(await moves([{ reference: A.reference, party_size: 9 }, { reference: 'NOSUCH99' }], t.ada), 422, 'party_exceeds_capacity');
  assertError(await moves([{ reference: 'NOSUCH99' }, { reference: A.reference, party_size: 9 }], t.ada), 404, 'not_found');
  assertError(await moves([{ reference: A.reference, starts_at_local: `${THU}T19:15` }, { reference: B.reference, starts_at_local: `${THU}T23:00` }], t.ada), 422, 'not_on_slot_grid');
  assertError(await moves([{ reference: B.reference, starts_at_local: `${THU}T23:00` }, { reference: A.reference, starts_at_local: `${THU}T19:15` }], t.ada), 422, 'outside_opening_hours');
  // Item 1 collides with the unlisted booking C (t_3 21:00); item 2 is off-grid: the validation error wins.
  assertError(await moves([{ reference: A.reference, table_id: 't_3', starts_at_local: `${THU}T21:00` }, { reference: B.reference, starts_at_local: `${THU}T19:15` }], t.ada), 422, 'not_on_slot_grid');
  const past = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${YESTERDAY_UTC}T12:00`, party_size: 2 });
  const future = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u2', starts_at_local: `${THU}T12:00`, party_size: 2 });
  assertError(await moves([{ reference: past.reference, party_size: 9, starts_at_local: `${THU}T12:15` }], t.ada), 409, 'cutoff_passed');
  assertError(await moves([{ reference: future.reference, party_size: 9 }, { reference: past.reference, party_size: 2 }], t.ada), 422, 'party_exceeds_capacity');
  assertError(await moves([{ reference: future.reference, party_size: 3 }, { reference: past.reference, party_size: 9 }], t.ada), 409, 'cutoff_passed');
  assert.deepEqual(await read(A.reference, t.ada), A);
});

test('S1-105 overlap among results or with an unlisted booking is 409 table_unavailable', async () => {
  const { t, A, B, C } = await setup();
  assertError(await moves([{ reference: A.reference, table_id: 't_3', starts_at_local: `${THU}T20:30` }], t.ada), 409, 'table_unavailable');
  assertError(await moves([{ reference: A.reference, table_id: 't_2', starts_at_local: `${THU}T21:00` }, { reference: C.reference, table_id: 't_2' }], t.ada), 409, 'table_unavailable');
  await mustBook(t.bob, { table_id: 't_2', starts_at_local: `${FRI}T19:00`, party_size: 2 });
  assertError(await moves([{ reference: B.reference, starts_at_local: `${FRI}T20:00` }], t.ada), 409, 'table_unavailable');
  for (const x of [A, B, C]) assert.deepEqual(await read(x.reference, t.ada), x);
});

test('S1-106 swaps are evaluated on the resulting state', async () => {
  const { t, A, B } = await setup();
  const r = await moves([{ reference: A.reference, table_id: 't_2' }, { reference: B.reference, table_id: 't_1' }], t.ada);
  assertStatus(r, 201);
  assert.equal((await read(A.reference, t.ada)).table_id, 't_2');
  assert.equal((await read(B.reference, t.ada)).table_id, 't_1');
  // Chain: A takes B's table while B moves to another time.
  const r2 = await moves([{ reference: A.reference, table_id: 't_1' }, { reference: B.reference, starts_at_local: `${THU}T20:30` }], t.ada);
  assertStatus(r2, 201);
  const s = await slotMap('r_anker', THU, 2);
  assert.deepEqual(s['19:00'], ['t_3', 't_2']);
  assert.equal((await read(B.reference, t.ada)).table_id, 't_1');
});

test('S1-107 a failing batch changes nothing and its key stays reusable', async () => {
  const { t, A, B, C } = await setup();
  const key = newKey();
  assertError(await moves([{ reference: A.reference, starts_at_local: `${THU}T20:30` }, { reference: B.reference, table_id: 't_3', starts_at_local: `${THU}T21:00` }], t.ada, key), 409, 'table_unavailable');
  for (const x of [A, B, C]) assert.deepEqual(await read(x.reference, t.ada), x);
  const s = await slotMap('r_anker', THU, 2);
  assert.deepEqual(s['19:00'], ['t_3']);
  assert.deepEqual(s['20:30'], ['t_1', 't_2']);
  const ok = await moves([{ reference: A.reference, starts_at_local: `${THU}T20:30` }], t.ada, key);
  assertStatus(ok, 201);
  assert.equal((await read(A.reference, t.ada)).starts_at_local, `${THU}T20:30`);
});

test('S1-108 omitted fields keep their values; identity, owner and created_at never change', async () => {
  const { t, A, B } = await setup();
  const r = await moves([{ reference: A.reference, party_size: 1, status: 'cancelled', reference_new: 'ZZZZZZ', user_id: 'u_bob' }, { reference: B.reference }], t.ada);
  assertStatus(r, 201);
  const a = r.body.reservations[0];
  // Stage 3: a real change increments revision (S3-090); everything else is unchanged.
  assert.deepEqual({ ...a, party_size: 2, revision: A.revision }, A);
  assert.equal(a.party_size, 1);
  assert.equal(a.status, 'confirmed');
  assert.deepEqual(r.body.reservations[1], B);
  assertError(await get(`/reservations/${A.reference}`, { token: t.bob }), 404, 'not_found');
  assert.deepEqual(await read(A.reference, t.ada), a);
});

test('S1-109 replay returns the original 201 body with 200 even after amend and cancel; a different body is 409', async () => {
  const { t, A, B } = await setup();
  const key = newKey();
  const list = [{ reference: A.reference, table_id: 't_3', starts_at_local: `${FRI}T19:00` }, { reference: B.reference }];
  const first = await moves(list, t.ada, key);
  assertStatus(first, 201);
  assertStatus(await patch(`/reservations/${A.reference}`, { party_size: 1 }, { token: t.ada }), 200);
  assertStatus(await post(`/reservations/${B.reference}/cancel`, {}, { token: t.ada }), 200);
  const rep = await moves(list, t.ada, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal((await read(A.reference, t.ada)).party_size, 1);
  assert.equal((await read(B.reference, t.ada)).status, 'cancelled');
  assertError(await moves([list[0]], t.ada, key), 409, 'idempotency_key_reuse');
});

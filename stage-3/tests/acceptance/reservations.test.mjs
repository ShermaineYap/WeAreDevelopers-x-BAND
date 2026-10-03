import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, world, THU, FRI, MON, YESTERDAY_UTC, assertError, assertStatus, mustBook, book, bookBody, newKey,
  expectedInstant, slotMap,
} from './lib.mjs';

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
const RFC3339_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;

test('S1-007 starts_at, ends_at and created_at are RFC 3339 with an explicit offset', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  assert.match(b.starts_at, RFC3339_OFFSET);
  assert.match(b.ends_at, RFC3339_OFFSET);
  assert.match(b.created_at, RFC3339);
  assert.ok(!Number.isNaN(Date.parse(b.created_at)));
  assert.ok(Math.abs(Date.parse(b.created_at) - Date.now()) < 10 * 60000, 'created_at is the creation time');
});

test('S1-015 a booking is not rejected because its start is in the past', async () => {
  const t = await world();
  const r = await book(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${YESTERDAY_UTC}T12:00`, party_size: 2 });
  assertStatus(r, 201);
  assert.equal(r.body.starts_at, `${YESTERDAY_UTC}T12:00:00+00:00`);
});

test('S1-059 cancelled reservations do not block availability or booking', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  assertStatus(await post(`/reservations/${b.reference}/cancel`, {}, { token: t.ada }), 200);
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:30'], ['t_3', 't_2']);
  assertStatus(await book(t.bob, { starts_at_local: `${THU}T19:30` }), 201);
});

test('S1-060 the create response has the documented shape', async () => {
  const t = await world();
  const r = await book(t.ada);
  assertStatus(r, 201);
  const b = r.body;
  for (const k of ['reservation_id', 'reference', 'restaurant_id', 'table_id', 'party_size', 'status', 'starts_at_local', 'starts_at', 'ends_at', 'created_at']) {
    assert.ok(k in b, `missing ${k}`);
  }
  assert.equal(typeof b.reservation_id, 'string');
  assert.ok(b.reservation_id.length <= 64);
  assert.equal(b.restaurant_id, 'r_anker');
  assert.equal(b.table_id, 't_2');
  assert.equal(b.party_size, 4);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.starts_at_local, `${THU}T19:00`);
  const start = expectedInstant('Europe/Berlin', `${THU}T19:00`);
  assert.equal(b.starts_at, start.rfc);
  assert.equal(Date.parse(b.ends_at) - Date.parse(b.starts_at), 90 * 60000);
  assert.equal(b.ends_at, expectedInstant('Europe/Berlin', `${THU}T20:30`).rfc);
  // GET by reference returns the same object.
  assert.deepEqual((await get(`/reservations/${b.reference}`, { token: t.ada })).body, b);
});

test('S1-061 references are 6-12 chars of A-Z0-9 and unique', async () => {
  const t = await world();
  const refs = new Set();
  const times = ['18:00', '19:30', '21:00'];
  for (const table_id of ['t_1', 't_3', 't_2']) for (const hm of times) {
    const b = await mustBook(t.ada, { table_id, starts_at_local: `${THU}T${hm}`, party_size: 2 });
    assert.match(b.reference, /^[A-Z0-9]{6,12}$/);
    refs.add(b.reference);
  }
  assert.equal(refs.size, 9);
});

test('S1-062 an overlapping interval on the same table is 409 table_unavailable', async () => {
  const t = await world();
  await mustBook(t.ada);
  for (const hm of ['18:00', '18:30', '19:00', '19:30', '20:00']) {
    assertError(await book(t.bob, { starts_at_local: `${THU}T${hm}`, party_size: 2 }), 409, 'table_unavailable');
  }
  // The same caller is not exempt.
  assertError(await book(t.ada, { starts_at_local: `${THU}T19:30` }), 409, 'table_unavailable');
});

test('S1-063 a start off the slot grid is 422 not_on_slot_grid', async () => {
  const t = await world();
  for (const hm of ['19:15', '18:01', '19:59']) {
    assertError(await book(t.ada, { starts_at_local: `${THU}T${hm}` }), 422, 'not_on_slot_grid');
  }
  // 45-minute grid: 19:00 is not a step from 18:00.
  assertError(await book(t.ada, { restaurant_id: 'r_odd', table_id: 't_o1', starts_at_local: `${THU}T19:00` }), 422, 'not_on_slot_grid');
  assertStatus(await book(t.ada, { restaurant_id: 'r_odd', table_id: 't_o1', starts_at_local: `${THU}T18:45` }), 201);
});

test('S1-064 outside opening hours, ending after closes, or a closed day is 422 outside_opening_hours', async () => {
  const t = await world();
  for (const at of [`${THU}T17:00`, `${THU}T23:00`, `${THU}T22:00`, `${THU}T23:30`, `${FRI}T22:30`, `${MON}T19:00`]) {
    assertError(await book(t.ada, { starts_at_local: at }), 422, 'outside_opening_hours');
  }
  assertError(await book(t.ada, { restaurant_id: 'r_odd', table_id: 't_o1', starts_at_local: `${THU}T20:15` }), 422, 'outside_opening_hours');
  // Boundaries that fit exactly are accepted.
  assertStatus(await book(t.ada, { starts_at_local: `${THU}T21:30` }), 201);
  assertStatus(await book(t.ada, { starts_at_local: `${FRI}T22:00` }), 201);
  assertStatus(await book(t.ada, { starts_at_local: `${THU}T18:00`, table_id: 't_3' }), 201);
});

test('S1-065 party_size above capacity is 422 party_exceeds_capacity; equal is fine', async () => {
  const t = await world();
  assertError(await book(t.ada, { table_id: 't_1', party_size: 3 }), 422, 'party_exceeds_capacity');
  assertError(await book(t.ada, { table_id: 't_2', party_size: 5 }), 422, 'party_exceeds_capacity');
  assertStatus(await book(t.ada, { table_id: 't_1', party_size: 2 }), 201);
  assertStatus(await book(t.ada, { table_id: 't_2', party_size: 4 }), 201);
});

test('S1-067 unknown restaurant, unknown table, or another restaurant\'s table is 404', async () => {
  const t = await world();
  assertError(await book(t.ada, { restaurant_id: 'r_nope' }), 404, 'not_found');
  assertError(await book(t.ada, { table_id: 't_nope' }), 404, 'not_found');
  assertError(await book(t.ada, { table_id: 't_9' }), 404, 'not_found');
  assertError(await book(t.ada, { restaurant_id: 'r_other', table_id: 't_2' }), 404, 'not_found');
});

test('S1-068 GET /reservations: own only, starts_at descending, includes cancelled', async () => {
  const t = await world();
  assert.deepEqual((await get('/reservations', { token: t.ada })).body, { reservations: [] });
  const a = await mustBook(t.ada, { starts_at_local: `${THU}T18:00`, table_id: 't_1', party_size: 2 });
  const b = await mustBook(t.ada, { starts_at_local: `${FRI}T21:00`, table_id: 't_1', party_size: 2 });
  const c = await mustBook(t.ada, { starts_at_local: `${THU}T21:00`, table_id: 't_1', party_size: 2 });
  await mustBook(t.bob, { starts_at_local: `${THU}T19:30`, table_id: 't_1', party_size: 2 });
  assertStatus(await post(`/reservations/${c.reference}/cancel`, {}, { token: t.ada }), 200);
  const r = await get('/reservations', { token: t.ada });
  assertStatus(r, 200);
  assert.deepEqual(r.body.reservations.map(x => x.reference), [b.reference, c.reference, a.reference]);
  assert.deepEqual(r.body.reservations.map(x => x.status), ['confirmed', 'cancelled', 'confirmed']);
  assert.deepEqual(r.body.reservations[2], a);
});

test('S1-069 GET /reservations/{reference}: own is 200, others are 404 not 403', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  assertStatus(await get(`/reservations/${b.reference}`, { token: t.ada }), 200);
  assertError(await get(`/reservations/${b.reference}`, { token: t.bob }), 404, 'not_found');
  assertError(await get('/reservations/ZZZZZZZZ', { token: t.ada }), 404, 'not_found');
});

test('S1-116 rejected requests leave no partial booking behind', async () => {
  const t = await world();
  await book(t.ada, { party_size: 9 });
  await book(t.ada, { starts_at_local: `${THU}T19:15` });
  await book(t.ada, { table_id: 't_nope' });
  await post('/reservations', bookBody(), { token: t.ada });
  assert.deepEqual((await get('/reservations', { token: t.ada })).body, { reservations: [] });
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3', 't_2']);
  // And a failure does not consume anything: the plain booking still works.
  assertStatus(await post('/reservations', bookBody(), { token: t.ada, key: newKey() }), 201);
});

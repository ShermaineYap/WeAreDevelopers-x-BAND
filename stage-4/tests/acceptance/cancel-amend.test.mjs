import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, world, THU, FRI, YESTERDAY_UTC, SOON_UTC, assertError, assertStatus, mustBook, book,
  slotMap, expectedInstant,
} from './lib.mjs';

const cancel = (ref, token) => post(`/reservations/${ref}/cancel`, {}, { token });
const amend = (ref, body, token) => patch(`/reservations/${ref}`, body, { token });

test('S1-070 cancel returns 200 with the full reservation, status cancelled, and frees the table', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const r = await cancel(b.reference, t.ada);
  assertStatus(r, 200);
  // Stage 3: a cancel increments revision (S3-046); everything else is unchanged.
  assert.deepEqual({ ...r.body, status: 'confirmed', revision: b.revision }, b);
  assert.equal(r.body.status, 'cancelled');
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3', 't_2']);
  assert.equal((await get(`/reservations/${b.reference}`, { token: t.ada })).body.status, 'cancelled');
});

test('S1-071 cancelling twice is 200 with the current state', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const first = await cancel(b.reference, t.ada);
  const second = await cancel(b.reference, t.ada);
  assertStatus(second, 200);
  assert.deepEqual(second.body, first.body);
});

test('S1-072 cancel within the cutoff before start is 409 cutoff_passed', async () => {
  const t = await world();
  const b = await mustBook(t.ada, { restaurant_id: 'r_long', table_id: 't_l1', starts_at_local: `${SOON_UTC}T12:00`, party_size: 2 });
  assertError(await cancel(b.reference, t.ada), 409, 'cutoff_passed');
  assert.equal((await get(`/reservations/${b.reference}`, { token: t.ada })).body.status, 'confirmed');
});

test('S1-073 cancel after the start is 409 cutoff_passed', async () => {
  const t = await world();
  const b = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${YESTERDAY_UTC}T12:00`, party_size: 2 });
  assertError(await cancel(b.reference, t.ada), 409, 'cutoff_passed');
});

test('S1-074 cancel outside the cutoff succeeds', async () => {
  const t = await world();
  const b = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${THU}T12:00`, party_size: 2 });
  assertStatus(await cancel(b.reference, t.ada), 200);
});

test('S1-075 cancelling someone else\'s or an unknown reservation is 404', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  assertError(await cancel(b.reference, t.bob), 404, 'not_found');
  assertError(await cancel('NOSUCH99', t.ada), 404, 'not_found');
  assert.equal((await get(`/reservations/${b.reference}`, { token: t.ada })).body.status, 'confirmed');
});

test('S1-076 PATCH any subset of fields, no idempotency key, 200 with the updated reservation', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  let r = await amend(b.reference, { party_size: 3 }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.party_size, 3);
  assert.equal(r.body.table_id, 't_2');
  assert.equal(r.body.starts_at_local, `${THU}T19:00`);
  r = await amend(b.reference, { starts_at_local: `${FRI}T20:00` }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.starts_at_local, `${FRI}T20:00`);
  assert.equal(r.body.starts_at, expectedInstant('Europe/Berlin', `${FRI}T20:00`).rfc);
  assert.equal(r.body.ends_at, expectedInstant('Europe/Berlin', `${FRI}T21:30`).rfc);
  assert.equal(r.body.party_size, 3);
  r = await amend(b.reference, { table_id: 't_3' }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.table_id, 't_3');
  r = await amend(b.reference, { table_id: 't_1', starts_at_local: `${THU}T21:30`, party_size: 2 }, t.ada);
  assertStatus(r, 200);
  assert.deepEqual([r.body.table_id, r.body.starts_at_local, r.body.party_size, r.body.status], ['t_1', `${THU}T21:30`, 2, 'confirmed']);
  assert.deepEqual((await get(`/reservations/${b.reference}`, { token: t.ada })).body, r.body);
  // Empty patch changes nothing.
  const e = await amend(b.reference, {}, t.ada);
  assertStatus(e, 200);
  assert.deepEqual(e.body, r.body);
});

test('S1-077 PATCH validation is identical to POST', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const cases = [
    [{ starts_at_local: `${THU}T19:15` }, 422, 'not_on_slot_grid'],
    [{ starts_at_local: `${THU}T22:00` }, 422, 'outside_opening_hours'],
    [{ starts_at_local: `${THU}T17:00` }, 422, 'outside_opening_hours'],
    [{ party_size: 5 }, 422, 'party_exceeds_capacity'],
    [{ table_id: 't_1' }, 422, 'party_exceeds_capacity'],
    [{ party_size: 0 }, 422, 'validation_failed'],
    [{ party_size: '4' }, 422, 'validation_failed'],
    [{ party_size: true }, 422, 'validation_failed'],
    [{ party_size: 2.5 }, 422, 'validation_failed'],
    [{ starts_at_local: `${THU}T19:00:00+02:00` }, 422, 'validation_failed'],
    [{ starts_at_local: '2026-02-30T19:00' }, 422, 'validation_failed'],
    [{ table_id: 't_nope' }, 404, 'not_found'],
    [{ table_id: 't_9' }, 404, 'not_found'],
    [{ table_id: 5 }, 400, 'malformed_request'],
  ];
  for (const [body, status, code] of cases) assertError(await amend(b.reference, body, t.ada), status, code);
  assert.deepEqual((await get(`/reservations/${b.reference}`, { token: t.ada })).body, b);
});

test('S1-078 PATCH cutoff is measured against the current start', async () => {
  const t = await world();
  const past = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${YESTERDAY_UTC}T12:00`, party_size: 2 });
  assertError(await amend(past.reference, { starts_at_local: `${THU}T12:00` }, t.ada), 409, 'cutoff_passed');
  const near = await mustBook(t.ada, { restaurant_id: 'r_long', table_id: 't_l1', starts_at_local: `${SOON_UTC}T12:00`, party_size: 2 });
  assertError(await amend(near.reference, { party_size: 3 }, t.ada), 409, 'cutoff_passed');
  // Current start is far away: moving it into the past is allowed (the cutoff looks at the current start only).
  const far = await mustBook(t.ada, { restaurant_id: 'r_utc', table_id: 't_u2', starts_at_local: `${THU}T12:00`, party_size: 2 });
  const r = await amend(far.reference, { starts_at_local: `${YESTERDAY_UTC}T15:00` }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.starts_at_local, `${YESTERDAY_UTC}T15:00`);
});

test('S1-079 amending a cancelled reservation is 409 reservation_cancelled', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  assertStatus(await cancel(b.reference, t.ada), 200);
  assertError(await amend(b.reference, { party_size: 2 }, t.ada), 409, 'reservation_cancelled');
  assertError(await amend(b.reference, { starts_at_local: `${THU}T20:30` }, t.ada), 409, 'reservation_cancelled');
  const g = (await get(`/reservations/${b.reference}`, { token: t.ada })).body;
  assert.equal(g.status, 'cancelled');
  assert.equal(g.party_size, 4);
});

test('S1-080 a successful amendment releases the old slot and reserves the new one together', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  // 19:30 overlaps the booking's own 19:00-20:30 interval; it must not conflict with itself.
  const r = await amend(b.reference, { starts_at_local: `${THU}T19:30` }, t.ada);
  assertStatus(r, 200);
  const slots = await slotMap('r_anker', THU, 4);
  assert.deepEqual(slots['18:00'], ['t_3', 't_2']);
  assert.deepEqual(slots['19:00'], ['t_3']);
  assert.deepEqual(slots['21:00'], ['t_3', 't_2']);
  assertStatus(await book(t.bob, { starts_at_local: `${THU}T18:00` }), 201);
  assertError(await book(t.bob, { starts_at_local: `${THU}T20:30` }), 409, 'table_unavailable');
});

test('S1-081 a failed amendment leaves the booking and its occupancy unchanged', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  await mustBook(t.bob, { table_id: 't_3', starts_at_local: `${THU}T21:00`, party_size: 5 });
  assertError(await amend(b.reference, { table_id: 't_3', starts_at_local: `${THU}T21:00` }, t.ada), 409, 'table_unavailable');
  assertError(await amend(b.reference, { starts_at_local: `${THU}T21:00`, party_size: 9 }, t.ada), 422, 'party_exceeds_capacity');
  assert.deepEqual((await get(`/reservations/${b.reference}`, { token: t.ada })).body, b);
  const slots = await slotMap('r_anker', THU, 4);
  assert.deepEqual(slots['19:00'], ['t_3']);
  assert.deepEqual(slots['21:00'], ['t_2']);
});

test('S1-082 reference, reservation_id and created_at survive a change', async () => {
  const t = await world();
  const b = await mustBook(t.ada);
  const r = await amend(b.reference, { table_id: 't_3', starts_at_local: `${FRI}T18:00`, party_size: 6 }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.reference, b.reference);
  assert.equal(r.body.reservation_id, b.reservation_id);
  assert.equal(r.body.created_at, b.created_at);
  assert.equal(r.body.restaurant_id, 'r_anker');
});

test('S1-083 PATCH onto a taken table is 409; someone else\'s or unknown is 404', async () => {
  const t = await world();
  const a = await mustBook(t.ada);
  await mustBook(t.bob, { table_id: 't_3' });
  assertError(await amend(a.reference, { table_id: 't_3' }, t.ada), 409, 'table_unavailable');
  assertError(await amend(a.reference, { party_size: 2 }, t.bob), 404, 'not_found');
  assertError(await amend('NOSUCH99', { party_size: 2 }, t.ada), 404, 'not_found');
  assert.equal((await get(`/reservations/${a.reference}`, { token: t.ada })).body.party_size, 4);
});

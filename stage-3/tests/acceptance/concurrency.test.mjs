import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, reset, fixture, PASSWORD, THU, FRI, assertStatus, bookBody, newKey, burst, tally,
  noServerErrors, slotMap, availability,
} from './lib.mjs';

const N = 50;
const crowd = Array.from({ length: N }, (_, i) => ({ id: `u_c${i}`, email: `c${i}@example.com`, password: PASSWORD, display_name: `C${i}` }));

async function crowdWorld() {
  await reset(fixture({ users: crowd }));
  const logins = await burst(N, i => post('/auth/login', { email: crowd[i].email, password: PASSWORD }));
  return logins;
}

const within5s = (results) => { for (const r of results) assert.ok(r.ms < 5000, `request took ${r.ms} ms`); };

test('S1-114 50 concurrent logins each finish well under 5 s', async () => {
  const logins = await crowdWorld();
  noServerErrors(logins);
  within5s(logins);
  assert.deepEqual(tally(logins), { 200: N });
});

test('S1-110 50 racers for one table and slot: exactly one 201, the rest 409', async () => {
  const tokens = (await crowdWorld()).map(r => r.body.token);
  const out = await burst(N, i => post('/reservations', bookBody(), { token: tokens[i], key: newKey() }));
  noServerErrors(out);
  within5s(out);
  assert.deepEqual(tally(out), { 201: 1, 409: N - 1 });
  for (const r of out.filter(x => x.status === 409)) assert.equal(r.body.error.code, 'table_unavailable');
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3']);
});

test('S1-047 concurrent identical requests with one unused key: one 201, the rest 200 with the same body', async () => {
  const tokens = (await crowdWorld()).map(r => r.body.token);
  const key = newKey();
  const out = await burst(20, () => post('/reservations', bookBody(), { token: tokens[0], key }));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 200: 19 });
  const original = out.find(r => r.status === 201).body;
  for (const r of out) assert.deepEqual(r.body, original);
  const list = (await get('/reservations', { token: tokens[0] })).body.reservations;
  assert.equal(list.length, 1);
  // The same for a move batch.
  const mkey = newKey();
  const body = { moves: [{ reference: original.reference, starts_at_local: `${FRI}T19:00` }] };
  const mv = await burst(20, () => post('/reservation-moves', body, { token: tokens[0], key: mkey }));
  noServerErrors(mv);
  assert.deepEqual(tally(mv), { 201: 1, 200: 19 });
  const morig = mv.find(r => r.status === 201).body;
  for (const r of mv) assert.deepEqual(r.body, morig);
});

async function tenWithBookings() {
  const tokens = (await crowdWorld()).map(r => r.body.token);
  const refs = [];
  for (let i = 0; i < 10; i++) {
    const r = await post('/reservations', { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${THU}T0${i}:00`, party_size: 2 }, { token: tokens[i], key: newKey() });
    assertStatus(r, 201);
    refs.push(r.body.reference);
  }
  return { tokens, refs };
}

test('S1-111 concurrent PATCHes onto one free table and slot: exactly one wins', async () => {
  const { tokens, refs } = await tenWithBookings();
  const out = await burst(10, i => patch(`/reservations/${refs[i]}`, { table_id: 't_u2', starts_at_local: `${THU}T12:00` }, { token: tokens[i] }));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 200: 1, 409: 9 });
  assert.deepEqual((await slotMap('r_utc', THU, 2))['12:00'], ['t_u1']);
  // Losers kept their original slot.
  const losers = out.map((r, i) => [r, i]).filter(([r]) => r.status === 409).map(([, i]) => i);
  for (const i of losers) {
    const g = (await get(`/reservations/${refs[i]}`, { token: tokens[i] })).body;
    assert.deepEqual([g.table_id, g.starts_at_local], ['t_u1', `${THU}T0${i}:00`]);
  }
});

test('S1-112 concurrent move batches onto one free table and slot: exactly one wins', async () => {
  const { tokens, refs } = await tenWithBookings();
  const out = await burst(10, i => post('/reservation-moves', { moves: [{ reference: refs[i], table_id: 't_u2', starts_at_local: `${THU}T12:00` }] }, { token: tokens[i], key: newKey() }));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 409: 9 });
  assert.deepEqual((await slotMap('r_utc', THU, 2))['12:00'], ['t_u1']);
});

test('S1-115 concurrent signups with one email: exactly one 201', async () => {
  await reset();
  const out = await burst(20, i => post('/auth/signup', { email: 'race@example.com', password: PASSWORD, display_name: `R${i}` }));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 409: 19 });
});

test('S1-113 / S1-027 50 concurrent mixed requests: no 5xx, each under 5 s, invariants hold', async () => {
  const tokens = (await crowdWorld()).map(r => r.body.token);
  // Pre-existing bookings for cancel / amend traffic.
  const pre = [];
  for (let i = 0; i < 10; i++) {
    const r = await post('/reservations', { restaurant_id: 'r_utc', table_id: 't_u1', starts_at_local: `${THU}T${String(10 + i).padStart(2, '0')}:00`, party_size: 2 }, { token: tokens[i], key: newKey() });
    assertStatus(r, 201);
    pre.push(r.body.reference);
  }
  const ops = [
    (i) => post('/reservations', bookBody({ table_id: ['t_1', 't_3', 't_2'][i % 3], party_size: 2, starts_at_local: `${THU}T${['18:00', '19:30', '21:00'][i % 3]}` }), { token: tokens[i], key: newKey() }),
    (i) => availability('r_anker', THU, 2),
    (i) => get('/reservations', { token: tokens[i] }),
    (i) => post(`/reservations/${pre[i % 10]}/cancel`, {}, { token: tokens[i % 10] }),
    (i) => patch(`/reservations/${pre[i % 10]}`, { party_size: 3 }, { token: tokens[i % 10] }),
    (i) => post('/auth/login', { email: crowd[i].email, password: PASSWORD }),
    (i) => post('/auth/signup', { email: `mix${i}@example.com`, password: PASSWORD, display_name: 'Mix' }),
    (i) => post('/reservation-moves', { moves: [{ reference: pre[i % 10], starts_at_local: `${FRI}T${String(10 + (i % 10)).padStart(2, '0')}:00` }] }, { token: tokens[i % 10], key: newKey() }),
    (i) => get('/restaurants'),
    (i) => get(`/reservations/${pre[i % 10]}`, { token: tokens[i % 10] }),
  ];
  const out = await burst(N, i => ops[i % ops.length](i));
  noServerErrors(out);
  within5s(out);
  // No table double-booked: at most one winner per (table, start) among the racing creates.
  const created = out.filter((r, i) => i % ops.length === 0 && r.status === 201);
  const keys = created.map(r => `${r.body.table_id}@${r.body.starts_at_local}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(created.length >= 1);
  assertStatus(await get('/health'), 200);
});

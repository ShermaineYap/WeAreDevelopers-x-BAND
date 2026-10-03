// Stage 4: replan previews (POST /restaurants/{id}/replans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, world4, fixture4, REP, THU, addDays, at, closure, bookR, mustBookR, preview, revisionOf,
  allReservations, optimalPlan, mustPublish, policy, allWeek, entries, cancel, assertError, assertStatus, newKey,
  YESTERDAY_UTC, availability,
} from './lib4.mjs';

const ms = (c) => ({ table_id: c.table_id, fromMs: Date.parse(c.from), toMs: Date.parse(c.to) });

async function expectPlan(t, body, prior = []) {
  const all = await allReservations([t.ada, t.bob, t.cy]);
  const atRep = all.filter(r => r.restaurant_id === 'r_rep');
  const want = optimalPlan(REP, atRep, prior, ms(body));
  const r = await preview(t.max, body);
  if (want === null) {
    assertError(r, 409, 'no_feasible_plan');
    return { r, want };
  }
  assertStatus(r, 201);
  assert.deepEqual(r.body.assignments, want.assignments, JSON.stringify({ got: r.body.assignments, want: want.assignments }));
  assert.equal(r.body.moved_count, want.moved_count);
  assert.equal(r.body.unused_seats, want.unused_seats);
  return { r, want };
}

test('S4-001 S4-002 replans need a manager, a key, a known table and a valid interval', async () => {
  const t = await world4();
  const body = closure('t_2', THU, '18:00', '23:00');
  assertError(await req('POST', '/restaurants/r_rep/replans', { key: newKey(), body }), 401, 'unauthenticated');
  assertError(await preview(t.ada, body), 403, 'forbidden');
  assertError(await preview(t.max, body, { rid: 'r_nope' }), 404, 'not_found');
  assertError(await post('/restaurants/r_rep/replans', body, { token: t.max }), 400, 'missing_idempotency_key');
  assertError(await preview(t.max, { ...body, table_id: 't_9' }), 404, 'not_found');
  for (const bad of [
    { ...body, from: body.to, to: body.from }, { ...body, to: body.from },
    { ...body, from: `${THU}T18:00:00` }, { ...body, to: `${THU}T23:00` }, { ...body, from: 'soon' },
    { table_id: 't_2', from: body.from }, { table_id: 't_2', to: body.to }, { from: body.from, to: body.to },
  ]) assertError(await preview(t.max, bad), 422, 'validation_failed');
  // A Z offset is explicit; an instant written in another offset names the same interval.
  assertStatus(await preview(t.max, { table_id: 't_2', from: new Date(Date.parse(body.from)).toISOString(), to: body.to }), 201);
});

test('S4-003 S4-009 a preview with nothing to move returns an empty plan at the current revision', async () => {
  const t = await world4();
  await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T12:00` });          // before the window
  await mustBookR(t.ada, { restaurant_id: 'r_rep2', table_id: 't_2' });                   // another restaurant
  const c = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T19:00` });
  assertStatus(await cancel(c.reference, t.ada), 200);                                     // cancelled: not considered
  const body = closure('t_2', THU, '18:00', '23:00');
  const r = await preview(t.max, body);
  assertStatus(r, 201);
  assert.equal(typeof r.body.plan_id, 'string');
  assert.deepEqual(r.body.assignments, []);
  assert.equal(r.body.moved_count, 0);
  assert.equal(r.body.unused_seats, 0);
  assert.equal(r.body.closure.table_id, 't_2');
  assert.equal(Date.parse(r.body.closure.from), Date.parse(body.from));
  assert.equal(Date.parse(r.body.closure.to), Date.parse(body.to));
  assert.equal(r.body.restaurant_revision, 3, 'two bookings at r_rep and one cancel');
});

test('S4-004 half-open window: bookings touching the window edges are not considered', async () => {
  const t = await world4();
  const before = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T16:30` }); // ends 18:00
  const after = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T20:00` });  // starts at to
  const inside = await mustBookR(t.ada, { table_id: 't_5', starts_at_local: `${THU}T17:00`, party_size: 4 }); // 17:00-18:30
  const r = await preview(t.max, closure('t_2', THU, '18:00', '20:00'));
  assertStatus(r, 201);
  assert.deepEqual(r.body.assignments, [{ reference: inside.reference, table_ids: ['t_5'], changed: false }]);
  assert.ok(![before.reference, after.reference].some(ref => r.body.assignments.some(a => a.reference === ref)));
});

test('S4-005 objective order: fewest moves, then fewest unused seats, then lowest ranks', async () => {
  // Fewer unused seats beats a lower rank: Nook (rank 2, 0 spare) over Bay (rank 0, 4 spare).
  let t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2', party_size: 2 });
  let r = await expectPlan(t, closure('t_2', THU, '18:00', '23:00'));
  assert.deepEqual(r.r.body.assignments, [{ reference: a.reference, table_ids: ['t_3'], changed: true }]);
  assert.deepEqual([r.r.body.moved_count, r.r.body.unused_seats], [1, 0]);
  // Fewer moves beats fewer unused seats: moving B too would reach 0 spare seats, but one move is better.
  t = await world4();
  const a2 = await mustBookR(t.ada, { table_id: 't_2', party_size: 4 });
  const b2 = await mustBookR(t.bob, { table_id: 't_5', party_size: 2 });
  r = await expectPlan(t, closure('t_2', THU, '18:00', '23:00'));
  const byRef = Object.fromEntries(r.r.body.assignments.map(x => [x.reference, x]));
  assert.deepEqual(byRef[a2.reference], { reference: a2.reference, table_ids: ['t_3', 't_4'], changed: true });
  assert.deepEqual(byRef[b2.reference], { reference: b2.reference, table_ids: ['t_5'], changed: false });
  assert.deepEqual([r.r.body.moved_count, r.r.body.unused_seats], [1, 2]);
  assert.deepEqual(r.r.body.assignments.map(x => x.reference), [a2.reference, b2.reference].sort());
  // Equal moves and seats: the lower rank wins (Loft rank 4 before the Nook+Snug pair rank 6).
  t = await world4();
  const a3 = await mustBookR(t.ada, { table_id: 't_2', party_size: 4 });
  r = await expectPlan(t, closure('t_2', THU, '18:00', '23:00'));
  assert.deepEqual(r.r.body.assignments, [{ reference: a3.reference, table_ids: ['t_5'], changed: true }]);
});

test('S4-006 capacity is judged under each booking\'s own accepted terms; fixed bookings block', async () => {
  const t = await world4();
  const old = await mustBookR(t.ada, { table_id: 't_2', party_size: 3 });                 // policy 0
  await mustPublish(t.max, policy(THU, { opening_hours: allWeek('12:00', '23:00'), capacities: { t_1: 6, t_2: 4, t_3: 3, t_4: 2, t_5: 2, t_6: 8 } }), { rid: 'r_rep' });
  const neu = await mustBookR(t.bob, { table_id: 't_3', party_size: 3, starts_at_local: `${THU}T17:00` }); // policy 1: Nook seats 3
  await mustBookR(t.cy, { table_id: 't_1', starts_at_local: `${THU}T20:00`, party_size: 2 }); // fixed, outside window
  const { r } = await expectPlan(t, closure('t_2', THU, '18:00', '19:30'));
  const mine = r.body.assignments.find(x => x.reference === old.reference);
  assert.ok(!mine.table_ids.includes('t_1'), 'Bay is taken by a fixed booking from 20:00');
  assert.ok(r.body.assignments.some(x => x.reference === neu.reference));
});

function lcg(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }

test('S4-007 S4-008 random scenarios within the planning limits match an exhaustive search', async () => {
  const OPTIONS = [['t_1'], ['t_2'], ['t_3'], ['t_4'], ['t_5'], ['t_6'], ['t_3', 't_4'], ['t_2', 't_5'], ['t_4', 't_5'], ['t_1', 't_6']];
  const TIMES = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'];
  const considered = (hm) => hm >= '17:00' && hm < '20:00';   // overlaps [18:00, 20:00) with 90-minute stays
  let infeasible = 0;
  for (let seed = 1; seed <= 14; seed++) {
    const rnd = lcg(seed * 7919);
    const t = await world4();
    if (seed % 3 === 0) {
      await mustPublish(t.max, policy(THU, { opening_hours: allWeek('12:00', '23:00'), capacities: { t_1: 5, t_2: 4, t_3: 3, t_4: 2, t_5: 4, t_6: 7 } }), { rid: 'r_rep' });
    }
    let inWindow = 0;
    for (let k = 0; k < 16 && inWindow < 6; k++) {
      const hm = TIMES[Math.floor(rnd() * TIMES.length)];
      if (considered(hm) && inWindow >= 6) continue;
      const o = OPTIONS[Math.floor(rnd() * OPTIONS.length)];
      const party = 1 + Math.floor(rnd() * 6);
      const who = [t.ada, t.bob, t.cy][k % 3];
      const res = await bookR(who, { ...(o.length === 1 ? { table_id: o[0] } : { table_ids: o }), party_size: party, starts_at_local: `${THU}T${hm}` });
      if (res.status === 201 && considered(hm)) inWindow++;
    }
    const table = ['t_1', 't_2', 't_3', 't_4', 't_5', 't_6'][Math.floor(rnd() * 6)];
    const { want } = await expectPlan(t, closure(table, THU, '18:00', '20:00'));
    if (want === null) infeasible++;
  }
  assert.ok(infeasible < 14, 'scenarios should not all be infeasible');
});

test('S4-010 a preview stores only the plan', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2', party_size: 2 });
  const rev = await revisionOf(t.max);
  const before = await get(`/reservations/${a.reference}`, { token: t.ada });
  const avBefore = (await availability('r_rep', THU, 2, '&explain=true')).body;
  const p = await preview(t.max, closure('t_2', THU, '18:00', '23:00'));
  assertStatus(p, 201);
  assert.equal(p.body.moved_count, 1);
  assert.deepEqual((await get(`/reservations/${a.reference}`, { token: t.ada })).body, before.body);
  assert.equal((await entries(a.reference, t.ada)).length, 1);
  assert.deepEqual((await availability('r_rep', THU, 2, '&explain=true')).body, avBefore, 'no closure recorded');
  assertStatus(await bookR(t.bob, { table_id: 't_2', starts_at_local: `${THU}T21:00` }), 201);
  assert.equal(await revisionOf(t.max), rev + 1, 'only the new booking counted');
});

test('S4-011 no feasible plan is 409 no_feasible_plan and changes nothing', async () => {
  const t = await world4();
  const big = await mustBookR(t.ada, { table_ids: ['t_1', 't_6'], party_size: 13 });
  const rev = await revisionOf(t.max);
  assertError(await preview(t.max, closure('t_1', THU, '18:00', '23:00')), 409, 'no_feasible_plan');
  assert.equal(await revisionOf(t.max), rev);
  assert.equal((await get(`/reservations/${big.reference}`, { token: t.ada })).body.revision, 1);
  assertStatus(await bookR(t.bob, { table_id: 't_1', starts_at_local: `${THU}T21:00` }), 201, 'no closure was recorded');
});

test('S4-012 previews are idempotent: replay returns the same plan; a different body is a key reuse', async () => {
  const t = await world4();
  await mustBookR(t.ada, { table_id: 't_2' });
  const key = newKey();
  const body = closure('t_2', THU, '18:00', '23:00');
  const first = await preview(t.max, body, { key });
  assertStatus(first, 201);
  const rep = await preview(t.max, body, { key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assertError(await preview(t.max, closure('t_5', THU, '18:00', '23:00'), { key }), 409, 'idempotency_key_reuse');
});

test('S4-013 diners\' cutoffs do not block an operator repair; past bookings are considered', async () => {
  const t = await world4();
  const day = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const past = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${day}T19:00`, party_size: 2 });
  const r = await preview(t.max, closure('t_2', day, '18:00', '23:00'));
  assertStatus(r, 201);
  assert.deepEqual(r.body.assignments, [{ reference: past.reference, table_ids: ['t_3'], changed: true }]);
  assert.ok(YESTERDAY_UTC);
});

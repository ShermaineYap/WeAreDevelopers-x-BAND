// Stage 4: applying a plan (POST /restaurants/{id}/replans/{plan_id}/apply) and closures afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, patch, world4, REP, THU, addDays, closure, bookR, mustBookR, preview, applyPlan, revisionOf,
  allReservations, optimalPlan, entries, cancel, amend, adopt, assertError, assertStatus, newKey, availability,
  burst, tally, noServerErrors, reset2,
} from './lib4.mjs';

const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;
const slot = (body, hm) => body.slots.find(s => s.starts_at_local.endsWith(`T${hm}`));

async function planFor(t, body, rid = 'r_rep') {
  const r = await preview(t.max, body, { rid });
  assertStatus(r, 201);
  return r.body;
}

test('S4-020 apply needs a manager and a key; unknown or foreign plans are 404', async () => {
  const t = await world4();
  await mustBookR(t.ada);
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  const other = await planFor(t, closure('t_1', THU, '18:00', '23:00'), 'r_rep2');
  assertError(await req('POST', `/restaurants/r_rep/replans/${p.plan_id}/apply`, { key: newKey(), body: {} }), 401, 'unauthenticated');
  assertError(await applyPlan(t.ada, p.plan_id), 403, 'forbidden');
  assertError(await post(`/restaurants/r_rep/replans/${p.plan_id}/apply`, {}, { token: t.max }), 400, 'missing_idempotency_key');
  assertError(await applyPlan(t.max, 'no-such-plan'), 404, 'not_found');
  assertError(await applyPlan(t.max, other.plan_id), 404, 'not_found');
  assertError(await applyPlan(t.max, p.plan_id, { rid: 'r_nope' }), 404, 'not_found');
  assertStatus(await applyPlan(t.max, p.plan_id, { body: { note: 'ignored' } }), 201);
});

test('S4-021 S4-022 application moves only changed bookings: one revision and one reassigned entry each', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2', party_size: 4 });
  const b = await mustBookR(t.bob, { table_id: 't_5', party_size: 2 });
  const c = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T12:00` });
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  const r = await applyPlan(t.max, p.plan_id);
  assertStatus(r, 201);
  assert.equal(r.body.plan_id, p.plan_id);
  assert.equal(r.body.restaurant_revision, p.restaurant_revision + 1);
  assert.deepEqual(r.body.reservations.map(x => x.reference), [a.reference, b.reference].sort());
  const ra = r.body.reservations.find(x => x.reference === a.reference);
  assert.deepEqual(ra.table_ids, ['t_3', 't_4']);
  assert.ok(!('table_id' in ra));
  assert.equal(ra.revision, 2);
  for (const k of ['starts_at', 'ends_at', 'starts_at_local', 'party_size', 'accepted_terms', 'created_at', 'reservation_id', 'status']) {
    assert.deepEqual(ra[k], a[k], k);
  }
  assert.deepEqual(await read(a.reference, t.ada), ra);
  assert.deepEqual(r.body.reservations.find(x => x.reference === b.reference), await read(b.reference, t.bob));
  assert.equal((await read(b.reference, t.bob)).revision, 1);
  assert.deepEqual(await read(c.reference, t.ada), c);
  const ea = await entries(a.reference, t.ada);
  assert.equal(ea.length, 2);
  const last = ea[1];
  assert.equal(last.event, 'reassigned');
  assert.equal(last.seq, 2);
  assert.equal(last.revision, 2);
  assert.equal(last.plan_id, p.plan_id);
  assert.deepEqual(last.changes, [{ field: 'table_ids', from: ['t_2'], to: ['t_3', 't_4'] }]);
  assert.deepEqual(last.accepted_terms, a.accepted_terms);
  assert.equal((await entries(b.reference, t.bob)).length, 1);
  assert.equal(await revisionOf(t.max), p.restaurant_revision + 1, 'one restaurant revision for the whole plan');
});

test('S4-023 an applied closure removes the table (and its pairs) from availability and refuses new holds', async () => {
  const t = await world4();
  const c = await mustBookR(t.ada, { table_id: 't_2', starts_at_local: `${THU}T12:00` });
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  assertStatus(await applyPlan(t.max, p.plan_id), 201);
  const av = (await availability('r_rep', THU, 2, '&explain=true')).body;
  for (const hm of ['17:00', '18:00', '19:30', '21:30']) {
    const s = slot(av, hm);
    assert.ok(!s.available_table_ids.includes('t_2'), hm);
    assert.ok(!s.available_options.some(o => o.table_ids.includes('t_2')), `${hm} pair with t_2`);
    const e = s.explain.find(x => x.table_id === 't_2');
    assert.deepEqual(e.rules, [{ rule: 'capacity', holds: true }, { rule: 'no_overlap', holds: false }], hm);
    assert.equal(e.available, false);
  }
  for (const hm of ['14:00', '16:00', '16:30']) {
    assert.ok(slot(av, hm).available_table_ids.includes('t_2'), `${hm} ends by 18:00 and stays bookable`);
  }
  assertError(await bookR(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` }), 409, 'table_unavailable');
  assertError(await bookR(t.bob, { table_ids: ['t_2', 't_5'], party_size: 6, starts_at_local: `${THU}T20:00` }), 409, 'table_unavailable');
  assertError(await amend(c.reference, { starts_at_local: `${THU}T17:00` }, t.ada), 409, 'table_unavailable');
  assertStatus(await bookR(t.bob, { table_id: 't_2', starts_at_local: `${THU}T16:30` }), 201);
  assertStatus(await bookR(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 1)}T19:00` }), 201);
  assertStatus(await bookR(t.bob, { restaurant_id: 'r_rep2', table_id: 't_2', starts_at_local: `${THU}T19:00` }), 201);
});

test('S4-024 any intervening restaurant revision makes a plan stale; nothing else does', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2' });
  let p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  // These do not count: another preview, another restaurant, failures, no-ops, replays.
  await planFor(t, closure('t_5', THU, '18:00', '23:00'));
  await mustBookR(t.bob, { restaurant_id: 'r_rep2', table_id: 't_1' });
  assertError(await bookR(t.bob, { table_id: 't_2' }), 409, 'table_unavailable');
  assertStatus(await amend(a.reference, { party_size: 2 }, t.ada), 200);
  const r = await applyPlan(t.max, p.plan_id);
  assertStatus(r, 201);
  // A real write in between: stale, and nothing changes.
  const b = await mustBookR(t.bob, { table_id: 't_5', starts_at_local: `${THU}T20:00` });
  p = await planFor(t, closure('t_5', THU, '18:00', '23:00'));
  const rev = p.restaurant_revision;
  await mustBookR(t.cy, { table_id: 't_6', starts_at_local: `${THU}T12:00` });
  assertError(await applyPlan(t.max, p.plan_id), 409, 'stale_plan');
  assert.equal(await revisionOf(t.max), rev + 1);
  assert.deepEqual((await read(b.reference, t.bob)).table_ids, ['t_5']);
  // No closure was recorded for t_5: a slot clear of b is still bookable.
  assertStatus(await bookR(t.cy, { table_id: 't_5', starts_at_local: `${THU}T18:00` }), 201);
});

test('S4-025 already applied vs replay', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2' });
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  const key = newKey();
  const first = await applyPlan(t.max, p.plan_id, { key });
  assertStatus(first, 201);
  const rev = await revisionOf(t.max);
  assertError(await applyPlan(t.max, p.plan_id), 409, 'plan_already_applied');
  assertStatus(await cancel(a.reference, t.ada), 200);
  const rep = await applyPlan(t.max, p.plan_id, { key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal(await revisionOf(t.max), rev + 1, 'only the cancel counted');
  assertError(await applyPlan(t.max, p.plan_id, { key, body: { x: 1 } }), 409, 'idempotency_key_reuse');
});

test('S4-026 later previews respect previously applied closures; a closure elsewhere does not stale a plan', async () => {
  const t = await world4();
  await mustBookR(t.ada, { table_id: 't_2', party_size: 2 });
  const b = await mustBookR(t.bob, { table_id: 't_5', party_size: 4 });
  assertStatus(await applyPlan(t.max, (await planFor(t, closure('t_2', THU, '18:00', '23:00'))).plan_id), 201);
  const prior = [{ table_id: 't_2', fromMs: Date.parse(closure('t_2', THU, '18:00', '23:00').from), toMs: Date.parse(closure('t_2', THU, '18:00', '23:00').to) }];
  const body = closure('t_5', THU, '18:00', '23:00');
  const atRep = (await allReservations([t.ada, t.bob, t.cy])).filter(r => r.restaurant_id === 'r_rep');
  const want = optimalPlan(REP, atRep, prior, { table_id: 't_5', fromMs: Date.parse(body.from), toMs: Date.parse(body.to) });
  const p = await planFor(t, body);
  assert.deepEqual(p.assignments, want.assignments);
  assert.ok(p.assignments.every(x => !x.table_ids.includes('t_2')));
  // A plan applied at another restaurant does not make this one stale.
  await mustBookR(t.cy, { restaurant_id: 'r_rep2', table_id: 't_1' });
  const other = await planFor(t, closure('t_1', THU, '18:00', '23:00'), 'r_rep2');
  assertStatus(await applyPlan(t.max, other.plan_id, { rid: 'r_rep2' }), 201);
  assertStatus(await applyPlan(t.max, p.plan_id), 201);
  assert.notDeepEqual((await read(b.reference, t.bob)).table_ids, ['t_5']);
});

test('S4-027 repairs move series occurrences: dates, terms and exception flags kept; one series revision per plan', async () => {
  const t = await world4();
  const anchor = await mustBookR(t.ada, { table_id: 't_2', party_size: 2 });
  const s = (await adopt(t.ada, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 })).body;
  assertStatus(await patch(`/reservations/${s.occurrences[1].reference}`, { party_size: 3 }, { token: t.ada }), 200);
  const before = (await get(`/series/${s.series_id}`, { token: t.ada })).body;
  assert.equal(before.revision, 2);
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00', addDays(THU, 7)));
  assert.equal(p.moved_count, 2);
  assertStatus(await applyPlan(t.max, p.plan_id), 201);
  const after = (await get(`/series/${s.series_id}`, { token: t.ada })).body;
  assert.equal(after.revision, 3);
  assert.deepEqual(after.occurrences.map(o => o.exception), [false, true, false]);
  for (const i of [0, 1, 2]) {
    const o = after.occurrences[i].reservation, b = before.occurrences[i].reservation;
    assert.deepEqual([o.starts_at, o.ends_at, o.accepted_terms, o.reference], [b.starts_at, b.ends_at, b.accepted_terms, b.reference]);
  }
  assert.ok(!after.occurrences[0].reservation.table_ids.includes('t_2'));
  assert.ok(!after.occurrences[1].reservation.table_ids.includes('t_2'));
  assert.deepEqual(after.occurrences[2].reservation.table_ids, ['t_2']);
});

test('S4-028 concurrent applications never leave partially moved bookings', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2', party_size: 4 });
  const b = await mustBookR(t.bob, { table_id: 't_5', party_size: 4 });
  const p1 = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  const p2 = await planFor(t, closure('t_5', THU, '18:00', '23:00'));
  const out = await burst(2, i => applyPlan(t.max, [p1, p2][i].plan_id));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 409: 1 });
  assert.equal(out.find(x => x.status === 409).body.error.code, 'stale_plan');
  const winner = out[0].status === 201 ? p1 : p2;
  for (const x of winner.assignments) {
    const tok = x.reference === a.reference ? t.ada : t.bob;
    assert.deepEqual((await read(x.reference, tok)).table_ids, x.table_ids);
  }
  // Ten different keys for one plan: one application.
  const p3 = await planFor(t, closure('t_6', THU, '18:00', '23:00'));
  const many = await burst(10, () => applyPlan(t.max, p3.plan_id));
  noServerErrors(many);
  assert.equal(tally(many)[201], 1);
  for (const r of many.filter(x => x.status === 409)) assert.equal(r.body.error.code, 'plan_already_applied');
});

test('S4-029 applied closures and plan receipts survive export/import', async () => {
  const t = await world4();
  const a = await mustBookR(t.ada, { table_id: 't_2' });
  const p = await planFor(t, closure('t_2', THU, '18:00', '23:00'));
  const key = newKey();
  const first = await applyPlan(t.max, p.plan_id, { key });
  assertStatus(first, 201);
  const e = await get('/_test/export');
  assertStatus(await post('/_test/reset', { users: [], restaurants: [], reservations: [] }), 204);
  assertStatus(await post('/_test/import', e.body, { timeout: 10000 }), 204);
  assertError(await bookR(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` }), 409, 'table_unavailable');
  const rep = await applyPlan(t.max, p.plan_id, { key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal((await entries(a.reference, t.ada)).at(-1).event, 'reassigned');
});

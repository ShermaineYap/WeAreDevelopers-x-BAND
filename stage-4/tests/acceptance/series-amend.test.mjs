// Stage 4: POST /series/{series_id}/amend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, patch, world4, THU, addDays, closure, bookR, mustBookR, preview, applyPlan, revisionOf, cancel,
  adopt, amendSeries, entries, mustPublish, policy, allWeek, assertError, assertStatus, newKey, burst, tally,
  noServerErrors,
} from './lib4.mjs';

const getSeries = async (id, token) => (await get(`/series/${id}`, { token })).body;
const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;

async function series(t, { count = 4, over = {} } = {}) {
  const anchor = await mustBookR(t.ada, { table_id: 't_2', party_size: 2, ...over });
  const r = await adopt(t.ada, { anchor_reference: anchor.reference, count, interval_weeks: 1 });
  assertStatus(r, 201);
  return r.body;
}

test('S4-040 owner-only idempotent write: 401, 400, 404 and replay', async () => {
  const t = await world4();
  const s = await series(t);
  const body = { expected_revision: 1, from_index: 1, local_time: '20:00' };
  assertError(await req('POST', `/series/${s.series_id}/amend`, { key: newKey(), body }), 401, 'unauthenticated');
  assertError(await post(`/series/${s.series_id}/amend`, body, { token: t.ada }), 400, 'missing_idempotency_key');
  assertError(await amendSeries(t.bob, s.series_id, body), 404, 'not_found');
  assertError(await amendSeries(t.ada, 'no-such-series', body), 404, 'not_found');
  const key = newKey();
  const first = await amendSeries(t.ada, s.series_id, { ...body, note: 'ignored' }, key);
  assertStatus(first, 201);
  assertStatus(await cancel(s.occurrences[3].reference, t.ada), 200);
  assertStatus(await patch(`/reservations/${s.occurrences[2].reference}`, { party_size: 3 }, { token: t.ada }), 200);
  const rep = await amendSeries(t.ada, s.series_id, { ...body, note: 'ignored' }, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assertError(await amendSeries(t.ada, s.series_id, { ...body, local_time: '21:00' }, key), 409, 'idempotency_key_reuse');
});

test('S4-041 input validation is 422; a stale revision is 409 before any booking validation', async () => {
  const t = await world4();
  const s = await series(t);
  const ok = { expected_revision: 1, from_index: 0, local_time: '20:00' };
  for (const bad of [
    { ...ok, expected_revision: 0 }, { ...ok, expected_revision: -1 }, { ...ok, expected_revision: 1.5 }, { ...ok, expected_revision: true },
    { ...ok, from_index: -1 }, { ...ok, from_index: 4 }, { ...ok, from_index: 1.5 }, { ...ok, from_index: true },
    { ...ok, local_time: '24:00' }, { ...ok, local_time: '7:00' }, { ...ok, local_time: '20:00:00' }, { ...ok, local_time: '2000' },
    { ...ok, local_time: '20:60' }, { ...ok, local_time: '' },
    { from_index: 0, local_time: '20:00' }, { expected_revision: 1, local_time: '20:00' }, { expected_revision: 1, from_index: 0 },
  ]) assertError(await amendSeries(t.ada, s.series_id, bad), 422, 'validation_failed');
  assertError(await amendSeries(t.ada, s.series_id, { ...ok, expected_revision: 2 }), 409, 'stale_revision');
  assertError(await amendSeries(t.ada, s.series_id, { ...ok, expected_revision: 2, local_time: '03:00' }), 409, 'stale_revision');
  assertError(await amendSeries(t.ada, s.series_id, { ...ok, local_time: '03:00' }), 422, 'outside_opening_hours');
  assertError(await amendSeries(t.ada, s.series_id, { ...ok, local_time: '19:15' }), 422, 'not_on_slot_grid');
  assert.equal((await getSeries(s.series_id, t.ada)).revision, 1);
  for (const o of s.occurrences) assert.deepEqual(await read(o.reference, t.ada), o.reservation);
});

test('S4-042 S4-043 eligible occurrences change time on their own dates; one entry and one revision each; no exceptions', async () => {
  const t = await world4();
  const s = await series(t);
  const rev = await revisionOf(t.max);
  const r = await amendSeries(t.ada, s.series_id, { expected_revision: 1, from_index: 1, local_time: '20:30' });
  assertStatus(r, 201);
  assert.equal(r.body.series_id, s.series_id);
  assert.equal(r.body.revision, 2);
  assert.deepEqual(r.body.occurrences.map(o => o.exception), [false, false, false, false]);
  assert.deepEqual(r.body.occurrences[0].reservation, s.occurrences[0].reservation);
  for (const i of [1, 2, 3]) {
    const o = r.body.occurrences[i];
    assert.equal(o.reference, s.occurrences[i].reference);
    assert.equal(o.reservation.starts_at_local, `${addDays(THU, 7 * i)}T20:30`);
    assert.deepEqual(o.reservation.table_ids, ['t_2']);
    assert.equal(o.reservation.party_size, 2);
    assert.equal(o.reservation.revision, 2);
    const e = await entries(o.reference, t.ada);
    assert.deepEqual(e.map(x => x.event), ['created', 'changed']);
    assert.deepEqual(e[1].changes, [{ field: 'starts_at_local', from: `${addDays(THU, 7 * i)}T19:00`, to: `${addDays(THU, 7 * i)}T20:30` }]);
  }
  assert.deepEqual(await getSeries(s.series_id, t.ada), r.body);
  assert.equal(await revisionOf(t.max), rev + 1);
});

test('S4-044 cancelled and exception occurrences are skipped; a no-op or empty set changes no revision', async () => {
  const t = await world4();
  const s = await series(t);
  assertStatus(await patch(`/reservations/${s.occurrences[2].reference}`, { party_size: 3 }, { token: t.ada }), 200);   // exception
  assertStatus(await cancel(s.occurrences[3].reference, t.ada), 200);
  let g = await getSeries(s.series_id, t.ada);
  assert.equal(g.revision, 3);
  const rev = await revisionOf(t.max);
  // Only exception and cancelled occurrences from index 2: empty eligible set.
  let r = await amendSeries(t.ada, s.series_id, { expected_revision: 3, from_index: 2, local_time: '21:00' });
  assertStatus(r, 201);
  assert.equal(r.body.revision, 3);
  // Same clock time: all no-op.
  r = await amendSeries(t.ada, s.series_id, { expected_revision: 3, from_index: 0, local_time: '19:00' });
  assertStatus(r, 201);
  assert.equal(r.body.revision, 3);
  assert.equal(await revisionOf(t.max), rev);
  r = await amendSeries(t.ada, s.series_id, { expected_revision: 3, from_index: 0, local_time: '21:00' });
  assertStatus(r, 201);
  assert.equal(r.body.revision, 4);
  const times = r.body.occurrences.map(o => o.reservation.starts_at_local.slice(11));
  assert.deepEqual(times, ['21:00', '21:00', '19:00', '19:00']);
  assert.deepEqual(r.body.occurrences.map(o => o.exception), [false, false, true, false]);
  assert.equal(r.body.occurrences[3].reservation.status, 'cancelled');
  assert.equal(await revisionOf(t.max), rev + 1);
});

test('S4-045 each real change adopts its resulting date\'s policy', async () => {
  const t = await world4();
  const s = await series(t, { count: 3 });
  await mustPublish(t.max, policy(addDays(THU, 14), { opening_hours: allWeek('12:00', '23:00'), reservation_duration_minutes: 60, capacities: { t_1: 6, t_2: 4, t_3: 2, t_4: 2, t_5: 4, t_6: 8 } }), { rid: 'r_rep' });
  const r = await amendSeries(t.ada, s.series_id, { expected_revision: 1, from_index: 1, local_time: '18:00' });
  assertStatus(r, 201);
  const [, o1, o2] = r.body.occurrences.map(o => o.reservation);
  assert.equal(o1.accepted_terms.policy_version, 0);
  assert.equal(o2.accepted_terms.policy_version, 1);
  assert.equal(Date.parse(o2.ends_at) - Date.parse(o2.starts_at), 60 * 60000);
});

test('S4-046 conflicts: non-occupancy errors first in index order, then occupancy; failures change nothing', async () => {
  const t = await world4();
  const s = await series(t);
  // Index 1 collides with another booking at 21:00 once moved to 20:00; index 2 sits on a day a policy closes; index 3 gets a capacity cut.
  await mustBookR(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 7)}T21:00` });
  await mustPublish(t.max, policy(addDays(THU, 14), { opening_hours: allWeek('12:00', '23:00').filter(h => h.weekday !== 'thu'), capacities: { t_1: 6, t_2: 4, t_3: 2, t_4: 2, t_5: 4, t_6: 8 } }), { rid: 'r_rep' });
  await mustPublish(t.max, policy(addDays(THU, 15), { opening_hours: allWeek('12:00', '23:00'), capacities: { t_1: 6, t_2: 1, t_3: 2, t_4: 2, t_5: 4, t_6: 8 } }), { rid: 'r_rep' });
  const key = newKey();
  const body = { expected_revision: 1, from_index: 0, local_time: '20:00' };
  const rev = await revisionOf(t.max);
  assertError(await amendSeries(t.ada, s.series_id, body, key), 422, 'outside_opening_hours');
  assertError(await amendSeries(t.ada, s.series_id, { ...body, from_index: 3 }), 422, 'party_exceeds_capacity');
  assertError(await amendSeries(t.ada, s.series_id, { ...body, from_index: 0, local_time: '21:30' }), 422, 'outside_opening_hours');
  assert.equal(await revisionOf(t.max), rev);
  for (const o of s.occurrences) {
    assert.deepEqual(await read(o.reference, t.ada), o.reservation);
    assert.equal((await entries(o.reference, t.ada)).length, 1);
  }
  assert.equal((await getSeries(s.series_id, t.ada)).revision, 1);
  // Only the occupancy conflict left (indices 0-1): 409; then the key is reusable once fixed.
  const s2 = await series(t, { count: 2, over: { table_id: 't_5', starts_at_local: `${THU}T12:00` } });
  await mustBookR(t.bob, { table_id: 't_5', starts_at_local: `${addDays(THU, 7)}T14:00` });
  const k2 = newKey();
  assertError(await amendSeries(t.ada, s2.series_id, { expected_revision: 1, from_index: 0, local_time: '13:00' }, k2), 409, 'table_unavailable');
  assertStatus(await amendSeries(t.ada, s2.series_id, { expected_revision: 1, from_index: 0, local_time: '12:30' }, k2), 201);
});

test('S4-047 resulting occurrences must not clash with unchanged occurrences or applied closures', async () => {
  const t = await world4();
  const s = await series(t, { count: 3 });
  // Index 2 becomes an exception moved onto index 1's date at 20:30 on the same table.
  assertStatus(await patch(`/reservations/${s.occurrences[2].reference}`, { starts_at_local: `${addDays(THU, 7)}T21:00` }, { token: t.ada }), 200);
  assertError(await amendSeries(t.ada, s.series_id, { expected_revision: 2, from_index: 1, local_time: '20:00' }), 409, 'table_unavailable');
  // An applied closure on the anchor's date from 21:00.
  const p = await preview(t.max, closure('t_2', THU, '21:00', '23:00'));
  assertStatus(p, 201);
  assertStatus(await applyPlan(t.max, p.body.plan_id), 201);
  assertError(await amendSeries(t.ada, s.series_id, { expected_revision: 2, from_index: 0, local_time: '20:00' }), 409, 'table_unavailable');
  assertStatus(await amendSeries(t.ada, s.series_id, { expected_revision: 2, from_index: 0, local_time: '18:00' }), 201);
});

test('S4-048 concurrent amendments from one revision: exactly one real change', async () => {
  const t = await world4();
  const s = await series(t, { count: 3 });
  const times = ['17:00', '17:30', '18:00', '18:30', '20:00', '20:30'];
  const out = await burst(12, i => amendSeries(t.ada, s.series_id, { expected_revision: 1, from_index: 0, local_time: times[i % times.length] }));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 409: 11 });
  for (const r of out.filter(x => x.status === 409)) assert.equal(r.body.error.code, 'stale_revision');
  const g = await getSeries(s.series_id, t.ada);
  assert.equal(g.revision, 2);
  assert.equal(new Set(g.occurrences.map(o => o.reservation.starts_at_local.slice(11))).size, 1);
});

test('S4-049 only real changes check the cutoff: an unchanged occurrence past its cutoff does not block (slow: ~1-2 min)', async () => {
  // A policy whose cutoff ends a minute or two after adoption makes occurrence 0 pass its cutoff during the test.
  const { todayIn, mustBookP, amend } = await import('./lib4.mjs');
  const t = await world4();
  const tomorrow = addDays(todayIn('UTC'), 1);
  const start = Date.parse(`${tomorrow}T12:00:00Z`);
  const c = Math.floor((start - Date.now()) / 60000) - 1;
  await mustPublish(t.max, { effective_from: '2020-01-01', slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: c, opening_hours: allWeek('00:00', '23:30'), capacities: { t_s1: 4, t_s2: 4 } }, { rid: 'r_soon' });
  const mk = async (table) => {
    const a = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: table, starts_at_local: `${tomorrow}T12:00` });
    const r = await adopt(t.ada, { anchor_reference: a.reference, count: 2, interval_weeks: 1 });
    assertStatus(r, 201);
    return r.body;
  };
  const mixed = await mk('t_s1');
  const same = await mk('t_s2');
  assertStatus(await amendSeries(t.ada, mixed.series_id, { expected_revision: 1, from_index: 1, local_time: '13:00' }), 201);
  await new Promise(r => setTimeout(r, Math.max(0, start - c * 60000 - Date.now() + 3000)));
  assertError(await amend(mixed.occurrences[0].reference, { party_size: 3 }, t.ada), 409, 'cutoff_passed');   // sanity: past cutoff now
  // All-no-op: succeeds without changing any revision.
  const noop = await amendSeries(t.ada, same.series_id, { expected_revision: 1, from_index: 0, local_time: '12:00' });
  assertStatus(noop, 201);
  assert.equal(noop.body.revision, 1);
  // Occurrence 0 unchanged (no cutoff check), occurrence 1 a real change.
  const r = await amendSeries(t.ada, mixed.series_id, { expected_revision: 2, from_index: 0, local_time: '12:00' });
  assertStatus(r, 201);
  assert.equal(r.body.revision, 3);
  assert.deepEqual(r.body.occurrences.map(o => o.reservation.starts_at_local.slice(11)), ['12:00', '12:00']);
  assert.equal(r.body.occurrences[0].reservation.revision, 1);
  // A real change to occurrence 0 is still refused by its cutoff.
  assertError(await amendSeries(t.ada, same.series_id, { expected_revision: 1, from_index: 0, local_time: '13:00' }), 409, 'cutoff_passed');
});

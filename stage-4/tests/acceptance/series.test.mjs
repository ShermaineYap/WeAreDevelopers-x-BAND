// Stage 3: recurring reservations (POST /series, GET /series/{id}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, world3, mustPublish, policy, mustBookP, bookP, entries, amend, cancel, adopt, THU, addDays,
  assertError, assertStatus, newKey, POL_TERMS0, assertTerms, YESTERDAY_UTC, berlinTransitions, burst, tally,
  noServerErrors, expectedInstant,
} from './lib3.mjs';

const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;
const getSeries = (id, token) => get(`/series/${id}`, { token });
const list = async (token) => (await get('/reservations', { token })).body.reservations;

async function adopted(t, { count = 3, interval_weeks = 1, over = {} } = {}) {
  const anchor = await mustBookP(t.ada, over);
  const r = await adopt(t.ada, { anchor_reference: anchor.reference, count, interval_weeks });
  assertStatus(r, 201);
  return { anchor, series: r.body };
}

test('S3-053 S3-054 S3-055 S3-059 S3-064 adoption returns every occurrence; the anchor is untouched', async () => {
  const t = await world3();
  const anchor = await mustBookP(t.ada, { table_id: 't_2', party_size: 3 });
  const before = await entries(anchor.reference, t.ada);
  const r = await adopt(t.ada, { anchor_reference: anchor.reference, count: 4, interval_weeks: 2, note: 'ignored' });
  assertStatus(r, 201);
  const s = r.body;
  assert.equal(typeof s.series_id, 'string');
  assert.equal(s.revision, 1);
  assert.equal(s.interval_weeks, 2);
  assert.deepEqual(s.occurrences.map(o => o.index), [0, 1, 2, 3]);
  assert.deepEqual(s.occurrences.map(o => o.exception), [false, false, false, false]);
  assert.equal(s.occurrences[0].reference, anchor.reference);
  assert.deepEqual(s.occurrences[0].reservation, anchor);
  assert.deepEqual(await read(anchor.reference, t.ada), anchor);
  assert.deepEqual(await entries(anchor.reference, t.ada), before);
  assert.equal(new Set(s.occurrences.map(o => o.reference)).size, 4);
  s.occurrences.forEach((o, i) => {
    assert.equal(o.reservation.reference, o.reference);
    assert.equal(o.reservation.starts_at_local, `${addDays(THU, 14 * i)}T19:00`);
    assert.equal(o.reservation.starts_at, expectedInstant('Europe/Berlin', `${addDays(THU, 14 * i)}T19:00`).rfc);
    assert.equal(o.reservation.party_size, 3);
    assert.deepEqual(o.reservation.table_ids, ['t_2']);
    assert.equal(o.reservation.status, 'confirmed');
    assert.equal(o.reservation.revision, 1);
  });
  const mine = await list(t.ada);
  for (const o of s.occurrences) assert.ok(mine.some(x => x.reference === o.reference), 'occurrences appear in the list');
  for (const o of s.occurrences.slice(1)) {
    const e = await entries(o.reference, t.ada);
    assert.deepEqual(e.map(x => x.event), ['created']);
    assert.equal(e[0].revision, 1);
  }
  assertError(await bookP(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 28)}T20:00` }), 409, 'table_unavailable');
  assertStatus(await bookP(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 7)}T19:00` }), 201);
});

test('S3-055 a combined-table anchor repeats the same pair', async () => {
  const t = await world3();
  const { series } = await adopted(t, { count: 2, over: { table_ids: ['t_2', 't_1'], party_size: 5 } });
  assert.deepEqual(series.occurrences[1].reservation.table_ids, ['t_2', 't_1']);
  assert.ok(!('table_id' in series.occurrences[1].reservation));
});

test('S3-050 S3-051 anchor rules: auth, key, owner, status, series membership, cutoff', async () => {
  const t = await world3();
  const a = await mustBookP(t.ada);
  const body = { anchor_reference: a.reference, count: 2, interval_weeks: 1 };
  assertError(await req('POST', '/series', { key: newKey(), body }), 401, 'unauthenticated');
  assertError(await post('/series', body, { token: t.ada }), 400, 'missing_idempotency_key');
  assertError(await adopt(t.ada, { ...body, anchor_reference: 'NOSUCH99' }), 404, 'not_found');
  assertError(await adopt(t.bob, body), 404, 'not_found');
  const c = await mustBookP(t.ada, { starts_at_local: `${THU}T21:00` });
  assertStatus(await cancel(c.reference, t.ada), 200);
  assertError(await adopt(t.ada, { ...body, anchor_reference: c.reference }), 409, 'reservation_cancelled');
  const past = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: 't_s1', starts_at_local: `${YESTERDAY_UTC}T12:00` });
  assertError(await adopt(t.ada, { ...body, anchor_reference: past.reference }), 409, 'cutoff_passed');
  const s = (await adopt(t.ada, body)).body;
  assertError(await adopt(t.ada, body), 409, 'already_in_series');
  assertError(await adopt(t.ada, { ...body, anchor_reference: s.occurrences[1].reference }), 409, 'already_in_series');
});

test('S3-052 count is 2..12 and interval_weeks 1..4, integers only', async () => {
  const t = await world3();
  const a = await mustBookP(t.ada);
  for (const [count, interval_weeks] of [[1, 1], [13, 1], [0, 1], [2.5, 1], [true, 1], [2, 0], [2, 5], [2, 1.5], [2, true]]) {
    assertError(await adopt(t.ada, { anchor_reference: a.reference, count, interval_weeks }), 422, 'validation_failed');
  }
  assertError(await adopt(t.ada, { anchor_reference: a.reference, interval_weeks: 1 }), 422, 'validation_failed');
  assertError(await adopt(t.ada, { anchor_reference: a.reference, count: 2 }), 422, 'validation_failed');
  assertError(await adopt(t.ada, { count: 2, interval_weeks: 1 }), 422, 'validation_failed');
  assert.equal((await list(t.ada)).length, 1);
  const r = await adopt(t.ada, { anchor_reference: a.reference, count: 12, interval_weeks: 4 });
  assertStatus(r, 201);
  assert.equal(r.body.occurrences.length, 12);
  assert.equal(r.body.occurrences[11].reservation.starts_at_local, `${addDays(THU, 11 * 28)}T19:00`);
});

test('S3-056 each generated occurrence selects its own date\'s policy', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(addDays(THU, 7), { reservation_duration_minutes: 60 }));
  await mustPublish(t.max, policy(addDays(THU, 14), { reservation_duration_minutes: 120, capacities: { t_1: 2, t_2: 5, t_3: 6 } }));
  const { anchor, series } = await adopted(t, { count: 3 });
  assertTerms(series.occurrences[0].reservation.accepted_terms, POL_TERMS0);
  assert.deepEqual(series.occurrences.map(o => o.reservation.accepted_terms.policy_version), [0, 1, 2]);
  assert.deepEqual(series.occurrences.map(o => (Date.parse(o.reservation.ends_at) - Date.parse(o.reservation.starts_at)) / 60000), [90, 60, 120]);
  assert.equal(anchor.revision, 1);
});

test('S3-058 all-or-nothing: the first failing occurrence decides; nothing survives', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(addDays(THU, 21), { opening_hours: [{ weekday: 'mon', opens: '18:00', closes: '23:00' }] }));
  await mustPublish(t.max, policy(addDays(THU, 22)));   // open again from the next day
  const blocker = await mustBookP(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 14)}T20:00` });
  const anchor = await mustBookP(t.ada);
  const key = newKey();
  const body = { anchor_reference: anchor.reference, count: 4, interval_weeks: 1 };
  assertError(await adopt(t.ada, body, key), 409, 'table_unavailable');          // index 2 occupied, index 3 closed
  assert.deepEqual((await list(t.ada)).map(r => r.reference), [anchor.reference]);
  assert.deepEqual(await read(anchor.reference, t.ada), anchor);
  assert.equal((await entries(anchor.reference, t.ada)).length, 1);
  assert.equal((await list(t.bob)).length, 1);
  assertStatus(await cancel(blocker.reference, t.bob), 200);
  assertError(await adopt(t.ada, body, key), 422, 'outside_opening_hours');      // now index 3 decides
  await mustBookP(t.bob, { table_id: 't_2', starts_at_local: `${addDays(THU, 7)}T18:00` });
  assertError(await adopt(t.ada, body, key), 409, 'table_unavailable');          // index 1 precedes index 3
  // Capacity under an occurrence's policy also rejects the whole adoption.
  await mustPublish(t.max, policy(addDays(THU, 35), { capacities: { t_1: 2, t_2: 1, t_3: 6 } }));
  const a2 = await mustBookP(t.ada, { starts_at_local: `${addDays(THU, 28)}T19:00` });
  assertError(await adopt(t.ada, { anchor_reference: a2.reference, count: 2, interval_weeks: 1 }), 422, 'party_exceeds_capacity');
  // The failed key is reusable and the anchor is not "already in series".
  const ok = await adopt(t.ada, { anchor_reference: anchor.reference, count: 2, interval_weeks: 2 }, key);
  assertStatus(ok, 201);
});

test('S3-057 a nonexistent local time rejects the adoption; a repeated time is its first occurrence', async () => {
  const t = await world3();
  const { spring, fall } = berlinTransitions();
  const a = await mustBookP(t.ada, { restaurant_id: 'r_dst', table_id: 't_d1', starts_at_local: `${addDays(spring, -7)}T02:30` });
  assertError(await adopt(t.ada, { anchor_reference: a.reference, count: 2, interval_weeks: 1 }), 422, 'invalid_local_time');
  assert.equal((await list(t.ada)).length, 1);
  const f = await mustBookP(t.ada, { restaurant_id: 'r_dst', table_id: 't_d1', starts_at_local: `${addDays(fall, -7)}T02:30` });
  const r = await adopt(t.ada, { anchor_reference: f.reference, count: 2, interval_weeks: 1 });
  assertStatus(r, 201);
  assert.equal(r.body.occurrences[1].reservation.starts_at, `${fall}T02:30:00+02:00`);
});

test('S3-060 GET /series/{id} is owner-only and shows current states', async () => {
  const t = await world3();
  const { series } = await adopted(t);
  const g = await getSeries(series.series_id, t.ada);
  assertStatus(g, 200);
  assert.deepEqual(g.body, series);
  assertError(await getSeries(series.series_id, t.bob), 404, 'not_found');
  assertError(await getSeries(series.series_id, undefined), 404, 'not_found');
  assertError(await getSeries('nope', t.ada), 404, 'not_found');
});

test('S3-061 a real PATCH marks a permanent exception and bumps the series revision; no-ops and failures do not', async () => {
  const t = await world3();
  const { series } = await adopted(t);
  const [o0, o1, o2] = series.occurrences;
  assertStatus(await amend(o2.reference, { party_size: 2 }, t.ada), 200);                    // no-op
  assertError(await amend(o2.reference, { party_size: 99 }, t.ada), 422, 'party_exceeds_capacity');
  assertError(await amend(o2.reference, { party_size: 3, expected_revision: 7 }, t.ada), 409, 'stale_revision');
  let g = (await getSeries(series.series_id, t.ada)).body;
  assert.equal(g.revision, 1);
  assert.deepEqual(g.occurrences.map(o => o.exception), [false, false, false]);
  assertStatus(await amend(o1.reference, { table_id: 't_3' }, t.ada), 200);
  g = (await getSeries(series.series_id, t.ada)).body;
  assert.equal(g.revision, 2);
  assert.deepEqual(g.occurrences.map(o => o.exception), [false, true, false]);
  assert.equal(g.occurrences[1].reference, o1.reference);
  assert.equal(g.occurrences[1].reservation.table_id, 't_3');
  assert.equal(g.occurrences[1].reservation.revision, 2);
  // Changing it back keeps the exception; the series revision moves again.
  assertStatus(await amend(o1.reference, { table_id: 't_2' }, t.ada), 200);
  g = (await getSeries(series.series_id, t.ada)).body;
  assert.equal(g.revision, 3);
  assert.equal(g.occurrences[1].exception, true);
  assert.equal(g.occurrences[0].reference, o0.reference);
});

test('S3-062 cancelling an occurrence bumps the series revision without marking an exception; anchor cancel spares siblings', async () => {
  const t = await world3();
  const { series } = await adopted(t);
  const [o0, o1, o2] = series.occurrences;
  assertStatus(await cancel(o1.reference, t.ada), 200);
  let g = (await getSeries(series.series_id, t.ada)).body;
  assert.equal(g.revision, 2);
  assert.equal(g.occurrences[1].exception, false);
  assert.equal(g.occurrences[1].reservation.status, 'cancelled');
  assert.equal(g.occurrences.length, 3);
  assertStatus(await cancel(o1.reference, t.ada), 200);
  assert.equal((await getSeries(series.series_id, t.ada)).body.revision, 2);
  assertStatus(await cancel(o0.reference, t.ada), 200);
  g = (await getSeries(series.series_id, t.ada)).body;
  assert.equal(g.revision, 3);
  assert.equal(g.occurrences[2].reservation.status, 'confirmed');
  assert.equal((await read(o2.reference, t.ada)).status, 'confirmed');
});

test('S3-063 a replay returns the original series response and changes no counter', async () => {
  const t = await world3();
  const anchor = await mustBookP(t.ada);
  const key = newKey();
  const body = { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 };
  const first = await adopt(t.ada, body, key);
  assertStatus(first, 201);
  assertStatus(await amend(first.body.occurrences[1].reference, { party_size: 3 }, t.ada), 200);
  const rep = await adopt(t.ada, body, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  const g = (await getSeries(first.body.series_id, t.ada)).body;
  assert.equal(g.revision, 2);
  assert.equal((await list(t.ada)).length, 2);
  assertError(await adopt(t.ada, { ...body, count: 3 }, key), 409, 'idempotency_key_reuse');
});

test('S3-063 concurrent adoptions of one anchor: one series; identical retries replay', async () => {
  const t = await world3();
  const anchor = await mustBookP(t.ada);
  const body = { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 };
  const out = await burst(10, () => adopt(t.ada, body));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 201: 1, 409: 9 });
  for (const r of out.filter(x => x.status === 409)) assert.equal(r.body.error.code, 'already_in_series');
  assert.equal((await list(t.ada)).length, 3);
  const a2 = await mustBookP(t.ada, { starts_at_local: `${THU}T21:00` });
  const key = newKey();
  const same = await burst(10, () => adopt(t.ada, { anchor_reference: a2.reference, count: 2, interval_weeks: 1 }, key));
  noServerErrors(same);
  assert.deepEqual(tally(same), { 201: 1, 200: 9 });
  assert.equal((await list(t.ada)).length, 5);
});

// Stage 3: combined-table history and collective moves under policies and agreements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, world3, mustPublish, policy, mustBookP, bookP, entries, amend, adopt, THU, addDays, allWeek,
  assertError, assertStatus, newKey, POL_TERMS0, assertTerms, SOON_DAY,
} from './lib3.mjs';

const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;
const moves = (token, list, key = newKey()) => post('/reservation-moves', { moves: list }, { token, key });

test('S3-082 creating a pair records table_ids from null, in declared order', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_ids: ['t_1', 't_2'], party_size: 5 });
  const e = await entries(b.reference, t.ada);
  assert.deepEqual(e[0].changes, [
    { field: 'table_ids', from: null, to: ['t_2', 't_1'] },
    { field: 'starts_at_local', from: null, to: `${THU}T19:00` },
    { field: 'party_size', from: null, to: 5 },
  ]);
});

test('S3-081 S3-083 S3-084 table_id for single-to-single, table_ids for any change involving a pair', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_id: 't_3', party_size: 2 });
  assertStatus(await amend(b.reference, { table_id: 't_2' }, t.ada), 200);
  assertStatus(await amend(b.reference, { table_ids: ['t_2', 't_1'] }, t.ada), 200);
  const rev = (await read(b.reference, t.ada)).revision;
  const same = await amend(b.reference, { table_ids: ['t_1', 't_2'] }, t.ada);   // reversed: same set
  assertStatus(same, 200);
  assert.equal(same.body.revision, rev, 'a reversed pair is not an amendment');
  assertStatus(await amend(b.reference, { table_id: 't_3', party_size: 4 }, t.ada), 200);
  const e = await entries(b.reference, t.ada);
  assert.deepEqual(e.map(x => x.event), ['created', 'changed', 'changed', 'changed']);
  assert.deepEqual(e[0].changes[0], { field: 'table_id', from: null, to: 't_3' });
  assert.deepEqual(e[1].changes, [{ field: 'table_id', from: 't_3', to: 't_2' }]);
  assert.deepEqual(e[2].changes, [{ field: 'table_ids', from: ['t_2'], to: ['t_2', 't_1'] }]);
  assert.deepEqual(e[3].changes, [{ field: 'table_ids', from: ['t_2', 't_1'], to: ['t_3'] }, { field: 'party_size', from: 2, to: 4 }]);
  assert.deepEqual(e.map(x => x.revision), [1, 2, 3, 4]);
});

test('S3-080 a pair\'s capacity is the sum of the selected policy\'s capacities', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(THU, { capacities: { t_1: 1, t_2: 2, t_3: 6 } }));
  assertError(await bookP(t.ada, { table_ids: ['t_2', 't_1'], party_size: 4 }), 422, 'party_exceeds_capacity');
  const b = await mustBookP(t.ada, { table_ids: ['t_2', 't_1'], party_size: 3 });
  assert.equal(b.accepted_terms.policy_version, 1);
  // On a policy-0 date the same pair seats 6.
  assertStatus(await bookP(t.ada, { table_ids: ['t_2', 't_1'], party_size: 6, starts_at_local: `${addDays(THU, -1)}T19:00` }), 201);
});

test('S3-090 S3-092 each real move adopts its new date\'s policy with one revision and one entry; no-ops keep everything', async () => {
  const t = await world3();
  const next = addDays(THU, 7);
  await mustPublish(t.max, policy(next, { reservation_duration_minutes: 60 }));
  const a = await mustBookP(t.ada, { table_id: 't_1' });
  const b = await mustBookP(t.ada, { table_id: 't_3' });
  const r = await moves(t.ada, [{ reference: a.reference, starts_at_local: `${next}T19:00` }, { reference: b.reference }]);
  assertStatus(r, 201);
  const [ra, rb] = r.body.reservations;
  assert.equal(ra.revision, 2);
  assert.equal(ra.accepted_terms.policy_version, 1);
  assert.equal(Date.parse(ra.ends_at) - Date.parse(ra.starts_at), 60 * 60000);
  assert.deepEqual(rb, b);
  const ea = await entries(a.reference, t.ada);
  assert.deepEqual(ea.map(x => x.event), ['created', 'changed']);
  assert.deepEqual(ea[1].changes, [{ field: 'starts_at_local', from: `${THU}T19:00`, to: `${next}T19:00` }]);
  assert.equal(ea[1].accepted_terms.policy_version, 1);
  assert.equal((await entries(b.reference, t.ada)).length, 1);
});

test('S3-090 S3-093 the old accepted cutoff applies per move; a failing batch changes nothing', async () => {
  const t = await world3();
  await mustPublish(t.max, { effective_from: '2020-01-01', slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 10080, opening_hours: allWeek('00:00', '23:30'), capacities: { t_s1: 4, t_s2: 4 } }, { rid: 'r_soon' });
  const strict = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: 't_s1', starts_at_local: `${SOON_DAY}T12:00` });
  const other = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: 't_s2', starts_at_local: `${addDays(SOON_DAY, 30)}T12:00` });
  assertError(await moves(t.ada, [{ reference: other.reference, party_size: 3 }, { reference: strict.reference, party_size: 3 }]), 409, 'cutoff_passed');
  assert.deepEqual(await read(other.reference, t.ada), other);
  // Occupancy failure after a valid real change: still nothing changes.
  const a = await mustBookP(t.ada, { table_id: 't_1' });
  const b = await mustBookP(t.ada, { table_id: 't_3' });
  await mustBookP(t.bob, { table_id: 't_2' });
  assertError(await moves(t.ada, [{ reference: a.reference, party_size: 1 }, { reference: b.reference, table_id: 't_2' }]), 409, 'table_unavailable');
  for (const x of [a, b]) {
    assert.deepEqual(await read(x.reference, t.ada), x);
    assert.equal((await entries(x.reference, t.ada)).length, 1);
  }
});

test('S3-091 per-move expected_revision: stale is 409, invalid is 422, matching proceeds', async () => {
  const t = await world3();
  const a = await mustBookP(t.ada, { table_id: 't_1' });
  const b = await mustBookP(t.ada, { table_id: 't_3' });
  assertError(await moves(t.ada, [{ reference: a.reference, party_size: 1, expected_revision: 1 }, { reference: b.reference, party_size: 3, expected_revision: 2 }]), 409, 'stale_revision');
  for (const v of [0, -2, 1.5, '1', true]) {
    assertError(await moves(t.ada, [{ reference: a.reference, party_size: 1, expected_revision: v }]), 422, 'validation_failed');
  }
  assert.deepEqual(await read(a.reference, t.ada), a);
  const ok = await moves(t.ada, [{ reference: a.reference, party_size: 1, expected_revision: 1 }, { reference: b.reference, party_size: 3, expected_revision: 1 }]);
  assertStatus(ok, 201);
  assert.deepEqual(ok.body.reservations.map(x => x.revision), [2, 2]);
});

test('S3-094 S3-095 a batch bumps each affected series once, marks exceptions; a replay changes nothing', async () => {
  const t = await world3();
  const anchor = await mustBookP(t.ada, { table_id: 't_2' });
  const s = (await adopt(t.ada, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 })).body;
  const [o0, o1, o2] = s.occurrences;
  const key = newKey();
  const list = [{ reference: o1.reference, table_id: 't_3' }, { reference: o2.reference, party_size: 3 }, { reference: o0.reference }];
  const first = await moves(t.ada, list, key);
  assertStatus(first, 201);
  let g = (await get(`/series/${s.series_id}`, { token: t.ada })).body;
  assert.equal(g.revision, 2, 'one series revision for the whole batch');
  assert.deepEqual(g.occurrences.map(o => o.exception), [false, true, true]);
  assert.deepEqual(g.occurrences[0].reservation, anchor);
  const rep = await moves(t.ada, list, key);
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  g = (await get(`/series/${s.series_id}`, { token: t.ada })).body;
  assert.equal(g.revision, 2);
  assert.equal((await entries(o1.reference, t.ada)).length, 2);
  // A failed batch touching the series changes no revision or exception flag.
  await mustBookP(t.bob, { table_id: 't_1', starts_at_local: `${addDays(THU, 14)}T19:00` });
  assertError(await moves(t.ada, [{ reference: o0.reference, party_size: 1 }, { reference: o2.reference, table_id: 't_1', party_size: 2 }]), 409, 'table_unavailable');
  g = (await get(`/series/${s.series_id}`, { token: t.ada })).body;
  assert.equal(g.revision, 2);
  assert.deepEqual(g.occurrences.map(o => o.exception), [false, true, true]);
  assert.equal((await read(o0.reference, t.ada)).revision, 1);
});

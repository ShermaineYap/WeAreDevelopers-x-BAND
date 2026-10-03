// Stage 3: cancel and amendment under accepted terms, revisions and expected_revision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, world3, mustPublish, publish, policy, mustBookP, bookP, entries, decision, amend, cancel, THU, addDays,
  allWeek, assertError, assertStatus, newKey, post, POL_TERMS0, assertTerms, SOON_DAY, YESTERDAY_UTC, burst,
  tally, noServerErrors,
} from './lib3.mjs';

const soonPolicy = (over = {}) => ({
  effective_from: '2020-01-01', slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 10080,
  opening_hours: allWeek('00:00', '23:30'), capacities: { t_s1: 4, t_s2: 4 }, ...over,
});
const soon = (token, over = {}) => mustBookP(token, { restaurant_id: 'r_soon', table_id: 't_s1', starts_at_local: `${SOON_DAY}T12:00`, ...over });
const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;

test('S3-040 cancel uses the accepted cutoff, not a newer policy', async () => {
  const t = await world3();
  const lenient = await soon(t.ada);                                // accepted cutoff 120
  await mustPublish(t.max, soonPolicy(), { rid: 'r_soon' });       // 7-day cutoff for every date
  const strict = await soon(t.ada, { starts_at_local: `${SOON_DAY}T14:00` });
  assert.equal(strict.accepted_terms.cancellation_cutoff_minutes, 10080);
  assertStatus(await cancel(lenient.reference, t.ada), 200);
  assertError(await cancel(strict.reference, t.ada), 409, 'cutoff_passed');
  assert.equal((await read(strict.reference, t.ada)).revision, 1);
});

test('S3-041 S3-043 an amendment checks the old accepted cutoff, then adopts the new policy', async () => {
  const t = await world3();
  const b = await soon(t.ada);
  await mustPublish(t.max, soonPolicy(), { rid: 'r_soon' });
  const r = await amend(b.reference, { party_size: 3 }, t.ada);       // old cutoff 120: allowed
  assertStatus(r, 200);
  assert.equal(r.body.revision, 2);
  assert.equal(r.body.accepted_terms.policy_version, 1);
  assert.equal(r.body.accepted_terms.cancellation_cutoff_minutes, 10080);
  // Now the accepted cutoff is 7 days: further changes, even to a far date, are refused.
  assertError(await amend(b.reference, { starts_at_local: `${THU}T12:00` }, t.ada), 409, 'cutoff_passed');
  assertError(await cancel(b.reference, t.ada), 409, 'cutoff_passed');
  assert.equal((await read(b.reference, t.ada)).revision, 2);
});

test('S3-042 S3-043 resulting fields are validated against the resulting date\'s policy; terms and end time are replaced', async () => {
  const t = await world3();
  const next = addDays(THU, 7);
  await mustPublish(t.max, policy(next, {
    slot_minutes: 60, reservation_duration_minutes: 60, opening_hours: [{ weekday: 'thu', opens: '12:00', closes: '15:00' }],
    capacities: { t_1: 2, t_2: 3, t_3: 6 },
  }));
  const b = await mustBookP(t.ada, { table_id: 't_2', party_size: 4 });
  assertTerms(b.accepted_terms, POL_TERMS0);
  assertError(await amend(b.reference, { starts_at_local: `${next}T19:00`, party_size: 3 }, t.ada), 422, 'outside_opening_hours');
  assertError(await amend(b.reference, { starts_at_local: `${next}T12:30`, party_size: 3 }, t.ada), 422, 'not_on_slot_grid');
  // Only the time changes, but the unchanged party of 4 no longer fits t_2 under the new policy.
  assertError(await amend(b.reference, { starts_at_local: `${next}T12:00` }, t.ada), 422, 'party_exceeds_capacity');
  assert.deepEqual(await read(b.reference, t.ada), b, 'failed amendments change nothing');
  const r = await amend(b.reference, { starts_at_local: `${next}T14:00`, party_size: 3 }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.revision, 2);
  assert.equal(r.body.accepted_terms.policy_version, 1);
  assert.equal(Date.parse(r.body.ends_at) - Date.parse(r.body.starts_at), 60 * 60000);
  assert.deepEqual((await decision(b.reference, t.ada)).body.accepted_terms, r.body.accepted_terms);
  // Moving back adopts policy 0 again.
  const back = await amend(b.reference, { starts_at_local: `${THU}T19:00` }, t.ada);
  assertStatus(back, 200);
  assert.equal(back.body.revision, 3);
  assertTerms(back.body.accepted_terms, POL_TERMS0);
  assert.equal(Date.parse(back.body.ends_at) - Date.parse(back.body.starts_at), 90 * 60000);
});

test('S3-043 a real amendment on the same date adopts the policy now applicable to that date', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { party_size: 2 });
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60 }));
  const r = await amend(b.reference, { party_size: 3 }, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.accepted_terms.policy_version, 1);
  assert.equal(Date.parse(r.body.ends_at) - Date.parse(r.body.starts_at), 60 * 60000);
});

test('S3-044 a no-op keeps terms, end time, revision and history, but still needs a confirmed, editable booking', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { party_size: 2 });
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60 }));
  const r = await amend(b.reference, { party_size: 2, table_id: 't_2' }, t.ada);
  assertStatus(r, 200);
  assert.deepEqual(r.body, b);
  assert.equal((await entries(b.reference, t.ada)).length, 1);
  const past = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: 't_s1', starts_at_local: `${YESTERDAY_UTC}T12:00` });
  assertError(await amend(past.reference, { party_size: 2 }, t.ada), 409, 'cutoff_passed');
  assertError(await amend(past.reference, {}, t.ada), 409, 'cutoff_passed');
  assertStatus(await cancel(b.reference, t.ada), 200);
  assertError(await amend(b.reference, { party_size: 2 }, t.ada), 409, 'reservation_cancelled');
});

test('S3-045 S3-046 failures change nothing; cancel adds one revision, a repeat adds none', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { party_size: 2 });
  await mustBookP(t.bob, { table_id: 't_3', party_size: 2 });
  for (const [body, status] of [[{ table_id: 't_3' }, 409], [{ party_size: 9 }, 422], [{ starts_at_local: `${THU}T19:15` }, 422], [{ table_ids: ['t_1', 't_3'] }, 422]]) {
    assert.equal((await amend(b.reference, body, t.ada)).status, status);
  }
  assert.deepEqual(await read(b.reference, t.ada), b);
  assert.equal((await entries(b.reference, t.ada)).length, 1);
  const c1 = await cancel(b.reference, t.ada);
  assert.equal(c1.body.revision, 2);
  const c2 = await cancel(b.reference, t.ada);
  assert.equal(c2.body.revision, 2);
  assert.deepEqual(c2.body, c1.body);
  assert.deepEqual((await entries(b.reference, t.ada)).map(e => e.event), ['created', 'cancelled']);
});

test('S3-047 expected_revision: stale is 409 before cutoff and validation; bad values are 422', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { party_size: 2 });
  assertError(await amend(b.reference, { party_size: 3, expected_revision: 2 }, t.ada), 409, 'stale_revision');
  assertError(await amend(b.reference, { party_size: 0, expected_revision: 9 }, t.ada), 409, 'stale_revision');
  assertError(await amend(b.reference, { starts_at_local: 'garbage', expected_revision: 9 }, t.ada), 409, 'stale_revision');
  assertError(await amend(b.reference, { party_size: 2, expected_revision: 9 }, t.ada), 409, 'stale_revision');
  for (const v of [0, -1, 1.5, '1', true, null]) {
    assertError(await amend(b.reference, { party_size: 3, expected_revision: v }, t.ada), 422, 'validation_failed');
  }
  assert.deepEqual(await read(b.reference, t.ada), b);
  const ok = await amend(b.reference, { party_size: 3, expected_revision: 1 }, t.ada);
  assertStatus(ok, 200);
  assert.equal(ok.body.revision, 2);
  assertError(await amend(b.reference, { party_size: 4, expected_revision: 1 }, t.ada), 409, 'stale_revision');
  const noop = await amend(b.reference, { party_size: 3, expected_revision: 2 }, t.ada);
  assertStatus(noop, 200);
  assert.equal(noop.body.revision, 2);
  // Omitted: stage-1 semantics.
  assertStatus(await amend(b.reference, { party_size: 4, unknown_field: 1 }, t.ada), 200);
  // Stale beats cutoff.
  const past = await mustBookP(t.ada, { restaurant_id: 'r_soon', table_id: 't_s1', starts_at_local: `${YESTERDAY_UTC}T12:00` });
  assertError(await amend(past.reference, { party_size: 3, expected_revision: 4 }, t.ada), 409, 'stale_revision');
  assertError(await amend(past.reference, { party_size: 3, expected_revision: 1 }, t.ada), 409, 'cutoff_passed');
});

test('S3-048 concurrent amendments on one revision: exactly one real change succeeds', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_id: 't_3', party_size: 2 });
  const parties = [1, 3, 4, 5, 6];
  const out = await burst(20, i => amend(b.reference, { party_size: parties[i % parties.length], expected_revision: 1 }, t.ada));
  noServerErrors(out);
  assert.deepEqual(tally(out), { 200: 1, 409: 19 });
  for (const r of out.filter(x => x.status === 409)) assert.equal(r.body.error.code, 'stale_revision');
  const now = await read(b.reference, t.ada);
  assert.equal(now.revision, 2);
  assert.equal(now.party_size, out.find(x => x.status === 200).body.party_size);
  assert.equal((await entries(b.reference, t.ada)).length, 2);
});

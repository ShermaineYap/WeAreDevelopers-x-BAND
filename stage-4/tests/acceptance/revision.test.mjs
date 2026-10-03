// Stage 4: restaurant revision counting, observed through previews and applications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, world4, fixture4, THU, addDays, closure, bookR, mustBookR, preview, applyPlan, revisionOf, amend, cancel,
  adopt, amendSeries, mustPublish, publish, policy, allWeek, assertStatus, assertError, newKey,
} from './lib4.mjs';

test('S4-030 the restaurant revision starts at 0 and counts each successful state change once', async () => {
  const seeds = [{ id: 'res_seed4', reference: 'SEEDREP1', user_id: 'u_ada', restaurant_id: 'r_rep', table_id: 't_6', starts_at_local: `${THU}T12:00`, party_size: 4 }];
  const t = await world4(fixture4({ reservations: seeds }));
  let rev = 0;
  const expect = async (n, why) => { rev += n; assert.equal(await revisionOf(t.max), rev, why); };
  await expect(0, 'after reset, seeds included');
  const key = newKey();
  const body = { restaurant_id: 'r_rep', table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
  const a = (await post('/reservations', body, { token: t.ada, key })).body;
  await expect(1, 'new booking');
  assertStatus(await post('/reservations', body, { token: t.ada, key }), 200);
  await expect(0, 'replay');
  assertError(await bookR(t.bob, { table_id: 't_2' }), 409, 'table_unavailable');
  await expect(0, 'failed booking');
  assertStatus(await amend(a.reference, { party_size: 2 }, t.ada), 200);
  await expect(0, 'no-op amendment');
  assertStatus(await amend(a.reference, { party_size: 3 }, t.ada), 200);
  await expect(1, 'real amendment');
  assertError(await amend(a.reference, { party_size: 3, expected_revision: 1 }, t.ada), 409, 'stale_revision');
  await expect(0, 'failed amendment');
  const pkey = newKey();
  const pol = policy(addDays(THU, 30), { opening_hours: allWeek('12:00', '23:00'), capacities: { t_1: 6, t_2: 4, t_3: 2, t_4: 2, t_5: 4, t_6: 8 } });
  assertStatus(await publish(t.max, pol, { rid: 'r_rep', key: pkey }), 201);
  await expect(1, 'policy publication');
  assertStatus(await publish(t.max, pol, { rid: 'r_rep', key: pkey }), 200);
  assertError(await publish(t.max, { ...pol, slot_minutes: 0 }, { rid: 'r_rep' }), 422, 'validation_failed');
  await expect(0, 'policy replay and failure');
  const anchor = await mustBookR(t.bob, { table_id: 't_1', starts_at_local: `${THU}T13:00` });
  await expect(1, 'new booking');
  const s = await adopt(t.bob, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 });
  assertStatus(s, 201);
  await expect(1, 'series adoption: once for the whole operation');
  assertStatus(await amendSeries(t.bob, s.body.series_id, { expected_revision: 1, from_index: 0, local_time: '13:00' }), 201);
  await expect(0, 'all-no-op series amendment');
  assertStatus(await amendSeries(t.bob, s.body.series_id, { expected_revision: 1, from_index: 1, local_time: '14:00' }), 201);
  await expect(1, 'series amendment: once although two occurrences changed');
  const mv = await post('/reservation-moves', { moves: [{ reference: a.reference, table_id: 't_5' }, { reference: 'SEEDREP1', party_size: 3 }] }, { token: t.ada, key: newKey() });
  assertStatus(mv, 201);
  await expect(1, 'batch move: once for the whole batch');
  assertStatus(await post('/reservation-moves', { moves: [{ reference: a.reference, table_id: 't_5' }] }, { token: t.ada, key: newKey() }), 201);
  await expect(0, 'all-no-op batch');
  assertStatus(await cancel(a.reference, t.ada), 200);
  await expect(1, 'cancellation');
  assertStatus(await cancel(a.reference, t.ada), 200);
  await expect(0, 'repeated cancel');
  const p = await preview(t.max, closure('t_1', THU, '12:00', '15:00'));
  assertStatus(p, 201);
  assert.equal(p.body.restaurant_revision, rev);
  await expect(0, 'preview');
  const ap = await applyPlan(t.max, p.body.plan_id);
  assertStatus(ap, 201);
  assert.equal(ap.body.restaurant_revision, rev + 1);
  await expect(1, 'plan application: once for the whole plan');
  // Another restaurant's writes never count here.
  await mustBookR(t.cy, { restaurant_id: 'r_rep2', table_id: 't_1' });
  await expect(0, 'write at another restaurant');
  assert.equal(await revisionOf(t.max, 'r_rep2'), 1);
});

test('S4-031 reset returns every restaurant revision to 0', async () => {
  let t = await world4();
  await mustBookR(t.ada);
  assert.equal(await revisionOf(t.max), 1);
  t = await world4();
  assert.equal(await revisionOf(t.max), 0);
});

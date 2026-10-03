// Stage 3: availability explanations and reservation history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, world3, mustBookP, bookP, mustPublish, policy, history, entries, amend, cancel, THU, addDays,
  assertError, assertStatus, availability, newKey, post, POL_TERMS0, assertTerms,
} from './lib3.mjs';

const MON = addDays(THU, 4);
const explainOf = async (date, party, extra = '&explain=true', rid = 'r_pol') => {
  const r = await availability(rid, date, party, extra);
  assertStatus(r, 200);
  return r.body;
};
const slotAt = (body, hm) => body.slots.find(s => s.starts_at_local.endsWith(`T${hm}`));

test('S3-001 explain accepts only "true"; any other value is 422', async () => {
  await world3();
  for (const v of ['false', '1', '', 'TRUE', 'True', 'yes', 'true ', '0']) {
    assertError(await availability('r_pol', THU, 2, `&explain=${encodeURIComponent(v)}`), 422, 'validation_failed');
  }
  assertStatus(await availability('r_pol', THU, 2, '&explain=true'), 200);
});

test('S3-002 without explain the slot shape is unchanged', async () => {
  await world3();
  const b = await explainOf(THU, 2, '');
  for (const s of b.slots) {
    assert.deepEqual(Object.keys(s).sort(), ['available_options', 'available_table_ids', 'starts_at', 'starts_at_local']);
  }
});

test('S3-003 S3-004 S3-005 every table once, both rules in order, available iff both hold', async () => {
  const t = await world3();
  await mustBookP(t.bob, { table_id: 't_1', party_size: 2 });
  await mustBookP(t.bob, { table_id: 't_3', party_size: 5, starts_at_local: `${THU}T21:00` });
  const b = await explainOf(THU, 3);
  for (const s of b.slots) {
    assert.deepEqual(s.explain.map(e => e.table_id), ['t_1', 't_2', 't_3'], s.starts_at_local);
    for (const e of s.explain) {
      assert.deepEqual(e.rules.map(r => r.rule), ['capacity', 'no_overlap']);
      for (const r of e.rules) assert.equal(typeof r.holds, 'boolean');
      assert.equal(e.available, e.rules.every(r => r.holds));
    }
    assert.deepEqual(s.explain.filter(e => e.available).map(e => e.table_id), s.available_table_ids);
  }
  const s19 = slotAt(b, '19:00');
  const byId = Object.fromEntries(s19.explain.map(e => [e.table_id, e]));
  // t_1: too small AND booked -> both false.
  assert.deepEqual(byId.t_1.rules, [{ rule: 'capacity', holds: false }, { rule: 'no_overlap', holds: false }]);
  assert.equal(byId.t_1.available, false);
  // t_2: fits and free.
  assert.deepEqual(byId.t_2.rules, [{ rule: 'capacity', holds: true }, { rule: 'no_overlap', holds: true }]);
  // t_3 at 21:00: fits, but booked -> capacity still reported holding.
  const t3 = slotAt(b, '21:00').explain.find(e => e.table_id === 't_3');
  assert.deepEqual(t3.rules, [{ rule: 'capacity', holds: true }, { rule: 'no_overlap', holds: false }]);
  // t_1 at 21:00: free but too small -> no_overlap still reported holding.
  const t1 = slotAt(b, '21:00').explain.find(e => e.table_id === 't_1');
  assert.deepEqual(t1.rules, [{ rule: 'capacity', holds: false }, { rule: 'no_overlap', holds: true }]);
});

test('S3-006 closed day is []; a slot with no available table still explains every table', async () => {
  const t = await world3();
  // r_dst opens on Sundays only.
  assert.deepEqual((await explainOf(MON, 2, '&explain=true', 'r_dst')).slots, []);
  for (const tb of ['t_1', 't_2', 't_3']) await mustBookP(t.bob, { table_id: tb, party_size: 2 });
  const s = slotAt(await explainOf(THU, 2), '19:00');
  assert.deepEqual(s.available_table_ids, []);
  assert.equal(s.explain.length, 3);
  for (const e of s.explain) {
    assert.equal(e.available, false);
    assert.deepEqual(e.rules, [{ rule: 'capacity', holds: true }, { rule: 'no_overlap', holds: false }]);
  }
});

test('S3-007 S3-008 explanations name the selected policy and use its capacities; cancelled bookings never block', async () => {
  const t = await world3();
  let s = slotAt(await explainOf(THU, 3), '19:00');
  for (const e of s.explain) assert.equal(e.policy_version, 0);
  const c = await mustBookP(t.bob, { table_id: 't_3', party_size: 3 });
  assertStatus(await cancel(c.reference, t.bob), 200);
  await mustPublish(t.max, policy(THU, { capacities: { t_1: 3, t_2: 2, t_3: 6 } }));
  s = slotAt(await explainOf(THU, 3), '19:00');
  for (const e of s.explain) assert.equal(e.policy_version, 1);
  const byId = Object.fromEntries(s.explain.map(e => [e.table_id, e]));
  assert.equal(byId.t_1.rules[0].holds, true, 'policy raised t_1 to 3 seats');
  assert.equal(byId.t_2.rules[0].holds, false, 'policy lowered t_2 to 2 seats');
  assert.deepEqual(s.available_table_ids, ['t_1', 't_3']);
  // The day before is still policy 0.
  const prev = slotAt(await explainOf(addDays(THU, -1), 3), '19:00');
  for (const e of prev.explain) assert.equal(e.policy_version, 0);
});

test('S3-010 history is owner-only: other users and anonymous callers get 404', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada);
  assertStatus(await history(b.reference, t.ada), 200);
  assertError(await history(b.reference, t.bob), 404, 'not_found');
  assertError(await history(b.reference, t.max), 404, 'not_found');
  assertError(await history(b.reference, undefined), 404, 'not_found');
  assertError(await history('NOSUCH99', t.ada), 404, 'not_found');
  assertError(await history('NOSUCH99', undefined), 404, 'not_found');
});

test('S3-011 S3-012 S3-013 S3-014 S3-016 sequence, created, changed and cancelled entries', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_id: 't_2', party_size: 4 });
  assertStatus(await amend(b.reference, { table_id: 't_3' }, t.ada), 200);
  assertStatus(await amend(b.reference, { party_size: 5, starts_at_local: `${THU}T20:00` }, t.ada), 200);
  assertStatus(await amend(b.reference, { party_size: 3, table_id: 't_2', starts_at_local: `${THU}T19:30` }, t.ada), 200);
  assertStatus(await cancel(b.reference, t.ada), 200);
  assertStatus(await cancel(b.reference, t.ada), 200);
  assertError(await amend(b.reference, { party_size: 2 }, t.ada), 409, 'reservation_cancelled');
  const r = await history(b.reference, t.ada);
  assertStatus(r, 200);
  assert.equal(r.body.reference, b.reference);
  const e = r.body.entries;
  assert.deepEqual(e.map(x => x.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(e.map(x => x.event), ['created', 'changed', 'changed', 'changed', 'cancelled']);
  for (let i = 1; i < e.length; i++) assert.ok(Date.parse(e[i].at) >= Date.parse(e[i - 1].at), 'at order follows seq');
  for (const x of e) assert.match(x.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/);
  assert.deepEqual(e[0].changes, [
    { field: 'table_id', from: null, to: 't_2' },
    { field: 'starts_at_local', from: null, to: `${THU}T19:00` },
    { field: 'party_size', from: null, to: 4 },
  ]);
  assert.deepEqual(e[1].changes, [{ field: 'table_id', from: 't_2', to: 't_3' }]);
  assert.deepEqual(e[2].changes, [
    { field: 'starts_at_local', from: `${THU}T19:00`, to: `${THU}T20:00` },
    { field: 'party_size', from: 4, to: 5 },
  ]);
  assert.deepEqual(e[3].changes, [
    { field: 'table_id', from: 't_3', to: 't_2' },
    { field: 'starts_at_local', from: `${THU}T20:00`, to: `${THU}T19:30` },
    { field: 'party_size', from: 5, to: 3 },
  ]);
  assert.deepEqual(e[4].changes, []);
});

test('S3-015 a PATCH to the current values succeeds and records nothing', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_id: 't_2', party_size: 4 });
  for (const body of [{ table_id: 't_2' }, { party_size: 4 }, { starts_at_local: `${THU}T19:00` },
    { table_id: 't_2', party_size: 4, starts_at_local: `${THU}T19:00` }, { table_ids: ['t_2'] }, {}]) {
    const r = await amend(b.reference, body, t.ada);
    assertStatus(r, 200);
    assert.deepEqual(r.body, b, `no-op ${JSON.stringify(body)} must leave the booking as it was`);
  }
  // One real field among unchanged ones: only that field is recorded.
  assertStatus(await amend(b.reference, { table_id: 't_2', party_size: 3, starts_at_local: `${THU}T19:00` }, t.ada), 200);
  const e = await entries(b.reference, t.ada);
  assert.deepEqual(e.map(x => x.event), ['created', 'changed']);
  assert.deepEqual(e[1].changes, [{ field: 'party_size', from: 4, to: 3 }]);
});

test('S3-017 an idempotent replay records nothing', async () => {
  const t = await world3();
  const key = newKey();
  const body = { restaurant_id: 'r_pol', table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
  const first = await post('/reservations', body, { token: t.ada, key });
  assertStatus(first, 201);
  for (let i = 0; i < 3; i++) assertStatus(await post('/reservations', body, { token: t.ada, key }), 200);
  assert.deepEqual((await entries(first.body.reference, t.ada)).map(x => x.seq), [1]);
});

test('S3-018 each entry carries its resulting revision and the terms of that moment', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada, { table_id: 't_2', party_size: 2 });
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60, capacities: { t_1: 2, t_2: 5, t_3: 6 } }));
  assertStatus(await amend(b.reference, { party_size: 5 }, t.ada), 200);
  assertStatus(await cancel(b.reference, t.ada), 200);
  const e = await entries(b.reference, t.ada);
  assert.deepEqual(e.map(x => x.revision), [1, 2, 3]);
  assertTerms(e[0].accepted_terms, POL_TERMS0, 'created entry keeps policy 0 terms');
  assert.equal(e[1].accepted_terms.policy_version, 1);
  assert.equal(e[1].accepted_terms.reservation_duration_minutes, 60);
  assert.deepEqual(e[1].accepted_terms.capacities, { t_1: 2, t_2: 5, t_3: 6 });
  assert.equal(e[2].accepted_terms.policy_version, 1);
  assert.ok(!('effective_from' in e[1].accepted_terms));
});

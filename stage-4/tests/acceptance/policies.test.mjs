// Stage 3: policies, selection, accepted terms and the decision endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, req, world3, fixture3, publish, mustPublish, policy, mustBookP, bookP, decision, entries, amend,
  cancel, THU, addDays, allWeek, assertError, assertStatus, availability, newKey, POL_TERMS0, assertTerms,
  USERS, MAX,
} from './lib3.mjs';

const termsOf = (p) => { const { effective_from, ...rest } = p; return rest; };

test('S3-020 only managers publish; unknown restaurant 404; non-manager 403; no token 401; key required', async () => {
  const t = await world3();
  assertError(await req('POST', '/restaurants/r_pol/policies', { key: newKey(), body: policy(THU) }), 401, 'unauthenticated');
  assertError(await publish(t.ada, policy(THU)), 403, 'forbidden');
  assertError(await publish(t.max, policy(THU), { rid: 'r_nope' }), 404, 'not_found');
  assertError(await publish(t.max, { ...policy(THU), capacities: { t_d1: 4 } }, { rid: 'r_dst' }), 403, 'forbidden');
  assertError(await post('/restaurants/r_pol/policies', policy(THU), { token: t.max }), 400, 'missing_idempotency_key');
  assert.deepEqual((await get('/restaurants/r_pol/policies')).body, { policies: [] });
});

test('S3-021 S3-022 versions start at 1 per restaurant; replays and failures allocate nothing', async () => {
  const t = await world3();
  const key = newKey();
  const body = policy(THU, { reservation_duration_minutes: 60, note: 'ignored' });
  const first = await publish(t.max, body, { key });
  assertStatus(first, 201);
  assert.equal(first.body.policy_version, 1);
  for (const [k, v] of Object.entries(policy(THU, { reservation_duration_minutes: 60 }))) assert.deepEqual(first.body[k], v, k);
  const rep = await publish(t.max, body, { key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assertError(await publish(t.max, policy(THU), { key }), 409, 'idempotency_key_reuse');
  assertError(await publish(t.max, policy(THU, { slot_minutes: 0 })), 422, 'validation_failed');
  assert.equal((await mustPublish(t.max, policy(THU))).policy_version, 2);
  assert.equal((await mustPublish(t.max, { ...policy(THU), capacities: { t_o: 4 } }, { rid: 'r_other3' })).policy_version, 1);
  assert.equal((await mustPublish(t.max, policy(addDays(THU, -30)))).policy_version, 3);
  const list = (await get('/restaurants/r_pol/policies')).body.policies;
  assert.deepEqual(list.map(p => p.policy_version), [1, 2, 3]);
});

test('S3-023 invalid policies are 422 and change nothing', async () => {
  const t = await world3();
  const bad = [];
  for (const f of ['effective_from', 'slot_minutes', 'reservation_duration_minutes', 'cancellation_cutoff_minutes', 'opening_hours', 'capacities']) {
    const p = policy(THU); delete p[f]; bad.push([`missing ${f}`, p]);
  }
  for (const v of ['2026-02-30', '2026-9-01', 'tomorrow', '', `${THU}T00:00`]) bad.push([`effective_from ${v}`, policy(THU, { effective_from: v })]);
  for (const v of [0, 1441, 1.5, true, -30]) bad.push([`slot ${v}`, policy(THU, { slot_minutes: v })]);
  for (const v of [0, 1441, 2.5, false]) bad.push([`duration ${v}`, policy(THU, { reservation_duration_minutes: v })]);
  for (const v of [-1, 10081, 2.5, true]) bad.push([`cutoff ${v}`, policy(THU, { cancellation_cutoff_minutes: v })]);
  bad.push(['duplicate weekday', policy(THU, { opening_hours: [...allWeek(), { weekday: 'thu', opens: '12:00', closes: '14:00' }] })]);
  bad.push(['closes before opens', policy(THU, { opening_hours: [{ weekday: 'thu', opens: '20:00', closes: '18:00' }] })]);
  bad.push(['closes equals opens', policy(THU, { opening_hours: [{ weekday: 'thu', opens: '18:00', closes: '18:00' }] })]);
  bad.push(['bad weekday', policy(THU, { opening_hours: [{ weekday: 'xyz', opens: '18:00', closes: '23:00' }] })]);
  bad.push(['bad clock', policy(THU, { opening_hours: [{ weekday: 'thu', opens: '25:00', closes: '26:00' }] })]);
  bad.push(['capacities missing a table', policy(THU, { capacities: { t_1: 2, t_2: 4 } })]);
  bad.push(['capacities extra table', policy(THU, { capacities: { t_1: 2, t_2: 4, t_3: 6, t_9: 2 } })]);
  for (const v of [0, 101, 2.5, true]) bad.push([`capacity ${v}`, policy(THU, { capacities: { t_1: v, t_2: 4, t_3: 6 } })]);
  for (const [name, body] of bad) assertError(await publish(t.max, body), 422, 'validation_failed');
  assert.deepEqual((await get('/restaurants/r_pol/policies')).body, { policies: [] }, 'nothing stored');
  // Boundaries are valid, and the first success is version 1.
  const ok = [
    policy(THU, { slot_minutes: 1, reservation_duration_minutes: 1440, cancellation_cutoff_minutes: 0 }),
    policy(THU, { slot_minutes: 1440, cancellation_cutoff_minutes: 10080, capacities: { t_1: 1, t_2: 100, t_3: 6 } }),
  ];
  assert.equal((await mustPublish(t.max, ok[0])).policy_version, 1);
  assert.equal((await mustPublish(t.max, ok[1])).policy_version, 2);
});

test('S3-025 S3-026 policies are public in publication order; restaurant detail stays the fixture', async () => {
  const t = await world3();
  const a = await mustPublish(t.max, policy(addDays(THU, 7), { reservation_duration_minutes: 60 }));
  const b = await mustPublish(t.max, policy(THU, { cancellation_cutoff_minutes: 30 }));
  const r = await get('/restaurants/r_pol/policies');
  assertStatus(r, 200);
  assert.deepEqual(r.body.policies, [a, b]);
  assertError(await get('/restaurants/r_nope/policies'), 404, 'not_found');
  const d = (await get('/restaurants/r_pol')).body;
  assert.equal(d.reservation_duration_minutes, 90);
  assert.equal(d.cancellation_cutoff_minutes, 120);
  assert.deepEqual(d.tables.map(x => x.capacity), [2, 4, 6]);
});

test('S3-027 selection: greatest effective_from not after the start date, ties by greatest version', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(addDays(THU, 7), { reservation_duration_minutes: 60 }));   // v1
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 120 }));              // v2
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 30 }));               // v3 supersedes v2 on THU
  await mustPublish(t.max, policy(addDays(THU, -7), { reservation_duration_minutes: 45 }));  // v4
  await mustPublish(t.max, policy('2020-01-01', { reservation_duration_minutes: 150 }));     // v5, long past
  const cases = [
    [addDays(THU, -8), 5, 150], [addDays(THU, -7), 4, 45], [addDays(THU, -1), 4, 45],
    [THU, 3, 30], [addDays(THU, 6), 3, 30], [addDays(THU, 7), 1, 60], [addDays(THU, 30), 1, 60],
  ];
  for (const [date, version, minutes] of cases) {
    const b = await mustBookP(t.ada, { starts_at_local: `${date}T19:00` });
    assert.equal(b.accepted_terms.policy_version, version, date);
    assert.equal(b.accepted_terms.reservation_duration_minutes, minutes, date);
    assert.equal(Date.parse(b.ends_at) - Date.parse(b.starts_at), minutes * 60000, date);
    const ex = (await availability('r_pol', date, 1, '&explain=true')).body.slots[0].explain;
    for (const e of ex) assert.equal(e.policy_version, version, date);
  }
});

test('S3-027 policy 0 applies before any published policy', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(addDays(THU, 1), { reservation_duration_minutes: 30 }));
  const b = await mustBookP(t.ada);
  assertTerms(b.accepted_terms, POL_TERMS0);
});

test('S3-028 availability and booking follow the selected policy (grid, hours, duration, capacities, pairs)', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(THU, {
    slot_minutes: 60, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120,
    opening_hours: [{ weekday: 'thu', opens: '12:00', closes: '15:00' }],
    capacities: { t_1: 1, t_2: 1, t_3: 3 },
  }));
  const av = (await availability('r_pol', THU, 1)).body;
  assert.deepEqual(av.slots.map(s => s.starts_at_local.slice(11)), ['12:00', '13:00', '14:00']);
  const s = av.slots[0];
  assert.deepEqual(s.available_options, [
    { table_ids: ['t_1'], capacity: 1 }, { table_ids: ['t_2'], capacity: 1 }, { table_ids: ['t_3'], capacity: 3 },
    { table_ids: ['t_2', 't_1'], capacity: 2 },
  ]);
  assert.deepEqual((await availability('r_pol', addDays(THU, 1), 1)).body.slots, [], 'Friday is closed under the policy');
  assertError(await bookP(t.ada, { starts_at_local: `${THU}T19:00` }), 422, 'outside_opening_hours');
  assertError(await bookP(t.ada, { starts_at_local: `${THU}T12:30` }), 422, 'not_on_slot_grid');
  assertError(await bookP(t.ada, { table_id: 't_2', party_size: 2, starts_at_local: `${THU}T12:00` }), 422, 'party_exceeds_capacity');
  assertError(await bookP(t.ada, { table_ids: ['t_2', 't_1'], party_size: 3, starts_at_local: `${THU}T12:00` }), 422, 'party_exceeds_capacity');
  const ok = await mustBookP(t.ada, { table_ids: ['t_2', 't_1'], party_size: 2, starts_at_local: `${THU}T14:00` });
  assert.match(ok.ends_at, /T15:00:00[+-]/);
  assert.deepEqual(ok.accepted_terms.capacities, { t_1: 1, t_2: 1, t_3: 3 });
});

test('S3-029 reservation responses carry revision 1 and a full accepted_terms snapshot', async () => {
  const t = await world3();
  const b0 = await mustBookP(t.ada);
  assert.equal(b0.revision, 1);
  assertTerms(b0.accepted_terms, POL_TERMS0);
  const p = await mustPublish(t.max, policy(addDays(THU, 7), {
    reservation_duration_minutes: 60, cancellation_cutoff_minutes: 30, opening_hours: [{ weekday: 'thu', opens: '17:00', closes: '22:00' }],
    capacities: { t_1: 3, t_2: 4, t_3: 5 },
  }));
  const b1 = await mustBookP(t.ada, { starts_at_local: `${addDays(THU, 7)}T19:00` });
  assert.equal(b1.revision, 1);
  assertTerms(b1.accepted_terms, termsOf(p));
  for (const r of [await get(`/reservations/${b1.reference}`, { token: t.ada }), (await get('/reservations', { token: t.ada }))]) {
    const x = r.body.reservations ? r.body.reservations.find(y => y.reference === b1.reference) : r.body;
    assert.equal(x.revision, 1);
    assertTerms(x.accepted_terms, termsOf(p));
  }
});

test('S3-030 seeded bookings start at revision 1 under policy 0', async () => {
  const fx = fixture3({ reservations: [{ id: 'res_seed3', reference: 'SEEDPOL1', user_id: 'u_ada', restaurant_id: 'r_pol', table_id: 't_3', starts_at_local: `${THU}T20:00`, party_size: 5 }] });
  const t = await world3(fx);
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 30 }));
  const g = (await get('/reservations/SEEDPOL1', { token: t.ada })).body;
  assert.equal(g.revision, 1);
  assertTerms(g.accepted_terms, POL_TERMS0);
  assert.equal(Date.parse(g.ends_at) - Date.parse(g.starts_at), 90 * 60000);
  const d = await decision('SEEDPOL1', t.ada);
  assertStatus(d, 200);
  assert.equal(d.body.revision, 1);
});

test('S3-031 replies to old idempotency keys keep the original revision and terms', async () => {
  const t = await world3();
  const key = newKey();
  const body = { restaurant_id: 'r_pol', table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
  const first = await post('/reservations', body, { token: t.ada, key });
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60 }));
  assertStatus(await amend(first.body.reference, { party_size: 3 }, t.ada), 200);
  assertStatus(await cancel(first.body.reference, t.ada), 200);
  const rep = await post('/reservations', body, { token: t.ada, key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  assert.equal(rep.body.revision, 1);
});

test('S3-032 publishing never edits existing bookings, their end times, occupancy or history', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada);
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 30, capacities: { t_1: 2, t_2: 1, t_3: 6 } }));
  await mustPublish(t.max, policy('2020-01-01', { reservation_duration_minutes: 30 }));
  assert.deepEqual((await get(`/reservations/${b.reference}`, { token: t.ada })).body, b);
  assert.equal((await entries(b.reference, t.ada)).length, 1);
  const ex = (await availability('r_pol', THU, 1, '&explain=true')).body.slots.find(s => s.starts_at_local.endsWith('T20:00')).explain;
  assert.equal(ex.find(e => e.table_id === 't_2').rules[1].holds, false, 'the 19:00-20:30 booking still blocks 20:00');
});

test('S3-033 decision returns the current revision and terms, owner-only, even after cancel', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada);
  let d = await decision(b.reference, t.ada);
  assertStatus(d, 200);
  assert.deepEqual(d.body, { reference: b.reference, revision: 1, accepted_terms: b.accepted_terms });
  assertError(await decision(b.reference, t.bob), 404, 'not_found');
  assertError(await decision(b.reference, undefined), 404, 'not_found');
  assertError(await decision('NOSUCH99', t.ada), 404, 'not_found');
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60 }));
  assertStatus(await amend(b.reference, { party_size: 3 }, t.ada), 200);
  assertStatus(await cancel(b.reference, t.ada), 200);
  d = await decision(b.reference, t.ada);
  assertStatus(d, 200);
  assert.equal(d.body.revision, 3);
  assert.equal(d.body.accepted_terms.policy_version, 1);
  const g = (await get(`/reservations/${b.reference}`, { token: t.ada })).body;
  assert.deepEqual(d.body.accepted_terms, g.accepted_terms);
  assert.equal(g.revision, 3);
});

test('S3-020 managers gain no access to diners\' bookings', async () => {
  const t = await world3();
  const b = await mustBookP(t.ada);
  for (const path of [`/reservations/${b.reference}`, `/reservations/${b.reference}/history`, `/reservations/${b.reference}/decision`]) {
    assertError(await get(path, { token: t.max }), 404, 'not_found');
  }
  assertError(await cancel(b.reference, t.max), 404, 'not_found');
});

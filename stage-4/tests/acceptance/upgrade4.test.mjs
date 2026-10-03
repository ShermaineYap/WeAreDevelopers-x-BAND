// Stage 4: exports from the same team's stage-1, stage-2 and stage-3 services are accepted, and
// stage-4 operations work on what they carry (series with moved and cancelled occurrences).
// PREVIOUS_BASE_URL = stage-3 service, PREVIOUS_STAGE2_BASE_URL = stage 2, PREVIOUS_STAGE1_BASE_URL = stage 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, fixture, fixture2, fixture4, USERS, MAX, PASSWORD, THU, addDays, newKey, assertError,
  assertStatus, closure, preview, applyPlan, amendSeries, adopt,
} from './lib4.mjs';

function client(base) {
  return async (method, path, { token, key, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['Idempotency-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base.replace(/\/+$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : undefined };
  };
}
const login = async (c, u) => (await c('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).body.token;

async function importInto(exported) {
  assertStatus(await post('/_test/reset', { users: [], restaurants: [], reservations: [] }), 204);
  assertStatus(await post('/_test/import', exported, { timeout: 10000 }), 204);
}

const S3 = process.env.PREVIOUS_BASE_URL;
test('S4-050 a stage-3 export: series with exception and cancelled occurrences can be amended and repaired', { skip: S3 ? false : 'set PREVIOUS_BASE_URL to the stage-3 service' }, async () => {
  const prev = client(S3);
  assertStatus(await prev('POST', '/_test/reset', { body: fixture4() }), 204);
  const ada = await login(prev, USERS.ada);
  const bob = await login(prev, USERS.bob);
  const max = await login(prev, MAX);
  const bookKey = newKey();
  const anchorBody = { restaurant_id: 'r_rep', table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
  const anchor = (await prev('POST', '/reservations', { token: ada, key: bookKey, body: anchorBody })).body;
  const seriesKey = newKey();
  const seriesBody = { anchor_reference: anchor.reference, count: 4, interval_weeks: 1 };
  const made = await prev('POST', '/series', { token: ada, key: seriesKey, body: seriesBody });
  assertStatus(made, 201);
  const occ = made.body.occurrences;
  assertStatus(await prev('PATCH', `/reservations/${occ[2].reference}`, { token: ada, body: { table_id: 't_5' } }), 200);  // moved: exception
  assertStatus(await prev('POST', `/reservations/${occ[3].reference}/cancel`, { token: ada, body: {} }), 200);
  const other = (await prev('POST', '/reservations', { token: bob, key: newKey(), body: { restaurant_id: 'r_rep', table_id: 't_5', starts_at_local: `${THU}T19:00`, party_size: 4 } })).body;
  assertStatus(await prev('POST', '/restaurants/r_rep/policies', { token: max, key: newKey(), body: { effective_from: addDays(THU, 21), slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 120, opening_hours: fixture4().restaurants[0].opening_hours, capacities: { t_1: 6, t_2: 4, t_3: 2, t_4: 2, t_5: 4, t_6: 8 } } }), 201);
  const seriesBefore = (await prev('GET', `/series/${made.body.series_id}`, { token: ada })).body;
  const histBefore = (await prev('GET', `/reservations/${occ[2].reference}/history`, { token: ada })).body;
  const exported = await prev('GET', '/_test/export');
  assertStatus(exported, 200);

  await importInto(exported.body);
  assert.deepEqual((await get(`/series/${made.body.series_id}`, { token: ada })).body, seriesBefore);
  assert.deepEqual((await get(`/reservations/${occ[2].reference}/history`, { token: ada })).body, histBefore);
  assert.deepEqual((await post('/reservations', anchorBody, { token: ada, key: bookKey })).body, anchor);
  const rep = await post('/series', seriesBody, { token: ada, key: seriesKey });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, made.body);
  assert.equal((await get('/restaurants/r_rep/policies')).body.policies.length, 1);

  // Series amendment skips the moved (exception) and cancelled occurrences.
  const am = await amendSeries(ada, made.body.series_id, { expected_revision: seriesBefore.revision, from_index: 0, local_time: '20:00' });
  assertStatus(am, 201);
  assert.deepEqual(am.body.occurrences.map(o => o.reservation.starts_at_local.slice(11)), ['20:00', '20:00', '19:00', '19:00']);
  assert.equal(am.body.revision, seriesBefore.revision + 1);
  // A repair over imported bookings: the anchor (now 20:00 on t_2) must move; bob's booking is considered.
  const p = await preview(max, closure('t_2', THU, '18:00', '23:00'));
  assertStatus(p, 201);
  assert.deepEqual(p.body.assignments.map(a => a.reference), [anchor.reference, other.reference].sort());
  const ap = await applyPlan(max, p.body.plan_id);
  assertStatus(ap, 201);
  assert.equal(ap.body.restaurant_revision, p.body.restaurant_revision + 1);
  const moved = (await get(`/reservations/${anchor.reference}`, { token: ada })).body;
  assert.ok(!moved.table_ids.includes('t_2'));
  const after = (await get(`/series/${made.body.series_id}`, { token: ada })).body;
  assert.equal(after.revision, seriesBefore.revision + 2);
  assert.deepEqual(after.occurrences.map(o => o.exception), seriesBefore.occurrences.map(o => o.exception));
  assert.equal((await get(`/reservations/${anchor.reference}/history`, { token: ada })).body.entries.at(-1).event, 'reassigned');
});

for (const src of [
  { name: 'stage-2', url: process.env.PREVIOUS_STAGE2_BASE_URL, fx: () => fixture2(), rid: 'r_pairs', pair: ['t_3', 't_4'], env: 'PREVIOUS_STAGE2_BASE_URL' },
  { name: 'stage-1', url: process.env.PREVIOUS_STAGE1_BASE_URL, fx: () => fixture(), rid: 'r_anker', pair: null, env: 'PREVIOUS_STAGE1_BASE_URL' },
]) {
  test(`S4-051 a ${src.name} export: receipts stay valid; imported bookings can be adopted and amended as a series`, { skip: src.url ? false : `set ${src.env}` }, async () => {
    const prev = client(src.url);
    assertStatus(await prev('POST', '/_test/reset', { body: src.fx() }), 204);
    const ada = await login(prev, USERS.ada);
    const key = newKey();
    const body = { restaurant_id: src.rid, table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
    const first = (await prev('POST', '/reservations', { token: ada, key, body })).body;
    let pair;
    if (src.pair) pair = (await prev('POST', '/reservations', { token: ada, key: newKey(), body: { restaurant_id: src.rid, table_ids: src.pair, starts_at_local: `${THU}T19:00`, party_size: 9 } })).body;
    const exported = await prev('GET', '/_test/export');
    await importInto(exported.body);
    const rep = await post('/reservations', body, { token: ada, key });
    assertStatus(rep, 200);
    assert.deepEqual(rep.body, first);
    const g = (await get(`/reservations/${first.reference}`, { token: ada })).body;
    assert.equal(g.revision, 1);
    const s = await adopt(ada, { anchor_reference: first.reference, count: 2, interval_weeks: 1 });
    assertStatus(s, 201);
    const am = await amendSeries(ada, s.body.series_id, { expected_revision: 1, from_index: 0, local_time: '20:00' });
    assertStatus(am, 201);
    assert.deepEqual(am.body.occurrences.map(o => o.reservation.starts_at_local.slice(11)), ['20:00', '20:00']);
    assert.equal(am.body.occurrences[0].reservation.revision, 2);
    if (pair) assert.deepEqual([...(await get(`/reservations/${pair.reference}`, { token: ada })).body.table_ids].sort(), [...src.pair].sort());
  });
}

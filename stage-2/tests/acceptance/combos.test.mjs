// Stage 2 API: combined tables (stage-2.md "Combined tables", "Model", "API").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, req, world2, reset2, fixture2, PAIRS, USERS, THU, FRI, assertError, assertStatus,
  book2, body2, newKey, availability,
} from './lib2.mjs';

const sorted = (a) => [...a].sort();
const read = async (ref, token) => (await get(`/reservations/${ref}`, { token })).body;
async function slotsAt(date, party, rid = 'r_pairs') {
  const r = await availability(rid, date, party);
  assertStatus(r, 200);
  return Object.fromEntries(r.body.slots.map(s => [s.starts_at_local.slice(11), s]));
}
const opts = (slot) => slot.available_options.map(o => o.table_ids.join('+'));

function assertShape(res, ids) {
  assert.deepEqual(sorted(res.table_ids), sorted(ids));
  if (ids.length === 1) assert.equal(res.table_id, ids[0]);
  else assert.ok(!('table_id' in res), `table_id must be omitted for a ${ids.length}-table set: ${JSON.stringify(res)}`);
}

test('S2-045 available_table_ids stays singles only', async () => {
  await world2();
  const s = await slotsAt(THU, 5);
  assert.deepEqual(s['19:00'].available_table_ids, ['t_4']);
  const s2 = await slotsAt(THU, 2);
  assert.deepEqual(s2['19:00'].available_table_ids, ['t_1', 't_2', 't_3', 't_4']);
});

test('S2-046 S2-047 available_options: singles in fixture order, then pairs in combinable order', async () => {
  await world2();
  let s = (await slotsAt(THU, 2))['19:00'];
  assert.deepEqual(s.available_options, [
    { table_ids: ['t_1'], capacity: 2 }, { table_ids: ['t_2'], capacity: 4 },
    { table_ids: ['t_3'], capacity: 2 }, { table_ids: ['t_4'], capacity: 8 },
    { table_ids: ['t_2', 't_1'], capacity: 6 }, { table_ids: ['t_2', 't_3'], capacity: 6 },
    { table_ids: ['t_3', 't_4'], capacity: 10 },
  ]);
  assert.deepEqual(opts((await slotsAt(THU, 5))['19:00']), ['t_4', 't_2+t_1', 't_2+t_3', 't_3+t_4']);
  assert.deepEqual(opts((await slotsAt(THU, 7))['19:00']), ['t_4', 't_3+t_4']);
  assert.deepEqual(opts((await slotsAt(THU, 9))['19:00']), ['t_3+t_4']);
  const none = (await slotsAt(THU, 11))['19:00'];
  assert.deepEqual(none.available_options, []);
  assert.deepEqual(none.available_table_ids, []);
  // A restaurant without combinable pairs: options are just the singles.
  const two = (await slotsAt(THU, 2, 'r_two'))['19:00'];
  assert.deepEqual(two.available_options, [{ table_ids: ['t_x'], capacity: 4 }, { table_ids: ['t_y'], capacity: 4 }]);
});

test('S2-046 S2-043 a booked member removes every option that contains it, for the full duration', async () => {
  const t = await world2();
  assertStatus(await book2(t.ada, { table_id: 't_1' }), 201);
  let s = await slotsAt(THU, 2);
  for (const hm of ['18:00', '18:30', '19:00', '19:30', '20:00']) {
    assert.deepEqual(opts(s[hm]), ['t_2', 't_3', 't_4', 't_2+t_3', 't_3+t_4'], hm);
  }
  assert.deepEqual(opts(s['20:30']), ['t_1', 't_2', 't_3', 't_4', 't_2+t_1', 't_2+t_3', 't_3+t_4']);
  // A combination occupies both tables.
  const c = await book2(t.bob, { table_ids: ['t_3', 't_4'], party_size: 9, starts_at_local: `${FRI}T20:00` });
  assertStatus(c, 201);
  s = await slotsAt(FRI, 2);
  for (const hm of ['19:00', '20:00', '21:00']) {
    assert.deepEqual(opts(s[hm]), ['t_1', 't_2', 't_2+t_1'], hm);
    assert.deepEqual(s[hm].available_table_ids, ['t_1', 't_2'], hm);
  }
  assert.deepEqual(opts(s['21:30']).length, 7);
  assertError(await book2(t.cy, { table_id: 't_4', party_size: 2, starts_at_local: `${FRI}T21:00` }), 409, 'table_unavailable');
  assertError(await book2(t.cy, { table_id: 't_3', party_size: 2, starts_at_local: `${FRI}T19:00` }), 409, 'table_unavailable');
});

test('S2-048 S2-049 POST accepts table_ids; table_id appears only for one-member sets', async () => {
  const t = await world2();
  const pair = await book2(t.ada, { table_ids: ['t_2', 't_1'], party_size: 6 });
  assertStatus(pair, 201);
  assertShape(pair.body, ['t_2', 't_1']);
  assert.equal(pair.body.party_size, 6);
  assert.equal(pair.body.status, 'confirmed');
  const one = await book2(t.ada, { table_ids: ['t_4'], party_size: 3 });
  assertStatus(one, 201);
  assertShape(one.body, ['t_4']);
  const legacy = await book2(t.ada, { table_id: 't_3', party_size: 2 });
  assertStatus(legacy, 201);
  assertShape(legacy.body, ['t_3']);
  // Every endpoint that returns a reservation carries the same shape.
  assertShape(await read(pair.body.reference, t.ada), ['t_2', 't_1']);
  assertShape(await read(one.body.reference, t.ada), ['t_4']);
  const list = (await get('/reservations', { token: t.ada })).body.reservations;
  for (const r of list) assertShape(r, r.reference === pair.body.reference ? ['t_2', 't_1'] : [r.table_ids[0]]);
  const c = await post(`/reservations/${pair.body.reference}/cancel`, {}, { token: t.ada });
  assertShape(c.body, ['t_2', 't_1']);
});

test('S2-048 sending both table_id and table_ids is 422 validation_failed', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_id: 't_1', table_ids: ['t_1'] }), 422, 'validation_failed');
  assertError(await book2(t.ada, { table_id: 't_2', table_ids: ['t_2', 't_1'], party_size: 5 }), 422, 'validation_failed');
  assert.deepEqual((await get('/reservations', { token: t.ada })).body.reservations, []);
});

test('S2-039 S2-050 a pair is bookable only if declared; declared pairs are unordered', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_ids: ['t_1', 't_4'], party_size: 3 }), 422, 'combination_not_allowed');
  assertError(await book2(t.ada, { table_ids: ['t_4', 't_2'], party_size: 3 }), 422, 'combination_not_allowed');
  assertError(await book2(t.ada, { restaurant_id: 'r_two', table_ids: ['t_x', 't_y'], starts_at_local: `${THU}T19:00`, party_size: 6 }), 422, 'combination_not_allowed');
  const rev = await book2(t.ada, { table_ids: ['t_1', 't_2'], party_size: 6 });
  assertStatus(rev, 201);
  assertShape(rev.body, ['t_1', 't_2']);
});

test('S2-041 combining is not transitive', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_ids: ['t_1', 't_3'], party_size: 4 }), 422, 'combination_not_allowed');
  assertError(await book2(t.ada, { table_ids: ['t_3', 't_1'], party_size: 4 }), 422, 'combination_not_allowed');
  assertError(await book2(t.ada, { table_ids: ['t_2', 't_4'], party_size: 4 }), 422, 'combination_not_allowed');
  for (const s of Object.values(await slotsAt(THU, 1))) {
    for (const o of s.available_options) {
      const k = sorted(o.table_ids).join('+');
      assert.ok(!['t_1+t_3', 't_2+t_4', 't_1+t_4'].includes(k), `undeclared option ${k}`);
    }
  }
});

test('S2-040 more than two tables is 422 combination_not_allowed', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_ids: ['t_2', 't_1', 't_3'], party_size: 7 }), 422, 'combination_not_allowed');
  assertError(await book2(t.ada, { table_ids: ['t_1', 't_2', 't_3', 't_4'], party_size: 7 }), 422, 'combination_not_allowed');
  assert.deepEqual((await get('/reservations', { token: t.ada })).body.reservations, []);
});

test('S2-042 S2-052 capacity is the sum; above it is 422 party_exceeds_capacity', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_ids: ['t_2', 't_1'], party_size: 7 }), 422, 'party_exceeds_capacity');
  assertError(await book2(t.ada, { table_ids: ['t_3', 't_4'], party_size: 11 }), 422, 'party_exceeds_capacity');
  assertStatus(await book2(t.ada, { table_ids: ['t_2', 't_1'], party_size: 6 }), 201);
  assertStatus(await book2(t.ada, { table_ids: ['t_3', 't_4'], party_size: 10 }), 201);
});

test('S2-051 any member taken for an overlapping interval is 409 table_unavailable', async () => {
  const t = await world2();
  assertStatus(await book2(t.ada, { table_id: 't_2', starts_at_local: `${THU}T19:30` }), 201);
  assertError(await book2(t.bob, { table_ids: ['t_2', 't_1'], party_size: 5 }), 409, 'table_unavailable');
  assertError(await book2(t.bob, { table_ids: ['t_2', 't_3'], party_size: 5, starts_at_local: `${THU}T20:30` }), 409, 'table_unavailable');
  assertStatus(await book2(t.bob, { table_ids: ['t_2', 't_3'], party_size: 5, starts_at_local: `${THU}T21:00` }), 201);
});

test('S2-053 S2-058 duplicate ids are 422 validation_failed; wrong JSON types are 400', async () => {
  const t = await world2();
  assertError(await book2(t.ada, { table_ids: ['t_1', 't_1'] }), 422, 'validation_failed');
  assertError(await book2(t.ada, { table_ids: [] }), 422, 'validation_failed');
  assertError(await book2(t.ada, { table_ids: 't_1' }), 400, 'malformed_request');
  assertError(await book2(t.ada, { table_ids: [1, 2] }), 400, 'malformed_request');
  assertError(await book2(t.ada, { table_ids: { a: 't_1' } }), 400, 'malformed_request');
  assertError(await book2(t.ada, { table_ids: ['t_nope'] }), 404, 'not_found');
  assert.deepEqual((await get('/reservations', { token: t.ada })).body.reservations, []);
});

test('S2-054 PATCH accepts table_ids under the same rules', async () => {
  const t = await world2();
  const b = (await book2(t.ada, { table_id: 't_4', party_size: 5 })).body;
  let r = await patch(`/reservations/${b.reference}`, { table_ids: ['t_2', 't_1'], party_size: 6 }, { token: t.ada });
  assertStatus(r, 200);
  assertShape(r.body, ['t_2', 't_1']);
  assert.equal(r.body.reference, b.reference);
  assertShape(await read(b.reference, t.ada), ['t_2', 't_1']);
  // Shift overlapping its own interval keeps working for a pair.
  r = await patch(`/reservations/${b.reference}`, { starts_at_local: `${THU}T19:30` }, { token: t.ada });
  assertStatus(r, 200);
  assertShape(r.body, ['t_2', 't_1']);
  assertError(await patch(`/reservations/${b.reference}`, { table_ids: ['t_1', 't_3'] }, { token: t.ada }), 422, 'combination_not_allowed');
  assertError(await patch(`/reservations/${b.reference}`, { party_size: 7 }, { token: t.ada }), 422, 'party_exceeds_capacity');
  assertError(await patch(`/reservations/${b.reference}`, { table_id: 't_4', table_ids: ['t_4'] }, { token: t.ada }), 422, 'validation_failed');
  assertError(await patch(`/reservations/${b.reference}`, { table_ids: ['t_3', 't_3'] }, { token: t.ada }), 422, 'validation_failed');
  assertError(await patch(`/reservations/${b.reference}`, { table_ids: ['t_2', 't_1', 't_3'] }, { token: t.ada }), 422, 'combination_not_allowed');
  await book2(t.bob, { table_id: 't_3', starts_at_local: `${THU}T20:00` });
  assertError(await patch(`/reservations/${b.reference}`, { table_ids: ['t_2', 't_3'] }, { token: t.ada }), 409, 'table_unavailable');
  // Back to a single table with table_id: the singular field returns.
  r = await patch(`/reservations/${b.reference}`, { table_id: 't_4' }, { token: t.ada });
  assertStatus(r, 200);
  assertShape(r.body, ['t_4']);
  const s = await slotsAt(THU, 2);
  assert.deepEqual(s['19:30'].available_table_ids, ['t_1', 't_2']);
});

test('S2-055 cancelling frees every table in the set', async () => {
  const t = await world2();
  const b = (await book2(t.ada, { table_ids: ['t_3', 't_4'], party_size: 9 })).body;
  assertStatus(await post(`/reservations/${b.reference}/cancel`, {}, { token: t.ada }), 200);
  const s = await slotsAt(THU, 2);
  assert.equal(opts(s['19:00']).length, 7);
  assertStatus(await book2(t.bob, { table_id: 't_3' }), 201);
  assertStatus(await book2(t.bob, { table_id: 't_4' }), 201);
});

test('S2-056 stage-1 single-table bodies keep working everywhere', async () => {
  const t = await world2();
  const b = await book2(t.ada, { table_id: 't_2', party_size: 4 });
  assertStatus(b, 201);
  assert.equal(b.body.table_id, 't_2');
  const p = await patch(`/reservations/${b.body.reference}`, { table_id: 't_4' }, { token: t.ada });
  assertStatus(p, 200);
  assert.equal(p.body.table_id, 't_4');
  const m = await post('/reservation-moves', { moves: [{ reference: b.body.reference, table_id: 't_2' }] }, { token: t.ada, key: newKey() });
  assertStatus(m, 201);
  assertShape(m.body.reservations[0], ['t_2']);
});

test('S2-044 seeded reservations: table_ids allowed, status cancelled honoured', async () => {
  const seeds = [
    { id: 'res_s1', reference: 'SEEDPAIR', user_id: 'u_ada', restaurant_id: 'r_pairs', table_ids: ['t_2', 't_1'], starts_at_local: `${THU}T19:00`, party_size: 6 },
    { id: 'res_s2', reference: 'SEEDGONE', user_id: 'u_ada', restaurant_id: 'r_pairs', table_id: 't_4', starts_at_local: `${THU}T19:00`, party_size: 4, status: 'cancelled' },
    { id: 'res_s3', reference: 'SEEDONE1', user_id: 'u_bob', restaurant_id: 'r_pairs', table_ids: ['t_3'], starts_at_local: `${THU}T21:00`, party_size: 2, status: 'confirmed' },
  ];
  const t = await world2(fixture2({ reservations: seeds }));
  const pair = await read('SEEDPAIR', t.ada);
  assertShape(pair, ['t_2', 't_1']);
  assert.equal(pair.status, 'confirmed');
  const gone = await read('SEEDGONE', t.ada);
  assert.equal(gone.status, 'cancelled');
  assertShape(gone, ['t_4']);
  assertShape(await read('SEEDONE1', t.bob), ['t_3']);
  const s = await slotsAt(THU, 2);
  assert.deepEqual(s['19:00'].available_table_ids, ['t_3', 't_4']);
  assert.deepEqual(s['21:00'].available_table_ids, ['t_1', 't_2', 't_4']);
  assertError(await book2(t.cy, { table_id: 't_1' }), 409, 'table_unavailable');
  assertStatus(await book2(t.cy, { table_id: 't_4' }), 201);
});

test('S2-057 moves accept table_ids; no table may sit in overlapping resulting bookings', async () => {
  const t = await world2();
  const a = (await book2(t.ada, { table_id: 't_1' })).body;
  const b = (await book2(t.ada, { table_id: 't_3' })).body;
  const c = (await book2(t.ada, { table_id: 't_2' })).body;
  assertError(await post('/reservation-moves', { moves: [{ reference: a.reference, table_ids: ['t_2', 't_1'], party_size: 5 }, { reference: b.reference, table_ids: ['t_2', 't_3'], party_size: 5 }] }, { token: t.ada, key: newKey() }), 409, 'table_unavailable');
  assertError(await post('/reservation-moves', { moves: [{ reference: a.reference, table_ids: ['t_2', 't_1'] }] }, { token: t.ada, key: newKey() }), 409, 'table_unavailable');
  assertError(await post('/reservation-moves', { moves: [{ reference: a.reference, table_ids: ['t_1', 't_3'] }] }, { token: t.ada, key: newKey() }), 422, 'combination_not_allowed');
  for (const x of [a, b, c]) assert.deepEqual(await read(x.reference, t.ada), x);
  // C vacates t_2 in the same batch: A can take the pair.
  const ok = await post('/reservation-moves', { moves: [{ reference: a.reference, table_ids: ['t_2', 't_1'], party_size: 5 }, { reference: c.reference, table_id: 't_4' }] }, { token: t.ada, key: newKey() });
  assertStatus(ok, 201);
  assertShape(ok.body.reservations[0], ['t_2', 't_1']);
  assertShape(ok.body.reservations[1], ['t_4']);
  assertShape(await read(a.reference, t.ada), ['t_2', 't_1']);
});

test('S2-059 combination receipts replay unchanged and survive export/import', async () => {
  const t = await world2();
  const key = newKey();
  const body = body2({ table_ids: ['t_2', 't_1'], party_size: 6 });
  delete body.table_id;
  const first = await post('/reservations', body, { token: t.ada, key });
  assertStatus(first, 201);
  const rep = await post('/reservations', body, { token: t.ada, key });
  assertStatus(rep, 200);
  assert.deepEqual(rep.body, first.body);
  const e = await get('/_test/export');
  assertStatus(e, 200);
  await reset2(fixture2({ users: [] }));
  assertStatus(await post('/_test/import', e.body), 204);
  const rep2 = await post('/reservations', body, { token: t.ada, key });
  assertStatus(rep2, 200);
  assert.deepEqual(rep2.body, first.body);
  assertShape(await read(first.body.reference, t.ada), ['t_2', 't_1']);
  assertError(await book2(t.bob, { table_id: 't_1' }), 409, 'table_unavailable');
});

test('S2-075 screen routes return HTML while the API stays JSON', async () => {
  await world2();
  for (const path of ['/', '/signup', '/login', '/lookup']) {
    const r = await req('GET', path);
    assertStatus(r, 200);
    assert.match(r.headers.get('content-type') || '', /^text\/html/i, path);
  }
  const api = await get('/restaurants');
  assert.match(api.headers.get('content-type') || '', /^application\/json/i);
  assert.ok(api.body.restaurants.some(r => r.id === 'r_pairs'));
  const detail = await get('/restaurants/r_pairs');
  assert.deepEqual(detail.body.combinable, PAIRS.combinable);
});

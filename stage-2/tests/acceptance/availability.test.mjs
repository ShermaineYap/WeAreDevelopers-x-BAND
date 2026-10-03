import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, world, THU, FRI, MON, availability, slotMap, assertError, assertStatus, mustBook, book, expectedInstant,
} from './lib.mjs';

test('S1-009 unknown query parameters are ignored', async () => {
  await world();
  const a = await availability('r_anker', THU, 2);
  const b = await availability('r_anker', THU, 2, '&foo=bar&party_size_max=x&_=1');
  assertStatus(b, 200);
  assert.deepEqual(b.body, a.body);
  assertStatus(await get('/restaurants?page=2'), 200);
});

test('S1-016 a closed day returns "slots": []', async () => {
  await world();
  const r = await availability('r_anker', MON, 2);
  assertStatus(r, 200);
  assert.deepEqual(r.body.slots, []);
  assert.equal(r.body.restaurant_id, 'r_anker');
  assert.equal(r.body.date, MON);
});

test('S1-024 query integers must be plain decimal digits', async () => {
  await world();
  for (const p of ['1e9', '4.0', '+4', '1e0', '0x4', ' 4', '4 ']) {
    assertError(await availability('r_anker', THU, p), 422, 'validation_failed');
  }
});

test('S1-025 other invalid party_size query values are 422', async () => {
  await world();
  for (const p of ['true', '-1', '0', '', 'abc', '2.5']) {
    assertError(await availability('r_anker', THU, p), 422, 'validation_failed');
  }
});

test('S1-037 restaurants, restaurant detail and availability are public', async () => {
  await world();
  assertStatus(await get('/restaurants'), 200);
  assertStatus(await get('/restaurants/r_anker'), 200);
  assertStatus(await availability('r_anker', THU, 2), 200);
});

test('S1-049 GET /restaurants lists {id, name, timezone}', async () => {
  await world();
  const r = await get('/restaurants');
  assertStatus(r, 200);
  assert.ok(Array.isArray(r.body.restaurants));
  const anker = r.body.restaurants.find(x => x.id === 'r_anker');
  assert.equal(anker.name, 'Zum Anker');
  assert.equal(anker.timezone, 'Europe/Berlin');
  assert.deepEqual(r.body.restaurants.map(x => x.id).sort(),
    ['r_anker', 'r_berlin', 'r_long', 'r_ny', 'r_odd', 'r_other', 'r_utc']);
});

test('S1-050 GET /restaurants/{id} has the fixture shape; unknown is 404', async () => {
  await world();
  const r = await get('/restaurants/r_anker');
  assertStatus(r, 200);
  const b = r.body;
  assert.equal(b.id, 'r_anker');
  assert.equal(b.name, 'Zum Anker');
  assert.equal(b.timezone, 'Europe/Berlin');
  assert.equal(b.slot_minutes, 30);
  assert.equal(b.reservation_duration_minutes, 90);
  assert.equal(b.cancellation_cutoff_minutes, 120);
  assert.deepEqual(b.opening_hours.map(h => ({ weekday: h.weekday, opens: h.opens, closes: h.closes })),
    [{ weekday: 'thu', opens: '18:00', closes: '23:00' }, { weekday: 'fri', opens: '18:00', closes: '23:30' }]);
  assert.deepEqual(b.tables.map(t => ({ id: t.id, label: t.label, capacity: t.capacity })),
    [{ id: 't_1', label: '1', capacity: 2 }, { id: 't_3', label: '3', capacity: 6 }, { id: 't_2', label: '2', capacity: 4 }]);
  assertError(await get('/restaurants/r_nope'), 404, 'not_found');
});

test('S1-051 each of the three availability parameters is required', async () => {
  await world();
  assertError(await get(`/availability?date=${THU}&party_size=2`), 422, 'validation_failed');
  assertError(await get('/availability?restaurant_id=r_anker&party_size=2'), 422, 'validation_failed');
  assertError(await get(`/availability?restaurant_id=r_anker&date=${THU}`), 422, 'validation_failed');
  assertError(await get('/availability'), 422, 'validation_failed');
});

test('S1-052 unknown restaurant is 404, invalid date is 422', async () => {
  await world();
  assertError(await availability('r_nope', THU, 2), 404, 'not_found');
  for (const d of ['2026-02-30', '2026-13-01', '2026-9-24', '24-09-2026', 'tomorrow', `${THU}T00:00`]) {
    assertError(await availability('r_anker', d, 2), 422, 'validation_failed');
  }
});

test('S1-053 availability response shape', async () => {
  await world();
  const r = await availability('r_anker', THU, 4);
  assertStatus(r, 200);
  assert.equal(r.body.restaurant_id, 'r_anker');
  assert.equal(r.body.date, THU);
  assert.equal(r.body.timezone, 'Europe/Berlin');
  const s = r.body.slots[0];
  assert.equal(s.starts_at_local, `${THU}T18:00`);
  assert.equal(s.starts_at, expectedInstant('Europe/Berlin', `${THU}T18:00`).rfc);
  assert.deepEqual(s.available_table_ids, ['t_3', 't_2']);
});

test('S1-054 slots step by slot_minutes from opens while slot + duration <= closes', async () => {
  await world();
  assert.deepEqual(Object.keys(await slotMap('r_anker', THU, 2)),
    ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30']);
  assert.deepEqual(Object.keys(await slotMap('r_anker', FRI, 2)),
    ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00']);
  // 45-minute grid, 60-minute stay, 18:00-21:00: 20:15 would end at 21:15.
  assert.deepEqual(Object.keys(await slotMap('r_odd', THU, 2)), ['18:00', '18:45', '19:30']);
});

test('S1-055 available tables: capacity >= party, fixture order', async () => {
  await world();
  assert.deepEqual((await slotMap('r_anker', THU, 1))['19:00'], ['t_1', 't_3', 't_2']);
  assert.deepEqual((await slotMap('r_anker', THU, 2))['19:00'], ['t_1', 't_3', 't_2']);
  assert.deepEqual((await slotMap('r_anker', THU, 3))['19:00'], ['t_3', 't_2']);
  assert.deepEqual((await slotMap('r_anker', THU, 4))['19:00'], ['t_3', 't_2']);
  assert.deepEqual((await slotMap('r_anker', THU, 6))['19:00'], ['t_3']);
});

test('S1-056 a slot with no available table still appears with []', async () => {
  const t = await world();
  await mustBook(t.ada, { table_id: 't_3' });
  await mustBook(t.bob, { table_id: 't_2' });
  const slots = await slotMap('r_anker', THU, 4);
  assert.deepEqual(slots['19:00'], []);
  assert.deepEqual(slots['18:00'], []);
  assert.deepEqual(slots['20:30'], ['t_3', 't_2']);
  assert.equal(Object.keys(slots).length, 8);
});

test('S1-057 a party larger than every table lists every slot with []', async () => {
  await world();
  const slots = await slotMap('r_anker', THU, 7);
  assert.equal(Object.keys(slots).length, 8);
  for (const ids of Object.values(slots)) assert.deepEqual(ids, []);
});

test('S1-058 occupancy is half-open [start, start + duration)', async () => {
  const t = await world();
  await mustBook(t.ada, { table_id: 't_2', starts_at_local: `${THU}T19:00` });
  const slots = await slotMap('r_anker', THU, 4);
  for (const hm of ['18:00', '18:30', '19:00', '19:30', '20:00']) assert.deepEqual(slots[hm], ['t_3'], hm);
  for (const hm of ['20:30', '21:00', '21:30']) assert.deepEqual(slots[hm], ['t_3', 't_2'], hm);
  // 17:30 would end exactly at 19:00 but is before opening; 20:30 starts exactly at 20:30 end.
  assertStatus(await book(t.bob, { table_id: 't_2', starts_at_local: `${THU}T20:30` }), 201);
  assertError(await book(t.bob, { table_id: 't_2', starts_at_local: `${THU}T18:00` }), 409, 'table_unavailable');
  assertError(await book(t.bob, { table_id: 't_2', starts_at_local: `${THU}T20:00` }), 409, 'table_unavailable');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, patch, world, availability, assertError, assertStatus, mustBook, book, slotMap, todayIn } from './lib.mjs';

const be = (over) => ({ restaurant_id: 'r_berlin', table_id: 't_be1', party_size: 2, ...over });
const ny = (over) => ({ restaurant_id: 'r_ny', table_id: 't_ny1', party_size: 2, ...over });

async function slotsOf(rid, date) {
  const r = await availability(rid, date, 2);
  assertStatus(r, 200);
  return r.body.slots;
}

const DAYS = [
  // [restaurant, date, gap hours (spring), repeated hours (fall), expected offsets]
  { rid: 'r_berlin', tz: 'Europe/Berlin', date: '2026-03-29', gap: ['02:00', '02:30'],
    offsets: { '00:30': '+01:00', '01:30': '+01:00', '03:00': '+02:00', '04:00': '+02:00' } },
  { rid: 'r_ny', tz: 'America/New_York', date: '2026-03-08', gap: ['02:00', '02:30'],
    offsets: { '00:30': '-05:00', '01:30': '-05:00', '03:00': '-04:00', '04:00': '-04:00' } },
  { rid: 'r_berlin', tz: 'Europe/Berlin', date: '2026-10-25', repeated: ['02:00', '02:30'],
    offsets: { '01:30': '+02:00', '02:00': '+02:00', '02:30': '+02:00', '03:00': '+01:00', '04:00': '+01:00' } },
  { rid: 'r_ny', tz: 'America/New_York', date: '2026-11-01', repeated: ['01:00', '01:30'],
    offsets: { '00:30': '-04:00', '01:00': '-04:00', '01:30': '-04:00', '02:00': '-05:00', '03:00': '-05:00' } },
];

test('S1-084 spring-forward local times never appear in availability', async () => {
  await world();
  for (const d of DAYS.filter(x => x.gap)) {
    const locals = (await slotsOf(d.rid, d.date)).map(s => s.starts_at_local.slice(11));
    for (const hm of d.gap) assert.ok(!locals.includes(hm), `${d.tz} ${d.date} ${hm} must not appear`);
    for (const hm of ['01:30', '03:00']) assert.ok(locals.includes(hm), `${d.tz} ${d.date} ${hm} must appear`);
  }
});

test('S1-085 booking a skipped local time is 422 invalid_local_time (POST and PATCH)', async () => {
  const t = await world();
  for (const hm of ['02:00', '02:30']) {
    assertError(await book(t.ada, be({ starts_at_local: `2026-03-29T${hm}` })), 422, 'invalid_local_time');
    assertError(await book(t.ada, ny({ starts_at_local: `2026-03-08T${hm}` })), 422, 'invalid_local_time');
  }
  // PATCH needs a future booking (cutoff); use the next Berlin spring-forward Sunday after today.
  const y = Number(todayIn('Europe/Berlin').slice(0, 4)) + 1;
  let day = 31; while (new Date(Date.UTC(y, 2, day)).getUTCDay() !== 0) day--;
  const date = `${y}-03-${day}`;
  const b = await mustBook(t.ada, be({ starts_at_local: `${date}T01:00` }));
  assertError(await patch(`/reservations/${b.reference}`, { starts_at_local: `${date}T02:30` }, { token: t.ada }), 422, 'invalid_local_time');
  assert.equal((await get(`/reservations/${b.reference}`, { token: t.ada })).body.starts_at_local, `${date}T01:00`);
  assert.deepEqual((await get('/reservations', { token: t.ada })).body.reservations.length, 1);
});

test('S1-086 fall-back repeated local times appear exactly once', async () => {
  await world();
  for (const d of DAYS.filter(x => x.repeated)) {
    const locals = (await slotsOf(d.rid, d.date)).map(s => s.starts_at_local);
    assert.equal(new Set(locals).size, locals.length, `duplicate slots on ${d.date}`);
    for (const hm of d.repeated) assert.equal(locals.filter(l => l === `${d.date}T${hm}`).length, 1, `${d.date} ${hm}`);
  }
});

test('S1-087 a repeated local time resolves to the first occurrence', async () => {
  const t = await world();
  let r = await book(t.ada, be({ starts_at_local: '2026-10-25T02:30' }));
  assertStatus(r, 201);
  assert.equal(r.body.starts_at, '2026-10-25T02:30:00+02:00');
  r = await book(t.ada, ny({ starts_at_local: '2026-11-01T01:30' }));
  assertStatus(r, 201);
  assert.equal(r.body.starts_at, '2026-11-01T01:30:00-04:00');
  // The second occurrence is not separately bookable: the same table at the same local time conflicts.
  assertError(await book(t.bob, ny({ starts_at_local: '2026-11-01T01:30' })), 409, 'table_unavailable');
});

test('S1-088 duration is absolute time, not wall-clock', async () => {
  const t = await world();
  const cases = [
    [be({ starts_at_local: '2026-03-29T01:30' }), '2026-03-29T01:30:00+01:00', '2026-03-29T04:00:00+02:00'],
    [ny({ starts_at_local: '2026-03-08T01:30' }), '2026-03-08T01:30:00-05:00', '2026-03-08T04:00:00-04:00'],
    [be({ starts_at_local: '2026-10-25T01:30' }), '2026-10-25T01:30:00+02:00', '2026-10-25T02:00:00+01:00'],
    [ny({ starts_at_local: '2026-11-01T01:30' }), '2026-11-01T01:30:00-04:00', '2026-11-01T02:00:00-05:00'],
    [be({ starts_at_local: '2026-10-25T02:30', table_id: 't_be2' }), '2026-10-25T02:30:00+02:00', '2026-10-25T03:00:00+01:00'],
  ];
  for (const [body, start, end] of cases) {
    const r = await book(t.ada, body);
    assertStatus(r, 201);
    assert.equal(r.body.starts_at, start, body.starts_at_local);
    assert.equal(r.body.ends_at, end, body.starts_at_local);
    assert.equal(Date.parse(r.body.ends_at) - Date.parse(r.body.starts_at), 90 * 60000);
  }
});

test('S1-089 offsets follow IANA rules on both sides of every transition', async () => {
  await world();
  for (const d of DAYS) {
    const slots = Object.fromEntries((await slotsOf(d.rid, d.date)).map(s => [s.starts_at_local.slice(11), s.starts_at]));
    for (const [hm, off] of Object.entries(d.offsets)) assert.equal(slots[hm], `${d.date}T${hm}:00${off}`, `${d.tz} ${hm}`);
  }
  const r = await availability('r_berlin', '2026-10-25', 2);
  assert.equal(r.body.timezone, 'Europe/Berlin');
});

test('S1-090 overlap on DST nights is computed on real instants', async () => {
  const t = await world();
  // Berlin spring: 01:30+01:00 for 90 real minutes ends 04:00+02:00, so 03:00 and 03:30 are still occupied.
  await mustBook(t.ada, be({ starts_at_local: '2026-03-29T01:30' }));
  let s = await slotMap('r_berlin', '2026-03-29', 2);
  assert.deepEqual(s['03:00'], ['t_be2']);
  assert.deepEqual(s['03:30'], ['t_be2']);
  assert.deepEqual(s['04:00'], ['t_be1', 't_be2']);
  assertError(await book(t.bob, be({ starts_at_local: '2026-03-29T03:00' })), 409, 'table_unavailable');
  // New York fall: 01:00-04:00 for 90 real minutes ends 01:30-05:00, so 02:00-05:00 is free.
  await mustBook(t.ada, ny({ starts_at_local: '2026-11-01T01:00' }));
  s = await slotMap('r_ny', '2026-11-01', 2);
  assert.deepEqual(s['00:00'], ['t_ny2']);
  assert.deepEqual(s['01:30'], ['t_ny2']);
  assert.deepEqual(s['02:00'], ['t_ny1', 't_ny2']);
  assertStatus(await book(t.bob, ny({ starts_at_local: '2026-11-01T02:00' })), 201);
});

// Stage 2 "Concurrent bookings and amendments": results equal some one-at-a-time order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, reset2, fixture2, PASSWORD, THU, body2, newKey, burst, tally, noServerErrors, availability,
  assertStatus,
} from './lib2.mjs';

const N = 30;
const crowd = Array.from({ length: N }, (_, i) => ({ id: `u_k${i}`, email: `k${i}@example.com`, password: PASSWORD, display_name: `K${i}` }));

async function tokens() {
  await reset2(fixture2({ users: crowd }));
  const r = await burst(N, i => post('/auth/login', { email: crowd[i].email, password: PASSWORD }));
  return r.map(x => x.body.token);
}

async function confirmedOccupancy(toks) {
  const all = [];
  for (const t of toks) {
    for (const r of (await get('/reservations', { token: t })).body.reservations) if (r.status === 'confirmed') all.push(r);
  }
  return all;
}

function assertNoDoubleBooking(rows) {
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const overlap = Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
    const shared = a.table_ids.filter(x => b.table_ids.includes(x));
    assert.ok(!(overlap && shared.length), `double booking of ${shared} by ${a.reference} and ${b.reference}`);
  }
}

test('S2-065 racing pairs and singles over shared members never double-book a table', async () => {
  const toks = await tokens();
  const shapes = [
    { table_ids: ['t_2', 't_1'], party_size: 5 }, { table_ids: ['t_2', 't_3'], party_size: 5 },
    { table_id: 't_1' }, { table_id: 't_2' }, { table_id: 't_3' }, { table_ids: ['t_3', 't_4'], party_size: 9 },
  ];
  const out = await burst(N, i => post('/reservations', body2({ ...shapes[i % shapes.length], starts_at_local: `${THU}T${['19:00', '19:30'][i % 2]}` }), { token: toks[i], key: newKey() }));
  noServerErrors(out);
  for (const r of out) assert.ok([201, 409].includes(r.status), `${r.status} ${r.text}`);
  assert.ok(tally(out)[201] >= 1);
  const rows = await confirmedOccupancy(toks);
  assert.equal(rows.length, tally(out)[201]);
  assertNoDoubleBooking(rows);
  // Every read agrees with the committed bookings.
  const av = await availability('r_pairs', THU, 1);
  for (const s of av.body.slots) {
    const at = Date.parse(s.starts_at), end = at + 90 * 60000;
    for (const o of s.available_options) {
      for (const id of o.table_ids) {
        assert.ok(!rows.some(r => r.table_ids.includes(id) && Date.parse(r.starts_at) < end && at < Date.parse(r.ends_at)),
          `option ${o.table_ids} offered at ${s.starts_at_local} but ${id} is booked`);
      }
    }
  }
});

test('S2-065 racing PATCHes onto a pair and its members: exactly the serial outcome', async () => {
  const toks = await tokens();
  const refs = [];
  for (let i = 0; i < 12; i++) {
    const r = await post('/reservations', body2({ restaurant_id: 'r_utc2', table_id: i < 6 ? 't_n1' : 't_n2', starts_at_local: `${THU}T0${i % 6}:00`, party_size: 2 }), { token: toks[i], key: newKey() });
    assertStatus(r, 201);
    refs.push(r.body.reference);
  }
  const target = `${THU}T12:00`;
  const out = await burst(12, i => patch(`/reservations/${refs[i]}`, i % 3 === 0
    ? { table_ids: ['t_n1', 't_n2'], starts_at_local: target }
    : { table_id: i % 3 === 1 ? 't_n1' : 't_n2', starts_at_local: target }, { token: toks[i] }));
  noServerErrors(out);
  const wins = out.filter(r => r.status === 200);
  const won = wins.map(w => w.body.table_ids.join('+')).sort();
  assert.ok(
    (won.length === 1 && won[0].split('+').length === 2) || (won.length === 2 && won[0] === 't_n1' && won[1] === 't_n2'),
    `a serial order yields one pair or one win per single table: ${JSON.stringify(won)}`);
  for (const r of out) assert.ok([200, 409].includes(r.status), `${r.status} ${r.text}`);
  assertNoDoubleBooking(await confirmedOccupancy(toks.slice(0, 12)));
});

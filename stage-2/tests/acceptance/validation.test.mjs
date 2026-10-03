import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, req, world, THU, PASSWORD, assertError, bookBody, newKey } from './lib.mjs';

const postRaw = (path, raw, opts = {}) => req('POST', path, { ...opts, raw });

async function noBookings(token) {
  const r = await get('/reservations', { token });
  assert.deepEqual(r.body, { reservations: [] });
}

test('S1-018 unparseable bodies are 400 malformed_request', async () => {
  const t = await world();
  assertError(await postRaw('/reservations', '{"restaurant_id": "r_anker",', { token: t.ada, key: newKey() }), 400, 'malformed_request');
  assertError(await postRaw('/auth/signup', 'not json'), 400, 'malformed_request');
  assertError(await postRaw('/auth/login', '{'), 400, 'malformed_request');
  assertError(await req('PATCH', '/reservations/ABCDEF', { token: t.ada, raw: '{"party_size":' }), 400, 'malformed_request');
  assertError(await postRaw('/reservation-moves', '{"moves": [', { token: t.ada, key: newKey() }), 400, 'malformed_request');
  await noBookings(t.ada);
});

test('S1-019 fields of the wrong JSON type are 400 malformed_request', async () => {
  const t = await world();
  assertError(await post('/auth/signup', { email: 42, password: PASSWORD, display_name: 'X' }), 400, 'malformed_request');
  assertError(await post('/auth/signup', { email: 'x@example.com', password: 12345678, display_name: 'X' }), 400, 'malformed_request');
  assertError(await post('/auth/login', { email: ['a@example.com'], password: PASSWORD }), 400, 'malformed_request');
  for (const over of [{ restaurant_id: 7 }, { table_id: ['t_2'] }, { restaurant_id: null }, { table_id: { id: 't_2' } }, { starts_at_local: 1900 }]) {
    assertError(await post('/reservations', bookBody(over), { token: t.ada, key: newKey() }), 400, 'malformed_request');
  }
  await noBookings(t.ada);
});

test('S1-020 a JSON body that is not an object is 400 malformed_request', async () => {
  const t = await world();
  for (const raw of ['[]', '"text"', 'null', '42']) {
    assertError(await postRaw('/reservations', raw, { token: t.ada, key: newKey() }), 400, 'malformed_request');
    assertError(await postRaw('/auth/signup', raw), 400, 'malformed_request');
  }
  await noBookings(t.ada);
});

test('S1-021 a missing required body field is 422 validation_failed', async () => {
  const t = await world();
  for (const drop of ['restaurant_id', 'table_id', 'starts_at_local', 'party_size']) {
    const body = bookBody(); delete body[drop];
    assertError(await post('/reservations', body, { token: t.ada, key: newKey() }), 422, 'validation_failed');
  }
  for (const drop of ['email', 'password']) {
    const body = { email: 'm@example.com', password: PASSWORD, display_name: 'M' }; delete body[drop];
    assertError(await post('/auth/signup', body), 422, 'validation_failed');
  }
  await noBookings(t.ada);
});

test('S1-022 party_size strings and booleans are 422 validation_failed, never 400', async () => {
  const t = await world();
  for (const party_size of ['4', true, false, 'four', '']) {
    assertError(await post('/reservations', bookBody({ party_size }), { token: t.ada, key: newKey() }), 422, 'validation_failed');
  }
  await noBookings(t.ada);
});

test('S1-023 starts_at_local strings that are not a bare YYYY-MM-DDTHH:MM are 422', async () => {
  const t = await world();
  for (const v of [`${THU}T19:00:00+02:00`, `${THU}T19:00Z`, `${THU}T19:00:00`, `${THU} 19:00`, `${THU}T7:00`,
    `${THU}T19:00+02:00`, `${THU}`, '2026-02-30T19:00', `${THU}T25:00`, 'not-a-time', '']) {
    assertError(await post('/reservations', bookBody({ starts_at_local: v }), { token: t.ada, key: newKey() }), 422, 'validation_failed');
  }
  await noBookings(t.ada);
});

test('S1-066 party_size below 1 or not an integer is 422 validation_failed', async () => {
  const t = await world();
  for (const party_size of [0, -1, 1.5, 2.25]) {
    assertError(await post('/reservations', bookBody({ party_size }), { token: t.ada, key: newKey() }), 422, 'validation_failed');
  }
  await noBookings(t.ada);
});

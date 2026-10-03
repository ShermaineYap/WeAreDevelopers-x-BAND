// Stage 3: exports from the same team's stage-1 and stage-2 services are accepted; imported
// bookings gain revision/terms, keep receipts and sessions, and can be amended and adopted.
// PREVIOUS_BASE_URL = stage-2 service; PREVIOUS_STAGE1_BASE_URL = stage-1 service. Each case is
// skipped when its variable is unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  get, post, patch, fixture, fixture2, USERS, PASSWORD, THU, newKey, assertError, assertStatus, adopt,
} from './lib3.mjs';

const SOURCES = [
  { name: 'stage-2', url: process.env.PREVIOUS_BASE_URL, stage: 2 },
  { name: 'stage-1', url: process.env.PREVIOUS_STAGE1_BASE_URL, stage: 1 },
];

function client(base) {
  return async (method, path, { token, key, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['Idempotency-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base.replace(/\/+$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : undefined, text };
  };
}

for (const src of SOURCES) {
  test(`S3-070 S3-071 S3-065 a ${src.name} export imports with revision 1, policy-0 terms, receipts, sessions and adoption`,
    { skip: src.url ? false : `set ${src.stage === 2 ? 'PREVIOUS_BASE_URL' : 'PREVIOUS_STAGE1_BASE_URL'}` }, async () => {
      const prev = client(src.url);
      const fx = src.stage === 2 ? fixture2() : fixture();
      const rid = src.stage === 2 ? 'r_pairs' : 'r_anker';
      assertStatus(await prev('POST', '/_test/reset', { body: fx }), 204);
      const ada = (await prev('POST', '/auth/login', { body: { email: USERS.ada.email, password: PASSWORD } })).body.token;
      const key = newKey();
      const body = { restaurant_id: rid, table_id: 't_2', starts_at_local: `${THU}T19:00`, party_size: 2 };
      const first = await prev('POST', '/reservations', { token: ada, key, body });
      assertStatus(first, 201);
      const failedKey = newKey();
      assertStatus(await prev('POST', '/reservations', { token: ada, key: failedKey, body: { ...body, party_size: 0 } }), 422);
      let pair;
      if (src.stage === 2) {
        pair = await prev('POST', '/reservations', { token: ada, key: newKey(), body: { restaurant_id: rid, table_ids: ['t_3', 't_4'], starts_at_local: `${THU}T19:00`, party_size: 9 } });
        assertStatus(pair, 201);
      }
      const exported = await prev('GET', '/_test/export');
      assertStatus(exported, 200);

      assertStatus(await post('/_test/reset', fixture({ users: [] })), 204);
      assertStatus(await post('/_test/import', exported.body, { timeout: 10000 }), 204);

      // Sessions and confirmation references survive; the booking gains stage-3 fields.
      const g = await get(`/reservations/${first.body.reference}`, { token: ada });
      assertStatus(g, 200);
      assert.equal(g.body.reservation_id, first.body.reservation_id);
      assert.equal(g.body.created_at, first.body.created_at);
      assert.equal(g.body.revision, 1);
      assert.equal(g.body.accepted_terms.policy_version, 0);
      const r = fx.restaurants.find(x => x.id === rid);
      assert.equal(g.body.accepted_terms.reservation_duration_minutes, r.reservation_duration_minutes);
      assert.equal(g.body.accepted_terms.cancellation_cutoff_minutes, r.cancellation_cutoff_minutes);
      assert.deepEqual(g.body.accepted_terms.capacities, Object.fromEntries(r.tables.map(x => [x.id, x.capacity])));
      const d = await get(`/reservations/${first.body.reference}/decision`, { token: ada });
      assertStatus(d, 200);
      assert.deepEqual(d.body, { reference: first.body.reference, revision: 1, accepted_terms: g.body.accepted_terms });
      assertStatus(await get(`/reservations/${first.body.reference}/history`, { token: ada }), 200);
      assertError(await get(`/reservations/${first.body.reference}/history`), 404, 'not_found');
      // Original retries replay the original response; failed keys stay reusable.
      const rep = await post('/reservations', body, { token: ada, key });
      assertStatus(rep, 200);
      assert.deepEqual(rep.body, first.body);
      assertStatus(await post('/reservations', { ...body, table_id: 't_1', starts_at_local: `${THU}T21:00` }, { token: ada, key: failedKey }), 201);
      if (pair) {
        const gp = (await get(`/reservations/${pair.body.reference}`, { token: ada })).body;
        assert.deepEqual([...gp.table_ids].sort(), ['t_3', 't_4']);
        assert.equal(gp.revision, 1);
      }
      // Imported bookings can be adopted as a series and amended with ordinary history.
      const s = await adopt(ada, { anchor_reference: first.body.reference, count: 2, interval_weeks: 1 });
      assertStatus(s, 201);
      assert.deepEqual(s.body.occurrences[0].reservation, g.body);
      const p = await patch(`/reservations/${first.body.reference}`, { party_size: 3, expected_revision: 1 }, { token: ada });
      assertStatus(p, 200);
      assert.equal(p.body.revision, 2);
      const h = (await get(`/reservations/${first.body.reference}/history`, { token: ada })).body.entries;
      const last = h[h.length - 1];
      assert.equal(last.event, 'changed');
      assert.equal(last.revision, 2);
      assert.deepEqual(last.changes, [{ field: 'party_size', from: 2, to: 3 }]);
      assert.deepEqual(h.map(e => e.seq), h.map((_, i) => i + 1));
    });
}

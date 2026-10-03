// Stage-4 helpers: a managed restaurant with 6 tables and 4 pairs, replans, plan application,
// series amendment, restaurant-revision probing and a reference optimiser written from the spec.
import assert from 'node:assert/strict';
import { PASSWORD, USERS, THU, post, get, newKey, assertStatus, expectedInstant, addDays } from './lib3.mjs';
import { MAX, allWeek, POL, SOON, DST, OTHER } from './lib3.mjs';

export * from './lib3.mjs';

/**
 * r_rep (Europe/Berlin, every day 12:00-23:00, 30/90/120, manager u_max).
 * Fixture order (single ranks 0..5): t_1 Bay 6, t_2 Arch 4, t_3 Nook 2, t_4 Snug 2, t_5 Loft 4, t_6 Hall 8.
 * Pairs (ranks 6..9): [t_3,t_4] 4, [t_2,t_5] 8, [t_4,t_5] 6, [t_1,t_6] 14.
 */
export const REP = {
  id: 'r_rep', name: 'Repair Kitchen', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120, opening_hours: allWeek('12:00', '23:00'),
  tables: [
    { id: 't_1', label: 'Bay', capacity: 6 }, { id: 't_2', label: 'Arch', capacity: 4 },
    { id: 't_3', label: 'Nook', capacity: 2 }, { id: 't_4', label: 'Snug', capacity: 2 },
    { id: 't_5', label: 'Loft', capacity: 4 }, { id: 't_6', label: 'Hall', capacity: 8 },
  ],
  combinable: [['t_3', 't_4'], ['t_2', 't_5'], ['t_4', 't_5'], ['t_1', 't_6']],
  manager_user_ids: ['u_max'],
};
/** r_rep2: a second managed restaurant (for cross-restaurant plan and revision checks). */
export const REP2 = {
  id: 'r_rep2', name: 'Second Kitchen', timezone: 'Europe/Berlin', slot_minutes: 30,
  reservation_duration_minutes: 90, cancellation_cutoff_minutes: 120, opening_hours: allWeek('12:00', '23:00'),
  tables: [{ id: 't_1', label: 'One', capacity: 4 }, { id: 't_2', label: 'Two', capacity: 4 }],
  combinable: [], manager_user_ids: ['u_max'],
};

export function fixture4({ reservations = [] } = {}) {
  return {
    users: [...Object.values(USERS), MAX],
    restaurants: [structuredClone(REP), structuredClone(REP2), structuredClone(POL), structuredClone(SOON), structuredClone(DST), structuredClone(OTHER)],
    reservations,
  };
}

export async function world4(fx = fixture4()) {
  assertStatus(await post('/_test/reset', fx, { timeout: 10000 }), 204);
  const tok = async (u) => (await post('/auth/login', { email: u.email, password: PASSWORD })).body.token;
  return { ada: await tok(USERS.ada), bob: await tok(USERS.bob), cy: await tok(USERS.cy), max: await tok(MAX) };
}

/** RFC 3339 instant for a local Berlin date-time. */
export const at = (date, hm) => expectedInstant('Europe/Berlin', `${date}T${hm}`).rfc;

export function bookR(token, over = {}, key = newKey()) {
  const b = { restaurant_id: 'r_rep', starts_at_local: `${THU}T19:00`, party_size: 2, ...over };
  if (!('table_id' in over) && !('table_ids' in over)) b.table_id = 't_2';
  return post('/reservations', b, { token, key });
}
export async function mustBookR(token, over = {}) {
  const r = await bookR(token, over);
  assertStatus(r, 201);
  return r.body;
}

export const preview = (token, body, { rid = 'r_rep', key = newKey() } = {}) =>
  post(`/restaurants/${rid}/replans`, body, { token, key });
export const applyPlan = (token, planId, { rid = 'r_rep', key = newKey(), body = {} } = {}) =>
  post(`/restaurants/${rid}/replans/${planId}/apply`, body, { token, key });
export const amendSeries = (token, seriesId, body, key = newKey()) => post(`/series/${seriesId}/amend`, body, { token, key });

export const closure = (table_id, date, fromHm, toHm, toDate = date) => ({ table_id, from: at(date, fromHm), to: at(toDate, toHm) });

/** The restaurant revision, read through a harmless preview far in the future (previews change nothing). */
export async function revisionOf(maxToken, rid = 'r_rep') {
  const r = await preview(maxToken, { table_id: 't_1', from: '2099-01-01T00:00:00+00:00', to: '2099-01-01T01:00:00+00:00' }, { rid });
  assertStatus(r, 201);
  assert.deepEqual(r.body.assignments, []);
  return r.body.restaurant_revision;
}

/** Every reservation of the given users (confirmed and cancelled). */
export async function allReservations(tokens) {
  const out = [];
  for (const t of tokens) out.push(...(await get('/reservations', { token: t })).body.reservations);
  return out;
}

// ---------- reference optimiser (from the stage-4 text only) ----------

/**
 * Exhaustive search for the optimal plan.
 * restaurant: { tables (fixture order), combinable (declared order) }
 * bookings:   every confirmed reservation at the restaurant (ordinary responses)
 * closures:   previously applied closures [{table_id, fromMs, toMs}]
 * proposed:   {table_id, fromMs, toMs}
 * Returns null when infeasible, else { assignments: [{reference, table_ids, changed}], moved_count, unused_seats }.
 */
export function optimalPlan(restaurant, bookings, closures, proposed) {
  const options = [...restaurant.tables.map(t => [t.id]), ...restaurant.combinable.map(p => [...p])];
  const span = (b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)];
  const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  const confirmed = bookings.filter(b => b.status === 'confirmed');
  const considered = confirmed.filter(b => { const [s, e] = span(b); return overlaps(s, e, proposed.fromMs, proposed.toMs); })
    .sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
  const fixed = confirmed.filter(b => !considered.includes(b));
  const allClosures = [...closures, proposed];
  const key = (ids) => [...ids].sort().join('+');
  const candidates = considered.map(b => {
    const [s, e] = span(b);
    return options.map((o, rank) => ({ o, rank })).filter(({ o }) => {
      const cap = o.reduce((sum, id) => sum + b.accepted_terms.capacities[id], 0);
      if (cap < b.party_size) return false;
      if (allClosures.some(c => o.includes(c.table_id) && overlaps(s, e, c.fromMs, c.toMs))) return false;
      return !fixed.some(f => { const [fs, fe] = span(f); return overlaps(s, e, fs, fe) && f.table_ids.some(id => o.includes(id)); });
    }).map(({ o, rank }) => ({ o, rank, unused: o.reduce((sum, id) => sum + b.accepted_terms.capacities[id], 0) - b.party_size, changed: key(o) !== key(b.table_ids) }));
  });
  let best = null;
  const pick = new Array(considered.length);
  const better = (a, b) => {
    if (a.moved !== b.moved) return a.moved < b.moved;
    if (a.unused !== b.unused) return a.unused < b.unused;
    for (let i = 0; i < a.ranks.length; i++) if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] < b.ranks[i];
    return false;
  };
  const walk = (i) => {
    if (i === considered.length) {
      const score = { moved: pick.filter(p => p.changed).length, unused: pick.reduce((s, p) => s + p.unused, 0), ranks: pick.map(p => p.rank), pick: [...pick] };
      if (!best || better(score, best)) best = score;
      return;
    }
    const [s, e] = span(considered[i]);
    for (const c of candidates[i]) {
      let clash = false;
      for (let j = 0; j < i && !clash; j++) {
        const [js, je] = span(considered[j]);
        clash = overlaps(s, e, js, je) && pick[j].o.some(id => c.o.includes(id));
      }
      if (clash) continue;
      pick[i] = c;
      walk(i + 1);
    }
  };
  walk(0);
  if (!best) return null;
  return {
    assignments: considered.map((b, i) => ({ reference: b.reference, table_ids: best.pick[i].o, changed: best.pick[i].changed })),
    moved_count: best.moved, unused_seats: best.unused,
  };
}

export { THU, addDays };

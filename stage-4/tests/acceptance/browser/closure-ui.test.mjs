// Stage 4 in the browser: an applied plan shows in the grid (closed, distinct from booked) and in lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, withPage, sel, logIn, search, waitCells, text, describe, styleSig } from './ui-lib.mjs';
import { world4, mustBookR, preview, applyPlan, closure, availability, get, THU, addDays } from '../lib4.mjs';

useBrowser();

test('S4-060 S4-061 a table closed by an applied plan reads "closed", distinct from booked and available; lookup shows the new table', async () => {
  const t = await world4();
  const booked = await mustBookR(t.bob, { table_id: 't_5', party_size: 4 });
  const moved = await mustBookR(t.ada, { table_id: 't_2', party_size: 2 });
  const p = await preview(t.max, closure('t_2', THU, '18:00', '23:00'));
  assert.equal(p.status, 201);
  const target = p.body.assignments.find(a => a.reference === moved.reference).table_ids;
  assert.equal((await applyPlan(t.max, p.body.plan_id)).status, 201);
  const av = (await availability('r_rep', THU, 2)).body;
  const exp = {};
  for (const s of av.slots) for (const tb of ['t_1', 't_2', 't_3', 't_4', 't_5', 't_6']) exp[`slot-${tb}-${s.starts_at_local.slice(11)}`] = String(s.available_table_ids.includes(tb));
  await withPage(async (page) => {
    await logIn(page);
    await search(page, { restaurant: 'r_rep', date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await waitCells(page, exp);
    assert.equal(await page.getAttribute(sel('slot-t_2-19:00'), 'data-available'), 'false');
    const closed = await describe(page, 'slot-t_2-19:00');
    const taken = await describe(page, 'slot-t_5-19:00');
    const free = await describe(page, 'slot-t_6-19:00');
    assert.match(closed, /closed/i, `closure not labelled closed: "${closed}"`);
    assert.doesNotMatch(closed, /booked/i, `closure labelled as booked: "${closed}"`);
    assert.match(taken, /booked/i);
    assert.doesNotMatch(taken, /closed/i);
    assert.match(free, /available/i);
    await page.mouse.move(0, 0);
    assert.notEqual(await styleSig(page, 'slot-t_2-19:00'), await styleSig(page, 'slot-t_5-19:00'), 'closed and booked look the same');
    // Outside the closure the table is bookable again (16:00 ends 17:30).
    assert.equal(await page.getAttribute(sel('slot-t_2-16:00'), 'data-available'), 'true');
    // The next day is untouched.
    await search(page, { restaurant: 'r_rep', date: addDays(THU, 1), party: 2, readyCell: 'slot-t_2-19:00' });
    await waitCells(page, { 'slot-t_2-19:00': 'true' });
    // Lookup reflects the reassignment.
    await page.goto('/lookup');
    await page.fill(sel('lookup-reference-input'), moved.reference);
    await page.click(sel('lookup-submit'));
    await page.waitForSelector(sel('reservation-detail'));
    const tables = await text(page, 'reservation-tables');
    const labels = { t_1: 'Bay', t_2: 'Arch', t_3: 'Nook', t_4: 'Snug', t_5: 'Loft', t_6: 'Hall' };
    for (const id of target) assert.match(tables, new RegExp(labels[id]));
    assert.doesNotMatch(tables, /Arch/);
    assert.equal(await text(page, 'reservation-status'), 'confirmed');
    assert.ok(booked.reference);
  });
});

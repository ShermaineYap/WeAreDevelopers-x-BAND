// Stage 3 in the browser: the stage-2 grid follows the selected policy; screens re-read after writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, withPage, sel, logIn, search, waitCells, text, visible } from './ui-lib.mjs';
import { world3, mustPublish, policy, mustBookP, amend, availability, get, THU, addDays } from '../lib3.mjs';

useBrowser();

test('S3-100 the grid shows the selected policy\'s slots and capacities', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(THU, {
    slot_minutes: 60, reservation_duration_minutes: 60, opening_hours: [{ weekday: 'thu', opens: '12:00', closes: '15:00' }],
    capacities: { t_1: 1, t_2: 5, t_3: 6 },
  }));
  const av = (await availability('r_pol', THU, 5)).body;
  const exp = {};
  for (const s of av.slots) for (const tb of ['t_1', 't_2', 't_3']) exp[`slot-${tb}-${s.starts_at_local.slice(11)}`] = String(s.available_table_ids.includes(tb));
  assert.equal(Object.keys(exp).length, 9);
  await withPage(async (page) => {
    await search(page, { restaurant: 'r_pol', date: THU, party: 5, readyCell: 'slot-t_2-12:00' });
    await waitCells(page, exp);
    assert.equal(await page.getAttribute(sel('slot-t_2-12:00'), 'data-available'), 'true', 'policy raised Bar to 5 seats');
    assert.equal(await page.locator(sel('slot-t_2-19:00')).count(), 0, 'fixture-hours slots must not appear');
    // The day after keeps the fixture rules.
    await search(page, { restaurant: 'r_pol', date: addDays(THU, -1), party: 2, readyCell: 'slot-t_2-19:00' });
  });
});

test('S3-101 booking through the UI under a policy, then lookup re-reads an amended booking', async () => {
  const t = await world3();
  await mustPublish(t.max, policy(THU, { reservation_duration_minutes: 60 }));
  await withPage(async (page) => {
    await logIn(page);
    await search(page, { restaurant: 'r_pol', date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await page.click(sel('slot-t_2-19:00'));
    await page.waitForSelector(sel('booking-form'));
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    const ref = await text(page, 'confirmation-reference');
    const b = (await get(`/reservations/${ref}`, { token: t.ada })).body;
    assert.equal(b.accepted_terms.policy_version, 1);
    assert.equal(b.revision, 1);
    // Amend outside the browser; a fresh lookup must show the server's current state.
    assert.equal((await amend(ref, { table_id: 't_3', starts_at_local: `${THU}T20:30` }, t.ada)).status, 200);
    await page.goto('/lookup');
    await page.fill(sel('lookup-reference-input'), ref);
    await page.click(sel('lookup-submit'));
    await page.waitForSelector(sel('reservation-detail'));
    assert.match(await text(page, 'reservation-tables'), /Garden/);
    assert.doesNotMatch(await text(page, 'reservation-tables'), /Bar/);
    assert.match(await page.locator(sel('reservation-detail')).innerText(), /20:30/);
    await page.click(sel('reservation-cancel-button'));
    await page.waitForSelector(sel('reservation-cancel-button'), { state: 'detached' });
    assert.equal(await text(page, 'reservation-status'), 'cancelled');
    assert.equal((await get(`/reservations/${ref}`, { token: t.ada })).body.revision, 3);
    assert.equal(await visible(page, 'reservation-error'), false);
  });
});

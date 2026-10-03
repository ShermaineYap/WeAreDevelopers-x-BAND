// Stage 2 lookup screen and the export/import upgrade seen from an open browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useBrowser, withPage, sel, logIn, search, waitCells, visible, text, loseBookingResponses, recordBookings,
  apiReservations, world2, reset2, fixture2, book2, get, post, THU, YESTERDAY_UTC,
} from './ui-lib.mjs';

useBrowser();

async function lookUp(page, ref) {
  await page.goto('/lookup');
  await page.fill(sel('lookup-reference-input'), ref);
  await page.click(sel('lookup-submit'));
  await page.waitForSelector(`${sel('reservation-detail')}, ${sel('reservation-error')}`);
}

test('S2-032 S2-033 S2-072 lookup shows the booking; cancel updates in place and frees the table', async () => {
  const t = await world2();
  const b = (await book2(t.ada, { table_ids: ['t_3', 't_4'], party_size: 9 })).body;
  await withPage(async (page) => {
    await logIn(page);
    await lookUp(page, b.reference);
    assert.ok(await visible(page, 'reservation-detail'));
    assert.equal(await text(page, 'reservation-status'), 'confirmed');
    assert.match(await text(page, 'reservation-tables'), /Garden/);
    assert.match(await text(page, 'reservation-tables'), /Terrace/);
    await page.click(sel('reservation-cancel-button'));
    await page.waitForSelector(sel('reservation-cancel-button'), { state: 'detached' });
    assert.equal(await text(page, 'reservation-status'), 'cancelled');
    assert.equal(await visible(page, 'reservation-error'), false);
    await lookUp(page, b.reference);
    assert.equal(await text(page, 'reservation-status'), 'cancelled');
    assert.equal(await page.locator(sel('reservation-cancel-button')).count(), 0);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_3-19:00' });
    await waitCells(page, { 'slot-t_3-19:00': 'true', 'slot-t_4-19:00': 'true' });
  });
});

test('S2-034 reservation-error for unknown or foreign references and for a refused cancel', async () => {
  const t = await world2();
  const bobs = (await book2(t.bob, { table_id: 't_2' })).body;
  const past = (await book2(t.ada, { restaurant_id: 'r_utc2', table_id: 't_n1', starts_at_local: `${YESTERDAY_UTC}T12:00` })).body;
  await withPage(async (page) => {
    await logIn(page);
    for (const ref of ['ZZZZZZ', bobs.reference]) {
      await lookUp(page, ref);
      await page.waitForSelector(sel('reservation-error'));
      assert.equal(await visible(page, 'reservation-detail'), false, `${ref} must not show a detail`);
    }
    await lookUp(page, past.reference);
    assert.equal(await text(page, 'reservation-status'), 'confirmed');
    await page.click(sel('reservation-cancel-button'));
    await page.waitForSelector(sel('reservation-error'));
    assert.equal(await text(page, 'reservation-status'), 'confirmed', 'a refused cancel must not show cancelled');
  });
  assert.equal((await get(`/reservations/${past.reference}`, { token: t.ada })).body.status, 'confirmed');
});

test('S2-036 S2-037 S2-038 an export/import upgrade keeps the session and the pending retry', async () => {
  await world2();
  await withPage(async (page) => {
    const log = recordBookings(page);
    await logIn(page);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await page.click(sel('slot-t_2-19:00'));
    await page.waitForSelector(sel('booking-form'));
    const net = await loseBookingResponses(page, 'after');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-uncertain'));
    await net.restore();
    const committed = net.lost[0].response.reference;

    // The upgrade happens between browser requests: export, wipe, import.
    const e = await get('/_test/export');
    assert.equal(e.status, 200);
    await reset2(fixture2({ users: [] }));
    assert.equal((await post('/_test/import', e.body, { timeout: 10000 })).status, 204);

    // Same page, no reload: the pending retry recovers the original confirmation.
    assert.ok(await visible(page, 'current-user'), 'still signed in');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    assert.equal(await text(page, 'confirmation-reference'), committed);
    assert.equal(await visible(page, 'booking-uncertain'), false);
    assert.equal(await visible(page, 'booking-error'), false);
    assert.ok(log.length >= 2 && log.every(l => l.key === log[0].key));

    // The retained reference still works through lookup with the same session.
    await lookUp(page, committed);
    assert.ok(await visible(page, 'current-user'));
    assert.equal(await text(page, 'reservation-status'), 'confirmed');
  });
});

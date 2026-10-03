// Stage 3 + product brief: a day closed by the selected policy is labelled "closed",
// exactly like a day the fixture itself closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, withPage, sel, search, text } from './ui-lib.mjs';
import { world3, mustPublish, policy, allWeek } from '../lib3.mjs';

useBrowser();

test('S3-103 a day closed by the selected policy is labelled closed, like a fixture-closed day', async () => {
  const t = await world3();
  // r_pol is open every day 18:00-23:00 in the fixture; from 2026-11-12 the policy closes Fridays.
  await mustPublish(t.max, policy('2026-11-12', { opening_hours: allWeek().filter(h => h.weekday !== 'fri') }));
  await withPage(async (page) => {
    // Reference: r_dst opens on Sundays only, so Friday 2026-11-13 is closed by its fixture.
    await search(page, { restaurant: 'r_dst', date: '2026-11-13', party: 2 });
    await page.waitForSelector(sel('no-slots'));
    assert.match(await text(page, 'no-slots'), /closed/i, 'fixture-closed day must read as closed');

    // Thursday under the policy still has slots.
    await search(page, { restaurant: 'r_pol', date: '2026-11-12', party: 2, readyCell: 'slot-t_2-19:00' });

    // Friday under the policy: closed, not "no times left" or full.
    await search(page, { restaurant: 'r_pol', date: '2026-11-13', party: 2 });
    await page.waitForSelector(sel('no-slots'));
    const label = await text(page, 'no-slots');
    assert.match(label, /closed/i, `policy-closed day must read as closed: "${label}"`);
    assert.doesNotMatch(label, /no times left|no bookable times|fully booked/i, `wrong cause: "${label}"`);
    assert.equal(await page.locator('[data-testid^="slot-"]').count(), 0);
  });
});

// Stage 2 booking form, confirmation, conflicts, lost responses and retries (single and combined).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useBrowser, withPage, sel, logIn, search, waitCells, visible, text, styleSig, recordBookings,
  loseBookingResponses, apiReservations, world2, book2, THU,
} from './ui-lib.mjs';

useBrowser();
const REF = /^[A-Z0-9]{6,12}$/;

async function openForm(page, { party = 2, cell = 'slot-t_2-19:00' } = {}) {
  await logIn(page);
  await search(page, { date: THU, party, readyCell: cell });
  await waitCells(page, { [cell]: 'true' });
  await page.click(sel(cell));
  await page.waitForSelector(sel('booking-form'));
}

test('S2-002 S2-027 S2-031 booking form and confirmation carry the documented content', async () => {
  const t = await world2();
  await withPage(async (page) => {
    await openForm(page, { party: 3 });
    const summary = await text(page, 'booking-summary');
    assert.match(summary, /Bar/);
    assert.match(summary, /19:00/);
    assert.equal(await page.inputValue(sel('booking-party-size')), '3');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    const ref = await text(page, 'confirmation-reference');
    assert.match(ref, REF);
    assert.equal(await page.locator(sel('confirmation-reference')).first().textContent(), ref, 'no surrounding words or whitespace');
    const details = await text(page, 'confirmation-details');
    for (const s of ['Harbour Kitchen', 'Bar', '19:00']) assert.ok(details.includes(s), `${s} missing from "${details}"`);
    const mine = await apiReservations(t.ada);
    assert.deepEqual(mine.map(r => [r.reference, r.table_id, r.party_size, r.starts_at_local]), [[ref, 't_2', 3, `${THU}T19:00`]]);
  });
});

test('S2-028 S2-029 an unchanged resubmit returns the same reference and books once', async () => {
  const t = await world2();
  await withPage(async (page) => {
    const log = recordBookings(page);
    await openForm(page);
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    const first = await text(page, 'confirmation-reference');
    assert.ok(await visible(page, 'booking-form'), 'the form must stay on screen after success');
    await page.click(sel('booking-submit'));
    await page.waitForTimeout(800);
    assert.equal(await visible(page, 'booking-error'), false);
    assert.equal(await text(page, 'confirmation-reference'), first);
    assert.equal((await apiReservations(t.ada)).length, 1);
    assert.ok(log.length >= 2 && log.every(l => l.key === log[0].key), 'the resubmit must reuse the idempotency key');
  });
});

test('S2-030 changing a field makes the next submission a new booking request', async () => {
  const t = await world2();
  await withPage(async (page) => {
    const log = recordBookings(page);
    await openForm(page, { party: 2, cell: 'slot-t_4-19:00' });
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    const first = await text(page, 'confirmation-reference');
    await page.fill(sel('booking-party-size'), '3');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-error'));
    assert.equal(log.length, 2);
    assert.notEqual(log[1].key, log[0].key, 'a changed form must use a new idempotency key');
    assert.equal(log[1].body.party_size, 3);
    const mine = await apiReservations(t.ada);
    assert.deepEqual(mine.map(r => r.reference), [first]);
  });
});

test('S2-004 S2-005 S2-006 a 409 shows booking-error, keeps the form and refreshes the grid', async () => {
  const t = await world2();
  await withPage(async (page) => {
    await openForm(page, { party: 2 });
    await page.fill(sel('booking-party-size'), '3');
    assert.equal((await book2(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` })).status, 201);
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-error'));
    assert.ok((await text(page, 'booking-error')).length > 0);
    assert.equal(await visible(page, 'confirmation'), false, 'no confirmation for a refused attempt');
    assert.ok(await visible(page, 'booking-form'), 'the form must stay');
    assert.equal(await page.inputValue(sel('booking-party-size')), '3', 'inputs must be preserved');
    assert.match(await text(page, 'booking-summary'), /Bar/);
    await waitCells(page, { 'slot-t_2-19:00': 'false', 'slot-t_2-18:30': 'false', 'slot-t_2-20:30': 'true' });
    assert.equal((await apiReservations(t.ada)).length, 0);
  });
});

for (const mode of ['after', 'before']) {
  test(`S2-007 S2-008 S2-009 S2-012 a lost response (${mode} commit) shows booking-uncertain; the retry recovers`, async () => {
    const t = await world2();
    await withPage(async (page) => {
      const log = recordBookings(page);
      await openForm(page);
      const net = await loseBookingResponses(page, mode);
      await page.click(sel('booking-submit'));
      await page.waitForSelector(sel('booking-uncertain'));
      assert.ok((await text(page, 'booking-uncertain')).length > 0, 'booking-uncertain must have text');
      assert.equal(await visible(page, 'booking-error'), false, 'no booking-error while uncertain');
      assert.equal(await visible(page, 'confirmation'), false, 'no confirmation from a lost response');
      await net.restore();
      assert.ok(await visible(page, 'booking-form'));
      await page.click(sel('booking-submit'));
      await page.waitForSelector(sel('confirmation'));
      const ref = await text(page, 'confirmation-reference');
      if (mode === 'after') assert.equal(ref, net.lost[0].response.reference, 'must show the original reference');
      assert.equal(await visible(page, 'booking-uncertain'), false, 'uncertainty must be removed');
      assert.equal(await visible(page, 'booking-error'), false);
      const sent = log.filter(l => l.key);
      assert.ok(sent.length >= 2);
      for (const l of sent) {
        assert.equal(l.key, sent[0].key, 'retry must reuse the idempotency key');
        assert.deepEqual(l.body, sent[0].body, 'retry must send the same body');
      }
      const mine = await apiReservations(t.ada);
      assert.deepEqual(mine.map(r => r.reference), [ref], 'exactly one booking');
    });
  });
}

test('S2-010 S2-070 a confirmed rejection after uncertainty uses booking-error, styled unlike uncertainty', async () => {
  const t = await world2();
  await withPage(async (page) => {
    await openForm(page);
    const net = await loseBookingResponses(page, 'before');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-uncertain'));
    const uncertain = await styleSig(page, 'booking-uncertain');
    await net.restore();
    assert.equal((await book2(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` })).status, 201);
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-error'));
    assert.equal(await visible(page, 'confirmation'), false);
    assert.notEqual(await styleSig(page, 'booking-error'), uncertain, 'refused and uncertain look the same');
    assert.equal((await apiReservations(t.ada)).length, 0);
  });
});

test('S2-011 S2-062 S2-063 combination bookings: summary, confirmation tables, lost response and recovery', async () => {
  const t = await world2();
  await withPage(async (page) => {
    const log = recordBookings(page);
    await openForm(page, { party: 5, cell: 'slot-t_2+t_1-19:00' });
    const summary = await text(page, 'booking-summary');
    assert.match(summary, /Bar/);
    assert.match(summary, /Window/);
    assert.match(summary, /19:00/);
    const net = await loseBookingResponses(page, 'after');
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('booking-uncertain'));
    assert.equal(await visible(page, 'confirmation'), false);
    await net.restore();
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    const ref = await text(page, 'confirmation-reference');
    assert.equal(ref, net.lost[0].response.reference);
    const tables = await text(page, 'confirmation-tables');
    assert.match(tables, /Bar/);
    assert.match(tables, /Window/);
    assert.doesNotMatch(tables, /\bt_\d\b/, 'raw ids in confirmation-tables');
    assert.ok(log.every(l => l.key === log[0].key));
    assert.deepEqual([...log[0].body.table_ids].sort(), ['t_1', 't_2']);
    const mine = await apiReservations(t.ada);
    assert.equal(mine.length, 1);
    assert.deepEqual([...mine[0].table_ids].sort(), ['t_1', 't_2']);
    // Unchanged resubmit of a combination is a replay too.
    await page.click(sel('booking-submit'));
    await page.waitForTimeout(800);
    assert.equal(await text(page, 'confirmation-reference'), ref);
    assert.equal(await visible(page, 'booking-error'), false);
    // Lookup lists both tables.
    await page.goto('/lookup');
    await page.fill(sel('lookup-reference-input'), ref);
    await page.click(sel('lookup-submit'));
    await page.waitForSelector(sel('reservation-detail'));
    const rt = await text(page, 'reservation-tables');
    assert.match(rt, /Bar/);
    assert.match(rt, /Window/);
  });
});

test('S2-064 a single-table booking keeps its stage-2 testids and details', async () => {
  await world2();
  await withPage(async (page) => {
    await openForm(page, { party: 2, cell: 'slot-t_3-21:00' });
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    assert.match(await text(page, 'confirmation-details'), /Garden/);
    const ref = await text(page, 'confirmation-reference');
    await page.goto('/lookup');
    await page.fill(sel('lookup-reference-input'), ref);
    await page.click(sel('lookup-submit'));
    await page.waitForSelector(sel('reservation-detail'));
    assert.equal(await text(page, 'reservation-status'), 'confirmed');
  });
});

test('S2-072 after a booking every visible grid re-reads the server', async () => {
  await world2();
  await withPage(async (page) => {
    await openForm(page, { party: 2, cell: 'slot-t_2-19:00' });
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    if (await visible(page, 'availability-grid')) {
      await waitCells(page, { 'slot-t_2-19:00': 'false', 'slot-t_2-18:00': 'false', 'slot-t_2-20:00': 'false', 'slot-t_2-20:30': 'true' });
    }
  });
});

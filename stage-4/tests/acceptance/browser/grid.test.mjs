// Stage 2 availability grid, combination cells, availability causes and out-of-order searches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useBrowser, withPage, sel, logIn, search, waitCells, visible, text, styleSig, describe,
  world2, reset2, availability, book2, THU, MON, PAIRS,
} from './ui-lib.mjs';

useBrowser();

async function expectedCells(rid, date, party, tables, pairs = []) {
  const r = await availability(rid, date, party);
  const exp = {};
  for (const s of r.body.slots) {
    const hm = s.starts_at_local.slice(11);
    for (const t of tables) exp[`slot-${t}-${hm}`] = String(s.available_table_ids.includes(t));
    for (const p of pairs) {
      if (s.available_options.some(o => o.table_ids.join('+') === p.join('+'))) exp[`slot-${p.join('+')}-${hm}`] = 'true';
    }
  }
  return exp;
}

test('S2-020 S2-021 S2-023 one cell per table per slot; data-available matches GET /availability exactly', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:30` });
  await book2(t.bob, { table_ids: ['t_3', 't_4'], party_size: 9, starts_at_local: `${THU}T21:00` });
  await withPage(async (page) => {
    for (const party of [1, 3, 5]) {
      await search(page, { date: THU, party, readyCell: 'slot-t_1-18:00' });
      assert.ok(await visible(page, 'availability-grid'));
      const exp = await expectedCells('r_pairs', THU, party, ['t_1', 't_2', 't_3', 't_4']);
      assert.equal(Object.keys(exp).length, 8 * 4);
      await waitCells(page, exp);
    }
  });
});

test('S2-022 no-slots replaces the grid on a day without slots', async () => {
  await world2();
  await withPage(async (page) => {
    await search(page, { date: MON, party: 2 });
    await page.waitForSelector(sel('no-slots'));
    assert.equal(await page.locator('[data-testid^="slot-"]').count(), 0);
    assert.equal(await visible(page, 'availability-grid'), false);
  });
});

test('S2-024 clicking an available cell opens the form for that table and slot', async () => {
  await world2();
  await withPage(async (page) => {
    await logIn(page);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_3-20:30' });
    await page.click(sel('slot-t_3-20:30'));
    await page.waitForSelector(sel('booking-form'));
    const summary = await text(page, 'booking-summary');
    assert.match(summary, /Garden/);
    assert.match(summary, /20:30/);
    assert.equal(await page.inputValue(sel('booking-party-size')), '2');
    assert.equal(await page.getAttribute(sel('booking-party-size'), 'type'), 'number');
  });
});

test('S2-025 clicking an unavailable cell does nothing', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_4', party_size: 3 });
  await withPage(async (page) => {
    await logIn(page);
    await search(page, { date: THU, party: 3, readyCell: 'slot-t_1-19:00' });
    await waitCells(page, { 'slot-t_1-19:00': 'false', 'slot-t_4-19:00': 'false' });
    for (const id of ['slot-t_1-19:00', 'slot-t_4-19:00']) {
      await page.click(sel(id), { force: true });
      await page.waitForTimeout(300);
      assert.equal(await visible(page, 'booking-form'), false, `${id} opened the form`);
    }
  });
});

test('S2-026 booking while signed out shows auth-error or goes to /login', async () => {
  await world2();
  await withPage(async (page) => {
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await page.click(sel('slot-t_2-19:00'));
    await page.waitForSelector(`${sel('auth-error')}, ${sel('login-submit')}`);
  });
});

test('S2-060 S2-061 combination cells use combinable order, only for declared pairs, with data-available', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_1', starts_at_local: `${THU}T19:00` });
  await withPage(async (page) => {
    await search(page, { date: THU, party: 5, readyCell: 'slot-t_4-18:00' });
    const exp = await expectedCells('r_pairs', THU, 5, ['t_4'], PAIRS.combinable);
    await waitCells(page, exp);
    assert.equal(exp['slot-t_2+t_1-18:00'], undefined, 'pair t_2+t_1 is not available at 18:00 (t_1 booked)');
    for (const hm of ['18:00', '19:00', '21:30']) {
      for (const bad of ['t_1+t_2', 't_1+t_3', 't_3+t_1', 't_3+t_2', 't_4+t_3', 't_2+t_4', 't_1+t_4']) {
        assert.equal(await page.locator(sel(`slot-${bad}-${hm}`)).count(), 0, `undeclared or misordered pair cell ${bad}`);
      }
      // A pair that is shown but not available must say so.
      const p = page.locator(sel(`slot-t_2+t_1-${hm}`));
      if (await p.count()) assert.equal(await p.getAttribute('data-available'), exp[`slot-t_2+t_1-${hm}`] ?? 'false');
    }
    assert.equal(await page.getAttribute(sel('slot-t_2+t_1-21:00'), 'data-available'), 'true');
    assert.equal(await page.getAttribute(sel('slot-t_3+t_4-19:00'), 'data-available'), 'true');
    // Party 7: t_2+t_1 (6 seats) is too small and must not be offered.
    await search(page, { date: THU, party: 7, stay: true });
    await waitCells(page, await expectedCells('r_pairs', THU, 7, ['t_1', 't_4'], PAIRS.combinable));
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="slot-t_2+t_1-21:00"]');
      return !el || el.getAttribute('data-available') === 'false';
    });
  });
});

test('S2-074 combinations are shown with human table labels, not raw ids', async () => {
  await world2();
  await withPage(async (page) => {
    await search(page, { date: THU, party: 5, readyCell: 'slot-t_2+t_1-19:00' });
    const cell = await page.locator(sel('slot-t_2+t_1-19:00')).innerText();
    assert.doesNotMatch(cell, /\bt_\d\b/, `raw ids in a combination cell: ${cell}`);
    const grid = await page.locator(sel('availability-grid')).innerText();
    assert.doesNotMatch(grid, /\bt_\d\b/, 'raw table ids shown in the grid');
    for (const label of ['Bar', 'Window', 'Garden', 'Terrace']) assert.match(grid, new RegExp(label), `label ${label} missing from grid`);
  });
});

test('S2-070 available, unavailable and selected cells look different', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` });
  await withPage(async (page) => {
    await logIn(page);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_3-19:00' });
    await waitCells(page, { 'slot-t_2-19:00': 'false', 'slot-t_3-19:00': 'true', 'slot-t_1-19:00': 'true' });
    await page.mouse.move(0, 0);
    const avail = await styleSig(page, 'slot-t_1-19:00');
    const taken = await styleSig(page, 'slot-t_2-19:00');
    assert.notEqual(avail, taken, 'available and booked cells look identical');
    await page.click(sel('slot-t_3-19:00'));
    await page.waitForSelector(sel('booking-form'));
    await page.mouse.move(0, 0);
    await page.locator('body').evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const selected = await styleSig(page, 'slot-t_3-19:00');
    assert.notEqual(selected, await styleSig(page, 'slot-t_1-19:00'), 'the selected cell looks like any available cell');
  });
});

test('S2-071 availability causes are labelled in words: available, booked, closed', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_2', starts_at_local: `${THU}T19:00` });
  await withPage(async (page) => {
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await waitCells(page, { 'slot-t_2-19:00': 'false' });
    const booked = await describe(page, 'slot-t_2-19:00');
    const free = await describe(page, 'slot-t_1-19:00');
    assert.match(booked, /booked|reserved|taken/i, `booked cell is not labelled as booked: "${booked}"`);
    assert.doesNotMatch(free, /booked|reserved|taken/i, `available cell is labelled as booked: "${free}"`);
    assert.match(free, /available|free|open/i, `available cell is not labelled as available: "${free}"`);
    await search(page, { date: MON, party: 2 });
    await page.waitForSelector(sel('no-slots'));
    assert.match(await text(page, 'no-slots'), /closed/i, 'a closed day is not described as closed');
  });
});

test('S2-003 a late response for an earlier search never replaces a newer one (restaurant change)', async () => {
  await world2();
  await withPage(async (page) => {
    await logIn(page);
    await page.goto('/');
    await page.waitForSelector(sel('search-button'));
    await page.waitForLoadState('networkidle');
    let release; const gate = new Promise(r => { release = r; });
    const held = [];
    const handler = async (route) => {
      const done = (async () => { const resp = await route.fetch(); await gate; await route.fulfill({ response: resp }).catch(() => {}); })();
      held.push(done);
      await done;
    };
    await page.route(u => u.href.includes('r_pairs'), handler);
    await page.selectOption(sel('restaurant-select'), 'r_pairs');
    await page.fill(sel('date-input'), THU);
    await page.fill(sel('party-size-input'), '2');
    await page.click(sel('search-button'));
    await page.waitForTimeout(200);
    await page.selectOption(sel('restaurant-select'), 'r_two');
    await page.click(sel('search-button'));
    await page.waitForSelector(sel('slot-t_x-19:00'));
    assert.ok(held.length > 0, 'search A was never sent');
    release();
    await Promise.all(held);
    await page.waitForTimeout(800);
    assert.equal(await page.locator(sel('slot-t_1-19:00')).count(), 0, 'late response for A restored its grid');
    assert.ok(await visible(page, 'slot-t_x-19:00'), 'B grid disappeared');
    await page.click(sel('slot-t_x-19:00'));
    await page.waitForSelector(sel('booking-form'));
    const summary = await text(page, 'booking-summary');
    assert.match(summary, /Alcove/);
    assert.doesNotMatch(summary, /Window|Bar|Garden|Terrace/);
  });
});

test('S2-003 a late response for an earlier search never replaces a newer one (date change)', async () => {
  await world2();
  await withPage(async (page) => {
    await page.goto('/');
    await page.waitForSelector(sel('search-button'));
    await page.waitForLoadState('networkidle');
    let release; const gate = new Promise(r => { release = r; });
    const held = [];
    await page.route(u => u.href.includes(THU), async (route) => {
      const done = (async () => { const resp = await route.fetch(); await gate; await route.fulfill({ response: resp }).catch(() => {}); })();
      held.push(done);
      await done;
    });
    await page.selectOption(sel('restaurant-select'), 'r_pairs');
    await page.fill(sel('party-size-input'), '2');
    await page.fill(sel('date-input'), THU);
    await page.click(sel('search-button'));
    await page.waitForTimeout(200);
    await page.fill(sel('date-input'), MON);
    await page.click(sel('search-button'));
    await page.waitForSelector(sel('no-slots'));
    assert.ok(held.length > 0, 'search A was never sent');
    release();
    await Promise.all(held);
    await page.waitForTimeout(800);
    assert.ok(await visible(page, 'no-slots'), 'late response for A replaced no-slots');
    assert.equal(await page.locator('[data-testid^="slot-"]').count(), 0, 'late response for A restored its cells');
  });
});

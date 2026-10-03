// Stage 2 screens, auth UI and observable product-quality rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useBrowser, withPage, sel, logIn, search, visible, text, noHorizontalScroll, styleSig,
  reset2, world2, get, BASE_URL, USERS, PASSWORD, THU, book2,
} from './ui-lib.mjs';

useBrowser();
const ROUTES = { '/': 'search-button', '/signup': 'signup-submit', '/login': 'login-submit', '/lookup': 'lookup-submit' };

test('S2-001 the four routes are reachable directly by URL', async () => {
  await reset2();
  await withPage(async (page) => {
    for (const [route, anchor] of Object.entries(ROUTES)) {
      const resp = await page.goto(route);
      assert.equal(resp.status(), 200, route);
      assert.match(resp.headers()['content-type'] || '', /text\/html/i, route);
      await page.waitForSelector(sel(anchor));
    }
  });
});

test('S2-013 signup through the UI signs the diner in', async () => {
  await reset2();
  await withPage(async (page) => {
    await page.goto('/signup');
    await page.fill(sel('signup-email'), 'dee@example.com');
    await page.fill(sel('signup-password'), PASSWORD);
    await page.fill(sel('signup-display-name'), 'Dee Lightful');
    await page.click(sel('signup-submit'));
    await page.waitForSelector(sel('current-user'));
    assert.match(await text(page, 'current-user'), /Dee Lightful/);
  });
  const r = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dee@example.com', password: PASSWORD }) });
  assert.equal(r.status, 200, 'the UI signup created a real account');
});

test('S2-014 S2-016 login shows current-user with the display name on every screen', async () => {
  await reset2();
  await withPage(async (page) => {
    await logIn(page);
    for (const route of Object.keys(ROUTES)) {
      await page.goto(route);
      await page.waitForSelector(sel('current-user'));
      assert.match(await text(page, 'current-user'), /Ada/, route);
    }
  });
});

test('S2-015 auth-error appears only when there is an error', async () => {
  await reset2();
  await withPage(async (page) => {
    for (const route of ['/login', '/signup']) {
      await page.goto(route);
      await page.waitForSelector(sel(route === '/login' ? 'login-submit' : 'signup-submit'));
      assert.equal(await page.locator(sel('auth-error')).count(), 0, `${route}: auth-error present with no error`);
    }
    await page.goto('/login');
    await page.fill(sel('login-email'), USERS.ada.email);
    await page.fill(sel('login-password'), 'wrong password');
    await page.click(sel('login-submit'));
    await page.waitForSelector(sel('auth-error'));
    assert.ok((await text(page, 'auth-error')).length > 0);
    assert.equal(await visible(page, 'current-user'), false);
    for (const [email, pw] of [[USERS.ada.email, PASSWORD], ['short@example.com', '1234567'], ['not-an-email', PASSWORD]]) {
      await page.goto('/signup');
      await page.fill(sel('signup-email'), email);
      await page.fill(sel('signup-password'), pw);
      await page.fill(sel('signup-display-name'), 'X');
      await page.click(sel('signup-submit'));
      await page.waitForSelector(sel('auth-error'));
      assert.equal(await visible(page, 'current-user'), false, `${email}/${pw} must not sign in`);
    }
    await logIn(page);
    assert.equal(await page.locator(sel('auth-error')).count(), 0, 'auth-error must go after a successful login');
  });
});

test('S2-017 logout signs the diner out, including after a reload', async () => {
  await reset2();
  await withPage(async (page) => {
    await logIn(page);
    await page.click(sel('logout-button'));
    await page.waitForSelector(sel('current-user'), { state: 'detached' });
    await page.goto('/lookup');
    await page.waitForSelector(sel('lookup-submit'));
    assert.equal(await page.locator(sel('current-user')).count(), 0);
  });
});

test('S2-018 S2-019 restaurant-select values are restaurant ids; date and party inputs', async () => {
  await reset2();
  const ids = (await get('/restaurants')).body.restaurants.map(r => r.id).sort();
  await withPage(async (page) => {
    await page.goto('/');
    await page.waitForSelector(sel('restaurant-select'));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="restaurant-select"] option[value]:not([value=""])').length >= n, ids.length);
    const values = await page.locator(`${sel('restaurant-select')} option`).evaluateAll(os => os.map(o => o.value).filter(Boolean));
    assert.deepEqual([...values].sort(), ids);
    await page.fill(sel('date-input'), THU);
    assert.equal(await page.inputValue(sel('date-input')), THU);
    assert.equal(await page.getAttribute(sel('party-size-input'), 'type'), 'number');
  });
});

test('S2-066 no horizontal scroll at 375 px and at desktop width through the whole flow', async () => {
  await world2();
  for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
    await withPage(async (page) => {
      for (const route of Object.keys(ROUTES)) {
        await page.goto(route);
        await page.waitForSelector(sel(ROUTES[route]));
        await noHorizontalScroll(page, `${route} @${viewport.width}`);
      }
      await logIn(page);
      await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
      await noHorizontalScroll(page, `grid @${viewport.width}`);
      await page.click(sel('slot-t_2-19:00'));
      await page.waitForSelector(sel('booking-form'));
      await noHorizontalScroll(page, `booking form @${viewport.width}`);
      await page.click(sel('booking-submit'));
      await page.waitForSelector(sel('confirmation'));
      await noHorizontalScroll(page, `confirmation @${viewport.width}`);
      const ref = await text(page, 'confirmation-reference');
      await page.goto('/lookup');
      await page.fill(sel('lookup-reference-input'), ref);
      await page.click(sel('lookup-submit'));
      await page.waitForSelector(sel('reservation-detail'));
      await noHorizontalScroll(page, `lookup @${viewport.width}`);
    }, { viewport });
    await world2();
  }
});

test('S2-067 every input has a visible label', async () => {
  await world2();
  const check = async (page, ids) => {
    for (const id of ids) {
      const label = await page.locator(sel(id)).first().evaluate((el) => {
        const shown = (n) => n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && n.textContent.trim();
        const fromLabels = [...(el.labels || [])].map(shown).find(Boolean);
        const byIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
          .map(i => document.getElementById(i)).map(shown).find(Boolean);
        return fromLabels || byIds || '';
      });
      assert.ok(label, `${id} has no visible label`);
    }
  };
  await withPage(async (page) => {
    await page.goto('/signup');
    await check(page, ['signup-email', 'signup-password', 'signup-display-name']);
    await page.goto('/login');
    await check(page, ['login-email', 'login-password']);
    await page.goto('/lookup');
    await check(page, ['lookup-reference-input']);
    await logIn(page);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await check(page, ['restaurant-select', 'date-input', 'party-size-input']);
    await page.click(sel('slot-t_2-19:00'));
    await page.waitForSelector(sel('booking-form'));
    await check(page, ['booking-party-size']);
  });
});

test('S2-068 keyboard focus is visible', async () => {
  await reset2();
  await withPage(async (page) => {
    await page.goto('/login');
    await page.waitForSelector(sel('login-email'));
    for (const id of ['login-email', 'login-submit']) {
      const before = await styleSig(page, id);
      let focused = false;
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      for (let i = 0; i < 25 && !focused; i++) {
        await page.keyboard.press('Tab');
        focused = await page.locator(sel(id)).first().evaluate(el => el === document.activeElement);
      }
      assert.ok(focused, `${id} is not reachable with the keyboard`);
      const ring = await page.locator(sel(id)).first().evaluate((el) => {
        const s = getComputedStyle(el);
        return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      });
      const after = await styleSig(page, id);
      assert.ok(ring && after !== before, `${id} shows no visible focus indicator`);
    }
  });
});

test('S2-069 navigation is consistent across the four routes', async () => {
  await reset2();
  await withPage(async (page) => {
    for (const route of Object.keys(ROUTES)) {
      await page.goto(route);
      await page.waitForSelector(sel(ROUTES[route]));
      const paths = await page.locator('a[href]').evaluateAll(as => as.map(a => new URL(a.href, location.href))
        .filter(u => u.origin === location.origin).map(u => u.pathname));
      for (const other of Object.keys(ROUTES).filter(r => r !== route)) {
        assert.ok(paths.includes(other), `${route} has no link to ${other} (links: ${paths})`);
      }
    }
  });
});

test('S2-073 pages load nothing from outside the service', async () => {
  const t = await world2();
  await book2(t.bob, { table_id: 't_3' });
  const origin = new URL(BASE_URL).origin;
  await withPage(async (page) => {
    const foreign = [];
    page.on('request', r => { const u = r.url(); if (/^https?:/.test(u) && new URL(u).origin !== origin) foreign.push(u); });
    for (const route of Object.keys(ROUTES)) { await page.goto(route); await page.waitForLoadState('networkidle'); }
    await logIn(page);
    await search(page, { date: THU, party: 2, readyCell: 'slot-t_2-19:00' });
    await page.click(sel('slot-t_2-19:00'));
    await page.waitForSelector(sel('booking-form'));
    await page.click(sel('booking-submit'));
    await page.waitForSelector(sel('confirmation'));
    await page.waitForLoadState('networkidle');
    assert.deepEqual(foreign, []);
  });
});

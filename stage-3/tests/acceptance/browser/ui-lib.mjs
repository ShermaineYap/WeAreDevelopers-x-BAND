// Browser helpers (Playwright, headless Chromium). Elements are found by data-testid only.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE_URL, USERS, PASSWORD } from '../lib2.mjs';

export * from '../lib2.mjs';

export const sel = (id) => `[data-testid="${id}"]`;

let browser;
export function useBrowser() {
  before(async () => {
    const origin = new URL(BASE_URL).origin;
    browser = await chromium.launch({
      channel: 'chromium',
      args: [`--unsafely-treat-insecure-origin-as-secure=${origin}`],
    });
  });
  after(async () => { await browser?.close(); });
}

/** A fresh context and page; closed afterwards. */
export async function withPage(fn, { viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  try {
    return await fn(page, context);
  } finally {
    await context.close();
  }
}

export async function logIn(page, user = USERS.ada) {
  await page.goto('/login');
  await page.fill(sel('login-email'), user.email);
  await page.fill(sel('login-password'), user.password ?? PASSWORD);
  await page.click(sel('login-submit'));
  await page.waitForSelector(sel('current-user'));
}

/** Runs a search and waits until `readyCell` (a testid) or no-slots shows. */
export async function search(page, { restaurant = 'r_pairs', date, party = 2, readyCell, stay = false } = {}) {
  if (!stay) await page.goto('/');
  await page.selectOption(sel('restaurant-select'), restaurant);
  await page.fill(sel('date-input'), date);
  await page.fill(sel('party-size-input'), String(party));
  await page.click(sel('search-button'));
  await page.waitForSelector(readyCell ? sel(readyCell) : `${sel('availability-grid')}, ${sel('no-slots')}`);
}

/** Waits until every listed cell carries the expected data-available value. */
export async function waitCells(page, expected, timeout = 10_000) {
  await page.waitForFunction((exp) => Object.entries(exp).every(([id, v]) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el && el.getAttribute('data-available') === v;
  }), expected, { timeout });
}

export async function visible(page, id) {
  return page.locator(sel(id)).first().isVisible().catch(() => false);
}

export async function text(page, id) {
  return ((await page.locator(sel(id)).first().textContent()) ?? '').trim();
}

/** Booking POSTs as the browser sends them (any path), with key and parsed body. */
export function recordBookings(page) {
  const log = [];
  page.on('request', async (r) => {
    if (!isBooking(r)) return;
    const headers = await r.allHeaders();
    log.push({ url: r.url(), key: headers['idempotency-key'], body: r.postDataJSON() });
  });
  return log;
}

export function isBooking(r) {
  if (r.method() !== 'POST' || r.url().includes('reservation-moves')) return false;
  const data = r.postData() || '';
  return data.includes('starts_at_local');
}

/**
 * Makes the next booking POSTs fail at the network level.
 * mode 'after': the request reaches the server (and commits) but the response is lost.
 * mode 'before': the request never reaches the server.
 */
export async function loseBookingResponses(page, mode) {
  const lost = [];
  const handler = async (route) => {
    const r = route.request();
    if (!isBooking(r)) return route.fallback();
    const entry = { key: (await r.allHeaders())['idempotency-key'], body: r.postDataJSON() };
    if (mode === 'after') {
      const resp = await route.fetch();
      entry.status = resp.status();
      entry.response = await resp.json().catch(() => undefined);
    }
    lost.push(entry);
    await route.abort('failed');
  };
  await page.route('**/*', handler);
  return { lost, restore: () => page.unroute('**/*', handler) };
}

/** A compact visual signature to compare states. */
export async function styleSig(page, id) {
  return page.locator(sel(id)).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.color, s.borderTopColor, s.borderTopWidth, s.outlineStyle, s.outlineColor,
      s.boxShadow, s.opacity, s.textDecorationLine, s.fontWeight, s.backgroundImage, s.cursor].join('|');
  });
}

/** textContent + aria-label + title of an element: its human-readable description. */
export async function describe(page, id) {
  return page.locator(sel(id)).first().evaluate((el) =>
    [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' '));
}

export async function noHorizontalScroll(page, where) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${where}: page scrolls horizontally (${sw} > ${iw})`);
}

export async function apiReservations(token) {
  const r = await fetch(`${BASE_URL}/reservations`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).reservations;
}

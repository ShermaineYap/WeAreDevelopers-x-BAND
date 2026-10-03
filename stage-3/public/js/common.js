// Shared by every screen: the signed-in session, API calls, the header, and formatting.
// The server is the only source of truth; nothing here invents a result.

const SESSION_KEY = 'tablekeeper.session';

/** The signed-in diner ({ token, user_id, display_name }) or null. */
export function getSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return value && typeof value.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token: session.token, user_id: session.user_id, display_name: session.display_name,
  }));
  renderHeader();
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  renderHeader();
}

/**
 * Calls the API. Resolves to { status, body } for every HTTP answer; rejects only when no
 * answer arrived (the network failed), which callers treat as an unknown outcome.
 */
export async function api(method, path, { body, key, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const session = getSession();
  if (auth && session) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(path, {
    method, headers, body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed };
}

/** A fresh Idempotency-Key; getRandomValues works on plain-http origins too. */
export function newIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `ui-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Tiny element builder: el('p', { class: 'x', dataset: { testid: 'y' } }, 'text', child). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'dataset') Object.assign(node.dataset, value);
    else if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** The server's error message, or a fallback in plain words. */
export function errorMessage(result, fallback) {
  const message = result && result.body && result.body.error && result.body.error.message;
  return typeof message === 'string' && message ? message : fallback;
}

// ---------- header ----------

export function renderHeader() {
  const session = getSession();
  const slot = document.getElementById('session');
  if (!slot) return;
  slot.replaceChildren();
  for (const link of document.querySelectorAll('[data-signed-out-only]')) link.hidden = Boolean(session);
  if (!session) return;
  slot.append(
    el('span', { class: 'session__user', 'data-testid': 'current-user' },
      el('span', { class: 'session__label' }, 'Signed in as '), el('strong', {}, session.display_name)),
    el('button', {
      type: 'button', class: 'btn btn--quiet', 'data-testid': 'logout-button',
      onclick: () => clearSession(),
    }, 'Log out'),
  );
}

// ---------- formatting ----------

/** "Thursday 8 October" for a local YYYY-MM-DD. */
export function formatDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

/** Human description of a local start: "Thursday 8 October at 19:00". */
export function formatLocalStart(startsAtLocal) {
  return `${formatDay(startsAtLocal.slice(0, 10))} at ${startsAtLocal.slice(11, 16)}`;
}

/** Table labels for a set of ids, joined as a seating: "Bar + Window". */
export function seatingName(restaurant, tableIds) {
  return tableIds.map((id) => {
    const index = restaurant.tables.findIndex((t) => t.id === id);
    const table = restaurant.tables[index];
    return table && table.label ? table.label : `Table ${index + 1}`;
  }).join(' + ');
}

export const guests = (n) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

renderHeader();

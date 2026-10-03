// `/`: search, availability grid, booking form and confirmation.
//
// Rules this module keeps:
// - Only the latest search may paint the grid (a sequence number drops late responses).
// - The booking form keeps its inputs across conflicts and refreshes.
// - A booking's retry identity is its exact body: an unchanged form reuses the same
//   Idempotency-Key; any change mints a new one.
// - A lost response is "uncertain", never a success or a refusal; the server decides.
import {
  api, el, errorMessage, formatDay, formatLocalStart, getSession, guests, newIdempotencyKey, seatingName,
} from './common.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const form = document.getElementById('search-form');
const notice = document.getElementById('search-notice');
const results = document.getElementById('results');
const panel = document.getElementById('booking-panel');
const inputs = {
  restaurant: document.getElementById('restaurant'),
  date: document.getElementById('date'),
  party: document.getElementById('party'),
};

const state = {
  /** Number of the latest search; responses for any other number are ignored. */
  seq: 0,
  /** The latest requested query { restaurantId, date, party }. */
  query: null,
  /** What the grid shows: { query, restaurant, availability }. */
  shown: null,
  /** The chosen seating: { tableIds, startsAtLocal, restaurant, party }. */
  selection: null,
  /** Retry identity of the last submitted form: { json, key }. */
  attempt: null,
  submitting: false,
};

// ---------- search ----------

function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readQuery() {
  const restaurantId = inputs.restaurant.value;
  const date = inputs.date.value;
  const party = inputs.party.value.trim();
  if (!restaurantId) return { error: 'Choose a restaurant.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a date.' };
  if (!/^\d+$/.test(party) || Number(party) < 1) return { error: 'Enter how many guests are coming (at least 1).' };
  return { query: { restaurantId, date, party: Number(party) } };
}

function showSearchProblem(message) {
  results.removeAttribute('aria-busy');
  results.replaceChildren(el('div', { class: 'alert alert--refused', role: 'alert' }, message));
}

/** Runs a search. `refresh` re-reads the shown query without blanking the grid. */
async function runSearch(query, { refresh = false } = {}) {
  const seq = ++state.seq;
  state.query = query;
  results.setAttribute('aria-busy', 'true');
  if (!refresh) {
    results.replaceChildren(el('div', { class: 'loading', role: 'status' },
      el('span', { class: 'loading__dot', 'aria-hidden': 'true' }), 'Checking tables…'));
  }
  // explain=true lets the server say why each table is unavailable, under the policy that
  // applies to the date (capacities can differ from the restaurant's fixture).
  const params = new URLSearchParams({
    restaurant_id: query.restaurantId, date: query.date, party_size: String(query.party), explain: 'true',
  });
  let availability;
  let restaurant;
  try {
    [availability, restaurant] = await Promise.all([
      api('GET', `/availability?${params}`),
      api('GET', `/restaurants/${encodeURIComponent(query.restaurantId)}`),
    ]);
  } catch {
    if (seq === state.seq) showSearchProblem('We could not reach the restaurant. Check your connection and try again.');
    return;
  }
  if (seq !== state.seq) return; // a newer search owns the screen
  if (availability.status !== 200 || restaurant.status !== 200) {
    showSearchProblem(errorMessage(availability.status !== 200 ? availability : restaurant,
      'Those tables could not be loaded. Please try again.'));
    return;
  }
  state.shown = { query, restaurant: restaurant.body, availability: availability.body };
  renderGrid();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  notice.replaceChildren();
  const { query, error } = readQuery();
  if (error) {
    showSearchProblem(error);
    return;
  }
  // A new search describes a new choice: close any open booking form.
  state.selection = null;
  renderPanel();
  runSearch(query);
});

/** Re-reads availability for the latest query after a write, keeping the form open. */
function refreshGrid() {
  if (state.query) runSearch(state.query, { refresh: true });
}

// ---------- grid ----------

const CAUSE_TEXT = { available: 'Available', booked: 'Booked', small: 'Too small' };

/** A cell; `capacity` is shown when the server reported it (available seatings). */
function cell({ restaurant, tableIds, startsAtLocal, capacity, cause }) {
  const time = startsAtLocal.slice(11, 16);
  const name = seatingName(restaurant, tableIds);
  const available = cause === 'available';
  const combined = tableIds.length > 1;
  const selected = available && Boolean(state.selection) && state.selection.startsAtLocal === startsAtLocal
    && state.selection.tableIds.join('+') === tableIds.join('+') && state.selection.restaurant.id === restaurant.id;
  return el('button', {
    type: 'button',
    class: `cell cell--${cause}${combined ? ' cell--combo' : ''}${selected ? ' is-selected' : ''}`,
    'data-testid': `slot-${tableIds.join('+')}-${time}`,
    'data-available': String(available),
    'aria-disabled': available ? false : 'true',
    'aria-pressed': available ? String(selected) : false,
    'aria-label': `${name}, ${combined ? 'tables together, ' : ''}${capacity ? `seats ${capacity}, ` : ''}${time}: ${CAUSE_TEXT[cause].toLowerCase()}`,
    onclick: () => { if (available) choose(tableIds, startsAtLocal); },
  },
  el('span', { class: 'cell__name' }, name),
  capacity ? el('span', { class: 'cell__meta' }, `${combined ? 'Together · ' : ''}Seats ${capacity}`) : null,
  el('span', { class: 'cell__state' }, selected ? 'Selected' : CAUSE_TEXT[cause]));
}

function renderGrid() {
  const { query, restaurant, availability } = state.shown;
  results.removeAttribute('aria-busy');
  const day = formatDay(query.date);
  if (availability.slots.length === 0) {
    const weekday = WEEKDAYS[new Date(`${query.date}T12:00:00Z`).getUTCDay()];
    const open = restaurant.opening_hours.some((h) => h.weekday === weekday);
    results.replaceChildren(el('div', { class: 'empty-state empty-state--closed', 'data-testid': 'no-slots' },
      el('p', { class: 'empty-state__title' }, open ? `No bookable times on ${day}` : `Closed on ${day}`),
      el('p', {}, open
        ? `${restaurant.name} has no times left that day. Try another date.`
        : `${restaurant.name} is closed that day. Try another date.`)));
    renderPanel();
    return;
  }
  const rows = availability.slots.map((slot) => {
    const optionFor = (ids) => slot.available_options.find((o) => o.table_ids.join('+') === ids.join('+'));
    const singles = restaurant.tables.map((table) => {
      const option = optionFor([table.id]);
      const reason = (slot.explain || []).find((e) => e.table_id === table.id);
      const tooSmall = reason ? !reason.rules[0].holds : false;
      const cause = slot.available_table_ids.includes(table.id) ? 'available' : tooSmall ? 'small' : 'booked';
      return cell({ restaurant, tableIds: [table.id], startsAtLocal: slot.starts_at_local, capacity: option && option.capacity, cause });
    });
    // Combined seatings appear only when the declared pair is free for this party.
    const pairs = (restaurant.combinable || [])
      .map((pair) => optionFor(pair))
      .filter(Boolean)
      .map((option) => cell({
        restaurant, tableIds: option.table_ids, startsAtLocal: slot.starts_at_local, capacity: option.capacity, cause: 'available',
      }));
    return el('li', { class: 'slot' },
      el('p', { class: 'slot__time' }, slot.starts_at_local.slice(11, 16)),
      el('div', { class: 'slot__cells' }, singles, pairs));
  });
  results.replaceChildren(el('div', { class: 'grid', 'data-testid': 'availability-grid' },
    el('div', { class: 'grid__head' },
      el('h2', {}, restaurant.name),
      el('p', {}, `${day} · ${guests(query.party)}`)),
    el('ul', { class: 'legend', 'aria-label': 'Key' },
      el('li', {}, el('span', { class: 'swatch swatch--available' }), 'Available'),
      el('li', {}, el('span', { class: 'swatch swatch--selected' }), 'Your choice'),
      el('li', {}, el('span', { class: 'swatch swatch--booked' }), 'Booked'),
      el('li', {}, el('span', { class: 'swatch swatch--small' }), 'Too small for your party')),
    el('ol', { class: 'slots' }, rows)));
  renderPanel();
}

// ---------- booking form ----------

let statusRegion = null;
let partyInput = null;

function choose(tableIds, startsAtLocal) {
  notice.replaceChildren();
  if (!getSession()) {
    notice.append(el('p', { class: 'alert alert--refused', role: 'alert', 'data-testid': 'auth-error' },
      'Log in to book this table. ', el('a', { href: '/login' }, 'Log in'), ' or ',
      el('a', { href: '/signup' }, 'create an account'), '.'));
    return;
  }
  state.selection = { tableIds, startsAtLocal, restaurant: state.shown.restaurant, party: state.shown.query.party };
  renderGrid();
  renderBookingForm();
  panel.scrollIntoView({ block: 'nearest' }); // instant: the form is ready the moment it shows
}

function renderPanel() {
  if (state.selection) return; // the open form stays exactly as the diner left it
  panel.replaceChildren();
  statusRegion = null;
  partyInput = null;
  if (state.shown && state.shown.availability.slots.length > 0) {
    panel.append(el('div', { class: 'panel-hint' },
      el('p', { class: 'empty-state__title' }, 'Pick a table'),
      el('p', {}, 'Choose any available time and table in the grid to book it.')));
  }
}

function renderBookingForm() {
  const { restaurant, tableIds, startsAtLocal, party } = state.selection;
  partyInput = el('input', {
    id: 'booking-party', type: 'number', min: '1', step: '1', inputmode: 'numeric',
    value: String(party), 'data-testid': 'booking-party-size',
  });
  statusRegion = el('div', { class: 'booking__status', 'aria-live': 'polite' });
  panel.replaceChildren(el('section', { class: 'booking', 'data-testid': 'booking-form' },
    el('h2', {}, 'Your table'),
    el('p', { class: 'booking__summary', 'data-testid': 'booking-summary' },
      el('strong', {}, seatingName(restaurant, tableIds)), ` at ${restaurant.name}`,
      el('br'), formatLocalStart(startsAtLocal)),
    el('form', { class: 'stack', novalidate: true, onsubmit: submitBooking },
      el('div', { class: 'field' }, el('label', { for: 'booking-party' }, 'Guests'), partyInput),
      el('button', { class: 'btn btn--primary btn--block', type: 'submit', 'data-testid': 'booking-submit' },
        'Book this table')),
    statusRegion));
}

const REFUSALS = {
  table_unavailable: 'This table is no longer free at that time. Choose another table or time — your details are kept.',
  party_exceeds_capacity: 'That is more guests than this seating holds. Choose a larger table or a combined seating.',
};

function showOutcome(outcome) {
  if (!statusRegion) return;
  const { restaurant } = state.selection;
  let content;
  switch (outcome.kind) {
    case 'pending':
      content = el('p', { class: 'alert alert--pending', role: 'status' },
        el('span', { class: 'loading__dot', 'aria-hidden': 'true' }), 'Booking your table…');
      break;
    case 'refused':
      content = el('p', { class: 'alert alert--refused', role: 'alert', 'data-testid': 'booking-error' }, outcome.message);
      break;
    case 'uncertain':
      content = el('div', { class: 'alert alert--uncertain', role: 'status', 'data-testid': 'booking-uncertain' },
        el('strong', {}, 'We could not confirm your booking yet.'),
        el('span', {}, ' The connection dropped before the restaurant answered, so the table may or may not be booked. '
          + 'Press “Book this table” again to check — you will not be booked twice.'));
      break;
    case 'confirmed': {
      const r = outcome.reservation;
      const tableIds = r.table_ids || [r.table_id];
      content = el('div', { class: 'confirmation', 'data-testid': 'confirmation', role: 'status' },
        el('p', { class: 'confirmation__eyebrow' }, 'You’re booked'),
        el('p', { class: 'confirmation__ref' }, 'Reference ',
          el('strong', { 'data-testid': 'confirmation-reference' }, r.reference)),
        el('p', { class: 'confirmation__details', 'data-testid': 'confirmation-details' },
          `${restaurant.name} · ${formatLocalStart(r.starts_at_local)} · ${guests(r.party_size)} · `,
          el('span', { 'data-testid': 'confirmation-tables' }, seatingName(restaurant, tableIds))),
        el('p', { class: 'confirmation__hint' }, 'Keep this reference to look up or cancel your booking.'));
      break;
    }
    default:
      content = null;
  }
  statusRegion.replaceChildren(...(content ? [content] : []));
}

async function submitBooking(event) {
  event.preventDefault();
  if (state.submitting || !state.selection) return;
  const { restaurant, tableIds, startsAtLocal } = state.selection;
  const partyText = partyInput.value.trim();
  if (!/^\d+$/.test(partyText) || Number(partyText) < 1) {
    showOutcome({ kind: 'refused', message: 'Enter how many guests are coming (at least 1).' });
    return;
  }
  if (!getSession()) {
    showOutcome({ kind: 'refused', message: 'Log in to book this table.' });
    return;
  }
  const body = {
    restaurant_id: restaurant.id,
    ...(tableIds.length === 1 ? { table_id: tableIds[0] } : { table_ids: tableIds }),
    starts_at_local: startsAtLocal,
    party_size: Number(partyText),
  };
  const json = JSON.stringify(body);
  if (!state.attempt || state.attempt.json !== json) state.attempt = { json, key: newIdempotencyKey() };
  state.submitting = true;
  showOutcome({ kind: 'pending' });
  let result;
  try {
    result = await api('POST', '/reservations', { body: json, key: state.attempt.key, auth: true });
  } catch {
    showOutcome({ kind: 'uncertain' });
    return;
  } finally {
    state.submitting = false;
  }
  if ((result.status === 200 || result.status === 201) && result.body && result.body.reference) {
    showOutcome({ kind: 'confirmed', reservation: result.body });
  } else if (result.status >= 500 || !result.body) {
    showOutcome({ kind: 'uncertain' });
    return;
  } else {
    const code = result.body.error && result.body.error.code;
    showOutcome({
      kind: 'refused',
      message: code === 'unauthenticated' ? 'Your session has ended. Log in again to book.'
        : REFUSALS[code] || errorMessage(result, 'The restaurant could not take this booking.'),
    });
  }
  refreshGrid();
}

inputs.date.value = todayLocal();

// `/lookup`: find one of your bookings by reference, and cancel it.
// Every view of the booking is read from the server, including right after a cancel.
import { api, el, errorMessage, formatLocalStart, getSession, guests, seatingName } from './common.js';

const form = document.getElementById('lookup-form');
const input = document.getElementById('lookup-reference');
const out = document.getElementById('lookup-result');

/** Number of the latest lookup; older answers are ignored. */
let seq = 0;

function showError(message, { keepDetail = false } = {}) {
  const error = el('p', { class: 'alert alert--refused', role: 'alert', 'data-testid': 'reservation-error' }, ...message);
  const detail = keepDetail ? out.querySelector('[data-testid="reservation-detail"]') : null;
  out.replaceChildren(...(detail ? [error, detail] : [error]));
}

function signInPrompt() {
  return ['Log in to see your bookings. ', el('a', { href: '/login' }, 'Log in'), ' or ',
    el('a', { href: '/signup' }, 'create an account'), '.'];
}

/**
 * Reads the booking (and its restaurant, for names) and renders it. `quiet` keeps the
 * current view on screen while re-reading.
 */
async function load(reference, { quiet = false } = {}) {
  const mine = ++seq;
  if (!getSession()) {
    showError(signInPrompt());
    return;
  }
  if (!quiet) {
    out.replaceChildren(el('div', { class: 'loading', role: 'status' },
      el('span', { class: 'loading__dot', 'aria-hidden': 'true' }), 'Finding your booking…'));
  }
  let booking;
  let restaurant;
  try {
    booking = await api('GET', `/reservations/${encodeURIComponent(reference)}`, { auth: true });
    if (booking.status === 200) restaurant = await api('GET', `/restaurants/${encodeURIComponent(booking.body.restaurant_id)}`);
  } catch {
    if (mine === seq) showError(['We could not reach Tablekeeper. Check your connection and try again.']);
    return;
  }
  if (mine !== seq) return;
  if (booking.status === 401) {
    showError(['Your session has ended. ', ...signInPrompt()]);
    return;
  }
  if (booking.status !== 200) {
    showError([`We could not find a booking with reference ${reference} on your account.`]);
    return;
  }
  render(booking.body, restaurant && restaurant.status === 200 ? restaurant.body : null);
}

function render(r, restaurant) {
  const tableIds = r.table_ids || [r.table_id];
  const confirmed = r.status === 'confirmed';
  out.replaceChildren(el('article', { class: `reservation reservation--${r.status}`, 'data-testid': 'reservation-detail' },
    el('header', { class: 'reservation__head' },
      el('div', {},
        el('p', { class: 'reservation__eyebrow' }, 'Booking reference'),
        el('p', { class: 'reservation__ref' }, r.reference)),
      el('span', { class: `status status--${r.status}`, 'data-testid': 'reservation-status' }, r.status)),
    el('dl', { class: 'reservation__facts' },
      el('div', {}, el('dt', {}, 'Restaurant'), el('dd', {}, restaurant ? restaurant.name : 'Restaurant')),
      el('div', {}, el('dt', {}, 'When'), el('dd', {}, formatLocalStart(r.starts_at_local))),
      el('div', {}, el('dt', {}, tableIds.length > 1 ? 'Tables' : 'Table'),
        el('dd', { 'data-testid': 'reservation-tables' }, restaurant ? seatingName(restaurant, tableIds) : '')),
      el('div', {}, el('dt', {}, 'Party'), el('dd', {}, guests(r.party_size)))),
    confirmed
      ? el('button', {
        type: 'button', class: 'btn btn--danger', 'data-testid': 'reservation-cancel-button',
        onclick: (event) => cancel(r.reference, event.currentTarget),
      }, 'Cancel booking')
      : el('p', { class: 'reservation__note' }, 'This booking is cancelled and the table has been released.')));
}

async function cancel(reference, button) {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Cancelling…';
  let result;
  try {
    result = await api('POST', `/reservations/${encodeURIComponent(reference)}/cancel`, { body: {}, auth: true });
  } catch {
    result = null;
  }
  if (result && result.status === 200) {
    await load(reference, { quiet: true }); // re-read the server's state rather than editing the view
    return;
  }
  button.removeAttribute('aria-busy');
  button.textContent = 'Cancel booking';
  const code = result && result.body && result.body.error && result.body.error.code;
  const message = !result ? 'We could not reach Tablekeeper, so the booking may not be cancelled. Look it up again to check.'
    : code === 'cutoff_passed' ? 'This booking is too close to its start time to cancel online. Please contact the restaurant.'
      : errorMessage(result, 'The booking could not be cancelled.');
  showError([message], { keepDetail: true });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const reference = input.value.trim().toUpperCase();
  if (!reference) {
    showError(['Enter the booking reference from your confirmation.']);
    return;
  }
  load(reference);
});

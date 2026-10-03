// Shared behaviour of the signup and login screens: submit, show `auth-error` only when
// there is an error, and sign the diner in place on success.
import { api, el, errorMessage, saveSession } from './common.js';

/**
 * Wires `form` to POST `path` with the body `read()` returns. `failure(result)` turns a
 * refusal into words.
 */
export function wireAuthForm({ form, path, read, failure, welcome }) {
  const feedback = document.getElementById('auth-feedback');
  const submit = form.querySelector('button[type="submit"]');
  let busy = false;

  const show = (node) => feedback.replaceChildren(...(node ? [node] : []));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.setAttribute('aria-busy', 'true');
    show(el('p', { class: 'alert alert--pending', role: 'status' },
      el('span', { class: 'loading__dot', 'aria-hidden': 'true' }), 'One moment…'));
    let result;
    try {
      result = await api('POST', path, { body: read() });
    } catch {
      result = null;
    } finally {
      busy = false;
      submit.removeAttribute('aria-busy');
    }
    if (result && (result.status === 200 || result.status === 201) && result.body && result.body.token) {
      saveSession(result.body);
      show(el('div', { class: 'confirmation', role: 'status' },
        el('p', { class: 'confirmation__eyebrow' }, welcome(result.body.display_name)),
        el('p', {}, el('a', { class: 'btn btn--primary', href: '/' }, 'Find a table'), ' ',
          el('a', { class: 'btn btn--quiet', href: '/lookup' }, 'Look up a booking'))));
      return;
    }
    const message = result ? failure(result) || errorMessage(result, 'Something went wrong. Please try again.')
      : 'We could not reach Tablekeeper. Check your connection and try again.';
    show(el('p', { class: 'alert alert--refused', role: 'alert', 'data-testid': 'auth-error' }, message));
  });
}

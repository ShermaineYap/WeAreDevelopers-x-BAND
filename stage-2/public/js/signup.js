// `/signup`
import { wireAuthForm } from './auth-form.js';

const MIN_PASSWORD_LENGTH = 8;

wireAuthForm({
  form: document.getElementById('signup-form'),
  path: '/auth/signup',
  read: () => {
    const body = {
      email: document.getElementById('signup-email').value.trim(),
      password: document.getElementById('signup-password').value,
    };
    const name = document.getElementById('signup-name').value.trim();
    if (name) body.display_name = name;
    return body;
  },
  failure: (result) => {
    const code = result.body && result.body.error && result.body.error.code;
    if (code === 'email_taken') return 'An account with that email already exists. Log in instead.';
    if (code === 'validation_failed') {
      return `Enter an email like name@example.com and a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return null;
  },
  welcome: (name) => `Welcome, ${name}`,
});

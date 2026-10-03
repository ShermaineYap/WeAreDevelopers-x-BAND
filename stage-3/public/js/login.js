// `/login`
import { wireAuthForm } from './auth-form.js';

wireAuthForm({
  form: document.getElementById('login-form'),
  path: '/auth/login',
  read: () => ({
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
  }),
  failure: (result) => (result.status === 401 ? 'That email and password do not match an account.' : null),
  welcome: (name) => `Welcome back, ${name}`,
});

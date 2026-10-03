// Server-rendered HTML for the four screen routes (stage 2). Each page shares one layout
// and stylesheet and loads one small vanilla-JS module for its screen.
import { listRestaurants } from './state';

export type Screen = 'search' | 'signup' | 'login' | 'lookup';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const NAV: { href: string; label: string; screen: Screen; signedOutOnly?: boolean }[] = [
  { href: '/', label: 'Find a table', screen: 'search' },
  { href: '/lookup', label: 'My booking', screen: 'lookup' },
  { href: '/login', label: 'Log in', screen: 'login', signedOutOnly: true },
  { href: '/signup', label: 'Sign up', screen: 'signup', signedOutOnly: true },
];

const TITLES: Record<Screen, string> = {
  search: 'Find a table',
  signup: 'Create an account',
  login: 'Log in',
  lookup: 'Find your booking',
};

function layout(screen: Screen, main: string): string {
  const nav = NAV.map((item) => `<a href="${item.href}"${item.screen === screen ? ' aria-current="page"' : ''}`
    + `${item.signedOutOnly ? ' data-signed-out-only' : ''}>${item.label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[screen]} · Tablekeeper</title>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/js/${screen}.js"></script>
</head>
<body data-screen="${screen}">
<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="/"><span class="brand__mark" aria-hidden="true">T</span>Tablekeeper</a>
    <nav class="site-nav" aria-label="Main">${nav}</nav>
    <div class="session" id="session" aria-live="polite"></div>
  </div>
</header>
<main class="page page--${screen}">
${main}
</main>
<footer class="site-footer"><p>Tablekeeper · Book a table at your neighbourhood favourites</p></footer>
</body>
</html>
`;
}

function searchMain(): string {
  const options = listRestaurants()
    .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('');
  return `<section class="hero">
  <h1>Find a table</h1>
  <p class="lede">Choose a restaurant, a day and how many of you are coming. Every open table is shown with its time.</p>
  <form class="search-form" id="search-form" novalidate>
    <div class="field field--wide">
      <label for="restaurant">Restaurant</label>
      <select id="restaurant" name="restaurant" data-testid="restaurant-select">${options}</select>
    </div>
    <div class="field">
      <label for="date">Date</label>
      <input id="date" name="date" type="date" data-testid="date-input">
    </div>
    <div class="field field--narrow">
      <label for="party">Guests</label>
      <input id="party" name="party" type="number" min="1" step="1" inputmode="numeric" value="2" data-testid="party-size-input">
    </div>
    <button class="btn btn--primary" type="submit" data-testid="search-button">Show tables</button>
  </form>
  <div id="search-notice"></div>
</section>
<div class="workspace">
  <section class="results" id="results" aria-live="polite" aria-label="Availability">
    <div class="empty-state">
      <p class="empty-state__title">Your tables will appear here</p>
      <p>Pick a restaurant, date and party size, then choose “Show tables”.</p>
    </div>
  </section>
  <aside class="booking-panel" id="booking-panel" aria-label="Your booking"></aside>
</div>`;
}

function signupMain(): string {
  return `<section class="auth-card">
  <h1>Create an account</h1>
  <p class="lede">Book in seconds and keep track of your reservations.</p>
  <form class="stack" id="signup-form" novalidate>
    <div class="field">
      <label for="signup-email">Email</label>
      <input id="signup-email" type="email" autocomplete="email" data-testid="signup-email">
    </div>
    <div class="field">
      <label for="signup-password">Password</label>
      <input id="signup-password" type="password" autocomplete="new-password" aria-describedby="signup-password-hint" data-testid="signup-password">
      <p class="hint" id="signup-password-hint">At least 8 characters.</p>
    </div>
    <div class="field">
      <label for="signup-name">Your name</label>
      <input id="signup-name" type="text" autocomplete="name" data-testid="signup-display-name">
    </div>
    <div id="auth-feedback"></div>
    <button class="btn btn--primary" type="submit" data-testid="signup-submit">Create account</button>
  </form>
  <p class="aside-link">Already have an account? <a href="/login">Log in</a></p>
</section>`;
}

function loginMain(): string {
  return `<section class="auth-card">
  <h1>Log in</h1>
  <p class="lede">Welcome back. Log in to book and manage your tables.</p>
  <form class="stack" id="login-form" novalidate>
    <div class="field">
      <label for="login-email">Email</label>
      <input id="login-email" type="email" autocomplete="email" data-testid="login-email">
    </div>
    <div class="field">
      <label for="login-password">Password</label>
      <input id="login-password" type="password" autocomplete="current-password" data-testid="login-password">
    </div>
    <div id="auth-feedback"></div>
    <button class="btn btn--primary" type="submit" data-testid="login-submit">Log in</button>
  </form>
  <p class="aside-link">New here? <a href="/signup">Create an account</a></p>
</section>`;
}

function lookupMain(): string {
  return `<section class="auth-card auth-card--wide">
  <h1>Find your booking</h1>
  <p class="lede">Enter the reference from your confirmation to see or cancel your booking.</p>
  <form class="lookup-form" id="lookup-form" novalidate>
    <div class="field field--wide">
      <label for="lookup-reference">Booking reference</label>
      <input id="lookup-reference" type="text" autocomplete="off" spellcheck="false" autocapitalize="characters" data-testid="lookup-reference-input">
    </div>
    <button class="btn btn--primary" type="submit" data-testid="lookup-submit">Find booking</button>
  </form>
  <div id="lookup-result" aria-live="polite"></div>
</section>`;
}

const MAINS: Record<Screen, () => string> = {
  search: searchMain, signup: signupMain, login: loginMain, lookup: lookupMain,
};

export function renderPage(screen: Screen): string {
  return layout(screen, MAINS[screen]());
}

export const SCREEN_ROUTES: Record<string, Screen> = {
  '/': 'search', '/signup': 'signup', '/login': 'login', '/lookup': 'lookup',
};

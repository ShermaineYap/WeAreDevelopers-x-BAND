# Tablekeeper — stage 2

HTTP API plus browser screens for restaurant availability, bookings (single tables and
declared combinable pairs), cancellations, amendments and atomic multi-booking moves.
Node 22 + TypeScript, Express, an in-memory `better-sqlite3` store, `luxon` for time zones
and `bcrypt` for password hashing. State is ephemeral.

Screens: `/` (search, availability grid, booking), `/signup`, `/login`, `/lookup`. They are
server-rendered HTML with one small vanilla-JS module per screen and one shared stylesheet,
all served from the image (`/assets/...`); pages make no requests outside the service.

## Build and run

From this folder (`stage-2/`):

```sh
docker build -t tablekeeper-stage-2 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-2
```

Open http://localhost:8080/ in a browser.

The service listens on `0.0.0.0:$PORT` (default `8080`) and needs no network at run time.
`GET /health` returns `200 {"status":"ok"}` once it can serve requests (well under a second).
`POST /_test/reset`, `GET /_test/export` and `POST /_test/import` are enabled in the image.

## Acceptance tests

With the service running on port 8080, from the repository root:

```sh
# API (stage-1 regression + stage-2)
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-2/tests/acceptance/*.test.mjs
# Browser (one-time: npm --prefix stage-2/tests/acceptance ci)
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-2/tests/acceptance/browser/*.test.mjs
# Upgrade from a stage-1 export: run the stage-1 image on 8081 and add
#   PREVIOUS_BASE_URL=http://localhost:8081 to the API command.
```

## Layout

| Path | Responsibility |
|---|---|
| `src/server.ts` | Process entry: reads `PORT`, listens on `0.0.0.0` |
| `src/app.ts` | Routes, body decoding, order of request-level checks, error envelope |
| `src/pages.ts` | Server-rendered HTML for the four screen routes |
| `public/app.css` | The one shared stylesheet |
| `public/js/common.js` | Session, API calls, header, formatting shared by every screen |
| `public/js/search.js` | `/`: search, grid, booking form, uncertain/retry handling, confirmation |
| `public/js/login.js`, `signup.js`, `auth-form.js` | `/login`, `/signup` |
| `public/js/lookup.js` | `/lookup`: find and cancel a booking |
| `src/auth.ts` | Signup, login, bcrypt hashing, bearer tokens (stored as SHA-256 digests) |
| `src/idempotency.ts` | `Idempotency-Key` rules, canonical JSON comparison, stored responses |
| `src/reservations.ts` | Create, list, read, cancel, amend and batch-move rules |
| `src/schedule.ts` | Slot grid, opening hours, cutoff, half-open occupancy, availability |
| `src/time.ts` | Local date/time parsing and IANA zone resolution (gap → none, overlap → first) |
| `src/state.ts` | Whole-state records: replace (reset/import), snapshot (export), import validation |
| `src/fixture.ts` | Reset fixture validation and seeding |
| `src/fields.ts` | Request field reading: wrong type 400, missing/invalid 422, table sets |
| `src/db.ts` | SQLite schema and the transaction helper |

## Interpretations

- A successful `PATCH` returns 200 with the full reservation; an empty `PATCH` changes nothing.
- Request checks run in this order: bearer token (401), body parses as a JSON object (400),
  `Idempotency-Key` present (400) and at most 255 characters (422), idempotency record
  (replay 200 / reuse 409), then field types (400), field values (422), resources (404),
  local-time existence, opening hours, slot grid, capacity, and finally occupancy (409).
- Idempotency records are scoped per user and per path, so the same key on the other write
  path is a new request.
- Amendments and moves check, per booking: cancelled (409), cutoff against the current
  start (409), then the ordinary create validation. In a batch the first failing item in
  input order decides the error; occupancy (409 `table_unavailable`) is judged last, on the
  resulting state.
- Reset fixtures are validated whole (IDs ≤ 64 chars, seeded references `A-Z0-9{6,12}`,
  known users/restaurants/tables, existing local times, no overlapping seeds); any defect is
  422 and leaves state unchanged.
- Import accepts only a `state` this service exported (stage-2 format, or the stage-1 format,
  which is upgraded: `table_id` becomes a one-member `table_ids`, restaurants get no pairs);
  anything else is 422 and leaves state unchanged. Stage-1 idempotent receipts replay their
  original bodies unchanged. Tokens issued before a reset or import of other state stop working.
- Table sets: `table_id` or `table_ids` (both → 422). Not an array / non-string ids → 400;
  empty or repeated ids → 422 `validation_failed`; more than two → 422 `combination_not_allowed`;
  any unknown id → 404; an undeclared pair → 422 `combination_not_allowed`. A pair is stored
  and returned in `combinable` order; `table_id` is returned only for one-table sets.
- Seeds may carry `table_id` or `table_ids` and `status` (`confirmed` default, or `cancelled`);
  only confirmed seeds must not overlap.
- Signup `display_name` is optional; without one the account is named after the email's local part.
- Every write (create, cancel, amend, moves, signup, login, reset, import) runs in one
  synchronous SQLite transaction.
- UI: the session token is kept in `localStorage`; a booking's retry identity (body and
  Idempotency-Key) is kept in the page, so an unchanged resubmit or a retry after a lost
  response reuses the key, and any change to the form uses a new one. Only the latest search
  may paint the grid. Combined seatings appear in the grid only when the pair is free for the
  party. Clicking a table while signed out shows `auth-error` with links to log in or sign up.

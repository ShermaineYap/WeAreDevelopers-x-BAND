# Tablekeeper — stage 4

HTTP API plus browser screens for restaurant availability, bookings (single tables and
declared combinable pairs), cancellations, amendments and atomic multi-booking moves; dated
booking policies with accepted terms and revisions, availability explanations, reservation
history and recurring reservations (series); seating changes after a table closure (replan
previews and atomic plan application) and recurring-reservation amendments.
Node 22 + TypeScript, Express, an in-memory `better-sqlite3` store, `luxon` for time zones
and `bcrypt` for password hashing. State is ephemeral.

Screens: `/` (search, availability grid, booking), `/signup`, `/login`, `/lookup`. They are
server-rendered HTML with one small vanilla-JS module per screen and one shared stylesheet,
all served from the image (`/assets/...`); pages make no requests outside the service.

## Build and run

From this folder (`stage-4/`):

```sh
docker build -t tablekeeper-stage-4 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-4
```

Open http://localhost:8080/ in a browser.

The service listens on `0.0.0.0:$PORT` (default `8080`) and needs no network at run time.
`GET /health` returns `200 {"status":"ok"}` once it can serve requests (well under a second).
`POST /_test/reset`, `GET /_test/export` and `POST /_test/import` are enabled in the image.

## Acceptance tests

With the service running on port 8080, from the repository root:

```sh
# API (stage-1..3 regression + stage-4)
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-4/tests/acceptance/*.test.mjs
# Browser (one-time: npm --prefix stage-4/tests/acceptance ci)
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-4/tests/acceptance/browser/*.test.mjs
# Upgrades: run the stage-3, stage-2 and stage-1 images (built from their folders) on 8083,
# 8082 and 8081, and add to the API command:
#   PREVIOUS_BASE_URL=http://localhost:8083 PREVIOUS_STAGE2_BASE_URL=http://localhost:8082 \
#   PREVIOUS_STAGE1_BASE_URL=http://localhost:8081
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
| `src/terms.ts`, `src/hours.ts` | Booking rules: policy 0, accepted terms, policy and opening-hours validation |
| `src/policies.ts` | Policy publication, the public list, and policy selection by local start date |
| `src/history.ts` | Reservation history entries and change computation |
| `src/series.ts` | Recurring reservations: adoption, reads and amendment |
| `src/replans.ts` | Closure replans: exhaustive seating search, preview, atomic apply, public closures |
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
- Every write (create, cancel, amend, moves, policy publication, series adoption, signup,
  login, reset, import) runs in one synchronous SQLite transaction.
- Stage 3 order of checks for PATCH and each move item: not yours (404), invalid
  `expected_revision` (422), stale `expected_revision` (409 `stale_revision`), cancelled (409),
  the old accepted cutoff (409), field types and values, then no-op detection (resulting values
  equal the current ones, a reversed declared pair included), then the resulting fields under
  the policy for the resulting start date, then occupancy. A no-op returns the booking
  unchanged and records nothing.
- Policy publication: auth (401), body, key (400/422), idempotency, unknown restaurant (404),
  non-manager (403), then validation (422, every invalid value). Versions count per restaurant
  and are allocated only on success. `GET /restaurants/{id}` keeps returning the fixture.
- Series: field validation (422), anchor not yours (404), cancelled (409), already in a series
  (409 `already_in_series`), past the accepted cutoff (409), then each generated occurrence in
  index order with full booking validation and occupancy; the first failure decides.
- History, decision and `GET /series/{id}` answer 404 to anyone but the owner, including
  callers without a token. History `at` is UTC (`+00:00`) at second precision.
- Restaurant revision (not readable until stage 4) counts each successful booking, real
  amendment, cancellation, policy publication, series adoption and changing move batch.
- Bookings seeded by a fixture or imported from stage-1/stage-2 exports get revision 1, policy-0
  terms and a synthesised `created` (and `cancelled`) history entry at their creation time.
- Stage 4 replans: considered bookings are every confirmed booking at the restaurant whose
  interval overlaps `[from, to)`, on any table; the rest are fixed. The planner tries every
  single and declared pair for each considered booking (capacity under its own accepted
  terms, no clash with fixed bookings, applied closures or the proposed closure, nor with each
  other) and keeps the lexicographic best of (bookings whose table set changes, unused seats,
  option ranks in reference order), with a bound that prunes partial plans already worse on
  the first two. Beyond 6 tables, 4 pairs or 6 considered bookings it still plans exactly
  unless the search space exceeds 5,000,000 combinations (then 422 `planning_limit`).
- Preview: auth, body, key, idempotency, unknown restaurant 404, non-manager 403, missing or
  invalid fields 422 (instants need an explicit offset, `Z` included; `from < to`), unknown
  table 404, then the plan (409 `no_feasible_plan`). Only the plan is stored.
- Apply: unknown plan or another restaurant's 404, already applied 409 `plan_already_applied`
  (before staleness), restaurant revision moved since the preview 409 `stale_plan`. Moved
  bookings gain one revision and one `reassigned` history entry (`table_ids` change, `plan_id`);
  the closure is recorded; each affected series and the restaurant gain one revision.
- Applied closures hold their table like a booking: availability, explain (`no_overlap`
  false), creates, amendments, moves, series and later plans all respect them.
  `GET /restaurants/{id}/closures` (public, additive) lists them so screens can say "closed".
- Series amendment: input 422 (expected_revision positive integer, from_index integer below
  the occurrence count, local_time HH:MM), not yours 404, stale series revision 409, then each
  eligible occurrence (index ≥ from_index, confirmed, not an exception) with PATCH semantics
  on its own date in index order, then occupancy. No exceptions are marked.
- Restaurant revision (`restaurant_revision` in plans): +1 per new booking, real amendment,
  first cancel, policy publication, series adoption, changing move batch, changing series
  amendment and plan application; never for seeds, previews, no-ops, failures or replays.
- UI: a table taken out of service by an applied closure reads "Closed" (solid dark cell),
  distinct from booked (hatched, struck through), too small (dashed) and available.
- UI: the grid asks for `explain=true`, so a table that cannot fit the party under the date's
  policy is labelled "Too small". Seat counts and the closed-day message come from the policy
  that applies to the searched date (selected from the public `GET /restaurants/{id}/policies`
  with the server's rule: greatest `effective_from` not after the date, ties by greatest
  version; the fixture before any). Availability itself always comes from the server.
- UI: the session token is kept in `localStorage`; a booking's retry identity (body and
  Idempotency-Key) is kept in the page, so an unchanged resubmit or a retry after a lost
  response reuses the key, and any change to the form uses a new one. Only the latest search
  may paint the grid. Combined seatings appear in the grid only when the pair is free for the
  party. Clicking a table while signed out shows `auth-error` with links to log in or sign up.

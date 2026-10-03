# Tablekeeper — stage 1

HTTP API for restaurant availability, bookings, cancellations, amendments and atomic
multi-booking moves. Node 22 + TypeScript, Express, an in-memory `better-sqlite3` store,
`luxon` for time zones and `bcrypt` for password hashing. State is ephemeral.

## Build and run

From this folder (`stage-1/`):

```sh
docker build -t tablekeeper-stage-1 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-1
```

The service listens on `0.0.0.0:$PORT` (default `8080`) and needs no network at run time.
`GET /health` returns `200 {"status":"ok"}` once it can serve requests (well under a second).
`POST /_test/reset`, `GET /_test/export` and `POST /_test/import` are enabled in the image.

## Acceptance tests

With the service running on port 8080, from the repository root:

```sh
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-1/tests/acceptance/*.test.mjs
```

## Layout

| Path | Responsibility |
|---|---|
| `src/server.ts` | Process entry: reads `PORT`, listens on `0.0.0.0` |
| `src/app.ts` | Routes, body decoding, order of request-level checks, error envelope |
| `src/auth.ts` | Signup, login, bcrypt hashing, bearer tokens (stored as SHA-256 digests) |
| `src/idempotency.ts` | `Idempotency-Key` rules, canonical JSON comparison, stored responses |
| `src/reservations.ts` | Create, list, read, cancel, amend and batch-move rules |
| `src/schedule.ts` | Slot grid, opening hours, cutoff, half-open occupancy, availability |
| `src/time.ts` | Local date/time parsing and IANA zone resolution (gap → none, overlap → first) |
| `src/state.ts` | Whole-state records: replace (reset/import), snapshot (export), import validation |
| `src/fixture.ts` | Reset fixture validation and seeding |
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
- Import accepts only a `state` this service exported; anything else is 422 and leaves state
  unchanged. Tokens issued before a reset or import of other state stop working.

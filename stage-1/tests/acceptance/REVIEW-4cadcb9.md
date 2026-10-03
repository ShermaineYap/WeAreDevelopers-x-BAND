# Stage 1 ledger review: revision 4cadcb9ce7b19b98266fd610c4ff4442e4aea54d

Reviewer: auditor. Handoff: foreman STAGE 1 ledger review (message 6a6fa308).

**Verdict: ACCEPT.** 116 covered, 0 partial, 0 missing.

## Evidence

- **Clean build.** I built the image from `git archive 4cadcb9 stage-1`, with no working-tree
  files. It ran with `-e PORT=8080 --cpus 2 --memory 2g` and was healthy in under 1 s after a
  restart.
- **Acceptance suite** (`stage-1/tests/acceptance/*.test.mjs`, commit 80cf895): 112 of 112 pass.
  `concurrency.test.mjs` passed on 3 more runs, 7 of 7 each time.
- **Extra probes against the image:**
  - A body over 1 MB returns 413 with the error envelope.
  - A request without `Content-Type` is parsed as JSON.
  - An empty body on `POST /reservations` or `PATCH` returns 400 `malformed_request`.
  - `moves:"ABC"` and `moves:[{reference:5}]` return 422.
  - Import with `state:"x"` returns 422.
  - Reset with a bad time zone returns 422.
  - Signup with an upper-case duplicate email returns 409.
  - Signup without `display_name` returns 422.
  - `__proto__` in the body is ignored and the booking returns 201.
  - Duplicate or unknown query parameters are ignored.
  - An unknown method or route returns 404 with the envelope.
- **Code read.** I read every file in `stage-1/src`. Paths below are relative to `stage-1/src/`.

## Per-line review

| ID | Mark | Code | Reason |
|---|---|---|---|
| S1-001 | covered | app.ts:133 | Returns a fixed `{"status":"ok"}` with 200. |
| S1-002 | covered | server.ts:4-7; constants.ts:3-4; Dockerfile | Listens on `0.0.0.0:$PORT` (default 8080); the image runs on its own. |
| S1-003 | covered | app.ts:92-95,134 | No auth on reset; returns 204. |
| S1-004 | covered | state.ts:181-210 | `replaceState` deletes every table, tokens and idempotency records included, in one transaction. |
| S1-005 | covered | state.ts:184-203 | Replacement is unconditional and repeatable. |
| S1-006 | covered | app.ts:39,45 | `res.json` sends `application/json; charset=utf-8`; errors use the same path. |
| S1-007 | covered | time.ts:129-138 | `formatInstant` always writes a numeric offset; `created_at` uses `+00:00`. |
| S1-008 | covered | fields.ts:7-22; reservations.ts:75-85 | Only named fields are read; anything else is ignored. |
| S1-009 | covered | app.ts:67-76 | Reads only the three named params from `URLSearchParams`. |
| S1-010 | covered | shape.ts:41-47; fixture.ts:22,38-55; state.ts:98,125 | `expectId` rejects IDs of 0 or over 64 characters with 422. |
| S1-011 | covered | shape.ts:43 | Uses `> MAX_ID_LENGTH`, so exactly 64 is accepted. |
| S1-012 | covered | fixture.ts:91-93; auth.ts:79-92 | Seed passwords are hashed during reset; login verifies them. |
| S1-013 | covered | fixture.ts:34-69 | Seeds are confirmed with the given id, reference and user_id, and computed start/end times. |
| S1-014 | covered | fixture.ts:40-41; constants.ts:19 | Reference must match `^[A-Z0-9]{6,12}$`, else 422. |
| S1-015 | covered | schedule.ts:59-75 | No "now" check at creation; the cutoff is used only by cancel and amend. |
| S1-016 | covered | schedule.ts:48-49,97 | No opening-hours entries for the day means no slots. |
| S1-017 | covered | errors.ts:11-13; app.ts:42-49,161-172 | Every error, including unknown routes and body-read failures, uses `{error:{code,message}}`. |
| S1-018 | covered | app.ts:23-30 | `JSON.parse` failure returns 400 `malformed_request`. |
| S1-019 | covered | fields.ts:13,18-22; reservations.ts:66,76,111; auth.ts:56,80 | String fields of a wrong type return 400 before any value check; `starts_at_local` as a number returns 400 (I-4). |
| S1-020 | covered | app.ts:31 | A body that is not an object returns 400 (I-3). |
| S1-021 | covered | fields.ts:9,30 | A missing required field returns 422. |
| S1-022 | covered | fields.ts:28-35; shape.ts:16-18 | `typeof number && isSafeInteger`, so strings and booleans return 422. |
| S1-023 | covered | time.ts:18,38-44; schedule.ts:31-35 | Strict regex plus calendar and clock range checks; failures return 422. |
| S1-024 | covered | app.ts:20,77 | `^\d+$` rejects `1e9`, `4.0`, `+4` and spaces. |
| S1-025 | covered | app.ts:70,77 | Empty, `true`, `-1`, `0` and `2.5` return 422. |
| S1-026 | covered | idempotency.ts:14-20; constants.ts:10 | Over 255 returns 422; 255 is accepted. |
| S1-027 | covered | db.ts:66-69; app.ts:42-49 | Synchronous transactions on one thread; no 5xx under the 50-request mixed test. |
| S1-028 | covered | auth.ts:55-74 | Returns 201 `{user_id, display_name, token}`; the token is stored as a digest. |
| S1-029 | covered | auth.ts:79-92 | Login returns the same `user_id`. |
| S1-030 | covered | auth.ts:64-69; db.ts:13 | Checked before hashing and again inside the transaction; `email_key` is UNIQUE. |
| S1-031 | covered | auth.ts:61; constants.ts:13 | Counts characters, minimum 8. |
| S1-032 | covered | auth.ts:12,60 | `^[^\s@]+@[^\s@]+$`. |
| S1-033 | covered | auth.ts:83-86 | Wrong password and unknown email both return 401, with a decoy hash so timing matches. |
| S1-034 | covered | auth.ts:13,41-47; app.ts:115,151-159 | Missing, malformed or unknown bearer returns 401 on every protected route, before the body is read. |
| S1-035 | covered | auth.ts:34-38; db.ts:17-20 | Each login inserts a new token row; tokens never expire. |
| S1-036 | covered | auth.ts:15-19; constants.ts:16 | bcrypt cost 6 over a SHA-256 pre-hash; no plaintext anywhere in the export. |
| S1-037 | covered | app.ts:141-148 | No `userOf` call on these three routes. |
| S1-038 | covered | idempotency.ts:15; app.ts:117 | Absent or empty header returns 400 on both write paths. |
| S1-039 | covered | idempotency.ts:42-58 | First use runs and records the 201 body; a replay returns 200 with the stored body. |
| S1-040 | covered | idempotency.ts:23-30,45 | Canonical JSON with sorted keys is used for comparison. |
| S1-041 | covered | idempotency.ts:49-51 | A different hash returns 409 `idempotency_key_reuse`. |
| S1-042 | covered | app.ts:113-119; idempotency.ts:46-53 | The record lookup runs before `run()`, so before every field or resource check. |
| S1-043 | covered | db.ts:56-63 | Primary key is (user_id, path, key). |
| S1-044 | covered | app.ts:150,159; constants.ts:45-46 | The path is part of the record key. |
| S1-045 | covered | idempotency.ts:46,54-55 | A failed `run()` throws and rolls back, so nothing is recorded. |
| S1-046 | covered | app.ts:117 | The key check comes before any field validation (I-2). |
| S1-047 | covered | idempotency.ts:46 | Lookup and insert happen in one synchronous transaction, so exactly one 201 and the rest 200. |
| S1-048 | covered | idempotency.ts:52 | Returns the stored body unchanged and makes no write. |
| S1-049 | covered | app.ts:141-142 | Maps each restaurant to `{id, name, timezone}`. |
| S1-050 | covered | app.ts:143-147; state.ts:143-147 | Fixture shape with tables in order; unknown returns 404. |
| S1-051 | covered | app.ts:68-76 | A missing or empty param returns 422. |
| S1-052 | covered | app.ts:74-81; time.ts:30-35 | A bad date returns 422; an unknown restaurant returns 404. |
| S1-053 | covered | app.ts:82-87; schedule.ts:111-119 | Response shape matches the spec. |
| S1-054 | covered | schedule.ts:97-105 | Steps from `opens`, keeping a slot only while `end_ms <= closes`. |
| S1-055 | covered | schedule.ts:107-110; state.ts:141 | Filters `capacity >= party` and overlap, in table `position` order. |
| S1-056 | covered | schedule.ts:107-114 | A slot is pushed even when its list is empty. |
| S1-057 | covered | schedule.ts:107-114 | Same as S1-056. |
| S1-058 | covered | schedule.ts:27-28; reservations.ts:23-25 | `start < other.end && other.start < end` in both the code and the SQL. |
| S1-059 | covered | reservations.ts:25,27 | Only `status='confirmed'` reservations block. |
| S1-060 | covered | reservations.ts:36-49,110-129 | All ten fields; `ends_at` is the start plus the absolute duration. |
| S1-061 | covered | ids.ts:11-19; constants.ts:19-21; db.ts:41 | 8 characters of A-Z0-9, unique check plus UNIQUE column; the update never touches `reference`. |
| S1-062 | covered | reservations.ts:103-106,117 | Overlap returns 409 `table_unavailable`. |
| S1-063 | covered | schedule.ts:69-71 | `(minute - opens) % slot_minutes` must be 0. |
| S1-064 | covered | schedule.ts:65-68,73 | No matching hours entry, or an end after `closes`, returns `outside_opening_hours`. |
| S1-065 | covered | reservations.ts:94-96 | `party > capacity` returns 422. |
| S1-066 | covered | fields.ts:34 | Below 1 or not an integer returns 422. |
| S1-067 | covered | reservations.ts:114-115,91-92 | Table is looked up within the named restaurant; otherwise 404. |
| S1-068 | covered | reservations.ts:21-22,131-134 | Own reservations only, `ORDER BY start_ms DESC`, all statuses; empty gives `[]`. |
| S1-069 | covered | reservations.ts:56-60 | Another user's reservation returns 404. |
| S1-070 | covered | reservations.ts:143-149 | Status update and full view; availability reads confirmed bookings only. |
| S1-071 | covered | reservations.ts:145 | Already cancelled returns 200 with the current state, before the cutoff check. |
| S1-072 | covered | schedule.ts:78-80; reservations.ts:146 | `now >= start - cutoff`. |
| S1-073 | covered | schedule.ts:79 | Same comparison also covers starts in the past. |
| S1-074 | covered | schedule.ts:79 | Outside the cutoff, the cancel goes through. |
| S1-075 | covered | reservations.ts:144 | `ownReservation` returns 404. |
| S1-076 | covered | reservations.ts:156-178 | Any subset of fields; `{}` keeps every value; no key required; returns 200 (I-1). |
| S1-077 | covered | reservations.ts:164-169,90-98 | Uses the same `resolveBooking` and `readChange` as create. |
| S1-078 | covered | reservations.ts:159 | Cutoff uses `row.start_ms`, the current start (I-5). |
| S1-079 | covered | reservations.ts:157 | Cancelled returns 409 `reservation_cancelled`. |
| S1-080 | covered | reservations.ts:175 | `assertFree` excludes the reservation's own id. |
| S1-081 | covered | reservations.ts:174-176 | All checks throw before `updateBooking`. |
| S1-082 | covered | reservations.ts:28-32 | The update never sets id, reference or created_at. |
| S1-083 | covered | reservations.ts:175,174 | Overlap returns 409; another user's reservation returns 404. |
| S1-084 | covered | schedule.ts:102-103; time.ts:98-109 | Times in the gap resolve to null and are skipped. |
| S1-085 | covered | schedule.ts:60-63 | Returns `invalid_local_time` for both POST and PATCH (shared `bookingTiming`). |
| S1-086 | covered | schedule.ts:95,105 | A `seen` set de-duplicates slots. |
| S1-087 | covered | time.ts:104-108 | Picks the larger offset, which is the first occurrence. |
| S1-088 | covered | schedule.ts:37-46 | `end = start_ms + duration` in milliseconds; offset formatted at the end instant. |
| S1-089 | covered | time.ts:89-91,129-133 | Uses luxon `IANAZone.offset`. |
| S1-090 | covered | schedule.ts:27-28; reservations.ts:24-25 | Overlap is computed on epoch milliseconds. |
| S1-091 | covered | app.ts:97-99,135 | Unauthenticated; `{track, format_version:1, state}`. |
| S1-092 | covered | state.ts:213-225,184-203 | Rows copied verbatim: ids, references, statuses, timestamps. |
| S1-093 | covered | state.ts:216,240-253; auth.ts:21-22 | Token digests and password hashes are exported and imported. |
| S1-094 | covered | state.ts:222-223,281-292 | Idempotency records travel with the state; failed keys were never recorded. |
| S1-095 | covered | state.ts:187 | Deletes everything, then inserts, in one transaction. |
| S1-096 | covered | app.ts:101-107; state.ts:237-294,204-207 | Track, version, schema marker and row validation run before the transaction; constraint errors roll back and return 422. |
| S1-097 | covered | state.ts:213-225; app.ts:98 | Read in one transaction and serialised immediately. |
| S1-098 | covered | app.ts:92-94; state.ts:187 | Reset uses the same full replacement. |
| S1-099 | covered | idempotency.ts:55; state.ts:222-223 | Move records are stored under the moves path and exported. |
| S1-100 | covered | reservations.ts:201-216 | Returns 201 with `planned.map(view)` in input order; unchanged items are included. |
| S1-101 | covered | reservations.ts:181-195 | Not an array, length outside 1..8, an item that is not an object, a non-string reference, or a duplicate: all 422. |
| S1-102 | covered | reservations.ts:205-207; app.ts:115-117 | Unknown or foreign reference returns 404; mixed restaurants 422; no token 401; no key 400. |
| S1-103 | covered | reservations.ts:157-159 | Cancelled, then the cutoff, for each item. |
| S1-104 | covered | reservations.ts:204-214 | Items are checked in input order, with occupancy after all of them; cutoff comes before field checks within each item (I-6). |
| S1-105 | covered | reservations.ts:211-214 | Planned bookings are checked against each other, then against unlisted confirmed bookings. |
| S1-106 | covered | reservations.ts:210,213 | Listed bookings' old positions are excluded. |
| S1-107 | covered | reservations.ts:215; idempotency.ts:46,54 | Writes happen only after every check passes; a throw rolls back and leaves no record. |
| S1-108 | covered | reservations.ts:161-170,28-32 | `??` keeps current values; an empty item returns the row unchanged; identity columns are never updated. |
| S1-109 | covered | idempotency.ts:47-52 | Replay returns the stored body; a different body returns 409. |
| S1-110 | covered | reservations.ts:117; db.ts:66-69 | Check and insert run in one synchronous transaction. |
| S1-111 | covered | reservations.ts:173-178 | Synchronous check and update; one winner in the 10-way race. |
| S1-112 | covered | reservations.ts:201-216; idempotency.ts:46 | Runs inside the idempotency transaction. |
| S1-113 | covered | app.ts:53-59 | All handlers catch and return the envelope; no 5xx or timeouts in the 50-request mix. |
| S1-114 | covered | constants.ts:16 | Cost 6; 50 parallel logins finish well under 5 s. |
| S1-115 | covered | auth.ts:68-73; db.ts:13 | Email is re-checked in the transaction; UNIQUE `email_key` backs it up. |
| S1-116 | covered | reservations.ts:110-128 | Every validation runs before the insert, inside a transaction. |

## Builder interpretations versus the ledger

All of them are compatible with the spec and with I-1 to I-11.

- **Check order on idempotent writes.** Order is 401, then 400 body, then 400 key, then 422 key
  length, then the idempotency record, then field checks. This matches §7 and I-2.
- **Records per user and path, successful first uses only.** Matches §7, S1-044 and S1-045.
- **PATCH and move order.** 404, then cancelled, then cutoff, then validation, with occupancy
  last. Matches §8, §11 and I-6.
- **Email uniqueness ignores case.** The spec is silent. This is a reasonable reading and stricter
  than required.
- **`display_name` required on signup.** The spec's request example always includes it. Accepted,
  but see advisory A-3.

## Advisory, non-blocking (no ledger line fails)

- **A-1. Stack constraint.** `cancelReservation` (reservations.ts:143-149) and
  `amendReservation` (reservations.ts:173-178) are not wrapped in `inTransaction`. The handoff
  says "every write path inside a single synchronous transaction". They are atomic in practice:
  the reads and the single UPDATE are synchronous and nothing yields between them. Wrapping them
  would make the constraint literally true and protect stage 2+ if a second write is added.
- **A-2. Malformed path encoding.** `GET /reservations/%E0%A4%A` returns 400 `malformed_request`
  with the message "The request body could not be read" (app.ts:166-171). The status is
  defensible, but the message is misleading.
- **A-3. Signup without `display_name` returns 422** (auth.ts:59). The spec doesn't say whether
  `display_name` is required. If the graded suite signs up without it, this would fail. Treating
  it as optional, defaulting to an empty string or the email's local part, would be safer.
- **A-4. Unchanged items in a batch.** A batch item that changes nothing still triggers that
  booking's cutoff check (reservations.ts:159 runs before the no-op return at 161-163). This is
  consistent with §11 "Each booking's existing cutoff applies". It is noted so stage 3 keeps the
  behaviour deliberate.

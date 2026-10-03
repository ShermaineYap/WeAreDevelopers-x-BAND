# Tablekeeper stage 1: requirements ledger

Source: `tablekeeper/spec/stage-1.md` plus the binding stack constraints in the foreman handoff.
Coverage column: whether the supplied checks (`tablekeeper/test/stage_1/*.py`) appear to exercise the
statement. `covered` = a supplied check asserts it; `partial` = supplied check touches it but not
the edge named here; `not covered` = nothing in the supplied checks; `unclear` = cannot be told
from the supplied checks. The `Test` column names the acceptance test(s) in this folder
(`<file>: <test name prefix>`); every test name starts with its ledger ID.

## Interpretations chosen (dark run, no human input)

- I-1 PATCH success returns **200** with the full reservation shape (spec gives no status; 201 is
  reserved for creates).
- I-2 A request with a missing `Idempotency-Key` returns 400 `missing_idempotency_key` even when the
  body would otherwise be invalid (idempotency is resolved before field validation, §7).
- I-3 A top-level JSON body that is not an object (array, string, `null`) is 400 `malformed_request`.
- I-4 `starts_at_local` of a non-string JSON type (number) is 400 `malformed_request` (§5: only
  *strings* that are not bare local times are 422; "other wrong JSON types follow the rule below").
- I-5 PATCH cutoff is measured only against the **current** start: moving a far-future booking to a
  past start is accepted; moving a past booking to the future is 409 `cutoff_passed`.
- I-6 In a move batch, non-occupancy errors (404, 409 `reservation_cancelled`, 409 `cutoff_passed`,
  422 codes) take precedence over 409 `table_unavailable`, and among non-occupancy errors the
  first item in input order wins; within one item `cutoff_passed` wins over that item's other errors.
- I-7 Reset fixtures with an ID longer than 64 characters, or a seeded `reference` not matching
  `^[A-Z0-9]{6,12}$`, are rejected with 422 `validation_failed`; an ID of exactly 64 is accepted.
- I-8 `import` with a `state` object that this service did not produce (e.g. `{"nonsense":true}`) is
  an "invalid state" → 422 and leaves the destination unchanged.
- I-9 After a reset, tokens issued before it are unknown (401): "subsequent requests must see only
  that fixture".
- I-10 Plaintext-password ban is checked black-box: the export must not contain any password string.
- I-11 Error responses are JSON; the `Content-Type` of JSON responses starts with `application/json`.

## Ledger

| ID | Statement (quoted / close paraphrase) | Supplied checks | Test |
|---|---|---|---|
| S1-001 | §3.2 `GET /health` → 200 `{"status":"ok"}` | covered | runtime: S1-001 |
| S1-002 | §3.1 Listen on 0.0.0.0:`$PORT` (default 8080); image runs alone with `-e PORT` | covered (harness boot) | — (harness) |
| S1-003 | §3.3 `POST /_test/reset` → 204, no auth | covered | runtime: S1-003 |
| S1-004 | §3.3 After reset only the new fixture is visible (old restaurants/users/reservations/tokens gone) | partial (restaurants only) | runtime: S1-004 |
| S1-005 | §3.3 Repeated resets are supported | partial | runtime: S1-005 |
| S1-006 | §3.4 Responses are `application/json; charset=utf-8` | not covered | runtime: S1-006 |
| S1-007 | §3.4 RFC 3339 timestamps with explicit offset (`starts_at`, `ends_at`, `created_at`) | partial (starts_at only) | reservations: S1-007 |
| S1-008 | §3.4 Unknown body fields ignored, never an error (all endpoints) | partial (POST /reservations) | runtime: S1-008 |
| S1-009 | §3.4 Unknown query parameters ignored | covered | availability: S1-009 |
| S1-010 | §3.4 IDs ≤ 64 chars, also in fixtures (65 rejected) | covered | runtime: S1-010 |
| S1-011 | §3.4 A fixture ID of exactly 64 chars is accepted (I-7) | not covered | runtime: S1-011 |
| S1-012 | §4 Seeded users can log in immediately | covered | auth: S1-012 |
| S1-013 | §4 Seeded reservations are confirmed bookings owned by `user_id`, occupying their table, with the given `id`/`reference` | covered | runtime: S1-013 |
| S1-014 | §4 Seeded reservation reference must be valid format (I-7) | covered | runtime: S1-014 |
| S1-015 | §4 A booking is not rejected solely because its start is in the past | not covered | reservations: S1-015 |
| S1-016 | §4 Day with no opening_hours entry is closed | covered | availability: S1-016 |
| S1-017 | §5 Every 4xx body is `{"error":{"code","message"}}` with string message | partial | runtime: S1-017 |
| S1-018 | §5 Unparseable body → 400 `malformed_request` | covered (POST /reservations) | validation: S1-018 |
| S1-019 | §5 Field of wrong JSON type → 400 `malformed_request` (signup, reservations `restaurant_id`/`table_id`, `starts_at_local` number, I-4) | partial (signup only) | validation: S1-019 |
| S1-020 | §5 Non-object JSON body → 400 (I-3) | not covered | validation: S1-020 |
| S1-021 | §5 Missing required body field → 422 `validation_failed` | not covered | validation: S1-021 |
| S1-022 | §5 `party_size` strings and **booleans** → 422 `validation_failed` (never 400, booleans never integers) | partial (string, no boolean) | validation: S1-022 |
| S1-023 | §5 `starts_at_local` strings not bare `YYYY-MM-DDTHH:MM` → 422 | covered | validation: S1-023 |
| S1-024 | §5 Query integers plain decimal digits: `1e9`, `4.0`, `+4` → 422 | covered | availability: S1-024 |
| S1-025 | §5 Query integer `true`, `-1`, `0`, empty → 422 | partial | availability: S1-025 |
| S1-026 | §5 `Idempotency-Key` 1..255 chars; 256 → 422 `validation_failed`; 255 accepted | not covered | idempotency: S1-026 |
| S1-027 | §5 No 5xx, including under concurrent load | partial (10 clients) | concurrency: S1-027 |
| S1-028 | §6 Signup → 201 `{user_id, display_name, token}`; token usable | covered | auth: S1-028 |
| S1-029 | §6 Login → 200 `{user_id, display_name, token}`; same user_id as signup | covered | auth: S1-029 |
| S1-030 | §6 Duplicate email → 409 `email_taken` | covered | auth: S1-030 |
| S1-031 | §6 Password < 8 chars → 422; exactly 8 accepted | partial (7 only) | auth: S1-031 |
| S1-032 | §6 Email not `local@domain` → 422 | partial (one form) | auth: S1-032 |
| S1-033 | §6 Wrong password / unknown email → 401 `unauthenticated` | covered | auth: S1-033 |
| S1-034 | §6 Missing / malformed / unknown bearer → 401 on every protected endpoint (incl. cancel, PATCH, moves) | partial (GET only) | auth: S1-034 |
| S1-035 | §6 Tokens never expire; multiple valid tokens per account at once | not covered | auth: S1-035 |
| S1-036 | §6 Passwords stored hashed, never plaintext (I-10) | not covered | export: S1-036 |
| S1-037 | §6/§8 `GET /restaurants`, `/restaurants/{id}`, `/availability` public | covered | availability: S1-037 |
| S1-038 | §7 Missing or **empty** `Idempotency-Key` → 400 `missing_idempotency_key` (both write paths) | partial (absent, reservations only) | idempotency: S1-038 |
| S1-039 | §7 First use → 201; replay same body → 200 identical JSON | covered | idempotency: S1-039 |
| S1-040 | §7 "Same body" is JSON-value equality: key order / whitespace differences are a replay | not covered | idempotency: S1-040 |
| S1-041 | §7 Same key, different body → 409 `idempotency_key_reuse` | covered | idempotency: S1-041 |
| S1-042 | §7 Key reuse conflict decided **before** field validation and current-resource checks (invalid new body → 409) | not covered | idempotency: S1-042 |
| S1-043 | §7 Key scoped per user: another user with same key/body books normally | covered | idempotency: S1-043 |
| S1-044 | §7 Same key + same body on a **different path** is a new request and succeeds normally | not covered | idempotency: S1-044 |
| S1-045 | §7 Key reused after original 4xx is a first use (422 and 409 originals) | not covered | idempotency: S1-045 |
| S1-046 | §7 Missing key with otherwise invalid body → 400 missing key (I-2) | not covered | idempotency: S1-046 |
| S1-047 | §7 Concurrent identical requests with unused key: exactly one 201, rest 200 same body, one effect | not covered (supplied sample says graded) | concurrency: S1-047 |
| S1-048 | §7 Replay returns original body even after cancel/amend, and makes no further state change | partial (body only) | idempotency: S1-048 |
| S1-049 | §8 `GET /restaurants` → `{restaurants:[{id,name,timezone}]}` | covered | availability: S1-049 |
| S1-050 | §8 `GET /restaurants/{id}` fixture shape (slot, duration, cutoff, opening_hours, tables); 404 unknown | covered | availability: S1-050 |
| S1-051 | §8 Availability requires all three params; missing → 422 | covered | availability: S1-051 |
| S1-052 | §8 Availability unknown restaurant → 404; invalid date → 422 | covered | availability: S1-052 |
| S1-053 | §8 Availability response shape `{restaurant_id,date,timezone,slots:[{starts_at_local,starts_at,available_table_ids}]}` | covered | availability: S1-053 |
| S1-054 | §8 Slot for every `slot_minutes` step from `opens` with `slot + duration <= closes` (incl. non-dividing step) | partial (30-min only) | availability: S1-054 |
| S1-055 | §8 `available_table_ids`: capacity ≥ party_size (equal counts), no overlapping confirmed booking, **fixture order** | covered | availability: S1-055 |
| S1-056 | §8 Slot with no available table still appears with `[]` | covered | availability: S1-056 |
| S1-057 | §8 Party larger than every table → all slots with empty lists | not covered | availability: S1-057 |
| S1-058 | §1 Half-open occupancy `[start, start+duration)`: back-to-back allowed; availability excludes every overlapping slot only | covered | availability: S1-058 |
| S1-059 | §8 Cancelled reservations do not block availability or booking | covered | reservations: S1-059 |
| S1-060 | §8 POST /reservations 201 shape (all ten fields, status confirmed, ends_at = start+duration) | covered | reservations: S1-060 |
| S1-061 | §8 `reference` 6–12 chars `A-Z0-9`, unique, never changes | partial | reservations: S1-061 |
| S1-062 | §8 Overlapping interval on same table → 409 `table_unavailable` | covered | reservations: S1-062 |
| S1-063 | §8 Off-grid start → 422 `not_on_slot_grid` | covered | reservations: S1-063 |
| S1-064 | §8 Start before opens / reservation ends after closes → 422 `outside_opening_hours` (incl. on-grid but too late, and closed day) | partial (no closed day) | reservations: S1-064 |
| S1-065 | §8 party_size > capacity → 422 `party_exceeds_capacity`; = capacity ok | covered | reservations: S1-065 |
| S1-066 | §8 party_size < 1 or non-integer → 422 `validation_failed` | covered | validation: S1-066 |
| S1-067 | §8 Unknown restaurant / unknown table / other restaurant's table → 404 | covered | reservations: S1-067 |
| S1-068 | §8 `GET /reservations`: only caller's, `starts_at` descending, confirmed and cancelled, `{reservations:[]}` when empty | partial (empty not checked) | reservations: S1-068 |
| S1-069 | §8 `GET /reservations/{reference}` → own booking; others' → 404 (not 403) | covered | reservations: S1-069 |
| S1-070 | §8 Cancel → 200 `{reference,status:"cancelled",...}` full shape, frees table immediately | covered | cancel: S1-070 |
| S1-071 | §8 Cancel twice → 200 current state | covered | cancel: S1-071 |
| S1-072 | §8 Cancel within cutoff before start → 409 `cutoff_passed` | covered | cancel: S1-072 |
| S1-073 | §8 Cancel after start ("or later") → 409 `cutoff_passed` | covered | cancel: S1-073 |
| S1-074 | §8 Cancel outside cutoff succeeds | partial | cancel: S1-074 |
| S1-075 | §8 Cancel someone else's → 404 | covered | cancel: S1-075 |
| S1-076 | §8 PATCH any subset of `table_id`, `starts_at_local`, `party_size`; no idempotency key needed (I-1) | partial (table only) | amend: S1-076 |
| S1-077 | §8 PATCH validation identical to POST (grid, hours, capacity, party, invalid local time, 404s) | partial | amend: S1-077 |
| S1-078 | §8 PATCH cutoff measured against **current** start (I-5) | partial | amend: S1-078 |
| S1-079 | §8 PATCH on cancelled → 409 `reservation_cancelled` | covered | amend: S1-079 |
| S1-080 | §8 PATCH releases old slot and reserves new one together (shift overlapping its own old interval succeeds) | not covered | amend: S1-080 |
| S1-081 | §8 Failed PATCH leaves booking and occupancy unchanged | not covered | amend: S1-081 |
| S1-082 | §8 `reference`, `reservation_id` (and `created_at`) survive a change | covered | amend: S1-082 |
| S1-083 | §8 PATCH onto taken table → 409 `table_unavailable`; others' → 404 | covered | amend: S1-083 |
| S1-084 | §9 Spring-forward gap absent from availability (Berlin 2026-03-29, NY 2026-03-08) | not covered | dst: S1-084 |
| S1-085 | §9 Booking a gap time → 422 `invalid_local_time` (both zones, POST and PATCH) | partial (one zone, POST) | dst: S1-085 |
| S1-086 | §9 Fall-back repeated hour: slot appears once (Berlin 2026-10-25, NY 2026-11-01) | partial | dst: S1-086 |
| S1-087 | §9 Repeated time resolves to first occurrence (pre-change offset) | partial | dst: S1-087 |
| S1-088 | §9 Duration absolute: `ends_at` = start + duration real minutes (NY 01:30 → 02:00-05:00; Berlin gap/repeat days) | partial | dst: S1-088 |
| S1-089 | §9 Offsets follow IANA rules on both sides of each transition | partial | dst: S1-089 |
| S1-090 | §9 Overlap on DST days is computed on real instants | not covered | dst: S1-090 |
| S1-091 | §10 Export 200 `{track:"tablekeeper", format_version:1, state:{}}`, unauthenticated | partial | export: S1-091 |
| S1-092 | §10 Import unchanged export → 204; restores reservations/references/timestamps/statuses | covered (one booking) | export: S1-092 |
| S1-093 | §10 Import preserves existing bearer tokens and hashed-password login (incl. signed-up users) | not covered | export: S1-093 |
| S1-094 | §10 Import preserves completed idempotent responses (replay → 200 original) and failed keys reusable | not covered | export: S1-094 |
| S1-095 | §10 Import is replacement: destination data/credentials created after export removed; repeat import no duplicates | not covered | export: S1-095 |
| S1-096 | §10 Invalid JSON → 400; missing fields / wrong track / wrong version / invalid state → 422, destination unchanged | not covered | export: S1-096 |
| S1-097 | §10 Export is an atomic snapshot; later writes don't change it (import of older export removes later writes) | not covered | export: S1-097 |
| S1-098 | §10 Reset clears imported state | not covered | export: S1-098 |
| S1-099 | §10/§11 Export preserves batch-move receipts | not covered | export: S1-099 |
| S1-100 | §11 Moves: 201 `{reservations:[...]}` in input order incl. unchanged items | partial (one item) | moves: S1-100 |
| S1-101 | §11 `moves` 1..8: 0 or 9 items → 422; duplicate references → 422; missing `moves` → 422 | not covered | moves: S1-101 |
| S1-102 | §11 Unknown / other owner's reference → 404; different restaurants → 422; no token → 401; no key → 400 | not covered | moves: S1-102 |
| S1-103 | §11 Cancelled booking → 409 `reservation_cancelled`; cutoff applies → 409 `cutoff_passed` | not covered | moves: S1-103 |
| S1-104 | §11 Error precedence in input order; cutoff before other errors of the same item; non-occupancy before occupancy (I-6) | not covered | moves: S1-104 |
| S1-105 | §11 Overlap among resulting bookings or with an unlisted booking → 409 `table_unavailable` | not covered | moves: S1-105 |
| S1-106 | §11 Swaps evaluated on resulting state (A↔B tables) succeed | not covered | moves: S1-106 |
| S1-107 | §11 All-or-nothing: failing batch changes nothing; its key remains reusable | not covered | moves: S1-107 |
| S1-108 | §11 Omitted fields retain values; unknown item fields ignored; identity/owner/created_at unchanged; no-op moves keep values | not covered | moves: S1-108 |
| S1-109 | §11 Replay → 200 original even after amend/cancel; different body → 409 reuse | not covered | moves: S1-109 |
| S1-110 | §1 Never two confirmed reservations on one table at overlapping times under concurrency (50 racers: exactly one 201) | partial (10) | concurrency: S1-110 |
| S1-111 | §1 Concurrent PATCHes onto one free table: exactly one wins | not covered | concurrency: S1-111 |
| S1-112 | §1 Concurrent move batches onto one free table: exactly one wins | not covered | concurrency: S1-112 |
| S1-113 | §2 50 concurrent mixed requests: no 5xx, each < 5 s | not covered | concurrency: S1-113 |
| S1-114 | §6/§2 50 concurrent logins each < 5 s (bcrypt cost) | not covered | concurrency: S1-114 |
| S1-115 | §6 Concurrent signups with the same email: exactly one 201 | not covered | concurrency: S1-115 |
| S1-116 | §1 Rejected requests create no partial bookings (failed POSTs leave list unchanged) | not covered | reservations: S1-116 |

## Not exercised by the supplied checks (not covered or partial)

not covered: S1-006, S1-011, S1-015, S1-020, S1-021, S1-026, S1-035, S1-036, S1-040, S1-042, S1-044,
S1-045, S1-046, S1-047, S1-057, S1-080, S1-081, S1-084, S1-090, S1-093, S1-094, S1-095, S1-096,
S1-097, S1-098, S1-099, S1-101, S1-102, S1-103, S1-104, S1-105, S1-106, S1-107, S1-108, S1-109,
S1-111, S1-112, S1-113, S1-114, S1-115, S1-116

partial: S1-004, S1-005, S1-007, S1-008, S1-017, S1-019, S1-022, S1-025, S1-027, S1-031, S1-032,
S1-034, S1-038, S1-048, S1-054, S1-061, S1-064, S1-068, S1-074, S1-076, S1-077, S1-078, S1-085,
S1-086, S1-087, S1-088, S1-089, S1-091, S1-100, S1-110

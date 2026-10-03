# Tablekeeper stage 2: requirements ledger

**Sources.**
- `tablekeeper/spec/stage-2.md`.
- The product brief and stack constraints in the foreman handoff.
- `stage-1.md`, which still applies. Its ledger is carried forward unchanged as
  `LEDGER-stage1.md` (S1-001..S1-116), and its tests run unchanged from this folder.

**Columns.**
- *Supplied* says whether `tablekeeper/test/stage_2/*.py` appears to exercise the line:
  `covered`, `partial` (touched, but not the edge named here) or `not covered`.
- *Test* gives `<file>: <ID>`. API files sit in this folder; `browser/` files use headless Chromium.
- Every test name starts with the ledger ID or IDs it covers.

## Interpretations chosen (dark run)

- **J-1. Combination order in responses.** A reservation's `table_ids` may come back in any order;
  tests compare it as a set. Only `available_options` and cell testids must use `combinable` order,
  because the spec states order only for those.
- **J-2. `table_ids` value checks.**
  - Not an array, or holding non-strings → 400 `malformed_request` (wrong JSON type, §5).
  - `[]` → 422 `validation_failed`.
  - An unknown id in a one-member set → 404 `not_found`.
- **J-3. `table_id` returns on PATCH.** When a PATCH or move turns a pair back into one table,
  `table_id` reappears.
- **J-4. Replaying a stage-1 receipt after the upgrade.** A receipt recorded by the stage-1 service
  replays with status 200 and its original identity: same `reference`, `reservation_id`, and the
  original `party_size`, even if the booking changed since. The test does not require the stage-2
  `table_ids` field on that replayed body, because §7 asks for the *original* response.
- **J-5. Where the upgrade is tested.**
  - In the browser: export, reset and import on the stage-2 service, between browser requests.
  - Across stages: through the API, against the stage-1 service at `PREVIOUS_BASE_URL`.
  - A browser session that began on the stage-1 service cannot be tested black-box, because stage 1
    has no UI.
- **J-6. Lost responses are network failures.** A lost response is a request that fails at the
  network level (`route.abort`), either after the server committed or before it was reached.
  - The retry must send the same `Idempotency-Key` header and an identical JSON body.
  - The UI must send `Idempotency-Key` on its booking requests (any URL is accepted).
- **J-7. Wording rules from the product brief.** These are checked as text that a person or screen
  reader sees (`textContent`, `aria-label` or `title`):
  - a booked cell matches `/booked|reserved|taken/i`;
  - an available cell matches `/available|free|open/i` and not the booked words;
  - `no-slots` on a closed day matches `/closed/i`.
  - "Outside opening hours" and "closed by a closure or plan" have no observable stage-2 trigger.
- **J-8. "Visible label".** An associated `<label>`, or an `aria-labelledby` target, that is rendered
  and has text. `aria-label` or a placeholder alone does not count.
- **J-9. "Consistent navigation".** When signed out, every one of the four routes links to the
  other three.
- **J-10. Visual distinctness.** Two states differ if their computed styles differ in at least one
  of: background, colour, border, outline, box-shadow, opacity, text-decoration, weight or cursor.
- **J-11. Seeded reservation status.** A seed's `status` is `confirmed` or `cancelled`.
  `GET /restaurants/{id}` includes `combinable` as it appeared in the fixture.

## Ledger

| ID | Statement (quoted / close paraphrase) | Supplied | Test |
|---|---|---|---|
| S2-001 | `/`, `/signup`, `/login`, `/lookup` are reachable by URL and return HTML | partial (no status/content-type) | browser/screens: S2-001; combos: S2-075 |
| S2-002 | Other screens (booking form, confirmation) are reachable through the UI | covered | browser/booking: S2-002 |
| S2-003 | Search A started before B but finishing after it: grid, table labels and booking form describe B; a late response must not restore A | not covered | browser/grid: S2-003 (restaurant change, date change) |
| S2-004 | Someone else takes the table after the form opens → 409 shows `booking-error`, no confirmation for that attempt | covered | browser/booking: S2-004 |
| S2-005 | …and availability is refreshed | not covered | browser/booking: S2-005 |
| S2-006 | …and the selected form and its inputs are preserved | not covered | browser/booking: S2-006 |
| S2-007 | Lost booking response (including after commit) → non-empty `booking-uncertain`, no `booking-error`, no new confirmation | not covered | browser/booking: S2-007 (after, before) |
| S2-008 | The unchanged form retries with the same idempotency key and body | not covered | browser/booking: S2-008 |
| S2-009 | A successful retry removes uncertainty and error and shows the original reference, booked once | not covered | browser/booking: S2-009 |
| S2-010 | A confirmed rejection after uncertainty uses `booking-error` | not covered | browser/booking: S2-010 |
| S2-011 | The conflict and lost-response rules also apply to combination bookings | not covered | browser/booking: S2-011 |
| S2-012 | The browser never makes up a success from cached data; the server is authoritative | not covered | browser/booking: S2-012 |
| S2-013 | Signup testids; signup signs the diner in | covered | browser/screens: S2-013 |
| S2-014 | Login testids; login signs the diner in | covered | browser/screens: S2-014 |
| S2-015 | `auth-error` appears only when there is an error (failed login, taken email, short password, bad email) | partial (login only) | browser/screens: S2-015 |
| S2-016 | `current-user` is visible on **every** screen when signed in and contains the display name | partial (one screen) | browser/screens: S2-016 |
| S2-017 | `logout-button` signs out | covered | browser/screens: S2-017 |
| S2-018 | `restaurant-select` option values are restaurant ids | not covered | browser/screens: S2-018 |
| S2-019 | `date-input` value is `YYYY-MM-DD`; `party-size-input` is a number input | not covered | browser/screens: S2-019 |
| S2-020 | `search-button` runs the search; `availability-grid` contains the results | covered | browser/grid: S2-020 |
| S2-021 | One `slot-{table_id}-{HH:MM}` cell per table per slot | covered | browser/grid: S2-021 |
| S2-022 | `no-slots` replaces the grid when the day has no slots | covered | browser/grid: S2-022 |
| S2-023 | `data-available` is true **exactly** when the table is in that slot's `available_table_ids` for the searched party | partial (two cells) | browser/grid: S2-023 |
| S2-024 | Clicking an available cell opens the booking form for that table and slot | partial | browser/grid: S2-024 |
| S2-025 | Clicking an unavailable cell does nothing | covered | browser/grid: S2-025 |
| S2-026 | Booking while signed out → `auth-error` or `/login` | covered | browser/grid: S2-026 |
| S2-027 | `booking-summary` contains the table label and local start; `booking-party-size` is a number input pre-filled from the search | covered | browser/booking: S2-027; browser/grid: S2-024 |
| S2-028 | The booking form stays on screen after success | covered | browser/booking: S2-028 |
| S2-029 | An unchanged resubmit returns the same `confirmation-reference`, with no `booking-error` and no second booking | covered | browser/booking: S2-029 |
| S2-030 | Changing a field makes the next submission a new booking request (new key) | partial (outcome only) | browser/booking: S2-030 |
| S2-031 | `confirmation-reference` is exactly the reference; `confirmation-details` has the restaurant name, table label and local start | covered | browser/booking: S2-031 |
| S2-032 | Lookup input and submit; `reservation-detail` when found; `reservation-status` is exactly `confirmed` or `cancelled` | covered | browser/lookup: S2-032 |
| S2-033 | `reservation-cancel-button` cancels and is absent once cancelled | covered | browser/lookup: S2-033 |
| S2-034 | `reservation-error` when not found (including another user's booking) or when a cancel is refused | partial (unknown only) | browser/lookup: S2-034 |
| S2-035 | A stage-2 service accepts the same team's stage-1 export: tokens, logins, references, receipts, failed keys | partial (token only) | upgrade: S2-035 |
| S2-036 | A browser signed in before the upgrade stays signed in, with no reload | not covered | browser/lookup: S2-036 |
| S2-037 | A retained reference still works after the upgrade (lookup) | not covered | browser/lookup: S2-037; upgrade: S2-037 |
| S2-038 | A booking whose response was lost before export can be retried after import with the same key and body; the UI recovers the original confirmation | not covered | browser/lookup: S2-038 |
| S2-039 | `combinable` holds unordered pairs; a pair not listed cannot be combined | not covered | combos: S2-039 |
| S2-040 | Pairs only: more than two tables → 422 `combination_not_allowed` | not covered | combos: S2-040 |
| S2-041 | Combining is not transitive | not covered | combos: S2-041 |
| S2-042 | A combination's capacity is the sum of its tables | not covered | combos: S2-042 |
| S2-043 | A combination occupies both tables for its full duration | partial (201 only) | combos: S2-043 |
| S2-044 | Seeded reservations are confirmed unless `status: "cancelled"`, and may use `table_id` or `table_ids` | not covered | combos: S2-044 |
| S2-045 | `available_table_ids` stays exactly as in stage 1: single tables only | not covered | combos: S2-045 |
| S2-046 | `available_options` lists every single table and declared pair with `capacity >= party_size` and no overlapping confirmed booking on any member, as `{table_ids, capacity}` | not covered | combos: S2-046 |
| S2-047 | Options order: singles in fixture order, then pairs in `combinable` order; ids within a pair in `combinable` order | not covered | combos: S2-047 |
| S2-048 | POST takes `table_ids`; `table_id` means a set of one; both → 422 | partial | combos: S2-048 |
| S2-049 | Responses always carry `table_ids`; `table_id` only for one-member sets (create, get, list, cancel, PATCH, moves) | partial (create, pair) | combos: S2-049 |
| S2-050 | A pair not in `combinable` → 422 `combination_not_allowed` | not covered | combos: S2-050 |
| S2-051 | Any table in the set taken for an overlapping interval → 409 | not covered | combos: S2-051 |
| S2-052 | `party_size` above the summed capacity → 422 `party_exceeds_capacity` | not covered | combos: S2-052 |
| S2-053 | A duplicate table id in the set → 422 `validation_failed` | not covered | combos: S2-053 |
| S2-054 | PATCH accepts `table_ids` under the same rules | not covered | combos: S2-054 |
| S2-055 | Cancelling frees every table in the set | not covered | combos: S2-055 |
| S2-056 | Stage-1 single-table request formats keep working | partial | combos: S2-056 |
| S2-057 | Moves accept `table_ids` per move; no table may sit in overlapping resulting bookings | not covered | combos: S2-057 |
| S2-058 | Wrong JSON types for `table_ids` → 400; empty set → 422 (J-2) | not covered | combos: S2-053 |
| S2-059 | Combination receipts replay unchanged and survive export/import | not covered | combos: S2-059 |
| S2-060 | Combination cell `slot-{t_a}+{t_b}-{HH:MM}`, ids in `combinable` order, shown when the pair is available for the party, with `data-available` | not covered | browser/grid: S2-060 |
| S2-061 | No cell for an undeclared or reordered pair | not covered | browser/grid: S2-061 |
| S2-062 | `booking-summary` names every table in the selection | not covered | browser/booking: S2-062 |
| S2-063 | `confirmation-tables` and `reservation-tables` contain every table label | not covered | browser/booking: S2-063 |
| S2-064 | A single-table booking's cell, confirmation and lookup are unchanged | partial | browser/booking: S2-064 |
| S2-065 | Concurrent bookings and amendments match some serial order; requirements hold at every read | not covered | concurrency2: S2-065 (two) |
| S2-066 | No horizontal page scroll at 375 px or at desktop width, through the whole flow | not covered | browser/screens: S2-066 |
| S2-067 | Every input has a visible label (J-8) | not covered | browser/screens: S2-067 |
| S2-068 | Keyboard focus is visible | not covered | browser/screens: S2-068 |
| S2-069 | Navigation is consistent across the four routes (J-9) | not covered | browser/screens: S2-069 |
| S2-070 | Available, unavailable and selected cells are visually distinct; refused and uncertain are distinct (J-10) | not covered | browser/grid: S2-070; browser/booking: S2-070 |
| S2-071 | Availability causes are labelled in words: available, booked, closed (J-7) | not covered | browser/grid: S2-071 |
| S2-072 | After any write (booking, cancel), visible grids and lookups re-read server state | partial (cancel on lookup) | browser/booking: S2-072; browser/lookup: S2-072 |
| S2-073 | No outbound network at run time: every page request goes to the service | not covered | browser/screens: S2-073 |
| S2-074 | Combined tables use human labels, never raw ids | not covered | browser/grid: S2-074; browser/booking: S2-063 |
| S2-075 | Screen routes are HTML and the API stays JSON; `GET /restaurants/{id}` carries `combinable` | not covered | combos: S2-075 |

## Stage-1 statements that stage 2 changes or extends

| Stage-1 ID | Change in stage 2 | Covered by |
|---|---|---|
| S1-060, S1-068, S1-070, S1-076, S1-100 | Every reservation body gains `table_ids`; `table_id` only for one-member sets | S2-049 |
| S1-053, S1-055 | Availability slots gain `available_options`; `available_table_ids` is unchanged | S2-045, S2-046 |
| S1-013, S1-050 | Fixtures gain `combinable`; seeds may carry `table_ids` and `status: "cancelled"` | S2-044, S2-075 |
| S1-062, S1-065, S1-067, S1-077 | Occupancy, capacity and not-found rules apply to every member and to summed capacity | S2-051, S2-052, S2-053 |
| S1-101..S1-109 | Moves accept `table_ids` per item | S2-057 |
| S1-006 | The `application/json` convention excludes the four screen routes | S2-075 |
| S1-092..S1-099 | Import must also accept a stage-1 export | S2-035 |
| S1-110..S1-112 | Concurrency must be serialisable over pairs and members | S2-065 |

## Not exercised by the supplied checks

**Not covered:** S2-003, S2-005, S2-006, S2-007, S2-008, S2-009, S2-010, S2-011, S2-012, S2-018,
S2-019, S2-036, S2-037, S2-038, S2-039, S2-040, S2-041, S2-042, S2-044, S2-045, S2-046, S2-047,
S2-050, S2-051, S2-052, S2-053, S2-054, S2-055, S2-057, S2-058, S2-059, S2-060, S2-061, S2-062,
S2-063, S2-065, S2-066, S2-067, S2-068, S2-069, S2-070, S2-071, S2-073, S2-074, S2-075.

**Partial:** S2-001, S2-015, S2-016, S2-023, S2-024, S2-030, S2-034, S2-035, S2-043, S2-048,
S2-049, S2-056, S2-064, S2-072.

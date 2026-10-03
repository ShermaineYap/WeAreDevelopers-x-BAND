# Tablekeeper stage 3: requirements ledger

**Sources.**
- `tablekeeper/spec/stage-3.md`.
- `stage-2.md` and `stage-1.md`, which still apply. Their ledgers are carried forward as
  `LEDGER-stage2.md` and `LEDGER-stage1.md`, and their tests run from this folder.
- The product brief in the foreman handoff.

**Columns.**
- *Supplied* says whether `tablekeeper/test/stage_3/test_sample.py` appears to exercise the line:
  `covered`, `partial`, or `not covered`.
- *Test* gives `<file>: <ID>`. Every test name starts with the ledger ID or IDs it covers.

## Interpretations chosen (dark run)

- **K-1. History field order.** `created` lists its changes in the same order as `changed`:
  `table_id` (or `table_ids`), `starts_at_local`, `party_size`.
- **K-2. History `at`.** RFC 3339 with an explicit offset, never decreasing in `seq` order.
- **K-3. No-op amendments.** No-op means the resulting values equal the current ones. All of these
  are no-ops, record nothing and keep the revision:
  - `{}`;
  - setting the current value;
  - `table_ids: [current single table]`;
  - a reversed declared pair.
- **K-4. Invalid policy values.** Every invalid policy field value is 422 `validation_failed`:
  booleans, non-integers, out-of-range numbers, bad dates, bad or duplicate weekdays, closes not
  after opens, missing or extra capacity ids. Non-numeric JSON strings for integer fields are not
  tested, because 400 versus 422 is unspecified.
- **K-5. `expected_revision`.**
  - 0, negatives, 1.5, `"1"`, `true` and `null` give 422.
  - A stale value gives 409 `stale_revision`. This is checked before the cutoff, before field
    validation, and before no-op detection.
- **K-6. Policy permissions.**
  - A restaurant without `manager_user_ids` has no managers, so anyone publishing gets 403.
  - A manager naming an unknown restaurant gets 404.
- **K-7. The policy response.** The 201 response echoes all six supplied fields unchanged, plus
  `policy_version`. `GET …/policies` returns those same objects.
- **K-8. Series membership.**
  - `already_in_series` applies to an anchor already adopted, and to any generated occurrence used
    as an anchor.
  - Concurrent adoptions of one anchor under different keys give exactly one 201; the rest get 409
    `already_in_series`.
- **K-9. Unchanged series.** `GET /series/{id}` equals the POST body when nothing has changed since.
- **K-10. Cancelling the anchor.** This bumps the series revision once, like cancelling any
  occurrence.
- **K-11. Imported bookings.** Bookings imported from a stage-1 or stage-2 export get revision 1 and
  policy-0 `accepted_terms` taken from the imported restaurant configuration.
  - History and decision answer 200 to the owner and 404 to anonymous callers.
  - Pre-import history content is not asserted. New entries continue with contiguous `seq`.
- **K-12. Restaurant revision.** "Restaurant revision" (S3-066, S3-096) has no stage-3 read
  endpoint, so it is not tested here. It becomes observable in stage 4.
- **K-13. Two stage-1 assertions adjusted.** S1-070 (cancel response equals the booking apart from
  status) and S1-108 (move response equals the booking apart from party size) now also ignore
  `revision`. Stage 3 requires cancel and real moves to increment it (S3-046, S3-090). Nothing else
  in the carried stage-1 and stage-2 suites is altered.

## Ledger

| ID | Statement (quoted / close paraphrase) | Supplied | Test |
|---|---|---|---|
| S3-001 | `explain` is optional; only `true` is accepted; `false`, `1`, `""` and anything else → 422 | not covered | explain-history: S3-001 |
| S3-002 | Without `explain`, the response keeps its earlier shape; no explanation fields | covered | explain-history: S3-002 |
| S3-003 | With `explain`, every slot carries `explain`; every table appears exactly once, in fixture order | partial (first slot) | explain-history: S3-003 |
| S3-004 | Both rules for every table, in the order `capacity`, `no_overlap`; a holding rule is reported holding even when the other fails; both false when both fail | partial (names only) | explain-history: S3-004 |
| S3-005 | `available` is true exactly when both hold; the available ids equal `available_table_ids` in order | partial | explain-history: S3-005 |
| S3-006 | A closed day still returns `[]`; a slot with no available table still has a full `explain` | not covered | explain-history: S3-006 |
| S3-007 | Each table explanation identifies its `policy_version` (the selected policy) | not covered | explain-history: S3-007; policies: S3-027 |
| S3-008 | The capacity rule uses the selected policy's capacities; `no_overlap` counts confirmed bookings only | not covered | explain-history: S3-008 |
| S3-010 | History is owner-only: another user, or no token, gets 404 `not_found` (not 401) | not covered (sample says graded) | explain-history: S3-010 |
| S3-011 | A cancelled reservation still has its history | not covered | explain-history: S3-011 |
| S3-012 | `{reference, entries}`; `seq` starts at 1 and steps by exactly 1; `seq` order is `at` order | partial ([1,2]) | explain-history: S3-012 |
| S3-013 | `created` names all three fields, each `from: null` (K-1 order) | covered (set) | explain-history: S3-013 |
| S3-014 | `changed` names only changed fields, in the order `table_id`, `starts_at_local`, `party_size` | partial (one field) | explain-history: S3-014 |
| S3-015 | A PATCH to the existing value succeeds and records no entry | not covered | explain-history: S3-015 |
| S3-016 | `cancelled` has empty `changes`, and nothing follows it | not covered | explain-history: S3-016 |
| S3-017 | Replaying `POST /reservations` records nothing | not covered | explain-history: S3-017 |
| S3-018 | Each entry carries its resulting `revision` and complete `accepted_terms`; old entries never acquire newer terms | not covered | explain-history: S3-018 |
| S3-020 | `manager_user_ids` (default `[]`); only managers publish; unknown restaurant → 404; non-manager → 403; no token → 401; managers gain no access to diners' lookup, history or decision | partial (manager succeeds) | policies: S3-020 (two) |
| S3-021 | Publishing needs an `Idempotency-Key` with stage-1 replay rules; replays allocate no version | not covered | policies: S3-021 |
| S3-022 | 201 returns the policy plus `policy_version`, starting at 1 and stepping by one per restaurant; failures allocate none | partial (first = 1) | policies: S3-022 |
| S3-023 | Validation (K-4): every field required; real date; grid and duration 1..1440; cutoff 0..10080; booleans are not integers; stage-1 opening hours with no duplicate weekdays; capacities name exactly the table ids, 1..100 → 422, with no version or state change | not covered | policies: S3-023 |
| S3-024 | Unknown fields ignored; a policy cannot change table ids, labels, timezone or combinations | not covered | policies: S3-021, S3-023 |
| S3-025 | `GET …/policies` is public, in publication order, omits policy 0 | not covered | policies: S3-025 |
| S3-026 | Restaurant detail still returns the original fixture configuration | not covered | policies: S3-026 |
| S3-027 | Selection: greatest `effective_from` not after the local start date; ties by greatest version; publication order can differ; past dates allowed; policy 0 before any | partial | policies: S3-027 (two) |
| S3-028 | Availability and booking use the selected policy: grid, hours, duration, capacities, pair capacity | not covered | policies: S3-028 |
| S3-029 | Reservation responses gain `revision` (1 at creation) and `accepted_terms` (entire policy except `effective_from`, plus `policy_version`) | partial | policies: S3-029 |
| S3-030 | Seeded bookings start at revision 1 under policy 0 | not covered | policies: S3-030 |
| S3-031 | Responses to old idempotency keys remain the original, with the original revision and terms | not covered | policies: S3-031 |
| S3-032 | Publishing never changes existing bookings, end times, occupancy or history | not covered | policies: S3-032 |
| S3-033 | `GET …/decision` gives `{reference, revision, accepted_terms}`, current and after cancel; owner-only 404, including without a token | partial | policies: S3-033 |
| S3-040 | Cancel checks the accepted cutoff against the current start | not covered | amend3: S3-040 |
| S3-041 | A real amendment checks the old accepted cutoff first | not covered | amend3: S3-041 |
| S3-042 | …then validates all resulting fields against the policy for the resulting start date | not covered | amend3: S3-042 |
| S3-043 | …and atomically replaces terms and end time, incrementing revision once | not covered | amend3: S3-041, S3-042, S3-043 |
| S3-044 | A no-op keeps terms, end time and revision, records no history, and still needs a confirmed, editable booking | not covered | amend3: S3-044 |
| S3-045 | Failed amendments change nothing | not covered | amend3: S3-045 |
| S3-046 | Cancel increments revision once; repeated cancel does not | not covered | amend3: S3-046 |
| S3-047 | `expected_revision`: mismatch → 409 `stale_revision` before cutoff and validation; invalid → 422; omitted → stage-1 semantics (K-5) | not covered | amend3: S3-047 |
| S3-048 | Concurrent amendments on one revision: at most one real change succeeds | not covered | amend3: S3-048 |
| S3-050 | `POST /series` needs a token (401) and a key (400); replay rules | not covered | series: S3-050 |
| S3-051 | Anchor rules: unknown or someone else's → 404; cancelled → 409 `reservation_cancelled`; already adopted → 409 `already_in_series`; must satisfy the accepted cutoff | not covered | series: S3-051 |
| S3-052 | `count` is an integer 2..12, `interval_weeks` 1..4; booleans and invalid values → 422 | not covered | series: S3-052 |
| S3-053 | 201 `{series_id, revision: 1, interval_weeks, occurrences[{index, reference, exception: false, reservation}]}`, all occurrences in index order | partial (count) | series: S3-053 |
| S3-054 | Occurrence 0 is the anchor, unchanged: reference, identity, revision, terms, history, timestamps, original response | partial (body equal) | series: S3-054 |
| S3-055 | Occurrence i is on the anchor date + i × interval × 7 days, same local time, same party and table selection | not covered | series: S3-055 (two) |
| S3-056 | Each occurrence selects its own date's policy (duration, capacity) and follows hours, DST and occupancy rules | not covered | series: S3-056 |
| S3-057 | A nonexistent local time rejects the whole adoption (`invalid_local_time`); a repeated time is its first occurrence | not covered | series: S3-057 |
| S3-058 | All-or-nothing: no partial series, reservations, histories, counters or key claims; the first failing occurrence in index order decides the error | not covered | series: S3-058 |
| S3-059 | Occurrences have distinct references, appear in lists, occupy tables and have ordinary histories | not covered | series: S3-059 |
| S3-060 | `GET /series/{id}` gives the same shape with current states; owner-only; another user or no token → 404 | not covered | series: S3-060 |
| S3-061 | A real PATCH permanently marks the occurrence an exception and bumps the series revision once; no-ops and failures do neither | not covered | series: S3-061 |
| S3-062 | Cancelling an occurrence bumps the series revision once without marking an exception; repeat cancel does nothing; cancelling the anchor spares its siblings | not covered | series: S3-062 |
| S3-063 | Replays return the original series response even after changes, and change no counter | not covered | series: S3-063 (two) |
| S3-064 | Unknown fields are ignored on series creation | not covered | series: S3-053 |
| S3-065 | Adoption works on reservations imported from stage-1 or stage-2 exports | not covered | upgrade3: S3-065 |
| S3-066 | Adoption increments the restaurant revision once (K-12) | not covered | — (not observable in stage 3) |
| S3-070 | A stage-1 export is accepted; sessions, confirmation links and original retries stay valid | not covered | upgrade3: S3-070 (`PREVIOUS_STAGE1_BASE_URL`) |
| S3-071 | A stage-2 export is accepted, the same way | not covered | upgrade3: S3-071 (`PREVIOUS_BASE_URL`) |
| S3-080 | Accepted terms apply to combinations; capacity is the sum of the selected policy's capacities | not covered | moves3: S3-080; policies: S3-028 |
| S3-081 | History keeps `table_id` for single-to-single changes | not covered | moves3: S3-081; explain-history: S3-014 |
| S3-082 | Creating a pair records `table_ids` from null to the pair, in declared order | not covered | moves3: S3-082 |
| S3-083 | A change involving a pair records `table_ids`, with complete before and after lists | not covered | moves3: S3-083 |
| S3-084 | A reversed input pair names the same set and is not an amendment on its own | not covered | moves3: S3-084 |
| S3-090 | Each real move: old accepted cutoff first, then the new date's policy; one revision and one `changed` entry | not covered | moves3: S3-090 (two) |
| S3-091 | Per-move `expected_revision` follows PATCH validation and stale rules | not covered | moves3: S3-091 |
| S3-092 | A no-op move keeps terms, revision and history | not covered | moves3: S3-092 |
| S3-093 | A failed batch leaves every booking, revision, history and exception flag unchanged | not covered | moves3: S3-093 |
| S3-094 | Each affected series gets one revision per batch; changed occurrences become permanent exceptions | not covered | moves3: S3-094 |
| S3-095 | A replayed batch changes no revisions, histories or exception flags | not covered | moves3: S3-095 |
| S3-096 | The restaurant revision increases once per batch (K-12) | not covered | — (not observable in stage 3) |
| S3-100 | The stage-2 grid follows the selected policy (slots, capacities, `data-available`) | not covered | browser/policies-ui: S3-100 |
| S3-101 | After writes (policy publication, amendment, cancel), screens re-read the server: a new search and lookup show the current state | not covered | browser/policies-ui: S3-101 |
| S3-102 | No new screens; stage-2 screens and API keep working (regression) | not covered | all carried stage-1/2 suites |
| S3-103 | A day closed by the selected policy is labelled "closed" in the grid, like a fixture-closed day (brief: causes in human words; "decisions use the selected policy") | not covered | browser/policy-closed: S3-103 |

## Stage-1 and stage-2 statements that stage 3 changes or extends

| Earlier ID | Change in stage 3 | Covered by |
|---|---|---|
| S1-060, S2-049 | Every reservation body gains `revision` and `accepted_terms` | S3-029 |
| S1-053, S1-055, S2-046 | Slot values (grid, duration, hours, capacities, options) come from the selected policy, not the fixture | S3-028, S3-100 |
| S1-064, S1-065, S1-077, S2-052 | Hours, grid and capacity validation use the policy for the (resulting) date | S3-028, S3-042 |
| S1-072..S1-074, S1-078 | Cancel and amend use the **accepted** cutoff, not the restaurant's current one | S3-040, S3-041 |
| S1-070, S1-071 | Cancel increments revision once; a repeat leaves it (K-13 adjusts S1-070) | S3-046 |
| S1-076, S1-080..S1-082 | Amendments replace terms and end time and bump revision; no-ops change nothing; optional `expected_revision` | S3-043, S3-044, S3-047 |
| S1-100..S1-109, S2-057 | Moves use PATCH semantics per item, plus revision, history, series and `expected_revision` (K-13 adjusts S1-108) | S3-090..S3-095 |
| S1-034, S1-037 | New public endpoint `GET …/policies`; history and decision answer 404 rather than 401 without a token | S3-010, S3-025, S3-033 |
| S1-039, S1-048 | A third idempotent path (`POST /series`) and a fourth (`POST …/policies`) | S3-021, S3-050, S3-063 |
| S1-013, S2-044 | Fixtures gain `manager_user_ids`; seeds get revision 1 under policy 0 | S3-020, S3-030 |
| S1-092..S1-099, S2-035 | Import must accept stage-1 and stage-2 exports; series, policies and history survive this service's own export | S3-070, S3-071 |
| S2-003..S2-012, S2-060 | The UI grid and booking flow run under policies, unchanged otherwise | S3-100, S3-101 |

## Not exercised by the supplied checks

**Not covered:** S3-001, 006, 007, 008, 010, 011, 015, 016, 017, 018, 021, 023, 024, 025, 026, 028, 030,
031, 032, 040, 041, 042, 043, 044, 045, 046, 047, 048, 050, 051, 052, 055, 056, 057, 058, 059, 060,
061, 062, 063, 064, 065, 066, 070, 071, 080, 081, 082, 083, 084, 090, 091, 092, 093, 094, 095, 096,
100, 101, 102, 103.

**Partial:** S3-003, 004, 005, 012, 014, 020, 022, 027, 029, 033, 053, 054.

**Covered:** S3-002, 013.

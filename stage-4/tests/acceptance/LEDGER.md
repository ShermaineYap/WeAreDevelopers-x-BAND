# Tablekeeper stage 4: requirements ledger

**Sources.**
- `tablekeeper/spec/stage-4.md`.
- `stage-3.md`, `stage-2.md` and `stage-1.md`, which still apply. Their ledgers are carried as
  `LEDGER-stage3.md`, `LEDGER-stage2.md` and `LEDGER-stage1.md`, and their tests run from this
  folder **unchanged**: no carried assertion needed adjusting for stage 4.
- The product brief in the foreman handoff.

**Columns.**
- *Supplied* says whether `tablekeeper/test/stage_4/test_sample.py` appears to exercise the line.
- *Test* gives `<file>: <ID>`. Every test name starts with the ledger ID or IDs it covers.

## Interpretations chosen (dark run)

- **L-1. Considered bookings.** These are every confirmed booking at the restaurant whose
  `[starts_at, ends_at)` overlaps `[from, to)`, on **any** table. All other confirmed bookings are
  fixed. Considered bookings on other tables may move only if that improves the objective; in
  practice the first criterion keeps them where they are. Cancelled bookings and other
  restaurants' bookings are never considered.
- **L-2. Objective.**
  - "Changed" compares table **sets**.
  - Capacity and unused seats are computed from each booking's own `accepted_terms.capacities`.
  - Ranks: singles 0..n-1 in fixture order, then pairs in declared order.
  - The rank vector follows ascending reference (string) order and is compared lexicographically.
  - The tests compare the service with an exhaustive reference search written from the spec
    (`lib4.mjs` `optimalPlan`).
- **L-3. The `reassigned` history entry.** It has the shape
  `{seq, at, event: "reassigned", changes: [{field: "table_ids", from: [...], to: [...]}], plan_id, revision, accepted_terms}`.
  It always uses `table_ids`, even single to single, because the spec says "a `table_ids`
  change". `accepted_terms` is unchanged.
- **L-4. What the restaurant revision counts.** Each of these adds exactly 1:
  - a new booking;
  - a real amendment;
  - a cancellation (not a repeat);
  - a policy publication;
  - a plan application;
  - a series adoption (stage 3);
  - a batch move, if anything in it changed (stage 3);
  - a series amendment, if anything in it changed.

  Seeds, previews, no-ops, failures and replays add nothing, and other restaurants' writes never
  count. The tests read the revision from `restaurant_revision` in a harmless preview, a closure in
  2099 that considers nothing.
- **L-5. Applying an applied plan.** Using a different key gives 409 `plan_already_applied`, even
  though the revision has moved since. That code takes precedence over `stale_plan`.
- **L-6. The replan preview.**
  - It is idempotent: a replay returns the same `plan_id` and body.
  - Missing `table_id`, `from` or `to`, a missing offset, an unparseable instant, or `from >= to`
    → 422.
  - `Z` counts as an explicit offset.
  - Unknown table → 404; unknown restaurant → 404; non-manager → 403.
  - The `closure` echo is compared as instants.
- **L-7. Series amendment.**
  - `expected_revision`, `from_index` and `local_time` are all required. Wrong types (booleans,
    strings, fractions) → 422.
  - `from_index` ≥ count → 422.
  - Its own non-occupancy errors (`outside_opening_hours`, `not_on_slot_grid`,
    `party_exceeds_capacity`) take precedence over occupancy, in index order.
  - The cutoff-before-policy order can't be set up black-box: the eligible occurrences are at least
    7 days out and a cutoff is at most 10080 minutes. It is reviewed in code instead.
- **L-8. Closed tables in the grid (product brief).** After a plan is applied, a cell blocked by
  the closure must be described (text, `aria-label` or `title`) with `/closed/i` and not
  `/booked/i`, and must look different from a booked cell.
  - The spec's `explain` gives `no_overlap: false` for both closures and bookings. The UI needs
    another way to tell them apart.
  - Any additive public read is acceptable, provided `explain` keeps its exact stage-3 shape.
- **L-9. `planning_limit`.** Larger inputs "may" return 422 `planning_limit`. That is optional, so
  it is not tested. Inputs within the limits (6 tables, 4 pairs, 6 considered) must plan
  optimally.
- **L-10. Stage-1/2 exports carry no managers.** Those stages ignore `manager_user_ids`, so a
  replan is exercised only on stage-3 imports. Stage-1/2 imports are exercised through receipts,
  adoption and series amendment.
- **L-11. Export/import of stage-4 state.** Applied closures and plan receipts survive this
  service's own export/import.

## Ledger

| ID | Statement (quoted / close paraphrase) | Supplied | Test |
|---|---|---|---|
| S4-001 | Replans need a manager (403 otherwise, 401 without a token), an idempotency key (400), a known restaurant (404) | partial (manager succeeds) | replan: S4-001 |
| S4-002 | Instants carry explicit offsets with `from < to`; invalid interval → 422; unknown table → 404 (L-6) | not covered | replan: S4-002 |
| S4-003 | 201 `{plan_id, restaurant_revision, closure{table_id,from,to}, assignments, moved_count, unused_seats}`; nothing to move gives an empty plan | partial (empty plan) | replan: S4-003 |
| S4-004 | The closure is half-open `[from,to)`; considered = confirmed bookings overlapping it; others keep their assignments (L-1) | not covered | replan: S4-004, S4-003 |
| S4-005 | Objective order: fewest moved, then fewest unused seats, then the lowest rank vector by reference | not covered | replan: S4-005 |
| S4-006 | Capacity is judged under each booking's **own** accepted terms; no conflicts with fixed bookings | not covered | replan: S4-006 |
| S4-007 | Exhaustive optimum within the limits (6 tables, 4 pairs, 6 considered bookings) | not covered | replan: S4-007 |
| S4-008 | Assignments cover every considered booking, in reference order, with `table_ids` in declared order and `changed` | partial | replan: S4-005, S4-008 |
| S4-009 | `restaurant_revision` in a preview is the current revision | not covered | replan: S4-003; revision: S4-030 |
| S4-010 | A preview stores only a plan: no closure, occupancy, reservation revision or history changes | not covered | replan: S4-010 |
| S4-011 | No feasible plan → 409 `no_feasible_plan`, changing nothing | not covered | replan: S4-011 |
| S4-012 | Previews are idempotent writes (replay 200, same plan; a different body → 409 reuse) | not covered | replan: S4-012 |
| S4-013 | Diners' cancellation cutoffs do not prevent a repair; no booking disappears or is cancelled | not covered | replan: S4-013; apply: S4-021 |
| S4-014 | Larger inputs may give 422 `planning_limit` (L-9) | not covered | — (optional) |
| S4-020 | Apply needs a manager and a key; an unknown plan, or one from another restaurant → 404 | not covered | apply: S4-020 |
| S4-021 | 201 `{plan_id, restaurant_revision: old+1, reservations}` covering every considered booking in reference order; times, party, terms and identity kept | not covered | apply: S4-021 |
| S4-022 | Each moved booking: revision +1 and one `reassigned` entry with a `table_ids` change and `plan_id` (L-3); unmoved bookings gain nothing; restaurant +1 once | not covered | apply: S4-022 |
| S4-023 | Afterwards the closure excludes singles and pairs from availability; creates and amendments → 409 `table_unavailable`; explain `no_overlap` false | not covered | apply: S4-023 |
| S4-024 | Any intervening restaurant revision → 409 `stale_plan`, changing nothing; previews, failures, no-ops, replays and other restaurants do not stale a plan | not covered | apply: S4-024 |
| S4-025 | Already applied under another key → 409 `plan_already_applied`; replay of the successful key → 200 original, even after later changes | not covered | apply: S4-025 |
| S4-026 | Previously applied closures constrain later plans; a closure at another restaurant does not invalidate this plan | not covered | apply: S4-026 |
| S4-027 | Repairs may move series occurrences: exception flags, dates, identities and terms kept; series revision +1 per application if any member moved | not covered | apply: S4-027 |
| S4-028 | Concurrent applications leave no partially moved bookings; application is atomic | not covered | apply: S4-028 |
| S4-029 | Applied closures and plan receipts survive export/import (L-11) | not covered | apply: S4-029 |
| S4-030 | Restaurant revision starts at 0 after reset and counts each successful state change once; no-ops, failures, previews and replays do not count (L-4) | not covered | revision: S4-030 |
| S4-031 | Reset returns the revision to 0 | not covered | revision: S4-031 |
| S4-040 | Series amend is an owner-only idempotent write: 404 for unknown or someone else's, 401, 400 key, replay 200 original even after edits, unknown fields ignored | partial (201) | series-amend: S4-040 |
| S4-041 | Validation: revision a positive integer; `from_index` 0..count-1; `local_time` exactly HH:MM 00:00..23:59; booleans invalid → 422; a stale revision → 409 before any booking validation | not covered | series-amend: S4-041 |
| S4-042 | Eligible occurrences (index ≥ `from_index`, not cancelled, not exception) change their clock time on their scheduled dates, keeping reference, party and tables | partial (all to 20:00) | series-amend: S4-042 |
| S4-043 | 201 is the current series; each changed occurrence gets one `changed` entry and +1 revision; series and restaurant +1 once; no exceptions marked | not covered | series-amend: S4-043 |
| S4-044 | Identical results are no-ops; all-no-op or an empty eligible set succeed with no revision change | not covered | series-amend: S4-044 |
| S4-045 | Each real change checks its old accepted cutoff, then adopts its resulting date's policy (L-7) | not covered | series-amend: S4-045 |
| S4-046 | Non-occupancy errors in index order precede occupancy; failure changes nothing, and the key stays reusable | not covered | series-amend: S4-046 |
| S4-047 | Results must not conflict with unchanged occurrences, other bookings or applied closures | not covered | series-amend: S4-047 |
| S4-048 | Concurrent amendments from one expected revision: at most one real change | not covered | series-amend: S4-048 |
| S4-050 | Stage-3 exports are accepted: series (with moved and cancelled occurrences), histories, policies and receipts stay valid; series amend and repairs work on them | not covered | upgrade4: S4-050 (`PREVIOUS_BASE_URL`) |
| S4-051 | Stage-1 and stage-2 exports are accepted; receipts stay valid; imported bookings can be adopted and series-amended | not covered | upgrade4: S4-051 (`PREVIOUS_STAGE2_BASE_URL`, `PREVIOUS_STAGE1_BASE_URL`) |
| S4-060 | Availability screens reflect an applied plan: closure cells unavailable and labelled "closed", distinct in text and style from booked and available (brief, L-8) | not covered | browser/closure-ui: S4-060 |
| S4-061 | Lookup reflects an applied plan (new table labels) | not covered | browser/closure-ui: S4-061 |

## Earlier statements that stage 4 changes or extends

| Earlier ID | Change in stage 4 | Covered by |
|---|---|---|
| S1-055, S2-046, S3-005, S3-008 | Availability (singles and pairs) also excludes tables closed by applied plans; `explain` reports `no_overlap: false` for a closure | S4-023 |
| S1-062, S2-051, S1-077, S1-105, S3-056 | Creates, amendments, moves, series creation and series amendment conflict with closures → 409 `table_unavailable` | S4-023, S4-047 |
| S3-012..S3-018, S3-081..S3-083 | History gains a `reassigned` event, with a `table_ids` change and `plan_id` | S4-022 |
| S3-029, S3-046 | Reservation revisions also move on plan application (+1 for moved bookings only) | S4-022 |
| S3-061, S3-062, S3-094 | Series revisions also move on plan application and series amendment; amendments and repairs never mark exceptions | S4-027, S4-043 |
| S3-066, S3-096 | The restaurant revision becomes observable; counting rules extended (L-4) | S4-030 |
| S1-039, S3-021, S3-050 | Three new idempotent write paths: replans, apply, series amend | S4-012, S4-025, S4-040 |
| S3-070, S3-071 | Imports must also accept stage-3 exports | S4-050 |
| S2-071 (brief) | "Closed" becomes a real cell cause (a table removed by a closure) | S4-060 |

## Not exercised by the supplied checks

**Not covered:** S4-002, 004, 005, 006, 007, 009, 010, 011, 012, 013, 014, 020, 021, 022, 023, 024, 025,
026, 027, 028, 029, 030, 031, 041, 043, 044, 045, 046, 047, 048, 050, 051, 060, 061.

**Partial:** S4-001, 003, 008, 040, 042.

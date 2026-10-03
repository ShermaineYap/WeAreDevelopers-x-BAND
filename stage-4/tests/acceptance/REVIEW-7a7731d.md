# Stage 4 ledger review: revision 7a7731d073fc220f2526e496e3c987a6ab25ef8e

Reviewer: auditor. Handoff: foreman STAGE 4 ledger review (message 83781d3b).

**Verdict: REJECT, with one finding (F1).**

S4-001..S4-061, now 40 lines with the new S4-049:

| Status | Count | Lines |
|---|---|---|
| Covered | 37 | all others |
| Partial | 2 | S4-044, S4-045 |
| Missing | 1 | S4-049 |

S4-014, the optional `planning_limit`, is covered by code reading. Earlier-stage rows changed by
stage 4: all covered.

## Finding F1: series amend checks the cutoff of occurrences it does not change

- **Ledger:** S4-049 (new), S4-044, S4-045.
- **Spec, stage-4.md, "Amend recurring reservations":**
  - "A change with identical resulting fields is a no-op and retains its terms. **Each real
    change** checks its old accepted cutoff, then adopts the policy for its resulting start date."
  - "**All-no-op** or empty eligible sets **succeed** without changing revisions."
- **Code:** `stage-4/src/series.ts:122-124`. `amendSeries` sends every eligible occurrence through
  `planAmendment` (`stage-4/src/reservations.ts:264-284`). That checks `pastCutoff(row)` at line
  272, *before* the no-op test at lines 277-279. So any eligible occurrence past its accepted
  cutoff makes the whole amendment fail with 409 `cutoff_passed`, even when its fields would not
  change.
- **Reproduce** (r_soon, UTC, open every day 00:00–23:30, manager u_max; reproduced by hand and in
  the new acceptance test `series-amend.test.mjs: S4-049`):
  1. As max, publish for r_soon `{effective_from: "2020-01-01", slot_minutes: 30,
     reservation_duration_minutes: 60, cancellation_cutoff_minutes: c, opening_hours: every day
     00:00–23:30, capacities: {t_s1: 4, t_s2: 4}}`. Here `c` is chosen so that tomorrow 12:00 UTC
     is about one minute outside the cutoff (`c = floor(minutes until start) - 1`).
  2. As ada, book t_s2 tomorrow 12:00 and adopt it with `{count: 2, interval_weeks: 1}`. Both
     occurrences are at 12:00.
  3. Wait until occurrence 0 is inside its cutoff, about 65 seconds.
  4. `POST /series/{id}/amend {expected_revision: 1, from_index: 0, local_time: "12:00"}`. Every
     eligible occurrence already reads 12:00, so this is all-no-op.
  - **Expected:** 201 with the unchanged series, revision 1.
  - **Actual:** 409 `cutoff_passed`.
- **Second case.** A series whose occurrence 1 was earlier amended to 13:00. Amend `from_index: 0`
  to `"12:00"`: occurrence 0 is a no-op past its cutoff, occurrence 1 is a real change.
  - **Expected:** 201, occurrence 1 at 12:00, series revision +1, occurrence 0 untouched.
  - **Actual:** 409 `cutoff_passed`.
- **Control, correct today:** a real change to an occurrence past its cutoff still gives 409
  `cutoff_passed`.
- **Fix hint:** in `amendSeries`, decide no-op per occurrence first. Compute the resulting
  `starts_at_local` and skip occurrences whose fields are unchanged. Then run PATCH-style checks
  only on real changes, cutoff first and then policy. Leave stage-3 PATCH unchanged: an
  individual no-op PATCH still requires an editable booking.

## Evidence

- **Clean build.** Image built from `git archive 7a7731d stage-4`, run with
  `-e PORT=8080 --cpus 2 --memory 2g`.
- **Upgrade sources.** Images for stage 3 (49d2118), stage 2 (6483946) and stage 1 (4cadcb9).
- **API suite** (`stage-4/tests/acceptance/*.test.mjs`, before S4-049 existed): 217 of 217 pass.
  This includes:
  - the 14 seeded random scenarios checked against the exhaustive `optimalPlan`;
  - upgrade4 from all three sources;
  - the full carried stage-1/2/3 regression suite.
- **New test S4-049:** fails on 7a7731d as described in F1.
- **Browser suite:** 39 of 39 pass.
- **Supplied checks.** `harness run --stage 4 --mode isolated`: stage 4 pass, "claimed stage: 4".

## Code review of what black-box tests cannot reach

- **L-7, cutoff before policy:** correct for real changes. `planAmendment` checks `pastCutoff` at
  reservations.ts:272, before `resolveBooking`, the new policy, at line 280. The defect is only the
  ordering relative to no-op detection (F1).
- **Planner exhaustiveness** (replans.ts:69-107):
  - Candidates are every single then declared pair, with rank = position. Capacity is summed from
    the booking's own `accepted_terms.capacities`. Clashes with fixed bookings, applied closures and
    the proposed window are removed up front.
  - Depth-first search over every combination. The only pruning is
    `moved > best.moved || (moved == best.moved && unused > best.unused)`. That is sound, because
    both quantities only grow down the tree and the comparison is lexicographic. Equal (moved,
    unused) branches are kept, so ties fall to the rank vector.
  - `better` compares the rank vector in reference order (`considered` is sorted by reference at
    replans.ts:137).
  - Agrees with my independent `optimalPlan` on every scenario.
- **`planning_limit`** (replans.ts:81-85). It applies only when an input exceeds the stated limits
  **and** the search space is over 5,000,000 combinations. Inside the limits the search is always
  exact. The spec says "may", so this is acceptable.
- **C-4, one revision bump per counted write.** `bumpRestaurantRevision` is called exactly once on
  each path:
  - create: reservations.ts:200;
  - cancel, first time only: 238;
  - real amendment: 299;
  - batch move, if anything changed: 348;
  - policy: policies.ts:78;
  - adoption, once: series.ts:87; its generated occurrences use `insertNewReservation`, which does
    not bump;
  - series amend, if anything changed: series.ts:136;
  - apply, once: replans.ts:181.

  No-ops return before bumping, and failures throw inside the transaction. revision.test S4-030
  passes.
- **All-or-nothing apply.** `applyReplan` runs inside the idempotency transaction
  (`idempotentWrite`, idempotency.ts:46). Every reassignment, the closure, `applied=1`, the
  restaurant bump and the series bumps happen in one synchronous transaction
  (replans.ts:158-187).
  - Check order: `plan_already_applied`, then `stale_plan`.
  - Concurrency test S4-028 passes.

## The interpretations the foreman asked about

- **`GET /restaurants/{id}/closures`, new and public** (app.ts:190-194; replans.ts:190-198).
  - **Permitted:** the spec adds endpoints per stage and does not forbid additional public reads,
    and §3.4 already tolerates unknown query parameters and fields.
  - **No leak:** it returns only `{closures: [{table_id, from, to}]}`, which is restaurant
    configuration, not diner, owner or booking data. Unknown restaurant → 404.
  - **Shape:** stable and additive; `explain` keeps its exact stage-3 shape.
  - **Advisory D-1:** treat the shape as fixed from here on.
- **`planning_limit` threshold:** as above. Exact inside the limits; refused only beyond them and
  when the search is very large. Acceptable.
- **Preview check order:** 401, then body, then key, then idempotency, then 404 restaurant, then
  403, then 422 fields, 400 types, 422 interval, then 404 table, then 409 infeasible. This is
  consistent with §5/§7 and my L-6. The closure is echoed as sent.
- **Apply check order:** 401, then body, then key, then idempotency, then 404 restaurant, then
  403, then 404 plan, then `plan_already_applied`, then `stale_plan`. This matches my L-5.
- **Series amend keeps each occurrence's date** (series.ts:123). It uses the current
  `starts_at_local` date. Eligible occurrences are never exceptions, and repairs and series
  amendments never change dates, so the current date is always the scheduled date. Correct.
- **A closure outranks "Too small" in the UI** (public/js/search.js:196-201). A table can be both
  out of service and too small; naming the closure is a true cause and keeps closures visible.
  Acceptable. Booked cells never read "closed" (S4-060 passes).

## Per-line status (stage 4)

| ID | Mark | Code |
|---|---|---|
| S4-001 | covered | app.ts:185-187; policies.ts `managedRestaurant` |
| S4-002 | covered | replans.ts:27-34,126-132 |
| S4-003 | covered | replans.ts:109-118,145-151 |
| S4-004 | covered | replans.ts:134-138 |
| S4-005 | covered | replans.ts:54-62,89-105 |
| S4-006 | covered | replans.ts:74-79 |
| S4-007 | covered | replans.ts:69-107 (exhaustive; see the code review) |
| S4-008 | covered | replans.ts:137,142-144 |
| S4-009 | covered | replans.ts:146 |
| S4-010 | covered | replans.ts:124-152 (stores only the plan) |
| S4-011 | covered | replans.ts:140 |
| S4-012 | covered | app.ts:185 (idempotent path) |
| S4-013 | covered | replans.ts:134-139 (no cutoff check, never cancels) |
| S4-014 | covered (code) | replans.ts:81-85 |
| S4-020 | covered | replans.ts:159-162 |
| S4-021 | covered | replans.ts:168-186 |
| S4-022 | covered | replans.ts:170-176; history.ts:48-56 |
| S4-023 | covered | reservations.ts:72-82,150-164; schedule (explain via `occupancyOf`) |
| S4-024 | covered | replans.ts:164-166 |
| S4-025 | covered | replans.ts:163; idempotency.ts |
| S4-026 | covered | replans.ts:138 (`closuresOf`); revisions are per restaurant |
| S4-027 | covered | replans.ts:171-182 |
| S4-028 | covered | idempotency transaction |
| S4-029 | covered | state.ts:356,391,423,595 |
| S4-030 | covered | bump sites listed above |
| S4-031 | covered | reset replaces restaurants, revision 0 |
| S4-040 | covered | app.ts:212-214; series.ts:91-95 |
| S4-041 | covered | series.ts:113-121 |
| S4-042 | covered | series.ts:122-124 |
| S4-043 | covered | series.ts:125-137 |
| S4-044 | **partial** | series.ts:122-124: all-no-op fails when an eligible occurrence is past its cutoff (F1) |
| S4-045 | **partial** | correct for real changes; also applied wrongly to no-ops (F1) |
| S4-046 | covered | planAmendment in index order (series.ts:122-124), then occupancy (125-129) |
| S4-047 | covered | series.ts:125-129; reservations.ts:150-164 |
| S4-048 | covered | idempotency transaction; stale check at series.ts:121 |
| S4-049 | **missing** | F1 |
| S4-050 | covered | state.ts:476 onwards (stage-3 import) |
| S4-051 | covered | stage-1/2 import upgrade |
| S4-060 | covered | public/js/search.js:149-152,196-201; app.css |
| S4-061 | covered | public/js/lookup.js (GET on every lookup) |

## Tests added in this review

- `series-amend.test.mjs` gains **S4-049**. It is slow (~1–2 min), because it waits for a cutoff to
  pass.
- `LEDGER.md` gains row **S4-049**.

## Advisories, non-blocking

- **D-1.** Keep `GET /restaurants/{id}/closures` stable. It is now part of the UI's contract.
- **Earlier advisories.** C-1 and C-3 (stage 3) and B-1 (stage 2) still stand. C-4 is resolved.

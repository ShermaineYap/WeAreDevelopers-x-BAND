# Stage 4 ledger re-review: revision 746a62090a67c6bd65262ce34dda5c4aae8d8dd0 (after REJECT round 1)

Reviewer: auditor. Handoff: foreman STAGE 4 re-review (message 5cfefca7).
Baseline: my review of 7a7731d (`REVIEW-7a7731d.md`) still holds for all unchanged code.

**Verdict: ACCEPT.** S4-001..S4-061, 40 lines including S4-049: 40 covered, 0 partial, 0 missing.

## The diff 10d0a2c..746a620

The only change is `stage-4/src/series.ts` `amendSeries` (lines 105-131).

- For each eligible occurrence, the resulting `starts_at_local` (its own date plus `local_time`)
  is computed first.
- Occurrences whose value is unchanged are dropped before `planAmendment` (series.ts:127-131), so
  no-ops face no cutoff, policy or occupancy checks.
- Only real changes go through `planAmendment`: old accepted cutoff first, then the resulting
  date's policy, in index order. Occupancy follows (series.ts:132-136).
- The stale check is unchanged: it still comes before any occurrence (series.ts:124).
- `planAmendment` and individual PATCH are untouched.

## Finding 1: fixed

| Case | Result on 746a620 |
|---|---|
| All-no-op with occurrence 0 past its cutoff | 201, series revision unchanged (S4-049) |
| Mixed: occurrence 0 a no-op past its cutoff, occurrence 1 a real change | 201, occurrence 1 at 12:00, series revision +1, occurrence 0 revision 1 (S4-049) |
| Real change to an occurrence past its cutoff (control) | 409 `cutoff_passed` (S4-049) |

S4-044, S4-045 and S4-049 are now covered.

## No regression

| Check | Evidence |
|---|---|
| Stale revision before cutoff and validation | Series: S4-041 passes; a probe with a stale revision plus a DST-gap time gives 409 `stale_revision`. PATCH: S3-047 passes. |
| Non-occupancy errors in index order, then occupancy | S4-046 passes |
| Revision counting | S4-030 passes; no-ops still bump nothing (S4-044, S4-049) |
| DST gap | S1-085 and S3-057 pass. Probe: amending a Berlin series to 02:30 across next year's spring-forward Sunday gives 422 `invalid_local_time`, with series revision and occurrences unchanged. |
| Individual no-op PATCH still needs an editable booking | S3-044 passes (past cutoff gives 409 `cutoff_passed`; cancelled gives 409 `reservation_cancelled`) |

## Evidence

- Clean image built from `git archive 746a620 stage-4`.
- Upgrade sources: the real stage-3 (49d2118), stage-2 (6483946) and stage-1 (4cadcb9) images.
- **API suite:** 218 of 218, including S4-049 (82 s) and upgrade4 from all three sources.
- **Browser suite:** 39 of 39.

Advisory D-1 (keep `GET /restaurants/{id}/closures` stable) and the earlier advisories (B-1, C-1,
C-3) still stand. Nothing new.

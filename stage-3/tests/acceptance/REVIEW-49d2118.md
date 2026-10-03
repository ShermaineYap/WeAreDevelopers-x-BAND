# Stage 3 ledger re-review: revision 49d2118bfeaf61bed9da353132ad2988ff05f8e7 (after rejection round 1)

Reviewer: auditor. Handoff: foreman STAGE 3 re-review (message 0fadb441).
Baseline: my ACCEPT of 7e6884f (`REVIEW-7e6884f.md`) still holds for all unchanged code.

**Verdict: ACCEPT.** S3-001..S3-103: 75 covered, 0 partial, 0 missing.

## The diff 7e6884f..49d2118

Product changes are confined to `stage-3/public/js/search.js` and a note in `RUN.md`. No server
code changed. The other files in the range are my own commits: e6d0132, the review, and 3f3e414,
the S3-103 test and its ledger line.

- **search.js:73-100.** Each search now fetches `GET /restaurants/{id}/policies` in the same
  `Promise.all` as availability and restaurant detail. The result is dropped unless `seq` still
  matches (line 92), and any non-200 among the three shows the search error state.
- **search.js:117-133 (`rulesOn`).** Picks the published policy with the greatest
  `effective_from` not after the date, with ties going to the greatest `policy_version`. Otherwise
  it falls back to the fixture hours and capacities. This is the stage-3 selection rule.
- **search.js:168-174.** The closed/open wording for `no-slots` now comes from the rules for that
  date, not from the fixture.
- **search.js:159-163,185-189.** Every single-table cell shows "Seats N" from those rules.
- **Unchanged:** availability itself (`data-available`, Available/Booked/Too small, the cell set)
  still comes only from the server's `available_table_ids` and `explain` (search.js:186-188).

## Checks requested

| Check | Result |
|---|---|
| S3-103 covered | **covered.** `browser/policy-closed.test.mjs` passes. Probe at 375 and 1280 px: Friday 2026-11-13 under the policy reads "Closed on Friday 13 November · Policy House is closed that day." with no horizontal scroll. The control Friday 2026-11-06 (before the policy) still shows the grid with 32 cells. |
| Out-of-order protection (S2-003) | **kept.** The policies request belongs to the same sequenced batch (search.js:79-92). Both S2-003 browser tests pass. Their held-request filter matches the restaurant id, so the new policies request is held too. |
| Only the server decides availability (S2-023, S3-100) | **kept.** `data-available` and the cause still derive only from `available_table_ids` and `explain`. S2-020/021/023 and S3-100 pass. The client-side policy is used only for wording and seat counts. |
| Cause labels distinct (S2-070, S2-071) | **kept.** Both tests pass. A probe on Thu 2026-11-12, under a policy that raises Window to 3 seats, with a party of 4: "Window · Seats 3 · Too small" and "Bar · Seats 4 · Available". Before the policy, the same cell reads "Seats 2". |

## Evidence

- Clean image built from `git archive 49d2118 stage-3`.
- **API suite:** 185 of 185, with both upgrade sources: stage-2 image 6483946 and stage-1 image
  4cadcb9.
- **Browser suite:** 38 of 38, the previous 37 plus S3-103.

## Per-line status

- S3-001..S3-102: unchanged from `REVIEW-7e6884f.md`, all covered. The server code is unchanged;
  the UI lines S3-100 and S3-101 were re-run and pass.
- S3-103: covered at search.js:117-133 and 168-174, verified by test and probe.
- Earlier-stage rows: unchanged and covered. The full stage-1 and stage-2 regression suites pass.

Advisories C-1, C-3, C-4 and B-1 from the previous review stand unchanged. Nothing new.

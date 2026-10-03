# Stage 3 ledger review: revision 7e6884f29723425d15248c71c8f3d7d0ffcf31fe

Reviewer: auditor. Handoff: foreman STAGE 3 ledger review (message feda7585).

**Verdict: ACCEPT.**
- S3-001..S3-102: 74 covered, 0 partial, 0 missing.
- S3-066 and S3-096 (restaurant revision) are covered by reading the code, because stage 3 has no
  endpoint to read the restaurant revision.
- The 12 earlier-stage rows that stage 3 changes are all covered.

## Evidence

I ran everything myself.

- **Clean build.** Image built from `git archive 7e6884f stage-3`, run with
  `-e PORT=8080 --cpus 2 --memory 2g`. Healthy within seconds.
- **API suite** (`stage-3/tests/acceptance/*.test.mjs`): 185 of 185 pass, none skipped.
  - This includes both upgrade sources: the stage-2 image (6483946) through `PREVIOUS_BASE_URL`, and
    the stage-1 image (4cadcb9) through `PREVIOUS_STAGE1_BASE_URL`.
  - It also includes the whole carried stage-1 and stage-2 regression suite.
- **Browser suite:** 37 of 37 pass. That is the stage-2 screens plus `policies-ui`.
- **Supplied checks.** `harness run --stage 3 --mode isolated`: stage 3 pass, "claimed stage: 3".
- **Extra probes against the image:**
  - **Seeds:** a seeded pair gets a synthesised `created` entry with `table_ids` in declared order.
    A seeded cancelled booking gets `created` + `cancelled` at revision 1, and its decision returns
    revision 1 under policy 0.
  - **Policy JSON types:** a string `slot_minutes`, string `opening_hours`, array `capacities`,
    numeric `effective_from` or a string capacity value → 422.
  - **Concurrent publishing:** 20 concurrent publications → 20 × 201 with 20 distinct versions.
  - **Stale on a cancelled booking:** a stale `expected_revision` → 409 `stale_revision`; a matching
    one → 409 `reservation_cancelled`.
  - **Series validation order:** a non-string `anchor_reference` → 400. An invalid count with an
    unknown anchor → 422, because fields are checked before the anchor.
  - **Slot shape:** with explain, slots carry `starts_at_local, starts_at, available_table_ids,
    available_options, explain`. Without it, `explain` is absent.

## The points the foreman asked about

1. **PATCH check order.** The order is: ownership 404, then invalid `expected_revision` 422, then
   stale 409, then cancelled 409, then the old accepted cutoff 409, then types and values, then
   no-op detection, then validation under the new policy, then occupancy (reservations.ts:245-265,
   273-283).
   - The spec says stale comes "before cutoff/validation". Here it comes before both, and before the
     cancelled check, which the spec does not order. That is acceptable.
   - No-op detection sits after the cutoff, as required: "It still requires a confirmed, editable
     booking". It sits before re-validation under the new policy, so a no-op keeps its terms.
   - My tests S3-044 and S3-047 pass, and so does the probe above.
2. **Policy publication answers 422 for wrong JSON types** (terms.ts:55-97).
   - Defensible. §5 says "Endpoint-specific field rules take precedence", and the policy section
     says "Invalid policy is 422 `validation_failed`", naming booleans explicitly.
   - Risk: a graded check expecting 400 for a string number would fail. See advisory C-1.
3. **Owner-only 404 with no token.** `optionalUserOf` (app.ts:43-50) turns a missing or invalid
   token into an anonymous caller, and `ownReservation` / `getSeries` then answer 404
   (reservations.ts:72-76; series.ts:87-90). This matches "History and decision return 404 even
   without authentication" and "another user or no token gives 404".
4. **History `at` in UTC.** The value is `…+00:00` at second precision (history.ts:51,
   time.ts `formatUtcNow`). That is RFC 3339 with an explicit offset, as §3.4 requires; the spec's
   `+02:00` is only an example. Order is total by `seq`, and `at` never decreases (S3-012 passes).
5. **Synthesised history for seeds and imports** (state.ts:386-398; fixture.ts:136).
   - A `created` entry with current values at revision 1 and policy-0 terms, plus a `cancelled`
     entry if the booking is already cancelled.
   - This is consistent with "Seeded bookings start at revision 1 under policy 0" and "Occurrences …
     have ordinary histories". The cancelled synthetic entry repeating revision 1 is a nit; see
     advisory C-3.
6. **Series rules** (series.ts:58-91):
   - Field checks (400/422), then the anchor checks: 404, cancelled, already in series, cutoff.
   - Each occurrence under its own date's policy, with occupancy checked, in index order.
   - Inside the idempotency transaction, so everything rolls back on failure.
   - The anchor row only gains `series_id`; its revision, history and terms are untouched.
   - Exceptions are set by real amendments, including moves (reservations.ts:262). Cancel bumps the
     series revision without marking an exception (reservations.ts:220).
   - Replays come from the idempotency record. All S3-050..S3-065 tests pass.
7. **Stage-4 behaviour pulled into stage 3.** `bumpRestaurantRevision` runs on create, cancel, real
   amendment, the batch, policy publication and adoption (state.ts:228; reservations.ts:181, 219,
   279, 328; series.ts:82; policies.ts:72). The counter is stored and exported only:
   - no endpoint and no response exposes it;
   - restaurant detail gains only `manager_user_ids`, which is fixture configuration.

   It does **not** change any observable stage-3 behaviour. The stage-3 rules it implements, once
   per adoption and once per batch, are met (series.ts:82; reservations.ts:328).

## Per-line review

Paths are relative to `stage-3/src/`.

| ID | Mark | Code | Reason |
|---|---|---|---|
| S3-001 | covered | app.ts:94-96 | Any value other than `"true"` → 422. |
| S3-002 | covered | schedule.ts:151 | `explain` is only added when requested. |
| S3-003 | covered | schedule.ts:151-158 | Every table, in fixture order. |
| S3-004 | covered | schedule.ts:153-157 | Both rules judged independently, in the order `capacity`, `no_overlap`. |
| S3-005 | covered | schedule.ts:156 | `available = capacity && noOverlap`; the same filter yields `available_table_ids`. |
| S3-006 | covered | schedule.ts:128-160 | Closed day `[]`; full explain on every slot. |
| S3-007 | covered | schedule.ts:156; app.ts:103 | `terms.policy_version` of the date's policy. |
| S3-008 | covered | schedule.ts:153-155; reservations.ts:29-30 | Policy capacities; only confirmed bookings count. |
| S3-010 | covered | app.ts:189; reservations.ts:72-76,195-198 | Not the owner, or no token → 404. |
| S3-011 | covered | reservations.ts:195-198 | No status filter. |
| S3-012 | covered | history.ts:48-63; db.ts:76-84 | Contiguous `seq` (MAX+1); ordered by `seq`. |
| S3-013 | covered | history.ts:26-32 | All three fields, `from: null`. |
| S3-014 | covered | history.ts:37-45 | Only differing fields, in the fixed order. |
| S3-015 | covered | reservations.ts:257-259,276 | A no-op returns early with no record. |
| S3-016 | covered | reservations.ts:214-218,250 | `cancelled` with `[]`; no later writes. |
| S3-017 | covered | idempotency.ts:46-53 | A replay returns the stored body without running. |
| S3-018 | covered | history.ts:48-55 | Each entry stores the row's revision and terms at write time. |
| S3-020 | covered | policies.ts:62-67; state.ts:153-166; reservations.ts:72-76 | Managers from the fixture; 404 then 403; diners' data owner-only. |
| S3-021 | covered | app.ts:181-183; idempotency.ts | Key per user + policies path; replay 200. |
| S3-022 | covered | policies.ts:69-73 | MAX+1 per restaurant inside the transaction; a failure rolls back. |
| S3-023 | covered | terms.ts:55-97; hours.ts:13-25 | Every rule → 422. |
| S3-024 | covered | terms.ts:80-86 | Exact table ids; unknown fields not read. |
| S3-025 | covered | policies.ts:52-56; app.ts:180 | Public; `ORDER BY policy_version`; no policy 0. |
| S3-026 | covered | app.ts (detail) | Fixture configuration plus `manager_user_ids`. |
| S3-027 | covered | policies.ts:17-19,45-50 | `effective_from <= date ORDER BY effective_from DESC, policy_version DESC`. |
| S3-028 | covered | reservations.ts:120-134; app.ts:103-104 | Terms for the local start date drive time, grid and capacity. |
| S3-029 | covered | reservations.ts:48-64; terms.ts:44-53 | `revision` plus `termsView`, without `effective_from`. |
| S3-030 | covered | fixture.ts:136; state.ts:386-398 | Seeds at revision 1, policy 0. |
| S3-031 | covered | idempotency.ts:52 | Stored original body. |
| S3-032 | covered | policies.ts:62-73 | Publication touches no reservation rows. |
| S3-033 | covered | reservations.ts:200-203; app.ts:190 | Current revision and terms; owner-only 404. |
| S3-040 | covered | reservations.ts:209,215 | Accepted cutoff against the current start. |
| S3-041 | covered | reservations.ts:251 | Old cutoff before validation. |
| S3-042 | covered | reservations.ts:260; 120-134 | Every resulting field under the new date's policy. |
| S3-043 | covered | reservations.ts:261-263,268-271 | Terms and end time replaced; revision +1. |
| S3-044 | covered | reservations.ts:250-259 | Requires confirmed and editable, then the no-op returns. |
| S3-045 | covered | reservations.ts:273-283 | All throws happen before writes, in one transaction. |
| S3-046 | covered | reservations.ts:214-216 | Cancel +1; repeat returns the current state. |
| S3-047 | covered | reservations.ts:226-231,246-249 | 422 for invalid, 409 for stale, before cutoff and validation. |
| S3-048 | covered | reservations.ts:274; db.ts | Synchronous transaction, so one winner. |
| S3-050 | covered | app.ts:198 | Idempotent write: 401, then 400. |
| S3-051 | covered | series.ts:62-65 | 404, cancelled, already in series, cutoff. |
| S3-052 | covered | series.ts:38-45,60-61 | Integer ranges; booleans rejected. |
| S3-053 | covered | series.ts:27-36,73-83 | Response shape. |
| S3-054 | covered | series.ts:77-79 | Anchor gains only `series_id` and `series_index`. |
| S3-055 | covered | series.ts:47-51,68-69 | Calendar-day shift; same time, party and tables. |
| S3-056 | covered | series.ts:69; reservations.ts:127-133 | Each date's terms; hours, DST, occupancy. |
| S3-057 | covered | schedule.ts `bookingTiming`; time.ts `resolveLocal` | Gap → `invalid_local_time`; repeated time → first occurrence. |
| S3-058 | covered | series.ts:68-72; idempotency.ts:46 | First failing index throws; the transaction rolls back. |
| S3-059 | covered | reservations.ts:148-167 | Ordinary rows with a `created` history entry. |
| S3-060 | covered | series.ts:86-91; app.ts:199 | Owner-only; current states. |
| S3-061 | covered | reservations.ts:262,276,280 | Real change sets the exception and bumps the series; a no-op returns early. |
| S3-062 | covered | reservations.ts:214,220 | Cancel bumps the series, no exception; a repeat returns early. |
| S3-063 | covered | idempotency.ts:52 | Original response; no counters touched. |
| S3-064 | covered | series.ts:59-61 | Only named fields read. |
| S3-065 | covered | state.ts:407-412 | Imported rows get `series_id: null`; adoption works. |
| S3-066 | covered (code) | series.ts:82 | One restaurant revision per adoption. |
| S3-070 | covered | state.ts:409-412 | Stage-1 schema upgraded. |
| S3-071 | covered | state.ts:409-412 | Stage-2 schema upgraded. |
| S3-080 | covered | reservations.ts:129 | Capacity summed over the policy's capacities. |
| S3-081 | covered | history.ts:18-23 | `table_id` when both sides are single. |
| S3-082 | covered | history.ts:26-28; reservations.ts:133 | `table_ids` from null to the declared order. |
| S3-083 | covered | history.ts:18-23,39 | Complete lists. |
| S3-084 | covered | reservations.ts:110-113,254-258 | Canonical pair comparison, so a reversed pair is a no-op. |
| S3-090 | covered | reservations.ts:311-328 | `planAmendment` per item; one entry each. |
| S3-091 | covered | reservations.ts:315 → 246-249 | Same rules per item. |
| S3-092 | covered | reservations.ts:259,323 | No-op items are not written. |
| S3-093 | covered | reservations.ts:311-322 | Every throw happens before any write. |
| S3-094 | covered | reservations.ts:262,325-327 | Set of series bumped once; exceptions marked. |
| S3-095 | covered | idempotency.ts:52 | Replay. |
| S3-096 | covered (code) | reservations.ts:328 | One restaurant revision per batch. |
| S3-100 | covered | public/js/search.js:71 (explain=true), 118 | Grid from the server's availability under the policy. |
| S3-101 | covered | public/js/lookup.js; search.js | Lookup and search re-read from the API. |
| S3-102 | covered | — | All carried stage-1 and stage-2 suites pass. |

## Earlier-stage rows changed by stage 3

All covered, as listed in `LEDGER.md`:
- revision and terms in every body;
- policy-driven slots and validation;
- accepted cutoff for cancel and amend;
- revision rules for cancel and amendment;
- moves with PATCH semantics;
- the new public and owner-only endpoints;
- the new idempotent paths;
- `manager_user_ids` and seeds;
- stage-1 and stage-2 imports;
- the UI under policies.

## Advisory, non-blocking

- **C-1. Policy wrong JSON types.** These answer 422 (terms.ts:55-97). This is defensible as an
  endpoint-specific rule, but §5's general rule would give 400 for, say, `"slot_minutes": "30"`. If
  a graded check expects 400, it fails. The spec's own wording ("Invalid policy is 422") favours the
  builder.
- **C-2. Cancelled before stale is unordered.** On a cancelled booking a stale
  `expected_revision` gives `stale_revision`, not `reservation_cancelled`. The spec does not order
  these two, and either is defensible.
- **C-3. Synthesised cancelled entry.** A seeded or imported cancelled booking gets a synthesised
  `cancelled` entry with the same revision (1) as its `created` entry, whereas API cancels add a
  revision. This is harmless, but a stricter reading would give that seed only a `created` entry.
- **C-4. Stage-4 counter.** The restaurant revision counter is already live. Stage 4 must not count
  again on paths already counted here. Check the stage-4 rules for which writes count: booking
  creation is counted here.
- **B-1 (from stage 2) still stands.** A reversed pair is answered in declared order.

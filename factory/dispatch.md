# Dispatch — paste to @foreman ONCE at the start of the dark run

Replace every `<WORKSPACE>` with the absolute workspace path, e.g. `/Users/shermaineyap/darkfactory` (no spaces, not iCloud). For practice runs, also replace `band-work/result` with `band-work/dev`. Send nothing else until the final report.

---

@foreman You are the lead seat for our factory. Build all four stages of the `tablekeeper` track sequentially, coordinating @auditor, @builder and @verifier, keeping every stage in its own complete, buildable folder. This is a dark-factory run: this message is the only human input. Do not ask me anything; record blockers in your final report instead.

**Paths**
- Workspace root: `<WORKSPACE>`
- Kickoff checkout (specs + supplied checks, read-only): `<WORKSPACE>/dark-factory-wearedevs`
- Result repository (all work goes here): `<WORKSPACE>/band-work/result`
- Track: `tablekeeper`
- Specs, in order:
  - `<WORKSPACE>/dark-factory-wearedevs/tablekeeper/spec/stage-1.md` → implement in `<WORKSPACE>/band-work/result/stage-1/`
  - `<WORKSPACE>/dark-factory-wearedevs/tablekeeper/spec/stage-2.md` → `stage-2/` (copy `stage-1/` forward, then extend)
  - `<WORKSPACE>/dark-factory-wearedevs/tablekeeper/spec/stage-3.md` → `stage-3/` (copy `stage-2/` forward, then extend)
  - `<WORKSPACE>/dark-factory-wearedevs/tablekeeper/spec/stage-4.md` → `stage-4/` (copy `stage-3/` forward, then extend)
- Each later spec says "requirements from earlier stages continue to apply" — every handoff must include the current stage's spec **and** all earlier specs in full.

**Checks** (run from `<WORKSPACE>/dark-factory-wearedevs` with its `.venv` activated):
```
python -m harness run --track tablekeeper --repo <WORKSPACE>/band-work/result --stage N --mode isolated --out <WORKSPACE>/band-work/checks/<unique-name>
```
Output directories must be new each run. Read the last lines: for `stage-N/` we need `claimed stage: N`. The shipped checks are a fraction of the graded suite (stage 1 83%, stage 2 41%, stage 3 11%, stage 4 21%); passing them is not evidence of a stage. Build to the spec.

**Stack constraints for this job**
- Node 22 + TypeScript, Express or Fastify, `better-sqlite3` with every write path inside a single synchronous transaction (this is how atomicity and concurrency correctness are achieved — do not introduce an external database or background workers).
- Time zones via `luxon`; durations are absolute minutes; repeated local times resolve to the first occurrence.
- Password hashing via `bcrypt` with a low cost factor (concurrent logins must stay well under the 5 s request timeout).
- Dockerfile based on `node:22-alpine`, multi-stage, listening on `0.0.0.0:$PORT` (default 8080). **No network at run time**: all dependencies, fonts, scripts and styles are baked into the image at build time.
- Each `stage-N/` contains `Dockerfile`, `RUN.md` (exact build + run commands), source, and the auditor's acceptance tests under `stage-N/tests/acceptance/`. No `.git` inside stage folders. No symlinks or submodules.
- Export/import serialises the entire store (accounts with hashes, tokens, restaurants, bookings, idempotency records with original responses) as the opaque `state` object.
- Stage 2 UI: server-rendered HTML plus small vanilla-JS modules per screen, one shared stylesheet. All `data-testid` attributes from the spec must be present exactly as written.

**Product brief for the browser screens (stage 2 onwards)**
A warm, confident hospitality product — think a well-designed neighbourhood restaurant's own booking site, not an admin tool. One consistent visual system: a two-colour palette (a deep warm neutral plus one accent), a system font stack, generous spacing, 8 px rhythm. The availability grid is the hero: dates, times, party size and table choices scannable at a glance; combined tables presented as intentional seating options with human labels ("Tables 1 + 2 · seats 6"), never as raw ids. Distinct visual treatment for: available, unavailable, selected, loading, success, refused, uncertain. Visible labels on every input, obvious focus rings, sufficient contrast. Fully usable at 375 px wide with no horizontal scroll, and at desktop widths. Considered empty, loading and error states on every screen. Consistent navigation across `/`, `/signup`, `/login`, `/lookup`. Technical identifiers only where they help the user.

**Areas that deserve explicit acceptance tests (for @auditor; derived from the specs)**
- Idempotency: per-user key scope; same key + same body on a different path is a new request; reuse after 4xx is a first use; key-reuse conflict is decided before field validation; concurrent identical requests yield exactly one 201; replay returns the original body even after later cancellation.
- Half-open occupancy intervals; slot grid bounds; closed days; slots with no available tables still listed.
- DST for both listed zones and both 2026 transitions: gap → invalid local time and absent from availability; repeated hour → first occurrence, appears once; end time uses absolute duration.
- Query-parameter integer spelling rules; wrong JSON type vs invalid value distinction; booleans are never integers.
- Cancel/amend cutoff against current start; cancel twice is 200; amend after cancel is a conflict.
- Atomic multi-booking moves: 1..8 distinct references, same restaurant, error precedence in input order with cutoff first, overlap among results, all-or-nothing including idempotency records.
- Export/import round trip preserving tokens, hashed-password login, original idempotent responses, reusable failed keys; import is replacement; invalid track/version leaves destination unchanged; export is a snapshot.
- No 5xx under 50 concurrent mixed requests.
- Stage 2: out-of-order search responses; conflict on booking preserves form and refreshes grid; lost response → uncertain state → retry with same key and body; unchanged resubmit returns same reference; pairs-only combinations, non-transitive, option ordering, single-member sets carry the singular id field; upgrade from a stage-1 export keeps the browser session and a pending retry.
- Stage 3: explain flag exactness; history sequence and field ordering rules including no-op and replay recording nothing; policy selection (greatest effective date not after the start date, ties by greatest version), immutability, version allocation only on success; accepted-terms snapshots; amendment checks old cutoff then new policy; expected-revision conflicts before cutoff; concurrent amendments on one revision; series adoption all-or-nothing, per-occurrence policy, exception and revision semantics; combined-table history field naming; batch moves under policies.
- Stage 4: replan objective order via exhaustive search within the stated limits, preview stores only the plan, stale plan on any intervening restaurant revision, already-applied vs replay, atomic apply with one restaurant revision, closures excluding tables afterwards; restaurant revision counting rules; series amendment index/time rules and revision counting; acceptance of exports from all earlier stages.

**Reporting**
At the end, send me one final report: per stage the accepted revision (or blocker), rejections and what changed because of them, wall time, and turn counts per seat.

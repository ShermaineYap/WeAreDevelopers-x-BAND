# FACTORY.md

Four Claude Code seats in one BAND Desktop room turn a written specification into a working, verified service, stage by stage, with the dispatched task as the only human input.

## 1. The seats

| Seat | Harness / model | Owns | Never does |
|---|---|---|---|
| **foreman** | Claude Code / claude-opus-5-5[1m] | Receives the dispatch, adds seats to the room, sends self-contained handoffs, sequences stages, accepts only verified commits, writes the final report | Writes code or tests; asks the human anything |
| **auditor** | Claude Code / claude-opus-5-5[1m] | Turns the requirements into a numbered **ledger** (one line per testable statement, flagged by whether the supplied checks seem to exercise it), writes **acceptance tests from the requirements alone**, and reviews each revision line by line against the ledger | Writes product code |
| **builder** | Claude Code / claude-opus-5-5[1m] | The single writer of product code. Copies the previous stage folder forward, implements, runs the supplied checks and the acceptance tests, and commits under its own name | Accepts its own work; amends or rebases a reported revision |
| **verifier** | Claude Code / claude-opus-5-5[1m] | Clean-clones the reported revision, builds it exactly as `RUN.md` says with no runtime network, runs every earlier suite, the acceptance tests and the next stage's suite as an overshoot probe, probes concurrency, retries, limits and narrow screens, then issues **ACCEPT / REJECT** with evidence | Fixes code |

The model ids above must match what each seat really ran. Each `mandates/<seat>.md` starts with the same `Harness:` / `Model:` lines.

## 2. The loop

```
human ──dispatch──▶ foreman
                     │ full requirements
                     ▼
                  auditor ── ledger + acceptance tests (committed)
                     │
                     ▼
                  builder ── copy previous stage forward → implement → run checks → commit
                     │ revision
                     ▼
                  auditor ── ledger review: covered / partial / missing ──┐
                     │                                                    │ REJECT
                     ▼                                                    │
                  verifier ── clean clone → build → suites → probes ──────┤
                     │ ACCEPT                                             ▼
                  foreman ── record revision, time, turns → next stage   builder
```

At most four rejection rounds per stage; after that the foreman records a blocker, and the chain ends at the last accepted stage.

## 3. How to stand it up

1. Install BAND Desktop and Claude Code (signed in). In BAND, create four **Claude Code** agents with **New Band Agent**, named exactly `foreman`, `auditor`, `builder` and `verifier`.
2. Link each agent's role to its mandate with **Choose role file** (`mandates/<seat>.md`). Set every agent's **working directory** to the **absolute** path of the result repository.
3. Set **Permission mode → Auto** on each agent so seats can run shell, git and docker without approval prompts, and in Settings → Runtime set **Human approval wait → auto-deny after 5 min**, so a stray prompt can never freeze a dark run.
4. Create a room, add the four seats (and nobody else), and send `@foreman` one dispatch. It must contain the paths, the specifications (or where to read them), the check command, any stack constraints and a product brief for user-facing screens. `factory/dispatch.md` is ours, verbatim. Track-specific detail belongs there, never in a mandate.
5. Start the run at the beginning of a fresh Claude usage window and keep the machine awake (`caffeinate -dis` on macOS): one full four-stage run uses roughly one subscription usage window.

`SETUP.md` has the full runbook, including the workspace script.

## 4. Design choices and why

- **An independent auditor instead of trusting the supplied checks.** The event ships only part of each graded suite: 83/41/11/21% for stages 1–4 on this track. A green run on the supplied checks says little about stages 3 and 4. The auditor reads the requirements cold, writes a ledger, and targets the lines the supplied checks don't reach. It is also a second, independent reviewer, so "review changed something" shows up in the room rather than being claimed.
- **The verifier builds from a clean clone in isolated mode.** Two failure modes it catches: code that only works in the builder's working tree, and services that quietly reach the network at runtime. Judges build from a clean container, so this reproduces their view.
- **One writer.** Only the builder edits product code. Parallel writers in one working tree produce merge noise and unclear ownership. The auditor and verifier add value by finding problems, not by patching them.
- **Copy-forward stage folders.** Each `stage-N/` is the previous folder carried forward and extended. It is never a rewrite and never a copy of later code, so every folder is an honest snapshot. The verifier's overshoot probe (a folder must not pass the next suite in full) enforces this.
- **Self-contained handoffs.** Seats see only messages addressed to them, so every handoff pastes the full requirements, the paths and the revision. Pointers to "the room" or a message id are forbidden by every mandate.
- **Stack steered by the dispatch, not the mandates.** We asked for Node + SQLite with every write in one synchronous transaction. That makes atomic multi-record operations, idempotent replays and concurrency correctness follow from one mechanism. The mandates stay reusable for any spec.
- **Authorship in git.** Seats commit with their own name, so `git log` and `room.json` can be cross-checked.

## 5. Measured cost

Submitted run: room `Tablekeeper`, Sat 3 Oct 2026, **17:15:51 → 19:43:56 (+08:00), 2 h 28 m**, one dispatch, no further human input, no blockers. Numbers are from the foreman's final report and the room log.

| Stage | Accepted revision | Wall time | Turns (foreman / auditor / builder / verifier) | Rejections |
|---|---|---|---|---|
| 1 | `4cadcb9` | 31 min | 5 / 2 / 1 / 1 | 0 |
| 2 | `6483946` | 37 min | 4 / 2 / 1 / 1 | 0 |
| 3 | `49d2118` | 42 min | 8 / 4 / 2 / 2 | 1 (verifier) |
| 4 | `746a620` | 37.5 min | 7 / 3 / 2 / 2 | 1 (auditor) |
| **Total** | | **2 h 28 m** | **24 / 11 / 6 / 6** | **2, each fixed in one round** |

"Turns" are handoffs handled per seat. Git history has 24 seat commits (builder 13, auditor 11), each authored by the seat that made it.

**Claude usage.** All four seats ran Claude Code on one Claude subscription (model `claude-opus-5-5[1m]`), so there is no per-token bill. BAND's room cost indicator, an API-price equivalent, read **$64.83** for the submitted room. One full run uses about one subscription usage window: in practice run 2 the foreman hit the session limit right after its final report, so the submitted run was started at the beginning of a fresh window.

**What the factory produced.** Four complete service folders that grow by copy-forward: about 1.5k / 2.7k / 3.5k / 3.9k lines of source, and 1.7k / 3.1k / 4.3k / 5.3k lines of the auditor's acceptance tests. In the final state every shipped check passes (120 / 25 / 7 / 6), the stage-4 auditor suites pass 218/218 over HTTP and 39/39 in the browser, and `harness run --all --mode isolated` shows each folder claiming its own stage.

**Development before freeze.** One toy smoke test (stage 1, ~10 min) and two full tablekeeper practice runs: Sep 29 (2 h 43 m, all four stages, one rejection round) and Sep 30 (2 h 05 m, all four stages, room indicator $57.82). Each practice run changed the dispatch's product brief, never the mandates' vocabulary (see §7).

## 6. A bad result the factory caught

Both rejections in the submitted run were caught **beyond the shipped checks**, and each left a regression test behind.

**Stage 4: the auditor overruled a verifier ACCEPT.** The builder reported `7a7731d`; the verifier accepted it. The auditor's ledger review rejected it (`10d0a2c`, finding F1): changing the time of a recurring reservation checked the cancellation cutoff even for occurrences the change would not move, so a single unchanged occurrence already past its cutoff made the whole series change fail with `409 cutoff_passed`. The spec says only real changes check their old cutoff, and an all-no-op change succeeds. The auditor added acceptance test **S4-049**. The builder's fix `746a620` (one file, `series.ts`) works out each occurrence's new time first, skips unchanged ones, and checks cutoff and policy only on real changes. Re-review: auditor ACCEPT 40/40 (`a163ce2`); verifier ACCEPT with 218/218 API, 39/39 browser, and its finding probe 9/9. The verifier then noted that its own near-cutoff probe had accepted either outcome and so could not have caught this: the reason for two independent reviewers.

**Stage 3: the verifier caught a product-quality bug the auditor's ledger passed.** On `7e6884f` (auditor ACCEPT 74/74) the verifier's browser probes found that a day closed by the applicable booking policy was labelled "no times left that day" instead of "closed": the search page read the restaurant's original opening hours, not the policy for that date. That breaks the brief's rule that every availability state is labelled with its real cause. The auditor added browser test **S3-103** (`3f3e414`); the builder's `49d2118` changed only `public/js/search.js` to pick the policy for the date by the same rule as the server. Re-review: auditor 75/75, verifier API 185/185, browser 38/38, 200 API + 91 browser probes.

Advisories also carried forward and were fixed: three stage-1 advisories (cancel/amend outside a transaction, a misleading bad-URL message, `display_name` required at signup) were fixed in stage 2 without touching `stage-1/`.

## 7. What we tried that failed

- **Trusting the shipped checks.** In practice run 1 every stage was accepted, yet the stage-4 screens showed a stale booking summary after a replan, and closed tables were labelled "Booked". Both passed every shipped check. Fix: two sentences added to the dispatch's product brief (post-write re-reads; every availability state labelled with its real cause). Run 2's UI review confirmed both fixed, and in the submitted run the verifier enforced the second rule (§6).
- **Running out of usage mid-run.** Practice run 2 hit the Claude session limit seconds after the final report. A dark run that stalls cannot be rescued without breaking the rules, so the submitted run started on a fresh usage window and nothing else used Claude meanwhile.
- **Approval prompts.** A seat that asks for permission waits for a human forever. Permission mode Auto plus BAND's "auto-deny after 5 min" removes that failure mode.
- **Typing the dispatch.** BAND's input box turns `--` into an em dash (breaking CLI flags in the check command) and a pasted `@foreman` is plain text, not a mention, so the message has no recipient. The dispatch is pasted from the clipboard and the mention re-picked from the popup.
- **Wrong model id in mandates.** A helper agent reported a different model id from the one the seats reported about themselves; the mandates use the seats' own report, `claude-opus-5-5[1m]`.
- **A disputed acceptance test.** In run 2 the builder disputed a failing auditor test with evidence from the spec; the auditor agreed its own test was wrong and fixed it. Review in this factory is two-way and evidence-based, not a one-way gate.

## 8. Limits and next steps

- **The chain reached stage 4,** the last stage of the track, with no blockers, so nothing stopped it. The foreman's report lists eight open judgement calls that graders could read differently (e.g. `422` vs `400` for a wrong-typed policy field, history timestamps in UTC, a public `GET /restaurants/{id}/closures` added for the grid); both reviewers accepted each one.
- **Cost is dominated by review.** The auditor and verifier together cost more than the builder (practice-week indicator: auditor $43.90, builder $37.42, verifier $21.67, foreman $8.74). A cheaper model for the foreman, and running verifier probes only on changed areas between rounds, would cut usage.
- **Verifier probes can be too lenient.** One accepted either outcome near the cutoff (§6). Next step: probes generated from the auditor's ledger with explicit expected outcomes.
- **Sequential stages.** Stage N+1's auditor ledger could start while stage N is in review. That would save about 10 minutes per stage, at the cost of a second auditor seat.

# FACTORY.md

Four Claude Code seats in one BAND Desktop room turn a written specification into a working, verified service, stage by stage, with the dispatched task as the only human input.

## 1. The seats

| Seat | Harness / model | Owns | Never does |
|---|---|---|---|
| **foreman** | Claude Code / claude-opus-5-5 | Receives the dispatch, adds seats to the room, sends self-contained handoffs, sequences stages, accepts only verified commits, writes the final report | Writes code or tests; asks the human anything |
| **auditor** | Claude Code / claude-opus-5-5 | Turns the requirements into a numbered **ledger** (one line per testable statement, flagged by whether the supplied checks seem to exercise it), writes **acceptance tests from the requirements alone**, and reviews each revision line by line against the ledger | Writes product code |
| **builder** | Claude Code / claude-opus-5-5 | The single writer of product code. Copies the previous stage folder forward, implements, runs the supplied checks and the acceptance tests, and commits under its own name | Accepts its own work; amends or rebases a reported revision |
| **verifier** | Claude Code / claude-opus-5-5 | Clean-clones the reported revision, builds it exactly as `RUN.md` says with no runtime network, runs every earlier suite, the acceptance tests and the next stage's suite as an overshoot probe, probes concurrency, retries, limits and narrow screens, then issues **ACCEPT / REJECT** with evidence | Fixes code |

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

1. Install BAND Desktop and create four headless **Claude Code** seats with **New local agent**, named exactly `foreman`, `auditor`, `builder` and `verifier`.
2. Paste each seat's mandate from `mandates/` into its instructions. Set every seat's working directory to the **absolute** path of the result repository.
3. Let the seats run shell, git and docker without approval prompts.
4. Create a room, add all four seats, and confirm each answers a direct `@mention`.
5. Send `@foreman` one dispatch. It must contain the paths, the specifications (or where to read them), the check command, any stack constraints and a product brief for user-facing screens. `factory/dispatch.md` is ours and is a working example. Track-specific detail belongs there, never in a mandate.

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

Submitted run (room `Tablekeeper`, <fill in: date>):

| Stage | Wall time | Turns (foreman / auditor / builder / verifier) | Rejections | Claude usage |
|---|---|---|---|---|
| 1 | <fill in> | <fill in> | <fill in> | <fill in> |
| 2 | <fill in> | <fill in> | <fill in> | <fill in> |
| 3 | <fill in> | <fill in> | <fill in> | <fill in> |
| 4 | <fill in> | <fill in> | <fill in> | <fill in> |

Development before freeze: <fill in: number of practice runs, total hours, usage>.
All seats ran on a Claude subscription, so there was no per-token bill. The usage column is from claude.ai → Settings → Usage.

## 6. A bad result the factory caught

<fill in from room.json: which stage, which seat rejected, the finding quoted, the requirement it violated, the builder's fix, and the commit before/after. The best candidate is a verifier REJECT that came from a probe or acceptance test, not from a supplied check.>

## 7. What we tried that failed

<fill in from practice runs. For example: the three-seat template left the builder carrying ~90% of the work; handoffs that pointed at earlier messages stalled seats; a mandate draft that named an endpoint was flagged by `harness check`; approval prompts froze a seat mid-run.>

## 8. Limits and next steps

<fill in: where the chain stopped and why, what would have moved it further (for example a second builder for UI, per-stage usage caps, an auditor that can also generate load tests).>

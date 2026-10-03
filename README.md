# Dark Factory — tablekeeper entry

WeAreDevelopers x BAND "Dark Factory" hackathon · Team: **Shermaine Yap** (solo) · Track: **tablekeeper**
Stages submitted: **1–4** (all four, accepted by both reviewers, no blockers)

A four-seat software factory in BAND Desktop — **foreman, auditor, builder, verifier** — that takes one dispatched task and builds a restaurant reservation service stage by stage, reviewing and verifying its own work without human input.

## How to read this repository

| Path | What it is |
|---|---|
| [`FACTORY.md`](FACTORY.md) | The factory: seats, how to stand it up, design choices, measured cost, a bad result it caught |
| [`mandates/`](mandates) | One generic mandate per seat. No track vocabulary; they could drive any spec |
| [`factory/dispatch.md`](factory/dispatch.md) | The single human message that started the submitted run (track detail lives here, not in mandates) |
| `room.json` | Full BAND room download of the submitted dark run |
| `stage-1/` … `stage-N/` | Each is a complete, independently buildable service: `Dockerfile`, `RUN.md`, source, `tests/acceptance/`. All code here was written by the seats |
| [`scripts/`](scripts) | Operator tooling (workspace setup, stage checks, pre-submit verification). Not part of any stage |
| [`SETUP.md`](SETUP.md) | Runbook for reproducing the run |

## Verify

```sh
python -m harness check . --track tablekeeper
python -m harness run --track tablekeeper --repo . --all --mode isolated
```

Stage outcome from the submitted run (verifier's clean clone, `--all --mode isolated`): **`stage-1/` claims stage 1, `stage-2/` claims 2, `stage-3/` claims 3, `stage-4/` claims 4**. Every shipped check passes (120 / 25 / 7 / 6).

## The submitted run at a glance

- **Sat 3 Oct 2026, 17:15:51 → 19:43:56 (+08:00), 2 h 28 m**, one dispatch, no human input after it, no blockers.
- **Stages:** 1 (31 min), 2 (37 min), 3 (42 min), 4 (37.5 min).
- **Turns per seat:** foreman 24, auditor 11, builder 6, verifier 6. **24 seat commits** (builder 13, auditor 11).
- **Review changed the work twice:** the verifier rejected a stage-3 revision whose search page labelled a policy-closed day "no times left" instead of "closed"; the auditor rejected a stage-4 revision, which the verifier had accepted, where an unchanged occurrence past its cutoff blocked a recurring-reservation change. Each was fixed in one round and left a regression test behind ([FACTORY.md §6](FACTORY.md#6-a-bad-result-the-factory-caught)).
- **Final evidence:** stage-4 auditor suites 218/218 API and 39/39 browser; the replan planner matched brute force on 1,800 random cases; 12 simultaneous plan applies → exactly one success; 50 concurrent mixed requests → no 5xx; exports from stages 1–3 import.

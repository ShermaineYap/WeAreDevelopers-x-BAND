# Dark Factory — tablekeeper entry

WeAreDevelopers x BAND "Dark Factory" hackathon · Team: **Shermaine Yap** (solo) · Track: **tablekeeper**
Stages submitted: **<fill in: 1–N>**

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

Stage outcome from the submitted run: **<fill in: harness `--all` summary lines>**

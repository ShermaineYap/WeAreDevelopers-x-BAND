# Runbook — from zero to submitted

Solo · macOS (Apple silicon) · Claude Code subscription · track **tablekeeper**
Deadline **Mon Oct 5 23:59 PDT = Tue Oct 6 14:59 MYT**. Aim to submit by **Mon Oct 5 23:00 MYT**.

> **The one rule that matters most:** every line under `stage-N/` must be written by the BAND seats in the room. Nothing under `stage-N/` may be written by you, by Cowork, or by a Claude Code session outside BAND. That code does not count, and it can disqualify the entry.

## 1. Tools (≈20 min)

```sh
xcode-select --install                # git, if not already there
brew install python@3.12
# Docker Desktop: install from docker.com, open it, wait until it says "running"
```

## 2. Workspace (≈10 min)

Use a path **without spaces and outside iCloud**. `~/darkfactory` is the default.

```sh
git clone https://github.com/ShermaineYap/WeAreDevelopers-x-BAND.git ~/darkfactory-setup
bash ~/darkfactory-setup/scripts/setup-mac.sh
```

This clones the kickoff package, builds the harness venv, installs Playwright's Chromium, and creates:

| Path | Use |
|---|---|
| `~/darkfactory/dark-factory-wearedevs` | specs + supplied checks (read-only) |
| `~/darkfactory/band-work/dev` | practice runs (throw it away and `git init` again as often as you like) |
| `~/darkfactory/band-work/result` | clone of this repo. **Only the final dark run writes here** |
| `~/darkfactory/band-work/checks` | harness output |

## 3. BAND Desktop seats (≈30 min)

1. Install BAND Desktop (0.4.10+) and sign in.
2. Create **four** seats with **New local agent**, harness **Claude Code**, headless:

   | Seat name (exactly) | Instructions / mandate | Working directory |
   |---|---|---|
   | `foreman` | paste `mandates/foreman.md` | `~/darkfactory/band-work/dev` (practice) |
   | `auditor` | paste `mandates/auditor.md` | same |
   | `builder` | paste `mandates/builder.md` | same |
   | `verifier` | paste `mandates/verifier.md` | same |

   Use the absolute path (`/Users/shermaineyap/darkfactory/band-work/dev`), not `~`.
3. Give the seats permission to run shell commands, git and docker without asking. A seat that stops to ask for approval is a stalled dark run.
4. Check which model each seat actually runs in BAND. If it is not `claude-opus-5-5`, change the `Model:` line in that mandate file to the exact id. It must be true.
5. Make a room, add all four seats, and send `@foreman ping, reply and ping @verifier`. Confirm that all four reply by @handle.

*(Optional)* Docker Sandboxes for the seats: see the participant guide section “Run a seat in a Docker Sandbox”. Skip it if it takes more than an hour.

## 4. Practice on the toy (≈1 h)

In a practice room, send @foreman a short dispatch: the toy track, `toy/spec/stage-1.md`, repo `band-work/dev`. When it reports, run:

```sh
bash ~/darkfactory-setup/scripts/check-stage.sh ~/darkfactory/band-work/dev 1
```

Goal: you see handoff → build → review → commit → `claimed stage: 1`. If something stalls, the mandates are what to fix, not the code.

## 5. Tablekeeper practice runs (Oct 1–3)

1. Reset the practice repo: `rm -rf ~/darkfactory/band-work/dev && git init -b main ~/darkfactory/band-work/dev`.
2. Open `factory/dispatch.md`, replace `<WORKSPACE>` with `/Users/shermaineyap/darkfactory` and `band-work/result` with `band-work/dev`, then paste it to @foreman in a **new** room.
3. You may step in during practice. Note every time you had to, because each one points at a mandate to fix.
4. Check each stage: `bash ~/darkfactory-setup/scripts/check-stage.sh ~/darkfactory/band-work/dev <N>` and look for `claimed stage: N`.
5. Record for FACTORY.md: wall time per stage, turns per seat, rejections, and Claude usage (claude.ai → Settings → Usage).
6. Copy any mandate change back into this repo's `mandates/`, then run `harness check` (step 7a). The mandates must stay free of track words.

**Mandate freeze: Sat Oct 3, 22:00 MYT.**

## 6. The dark run (Sun Oct 4, start early)

1. Point all four seats' working directory at `/Users/shermaineyap/darkfactory/band-work/result`, and paste the frozen mandates into them.
2. Create a **fresh** room named `Tablekeeper` and add the four seats.
3. Paste `factory/dispatch.md` (with `<WORKSPACE>` replaced and `band-work/result` left as is) to @foreman. **Once.**
4. **Hands off.** Send nothing: no "continue", no hints, no re-dispatch. If a seat process crashes, restarting the process is fine, but sending a message is not.
5. When @foreman posts the final report, you're done with the band.

## 7. Package and submit (Mon Oct 5)

a. Download the room. In BAND Desktop, open the room's `⋮` menu → **Open in Band**, then `⋮` → **Download** → **Download full session**, and save it as `~/darkfactory/band-work/result/room.json`. Open the file and search for `sk-`, `ghp_`, `token` and `password`; replace any real secret with `[REDACTED]`.

b. Fill `README.md` and `FACTORY.md`: replace every `<fill in …>`, using the numbers from the final report and your notes.

c. Commit and push. Do not squash or rebase the seats' commits.

```sh
cd ~/darkfactory/band-work/result
git add room.json README.md FACTORY.md && git commit -m "Room log and factory write-up"
git push origin main
```

d. Verify like a judge:

```sh
bash ~/darkfactory-setup/scripts/presubmit.sh
```

e. Record the video (3–5 min, screen capture):
   1. The room with the four seats.
   2. The dispatch.
   3. One handoff.
   4. One REJECT and the fix commit.
   5. The `harness run --all` output.
   6. The stage-2 UI at desktop width, then at phone width.

f. Make the slides (6–8), covering the factory design, what it cost, a bad result it caught, and the stage reached. Submit the repo URL, slides and video on the lablab event page.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Seat asks you a question during the dark run | Don't answer. Let @foreman record it as a blocker. Tighten the mandate next time |
| `claimed stage: none` because a suite is under 50% | Read `report.json`. In practice runs, feed the failing log back through @foreman |
| `claimed stage: none` because the folder passes the next suite too | The code was copied backwards. The builder must keep stage folders as real snapshots |
| Works in host mode, fails isolated | Something fetches from the network at runtime (a CDN font, script or package) |
| `harness check` flags a mandate line | A track word leaked in. Rewrite it generically |
| Running out of time | Submit the contiguous stages you have. Clean 1–3 beats a broken 1–4 |

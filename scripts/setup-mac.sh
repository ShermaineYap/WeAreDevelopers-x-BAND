#!/usr/bin/env bash
# One-time setup on macOS (Apple silicon) for the Dark Factory hackathon.
# Creates:  $WS/dark-factory-wearedevs   (kickoff: specs, supplied checks, harness)
#           $WS/band-work/dev            (throwaway result repo for practice runs)
#           $WS/band-work/result         (clone of this repo; the SUBMITTED run writes here)
#           $WS/band-work/checks         (harness output directories)
# Usage:    bash scripts/setup-mac.sh            (defaults WS to ~/darkfactory)
#           WS=/some/path bash scripts/setup-mac.sh
set -euo pipefail

WS="${WS:-$HOME/darkfactory}"
REPO_URL="${REPO_URL:-https://github.com/ShermaineYap/WeAreDevelopers-x-BAND.git}"
KICKOFF_URL="https://github.com/band-ai/dark-factory-wearedevs.git"

case "$WS" in *" "*) echo "WS must not contain spaces (Docker, the harness and the seats all break on them): $WS"; exit 1;; esac
case "$WS" in *"Mobile Documents"*|*"iCloud"*|*"icloud"*) echo "Do not use an iCloud-synced folder for the workspace: $WS"; exit 1;; esac

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING: $1 — $2"; MISSING=1; }; }

say "Checking tools"
MISSING=0
need git    "xcode-select --install"
need docker "install Docker Desktop and start it"
need brew   "https://brew.sh"
PY=""
for c in python3.13 python3.12 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "MISSING: Python 3.12+ — brew install python@3.12"; MISSING=1; }
[ "$MISSING" = 0 ] || { echo; echo "Install the missing tools above, then re-run."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running — open Docker Desktop and re-run."; exit 1; }
echo "python: $($PY --version)   docker: $(docker --version)"

say "Workspace $WS"
mkdir -p "$WS/band-work/checks"

say "Kickoff package"
if [ -d "$WS/dark-factory-wearedevs/.git" ]; then git -C "$WS/dark-factory-wearedevs" pull --ff-only
else git clone "$KICKOFF_URL" "$WS/dark-factory-wearedevs"; fi

say "Harness virtualenv"
cd "$WS/dark-factory-wearedevs"
[ -d .venv ] || "$PY" -m venv .venv
. .venv/bin/activate
python -m pip install -q --upgrade pip
python -m pip install -q -r harness/requirements.txt
python -m playwright install chromium
python -m harness --help >/dev/null && echo "harness OK"

say "Practice result repo (band-work/dev)"
if [ ! -d "$WS/band-work/dev/.git" ]; then
  git init -q -b main "$WS/band-work/dev"
  mkdir -p "$WS/band-work/dev/stage-1"
fi

say "Submission result repo (band-work/result)"
if [ ! -d "$WS/band-work/result/.git" ]; then git clone "$REPO_URL" "$WS/band-work/result"; fi
git -C "$WS/band-work/result" config user.name  >/dev/null || git -C "$WS/band-work/result" config user.name  "Shermaine Yap"
git -C "$WS/band-work/result" config user.email >/dev/null || git -C "$WS/band-work/result" config user.email "shermaine8268@gmail.com"

say "Done"
cat <<MSG
Paths to use in BAND Desktop and the dispatch:
  WORKSPACE           $WS
  kickoff (read-only) $WS/dark-factory-wearedevs
  practice repo       $WS/band-work/dev
  submission repo     $WS/band-work/result

Next: SETUP.md step 3 (create the four seats in BAND Desktop).
Toy smoke test once a seat has built toy stage 1 into band-work/dev:
  cd $WS/dark-factory-wearedevs && . .venv/bin/activate
  python -m harness run --track toy --repo $WS/band-work/dev --stage 1 --out $WS/band-work/checks/toy-s1-\$(date +%s)
MSG

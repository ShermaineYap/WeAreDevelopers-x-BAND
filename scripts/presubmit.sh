#!/usr/bin/env bash
# Final pre-submission verification against a FRESH CLONE of the pushed GitHub repo,
# exactly the way a judge sees it.
# Usage: bash scripts/presubmit.sh
set -euo pipefail
WS="${WS:-$HOME/darkfactory}"
REPO_URL="${REPO_URL:-https://github.com/ShermaineYap/WeAreDevelopers-x-BAND.git}"
TMP="$(mktemp -d)"; CLONE="$TMP/clone"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "Fresh clone of $REPO_URL"
git clone -q "$REPO_URL" "$CLONE"
cd "$WS/dark-factory-wearedevs"; . .venv/bin/activate

say "1. Offline gates (layout, mandates, room.json, credentials)"
python -m harness check "$CLONE" --track tablekeeper

say "2. Every stage folder, isolated mode (no network, 2 vCPU, 2 GiB)"
python -m harness run --track tablekeeper --repo "$CLONE" --all --mode isolated --out "$WS/band-work/checks/presubmit-$(date +%Y%m%d-%H%M%S)"

say "3. Nothing that should not be committed"
( cd "$CLONE"
  find . -name .git -mindepth 2 -print | sed 's/^/nested .git: /' || true
  find . -type l -print | sed 's/^/symlink: /' || true
  git ls-files | grep -E '(^|/)node_modules/|\.env$' | sed 's/^/should not be committed: /' || true )

say "4. Manual items (tick yourself)"
cat <<'LIST'
  [ ] followed each stage-N/RUN.md by hand in a clean terminal
  [ ] room.json is the FULL session download, credentials replaced with [REDACTED]
  [ ] README.md and FACTORY.md filled in (no <fill in> markers left)
  [ ] video (3-5 min) + slides uploaded; repo URL submitted on lablab
LIST
grep -n '<fill in' "$CLONE/README.md" "$CLONE/FACTORY.md" && echo "^^ placeholders still present" || true

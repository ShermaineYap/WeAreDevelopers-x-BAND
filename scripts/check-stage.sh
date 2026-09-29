#!/usr/bin/env bash
# Run the supplied checks for one stage (or --all) in isolated mode, into a fresh output dir.
# Usage: bash scripts/check-stage.sh <repo> <N|all>      e.g.  bash scripts/check-stage.sh ~/darkfactory/band-work/dev 1
set -euo pipefail
WS="${WS:-$HOME/darkfactory}"
REPO="${1:?repo path}"; STAGE="${2:?stage number or all}"
cd "$WS/dark-factory-wearedevs"; . .venv/bin/activate
OUT="$WS/band-work/checks/s${STAGE}-$(date +%Y%m%d-%H%M%S)"
if [ "$STAGE" = all ]; then SEL=(--all); else SEL=(--stage "$STAGE"); fi
python -m harness run --track tablekeeper --repo "$REPO" "${SEL[@]}" --mode isolated --out "$OUT"
echo "report: $OUT/report.json"

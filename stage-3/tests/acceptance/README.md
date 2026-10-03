# Stage 3 acceptance tests (auditor)

These are black-box tests written from `stage-3.md`, plus `stage-2.md` and `stage-1.md`, which
still apply.

- **Ledgers:** `LEDGER.md` (stage 3), `LEDGER-stage2.md` and `LEDGER-stage1.md`.
- **Test names:** every test name starts with the ledger ID or IDs it covers.
- **Carried-forward suites:** the stage-1 and stage-2 suites are copied unchanged from
  `stage-2/tests/acceptance/`. The one exception is two assertions adjusted for stage-3 revisions;
  see K-13 in `LEDGER.md`.

| Files | What they cover | Needs |
|---|---|---|
| `*.test.mjs` | Stage-1 and stage-2 regression, plus stage 3: `explain-history`, `policies`, `amend3`, `series`, `moves3`, `upgrade3` | Node 22, no packages |
| `browser/*.test.mjs` | Stage-2 screens (regression), plus `policies-ui` (stage 3) | Node 22, `playwright-core` 1.63.0 and Chromium |

## Setup (browser tests only, once)

Run from the repository root:

```sh
npm --prefix stage-3/tests/acceptance ci
# Only if Chromium for Playwright 1.63 is not already cached:
npx --prefix stage-3/tests/acceptance playwright-core install chromium
```

## Run

Start the stage-3 service on port 8080, then, from the repository root:

```sh
# API: stage-1 + stage-2 regression and the stage-3 API tests
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-3/tests/acceptance/*.test.mjs

# Browser
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-3/tests/acceptance/browser/*.test.mjs
```

### Upgrade tests

- `upgrade3.test.mjs` imports real exports from the earlier services.
- The carried `upgrade.test.mjs` imports a stage-1-shaped export from `PREVIOUS_BASE_URL`, which
  also works when that service is stage 2.
- Each case is skipped when its variable is unset.

```sh
docker build -t tablekeeper-stage-1 stage-1 && docker run -d --rm -p 8081:8080 tablekeeper-stage-1
docker build -t tablekeeper-stage-2 stage-2 && docker run -d --rm -p 8082:8080 tablekeeper-stage-2
BASE_URL=http://localhost:8080 PREVIOUS_BASE_URL=http://localhost:8082 PREVIOUS_STAGE1_BASE_URL=http://localhost:8081 \
  node --test --test-concurrency=1 stage-3/tests/acceptance/upgrade.test.mjs stage-3/tests/acceptance/upgrade3.test.mjs
```

## Notes

- **Policy fixtures.** Restaurant `r_pol` uses manager `u_max` (`max@example.com`). Restaurant
  `r_soon` sits in UTC, so cutoff tests can book three days ahead. Restaurant `r_dst` has no
  managers.
- **Dates.** Bookings use the Thursday at least 21 days ahead, and the weeks after it. The DST
  series tests use next year's Europe/Berlin transitions.
- **Run order.** `--test-concurrency=1` is required, because every test resets the service.

# Stage 4 acceptance tests (auditor)

These are black-box tests written from `stage-4.md`, plus `stage-3.md`, `stage-2.md` and
`stage-1.md`, which still apply.

- **Ledgers:** `LEDGER.md` (stage 4), `LEDGER-stage3.md`, `LEDGER-stage2.md` and
  `LEDGER-stage1.md`.
- **Test names:** every test name starts with the ledger ID or IDs it covers.
- **Carried-forward suites:** the stage-1/2/3 suites are copied unchanged from
  `stage-3/tests/acceptance/`.

| Files | What they cover | Needs |
|---|---|---|
| `*.test.mjs` | Stage-1/2/3 regression, plus stage 4: `replan`, `apply`, `revision`, `series-amend`, `upgrade4` | Node 22, no packages |
| `browser/*.test.mjs` | Earlier screens, plus `closure-ui` (stage 4) | Node 22, `playwright-core` 1.63.0 and Chromium |

`lib4.mjs` contains `optimalPlan`, an exhaustive reference search written from the stage-4
objective. The replan tests compare the service's plans with it.

## Setup (browser tests only, once)

Run from the repository root:

```sh
npm --prefix stage-4/tests/acceptance ci
# Only if Chromium for Playwright 1.63 is not already cached:
npx --prefix stage-4/tests/acceptance playwright-core install chromium
```

## Run

Start the stage-4 service on port 8080. For the upgrade tests, also start the earlier stages,
for example on ports 8083 (stage 3), 8082 (stage 2) and 8081 (stage 1):

```sh
for n in 1 2 3; do docker build -t tablekeeper-stage-$n stage-$n; done
docker run -d --rm -p 8081:8080 tablekeeper-stage-1
docker run -d --rm -p 8082:8080 tablekeeper-stage-2
docker run -d --rm -p 8083:8080 tablekeeper-stage-3
```

Then, from the repository root:

```sh
# API: regression, stage 4, and upgrades from stages 3, 2 and 1
BASE_URL=http://localhost:8080 \
PREVIOUS_BASE_URL=http://localhost:8083 \
PREVIOUS_STAGE2_BASE_URL=http://localhost:8082 \
PREVIOUS_STAGE1_BASE_URL=http://localhost:8081 \
  node --test --test-concurrency=1 stage-4/tests/acceptance/*.test.mjs

# Browser
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-4/tests/acceptance/browser/*.test.mjs
```

### Upgrade variables

- `PREVIOUS_BASE_URL` is the stage-3 service. It also feeds the carried `upgrade.test.mjs` and
  `upgrade3.test.mjs`, which work against a stage-3 source too.
- `PREVIOUS_STAGE2_BASE_URL` is the stage-2 service, used by `upgrade4.test.mjs`.
- `PREVIOUS_STAGE1_BASE_URL` is the stage-1 service, used by `upgrade3.test.mjs` and
  `upgrade4.test.mjs`.

Each upgrade case is skipped when its variable is unset.

## Notes

- **Fixture.** `r_rep` has 6 tables, 4 declared pairs and manager `u_max` (`max@example.com`).
- **Dates.** The Thursday at least 21 days ahead.
- **Run order.** `--test-concurrency=1` is required, because every test resets the service.

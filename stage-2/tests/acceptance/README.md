# Stage 2 acceptance tests (auditor)

These are black-box tests written from `stage-2.md` and from `stage-1.md`, which still applies.

- `LEDGER.md` holds the stage-2 ledger. `LEDGER-stage1.md` is the stage-1 ledger.
- Every test name starts with the ledger ID or IDs it covers.
- The stage-1 suite is carried forward unchanged. Its files are `lib.mjs` and the stage-1
  `*.test.mjs` files.

| Files | What they cover | Needs |
|---|---|---|
| `*.test.mjs` (this folder) | The stage-1 regression suite, plus the stage-2 API tests: `combos`, `concurrency2` and `upgrade` | Node 22, no packages |
| `browser/*.test.mjs` | The screens, grid, booking, lost and out-of-order responses, lookup, upgrade, and product-quality rules | Node 22, `playwright-core` 1.63.0 and Chromium |

## Setup (browser tests only, once)

Run from the repository root:

```sh
npm --prefix stage-2/tests/acceptance ci
# Only needed if Chromium for Playwright 1.63 is not already in ~/Library/Caches/ms-playwright:
npx --prefix stage-2/tests/acceptance playwright-core install chromium
```

## Run

Start the stage-2 service, for example the stage-2 Docker image on port 8080. Then, from the
repository root:

```sh
# API: the stage-1 regression suite and the stage-2 API tests
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-2/tests/acceptance/*.test.mjs

# Browser (headless Chromium driven from the host)
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-2/tests/acceptance/browser/*.test.mjs
```

`--test-concurrency=1` is required, because every test resets the service.

### Upgrade test against the stage-1 service

`upgrade.test.mjs` imports a real stage-1 export. It is skipped unless `PREVIOUS_BASE_URL` points
at a running stage-1 service:

```sh
docker build -t tablekeeper-stage-1 stage-1 && docker run -d --rm -p 8081:8080 tablekeeper-stage-1
BASE_URL=http://localhost:8080 PREVIOUS_BASE_URL=http://localhost:8081 \
  node --test --test-concurrency=1 stage-2/tests/acceptance/upgrade.test.mjs
```

## Notes

- **Dates.** Dates are relative to today: a Thursday at least 21 days ahead, and the Monday after
  it, which is closed. The DST tests use the 2026 transitions.
- **Lost and out-of-order responses.** These are simulated with Playwright request interception.
  - Booking requests are recognised as POSTs whose body contains `starts_at_local`, on any path.
  - Searches are recognised by the restaurant id or date in their URL.
- **Browser flags.** Chromium is launched the way the supplied harness launches it, with the
  service origin treated as a secure context.

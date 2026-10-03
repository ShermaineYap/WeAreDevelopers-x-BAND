# Stage 1 acceptance tests (auditor)

Black-box HTTP tests written from `tablekeeper/spec/stage-1.md` alone. Every test name starts
with the ledger ID it covers; see `LEDGER.md` for the ledger and the interpretations chosen.

No dependencies: plain ES modules on Node 22's built-in `node:test`, `fetch` and `Intl`.
No `npm install` is needed.

## Run

Start the service (e.g. the stage-1 Docker image on port 8080), then from the repository root:

```sh
BASE_URL=http://localhost:8080 node --test --test-concurrency=1 stage-1/tests/acceptance/*.test.mjs
```

`BASE_URL` defaults to `http://localhost:8080`. `--test-concurrency=1` is required: every test
calls `POST /_test/reset`, so files must not run in parallel against one service.

To run one area: `node --test stage-1/tests/acceptance/dst.test.mjs` (likewise `auth`,
`availability`, `validation`, `reservations`, `cancel-amend`, `idempotency`, `moves`,
`export`, `concurrency`, `runtime`).

Dates are computed relative to today (bookings are placed on a Thursday at least 21 days ahead,
so cutoffs never interfere), except the DST tests, which use the 2026 transitions named in §9.

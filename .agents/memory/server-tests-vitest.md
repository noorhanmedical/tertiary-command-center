---
name: Server tests are vitest suites
description: Server __tests__ files run under vitest, not tsx; guard scripts must exec them via vitest run.
---

All pure `server/**/__tests__/*.test.ts` files are vitest `describe`/`it` suites, run by `npx vitest run` alongside client tests.

**Why:** They were once standalone tsx scripts. Running a vitest suite via `npx tsx <file>` crashes with `Cannot read properties of undefined (reading 'config')` because vitest's `it` needs the runner context. Many `scripts/qa-*.mjs` guard scripts exec these test files as subprocesses — after conversion every such exec had to become `npx vitest run <file>` (there were TWO exec idioms to catch: ``execSync(`npx tsx ${TEST}`)`` and `spawnSync("npx", ["tsx", testAbs])`).

**How to apply:**
- New server unit tests: write vitest suites; they're picked up by the config include automatically.
- Live-DB tests (need env like `DATABASE_URL` + fixture ids): keep as standalone tsx scripts and add them to the vitest `exclude` list (precedent: the operational-queue live parity script).
- `tests/unit/*` files are still plain tsx scripts — do NOT run those via vitest.
- If a qa guard script starts failing with the "reading 'config'" TypeError, it's exec'ing a vitest suite via tsx.

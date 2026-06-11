# Phase 1 scanner enforcement plan

**Status:** Docs-only (Batch I2 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-scanner-enforcement-plan.mjs`.

Defines how the existing 160+ `scripts/qa-*.mjs` checks transition
from "developer-run after edits" to "enforced on every PR" without
breaking the in-flight work. No CI YAML is added in Phase 1 — that
needs explicit approval. This document records the contract so a
future approved batch can wire CI / pre-commit safely.

## Today's posture (Phase 1)

- Every batch runs `npm run check && npm run build && for s in
  scripts/qa-*.mjs; do node "$s" >/dev/null || exit 1; done` before
  commit.
- No machine enforces the sweep on a PR.
- Operator habit + this run's batch discipline is the only guard.

## Target posture (post-Phase 1)

| Layer | Check |
|---|---|
| Pre-commit hook | `npm run check` + a fast subset (no test execution) |
| PR CI | full `scripts/qa-*.mjs` sweep + `npm run build` |
| PR CI | tsc strict + lint (when wired) |
| Branch protection | "Phase 1 QA sweep" status must be green to merge |

## What the sweep enforces today

Source-invariant pins covering:

- Canonical call-result side-effect ownership matrix
- Engagement / outreach delegation flag posture
- Per-surface step suppression
- Plexus IQ read-model invariants (no write paths)
- Admin Review boundary preservation
- Team Portal panel / playground protection
- Document-readiness envelope shape
- Portal call-history route shape + 404 invariants
- Architecture docs registry coverage
- Phase 1 ancillary / billing / invoicing scaffolds dormancy
- AWS deployment contract presence + `.gitignore` secret hygiene
- Phase 1 env var inventory liveness cross-check
- End-to-end smoke contract presence + DispositionSheet invariants

## Migration plan (future approved batch)

1. Add a `.github/workflows/qa.yml` that runs `npm ci`, `npm run
   check`, `npm run build`, then loops over `scripts/qa-*.mjs`.
2. Make the workflow required on `main` branch protection.
3. Add a tiny `tools/qa-sweep.sh` so local + CI share the same
   invocation.
4. Skip explicit IaC + secrets-scanning CI integration in Phase 1.

## What this contract does NOT do

- Add CI YAML in Phase 1 (explicit approval needed).
- Add pre-commit hooks in Phase 1.
- Modify any existing `scripts/qa-*.mjs` to become CI-aware.
- Change the QA pattern (still source-invariant, no DB / network /
  app boot).
- Touch Plexus IQ / Admin Review.

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[phase-1-aws-deploy-runbook]]
- [[phase-1-aws-smoke-test-runbook]]
- [[phase-1-end-to-end-smoke-contract]]

End of plan.

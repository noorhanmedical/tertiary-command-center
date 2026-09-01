# ADR-003: Remove Runtime Schema Push; Migrations as a Gated One-Shot Task

**Date:** 2026-08-25
**Status:** Proposed
**Deciders:** Platform owner (approval pending), Architecture review (Kiro-assisted)
**Parent:** [High-Level Design](../high-level-design.md) §5, §7

## Context

The production container starts with:

```
CMD ["sh", "-c", "HOME=/app/tmp npx drizzle-kit push --force && node dist/index.cjs"]
```

(`Dockerfile`). This means **every container start runs `drizzle-kit push
--force`** against the database (GAP-035). Consequences:

- **Destructive, implicit schema reconciliation on every boot.** `push --force`
  reconciles the database to the current schema without a reviewed migration; it
  can drop or alter columns/constraints as a side effect of a deploy or even a
  restart.
- **Non-deterministic, unreviewed changes.** There is no migration artifact to
  review, no ordering guarantee, and no backup/lock/verification step.
- **Amplified blast radius under ECS scaling.** Multiple tasks starting can each
  attempt schema reconciliation.
- **Blocks ADR-002.** The fail-closed tenancy work requires a controlled data
  migration (backfill `clinic_id`, then `NOT NULL`). That cannot be done safely
  through boot-time `push --force`.

The repository already contains a `migrations/` directory managed by Drizzle
(protected — not to be hand-edited), so the tooling for versioned migrations
exists; it simply is not used at deploy time.

## Decision

**Remove schema mutation from container startup** and run database migrations as
a **separate, gated, one-shot task** in the promotion pipeline, before the new
application version takes traffic.

### 1. Container startup no longer mutates schema

Change the production start command to launch the app only:

```
CMD ["node", "dist/index.cjs"]
```

Startup performs no `drizzle-kit push`. Application boot may *verify* expected
schema version and fail closed if the database is behind, but it never mutates.

### 2. Migrations run as a one-shot pipeline step

Per ADR-001, in each environment the pipeline runs a dedicated migration task
against that environment's database **before** shifting traffic to the new
version:

```
Deploy digest to <env>
   └─ Run one-shot migration task (reviewed, versioned migrations)
        ├─ Pre-migration backup / snapshot checkpoint
        ├─ Apply forward migrations in order
        ├─ Verify (expected schema version + smoke checks)
        └─ On failure: stop promotion; documented roll-forward/rollback
   └─ Only then: canary the new app version
```

### 3. Migrations are versioned, reviewed, backward-compatible

- Migrations are code-reviewed artifacts, applied in order, never `--force`.
- Prefer **expand/contract** (backward-compatible) migrations so the running old
  version tolerates the new schema during canary, enabling rollback.
- Each production migration has a **pre-migration backup checkpoint** and a
  documented rollback/roll-forward plan.
- Data migrations (e.g., ADR-002's `clinic_id` backfill → `NOT NULL`) are staged:
  backfill and verify first, flip the constraint in a later step once clean.

## Rationale

- Removing `push --force` eliminates the single most dangerous production
  behavior in the current design: unreviewed, destructive schema change on every
  boot.
- A gated one-shot task makes schema change a **deliberate, reviewable, reversible
  event** with a backup and verification — what HIPAA contingency expectations and
  SOC 2 change-management both want.
- Expand/contract keeps rollback viable, which the canary strategy in ADR-001
  depends on.
- It unblocks ADR-002's safe tenant backfill.

## Alternatives Considered

### Option A: Keep `push` but drop `--force`
- **Pros:** Minimal change.
- **Cons:** `drizzle-kit push` still reconciles without reviewed migrations and
  still runs at boot on every task; ordering and review are still absent.
- **Why rejected:** Doesn't make schema change deliberate or reviewable.

### Option B: Run migrations from application code on startup (guarded by a lock)
- **Pros:** No separate task; single artifact.
- **Cons:** Couples schema change to every boot/scale event; a bad migration
  takes down app start; harder to gate, back up, and roll back independently.
- **Why rejected:** Schema change should be a separate, approvable step, not a
  side effect of starting the app.

### Option C: Manual DBA-run migrations outside the pipeline
- **Pros:** Full human control.
- **Cons:** Not repeatable, easy to skip or misorder, no automated evidence.
- **Why rejected:** Loses the reviewed, evidenced, environment-consistent
  promotion the pipeline provides. (A human **approval** of the migration is
  retained; manual *execution* outside the pipeline is not.)

## Consequences

### Positive
- No destructive schema change on deploy or restart.
- Reviewed, ordered, reversible migrations with backups and verification.
- Enables ADR-002's fail-closed backfill.
- Consistent schema promotion Dev → Staging → Prod; change-management evidence
  for SOC 2/HITRUST.

### Negative (accepted trade-offs)
- Requires building the one-shot migration task and its gating into the pipeline.
- Requires discipline: every schema change now goes through a reviewed migration,
  not an implicit reconcile.
- Some in-flight schema drift (from prior `push --force` runs) must be
  reconciled into a clean baseline migration first.

### Risks
- **Existing prod schema may not match the migration history** (a consequence of
  historic `push --force`). Mitigation: capture the current production schema,
  create a verified baseline migration, and reconcile before enabling the gate.
  Deployed schema parity was never queried in the audit — this must be verified
  by an authorized operator (see gap register limitations).
- **A failed migration mid-promotion.** Mitigation: backup checkpoint + expand/
  contract + documented rollback; rehearse in staging on synthetic data first.

## References
- Code: `Dockerfile`, `migrations/` (Drizzle-managed), `drizzle.config.ts`
- Power steering: `resilience-and-deployment.md`
- Gap register: `docs/GAP_ANALYSIS.md` (GAP-035)

## Related Artifacts
- [High-Level Design](../high-level-design.md) — §5 (deployment), §7 (deployment)
- [ADR-001](./ADR-001-multi-account-structure-and-promotion-pipeline.md) — the pipeline this step lives in
- [ADR-002](./ADR-002-fail-closed-pool-tenancy.md) — the tenant backfill this migration process delivers safely

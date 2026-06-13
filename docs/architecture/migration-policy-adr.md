# ADR: Migration Policy

**Status:** Accepted (Phase 1, Slice 1.0)
**Context:** Tertiary Command Center / Plexus operating platform

## Context

The repo runs a Postgres-backed runtime (Drizzle ORM) with raw SQL
migrations under `migrations/` (0000 → 0029 today). Multiple
engineers + AI-assisted edits land schema changes per phase. Without
a written policy, a future commit can:

- collide on a migration number,
- silently break facility / patient / billing joins,
- create destructive operations that aren't reversible,
- drift schema between staging and production.

This ADR sets the policy for **how** new migrations are added during
Phases 1 → 5.

## Decision

### 1. Numbering

- New migration files are named `NNNN_<short_snake_case>.sql`.
- `NNNN` is a strictly increasing 4-digit integer, never reused.
- When two branches both add `NNNN`, the second-merged branch renames
  to `NNNN+1` before merging. Never edit the already-merged file.
- The current latest committed migration is `0029_add_patient_directory_events.sql`,
  so the next available id is `0030`. There is a historical collision
  at `0021` (`0021_add_invoice_payments.sql` + `0021_invoice_email_metadata.sql`)
  — this is documented in `phase-1-full-system-inventory.md` §1 as
  technical debt to address out-of-Phase-1.

### 2. Additive bias

Phase 1 migrations are **additive only**:

- new columns: NULLABLE or with a safe default
- new tables: do not block existing reads
- new indexes: created with `IF NOT EXISTS`
- no `DROP COLUMN`, `DROP TABLE`, `ALTER TYPE`, or destructive
  `UPDATE` without an explicit ADR amendment.

Backfills that read existing data MUST be deterministic, idempotent,
and reversible. The migration file must include a top-of-file comment
documenting:

- intent
- safe-default value (if any)
- backfill source
- whether the column / table is read-only at first or actively used
- the slice / ADR that introduced it

### 3. Dual-write window

When a Phase 1 slice introduces a new canonical store (e.g. a new
facilities table), the old source-of-truth (e.g. the existing
`facility` string field on `patient_screenings`) is preserved for at
least one production cycle, and writes go to **both** until a parity
check QA script proves they agree.

Parity check QA scripts live under `scripts/qa-phase-1-*-parity.mjs`
and must run green before the dual-write window closes in a later
phase.

### 4. Read-back at runtime

New migrations must include defensive reads in the service layer:

```ts
// 0027 / 0028 / 0029 columns — defensive read.
sourceFileName = nullableField<string>(batch, "sourceFileName");
```

This pattern is already used in
`server/services/patientDirectory/patientDirectoryStorageDeps.ts`
(see lines 50–60) and remains the canonical example for additive
migrations that may not yet be applied in every environment.

### 5. Rollback

Every migration must have a documented rollback path. For Phase 1
this can be:

- a `DROP COLUMN IF EXISTS` script kept under
  `migrations/rollback/<NNNN>.sql` (recommended for new columns), or
- a code-side rollback flag described in the migration file header
  that lets the service stop using the column without removing it
  (recommended for additive runtime data).

Rollback scripts are NOT auto-applied. They exist so an operator can
revert manually if a Phase 1 slice causes a regression in staging.

### 6. Reviewer checklist

Every PR that adds a migration must answer:

- [ ] Is this additive?
- [ ] Does the column / table have a safe default or nullable column?
- [ ] Is there a parity / shadow-read QA script (when introducing a
      canonical store)?
- [ ] Is the rollback path documented?
- [ ] Does the service layer read it defensively?
- [ ] Is the next migration number actually free?

### 7. What this ADR explicitly forbids during Phase 1

- destructive schema operations (`DROP COLUMN`, `DROP TABLE`,
  `ALTER TYPE`, `TRUNCATE`) in any migration committed to `main`
- editing an already-merged migration file
- creating a migration that requires a maintenance window
- creating a migration without a top-of-file comment
- shipping a new canonical store without a dual-write window

## Consequences

**Positive**

- Predictable, reversible schema evolution during phase work.
- Clear reviewer signal: a migration that lacks the top-of-file
  comment or rollback path is blocked.
- Aligns with the
  `phase-1-aws-deployment-contract.md` and
  `phase-1-aws-backup-runbook.md` already in `docs/architecture/`.

**Negative**

- Phase 4 (billing/invoicing) and Phase 5 (AWS activation) will need
  to revisit this ADR when cleanup migrations become necessary.
- The `0021` duplicate is not fixed by this ADR; it remains a Phase-2
  cleanup task because renaming a merged migration would itself break
  the policy in §1.

## References

- `docs/architecture/phase-1-aws-deployment-contract.md`
- `docs/architecture/phase-1-aws-backup-runbook.md`
- `docs/architecture/phase-1-canonical-id-registry.md`
- `docs/architecture/phase-1-full-system-inventory.md`
- `CLAUDE_PHASE_GUARDRAILS.md` §13 Safety protocol

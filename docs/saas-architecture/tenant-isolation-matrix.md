# Tenant Isolation Matrix

**Generated:** 2026-08-25
**Product:** Plexus Command Center (Plexus Ancillary application)
**Parent:** [High-Level Design](./high-level-design.md) §3, §6 · **Decision:** [ADR-002](./adr/ADR-002-fail-closed-pool-tenancy.md)

This matrix maps each functional component to its tenancy model, storage, and
isolation mechanism, and records **current state vs. target state**. The target
state is the fail-closed contract defined in ADR-002.

> **Scale context:** ~20 clinics Year 1, ~80 Year 3 → **pool** model throughout
> (confirmed in ADR-001/ADR-002). Every component below is Pool: one shared
> Express app, one shared RDS PostgreSQL database, tenant = `clinic_id` on rows,
> `admin` role bypasses scoping.

---

## 1. Isolation model (whole platform)

| Aspect | Current | Target (ADR-002) |
|---|---|---|
| Tenancy model | Pool (shared app + DB) | Pool (unchanged) |
| Tenant key | `clinic_id` column, **nullable** | `clinic_id`, **`NOT NULL`** after backfill |
| Tenant context | `req.clinicId` from session; `null` overloaded for admin **and** unassigned | Explicit resolved `clinicId` **or** explicit `platformAdmin`; neither ⇒ deny |
| Where enforced | Per-repository, inconsistently; many ID-only queries | Repository layer, **uniformly**; record-ID **+** `clinic_id` on every scoped read/write |
| Admin bypass | Implicit (`clinicId === null`) | Explicit, separately typed platform-admin path |
| Isolation on failure | **Fail-open** (missing scope ⇒ unscoped query) | **Fail-closed** (missing scope ⇒ denied) |
| DB backstop | None (nullable column) | `NOT NULL`; RLS as defense-in-depth stretch goal |
| Isolation testing | No cross-tenant negative suite | Mandatory cross-clinic + wrong-role negative tests (pipeline gate) |

Evidence: `server/middleware/clinicContext.ts`, `server/repositories/screening.repo.ts`
(and peers), `shared/schema/clinics.ts`, `shared/schema/users.ts`, `shared/schema/screening.ts`.

---

## 2. Service-Level Tenancy Decisions

All services are **Pool** compute (shared Express process) and **Pool** storage
(shared RDS). "Storage" below notes the primary store; documents also use S3.
"Isolation — current" reflects what the repository code does today.

| Component | Tenancy | Storage | Isolation — current | Isolation — target (ADR-002) |
|---|---|---|---|---|
| Identity & users | Pool | RDS (`users`) | Keyed by user id; `clinic_id` on user; role drives scope | Role/tenant resolved to explicit context; revoke on change (ADR-005) |
| Screening core (Plexus Ancillary) | Pool | RDS (`screening_batches`, `patient_screenings`) | Clinic filter applied **when clinicId provided**; several point reads/updates by **id only** | Record-ID + `clinic_id` on all reads/writes; admin path explicit |
| Appointments | Pool | RDS (`ancillary_appointments`) | `list/upcoming` filter on clinicId; `cancel`/by-id **id only** | Add `clinic_id` predicate to by-id mutations |
| Billing & invoices | Pool | RDS (`billing_records`, `invoices`, line items) | `listAll` filters on clinicId; `update`/`remove`/by-id **id only** | Tenant predicate on every invoice/billing mutation |
| Documents | Pool | RDS + **S3** | `uploadedDocuments.getById` **id only**; library repos mixed | Tenant predicate on metadata; S3 keys/prefixes tenant-scoped |
| Patient records/history | Pool | RDS (`patientDirectory`, `patientHistory`, notes) | history/reference deletes **id only** | Tenant predicate on all patient-data access |
| Cooldown | Pool | RDS (`cooldown_records`) | by-id **id only** | Tenant predicate on read/update |
| Generated/procedure notes | Pool | RDS (`procedure_notes`, `generated_notes`) | by-id **id only** | Tenant predicate on read/update |
| Engagement & outreach | Pool | RDS (`engagement`, `outreach`) | Mixed; some role-gated | Tenant predicate + role gate |
| Scheduling (triage, assignments, global) | Pool | RDS (`schedulingTriage`, `globalSchedule`) | homeStats/global filter on clinicId where present | Uniform tenant predicate |
| Analysis jobs | Pool | RDS (`analysis_jobs`) | by-id **id only**; admin-facing | Admin-only + explicit scope; PHI-safe (WP1) |
| Audit log | Pool | RDS (`audit`) | Behind auth gate; **not** admin-restricted (GAP-003) | Admin-only, tenant-scoped, minimum-necessary fields |
| Portals (physician/team) | Pool | RDS (`portalPrefs`, `portalWidgets`) | Keyed by user/entity | Tenant + user predicate |
| Clinical AI (screening/notes) | Pool (stateless call) | No PHI persisted in AI layer (target) | Calls OpenAI; PHI in prompt | Bedrock + dual-zone; minimum-necessary payload (ADR-004) |

---

## 3. Isolation Enforcement Details (representative)

### Screening core (Plexus Ancillary)
- **Tenancy:** Pool. `patient_screenings` / `screening_batches` carry `clinic_id`.
- **Current:** `clinicFilter()` / `clinicFilterScreening()` return `undefined`
  when `clinicId == null`, so the query runs unscoped; `getScreening(id)` /
  `updateScreening(id, …)` use record ID only.
- **Target:** resolve tenant context explicitly; add `clinic_id` predicate to
  point reads/updates/deletes; admin all-clinic access via explicit platform path.
- **Cross-tenant prevention:** repository-layer predicate + `NOT NULL` column.
- **Testing:** Clinic A user cannot read/mutate Clinic B screening by ID;
  unassigned non-admin sees nothing.

### Billing & invoices
- **Tenancy:** Pool. `billing_records` / `invoices` carry `clinic_id`.
- **Current:** aggregate lists filter on clinicId; `update`, `remove`, and by-id
  invoice reads are ID-only.
- **Target:** tenant predicate on every mutation and by-id read; financial data
  must never be reachable cross-clinic by ID.

### Documents (RDS + S3)
- **Tenancy:** Pool. Metadata in RDS; files in S3.
- **Current:** `uploadedDocuments.getById` is ID-only.
- **Target:** tenant predicate on metadata; **S3 object keys prefixed by tenant**
  (`clinic/{clinicId}/…`) and access scoped so one clinic's objects are not
  reachable via another clinic's context.

### Clinical AI
- **Tenancy:** Pool, stateless. The AI layer should hold **no** PHI at rest.
- **Target (ADR-004):** dual-zone — AI path calls Bedrock but cannot read the PHI
  store directly; a controlled gate passes minimum-necessary fields and writes
  results back. Per-inference audit with tenant/user/patient/model metadata.

---

## 4. Tier Mapping

Plexus Command Center has **no productized pricing tiers** today; all clinics
receive the same pool deployment. If tiers are introduced later, this section and
a Tiering Matrix would define pool-vs-bridge-vs-silo per tier. For now:

| Tier | Pool | Bridge | Silo |
|---|---|---|---|
| All clinics (single tier) | All components | — | — |

---

## 5. Open Questions / Risks

- **Uneven enforcement (GAP-001/002/003):** clinic filtering is applied in some
  repositories and absent (ID-only) in others. Target is uniform repository-layer
  enforcement; until then, ID-only paths are the concrete cross-tenant exposure.
- **`clinic_id` nullable:** the database currently permits unscoped rows.
  Backfill + `NOT NULL` is required (delivered via ADR-003 one-shot migration).
- **S3 tenant scoping:** confirm document object keys are tenant-prefixed and
  access-scoped; not yet verified in this matrix.
- **Admin path:** must be reimplemented as an explicit platform-admin scope, not
  the `clinicId === null` fallback, so a misconfigured non-admin cannot inherit
  all-clinic visibility.
- **RLS:** PostgreSQL Row-Level Security is a recommended defense-in-depth layer
  after the application-layer contract is in place.

---

## 6. Related Artifacts

- [High-Level Design](./high-level-design.md) — §3 (logical architecture), §6 (isolation)
- [ADR-002: Fail-Closed Pool Tenancy](./adr/ADR-002-fail-closed-pool-tenancy.md) — the decision this matrix details
- [ADR-003: Migrations as Gated One-Shot Task](./adr/ADR-003-migrations-as-gated-one-shot-task.md) — delivers the `clinic_id` backfill/`NOT NULL`
- [ADR-004: OpenAI → Bedrock](./adr/ADR-004-openai-to-bedrock-phi-inference.md) — AI-layer isolation (dual-zone)
- Data Partitioning Map (planned) — storage key design and backup/erasure detail
- [Gap Register](../GAP_ANALYSIS.md) — GAP-001, GAP-002, GAP-003

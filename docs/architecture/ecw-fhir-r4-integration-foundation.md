# eClinicalWorks FHIR R4 — Integration Station foundation

Branch: `ecw-api-integration-station-foundation`
Phase: **1 of 2** — UI + scope/mapping/routing model + this doc.
Status: **demo-only**; no backend, no credential storage, no sync worker, no PHI ingestion.

This doc is the Phase 2 blueprint. Phase 1 ships the admin surface so the
mapping + routing model can be reviewed, scoped, and signed off before
anyone wires sync against a live tenant.

---

## 1. Overview

The **API Integration Station** is the central admin console for third-party
EMR + FHIR integrations. PR #295 (this branch) opens the surface with
eClinicalWorks FHIR R4 as the first vendor. The architecture is built so
additional vendors (Epic FHIR, Athena, Cerner) plug into the same shell
in later phases by adding a new `vendor` value + a new connection
profile schema; the rest (mapping / routing / audit / sync jobs) is
already vendor-agnostic.

Phase 1 (this PR) ships:

- The admin shell at **`/admin/settings-center/api-integrations`**.
- All 18 eCW FHIR R4 read-scope definitions with destination modules
  + internal-table targets + dependency graph.
- A Field Mapping seed for every resource.
- A Service Request routing table (Encounter vs ServiceRequest semantics).
- An Ancillary routing table that enforces Imaging Central = ultrasound-only.
- A Document routing table keyed by LOINC.
- A Coverage / payor mapping shell.
- A Billing Readiness checklist mapped to FHIR sources.
- Patient identity matching rules with auto-merge threshold.
- Sync Jobs / Error Center / Audit Log shells (empty by design).
- A Security & Credentials page documenting the vault policy.
- A Test Console with disabled diagnostic actions.
- A Mission Control "eCW Sync Health" panel (counters render zero,
  marked "Integration Station pending backend sync").

Phase 1 does NOT ship: backend tables, migrations, credential storage,
sync worker, normalization pipeline, real OAuth, Binary decoding,
patient merge actions.

---

## 2. Admin Settings location

- Route: `/admin/settings-center/api-integrations` (Wouter route inside `client/src/App.tsx`).
- Linked from: `/admin` (tile grid in `client/src/pages/admin.tsx`) with a new "API Integration Station" tile.
- Sibling surface: the existing `/admin/settings-center` (admin_settings rows) is unchanged.
- The page introduces an internal left-rail navigation pattern. Future multi-section admin surfaces (e.g., RingCentral integration, EMR adapter for Athena) should adopt the same shell pattern.

---

## 3. The 18 eCW FHIR R4 read scopes

All 18 are required Phase 1 surfaces; Phase 2 will enable per-scope sync
in dependency order. The dependency column is the order Phase 2's
worker MUST follow — `Encounter` is meaningless without `Patient`
already in our spine, and so on.

| # | Scope | Resource | Depends on | Required for go-live |
|---|---|---|---|---|
| 1 | `system/Patient.read` | Patient | — | yes |
| 2 | `system/Encounter.read` | Encounter | Patient, Practitioner | yes |
| 3 | `system/Condition.read` | Condition | Patient | yes |
| 4 | `system/MedicationRequest.read` | MedicationRequest | Patient, Medication, Practitioner | yes |
| 5 | `system/Medication.read` | Medication | — | no |
| 6 | `system/Observation.read` | Observation | Patient, Encounter | yes |
| 7 | `system/DiagnosticReport.read` | DiagnosticReport | Patient, Encounter, Binary | yes |
| 8 | `system/DocumentReference.read` | DocumentReference | Patient, Binary | yes |
| 9 | `system/Binary.read` | Binary | — | yes |
| 10 | `system/Procedure.read` | Procedure | Patient, Encounter | yes |
| 11 | `system/AllergyIntolerance.read` | AllergyIntolerance | Patient | no |
| 12 | `system/Coverage.read` | Coverage | Patient | yes |
| 13 | `system/Immunization.read` | Immunization | Patient | no |
| 14 | `system/ServiceRequest.read` | ServiceRequest | Patient, Practitioner | yes |
| 15 | `system/Practitioner.read` | Practitioner | — | yes |
| 16 | `system/Device.read` | Device | — | no |
| 17 | `system/MedicationAdministration.read` | MedicationAdministration | Patient, Medication | no |
| 18 | `system/Specimen.read` | Specimen | Patient | no |

Source-of-truth list lives in `client/src/lib/api-integrations/ecw/ecwScopes.ts`.
Each entry carries: scope string, FHIR resource, downstream modules,
internal table names (Phase 2 will create these), dependencies, and a
go-live-required flag.

---

## 4. Raw FHIR storage model (Phase 2)

A single append-only table per connection holds every fetched resource
exactly as received:

```sql
-- Phase 2 (PR #2)
CREATE TABLE integration_raw_resources (
  id              bigserial PRIMARY KEY,
  connection_id   uuid NOT NULL REFERENCES integration_connections(id),
  resource_type   text NOT NULL,                    -- 'Patient', 'Encounter', ...
  upstream_id     text NOT NULL,                    -- FHIR resource id
  version_id      text,                             -- FHIR meta.versionId
  last_updated    timestamptz,                      -- FHIR meta.lastUpdated
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,                   -- raw FHIR JSON
  CONSTRAINT raw_resources_unique UNIQUE (connection_id, resource_type, upstream_id, version_id)
);
CREATE INDEX raw_resources_by_patient ON integration_raw_resources ((payload->>'subject'));
CREATE INDEX raw_resources_by_type_time ON integration_raw_resources (resource_type, last_updated DESC);
```

Notes:
- Insert-only; never mutated. New versionId → new row.
- Patient resolution + PHI display goes through the normalization step,
  not directly off the raw store.
- The Raw FHIR Viewer in the Integration Station reads from this table
  with admin-only auth.

---

## 5. Sync job model (Phase 2)

```sql
CREATE TABLE integration_sync_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES integration_connections(id),
  job_type        text NOT NULL,        -- 'full' | 'incremental' | 'resource' | 'date_range' | 'panel' | 'clinic' | 'provider' | 'validation'
  resource        text,                 -- NULL for 'all'
  status          text NOT NULL,        -- enum: see SyncStatus in ecwTypes.ts
  started_at      timestamptz,
  finished_at     timestamptz,
  requested_by    uuid REFERENCES users(id),
  resource_count  integer,
  error_count     integer,
  config          jsonb,                -- date range, panel filter, dry-run, etc.
  notes           text,
  CONSTRAINT sync_job_status_check CHECK (status IN ('Requested','Accepted','In Progress','Complete','Partial Complete','Failed','Cancelled','Paused'))
);
CREATE INDEX sync_jobs_by_connection_status ON integration_sync_jobs (connection_id, status, started_at DESC);
```

The Phase 2 worker is **advisory-locked** via Postgres so multiple ECS
tasks running in parallel never double-fire — matches the existing
`absenceWatcher` / `morningRebuildScheduler` pattern.

---

## 6. Sync error model (Phase 2)

```sql
CREATE TABLE integration_sync_errors (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                 uuid REFERENCES integration_sync_jobs(id) ON DELETE SET NULL,
  connection_id          uuid NOT NULL REFERENCES integration_connections(id),
  resource               text,
  category               text NOT NULL,
  severity               text NOT NULL,
  message                text NOT NULL,
  upstream_resource_id   text,
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  acknowledged_at        timestamptz,
  acknowledged_by        uuid REFERENCES users(id),
  CONSTRAINT err_severity_check CHECK (severity IN ('Info','Warning','Error','Critical'))
);
CREATE INDEX sync_errors_unack ON integration_sync_errors (connection_id, acknowledged_at) WHERE acknowledged_at IS NULL;
```

Categories: `Authentication | Authorization | Network | Rate Limit |
Validation | Mapping | Downstream Routing | PHI Integrity | Unknown`.

Error messages **must strip patient identifiers** before persisting.
PHI never enters this table.

---

## 7. Normalization pipeline (Phase 2)

Per resource, the worker runs:

```
[FHIR fetch] → [raw store insert] → [field mapping resolve] → [identity match]
            → [downstream route]   → [audit log]            → [sync job stats]
```

Identity match uses the rules in `ecwRoutingRules.ts:PATIENT_MATCH_RULES`.
Sum ≥ `PATIENT_MATCH_AUTO_THRESHOLD` (80) → auto-merge candidate.
Below threshold → enters the manual review queue.

PHI never leaves the worker; downstream tables get internal IDs only,
not raw FHIR payloads.

---

## 8. Resource → internal-table mapping

| Resource | Internal tables (Phase 2 — names declared in code now) |
|---|---|
| Patient | `patient_screenings`, `patient_directory_records` |
| Encounter | `global_schedule_events`, `patient_journey_events` |
| Condition | `patient_screenings.diagnoses`, `patient_journey_events` |
| MedicationRequest | `patient_screenings.medications` |
| Medication | `medication_catalog` |
| Observation | `patient_screenings.history`, `ancillary_observations` |
| DiagnosticReport | `case_document_readiness`, `ancillary_documents` |
| DocumentReference | `documents`, `document_surface_assignments` |
| Binary | `document_blobs` |
| Procedure | `procedure_events` |
| AllergyIntolerance | `patient_allergies` |
| Coverage | `insurance_eligibility_review`, `cooldown_records` |
| Immunization | `patient_immunizations` |
| ServiceRequest | `service_requests`, `patient_execution_cases` |
| Practitioner | `users`, `outreach_schedulers` |
| Device | `device_catalog` |
| MedicationAdministration | `medication_administrations` |
| Specimen | `specimen_catalog` |

Existing tables (`patient_screenings`, `patient_journey_events`,
`global_schedule_events`, `documents`, `procedure_events`, etc.) need
**column additions** in Phase 2 to capture upstream FHIR provenance —
this is additive-only per `docs/architecture/do-not-touch.md`. New
tables (`medication_catalog`, `device_catalog`, etc.) are net-new
additions.

**Approval gate:** Every schema change requires explicit operator
approval per the protected-files policy. The Integration Station UI
does not unblock that.

---

## 9. Patient identity matching strategy

- Five weighted signals: MRN exact (60), Name+DOB exact (40), Name+DOB
  fuzzy (25), Phone exact (20), Insurance member ID exact (30).
- Auto-merge threshold: 80.
- Below threshold → manual review in the **Patient Identity** section
  of the Integration Station.
- Manual merge is a Phase 2 action that fires an audit event (`Patient
  Merged`) and writes to a new join table (`integration_patient_matches`).
- Conflict resolution rule: when MRN matches but name disagrees, the
  worker holds the candidate as "Duplicate Suspect" and refuses to
  auto-merge — admin action required.

---

## 10. Scheduling logic — Encounter vs ServiceRequest

This is the most-important semantic distinction and the cause of most
EMR integration bugs. Phase 2 must enforce it strictly.

- **Encounter** = a patient visit that EXISTS on the EMR's calendar.
  - Reconciles with our `global_schedule_events` table.
  - Does NOT put the patient back into the Plexus IQ qualification queue.
  - Does NOT create a new ServiceRequest.
  - Maps to: existing scheduling pipeline.

- **ServiceRequest** = an order, referral, or test that NEEDS to be
  qualified / scheduled / executed.
  - Routes via `SERVICE_REQUEST_ROUTING_DEFAULTS` (in `ecwRoutingRules.ts`):
    - Display contains "BrainWave" / "VitalWave" → Plexus IQ qualification queue.
    - Display contains an ultrasound study type → Imaging Central work queue.
    - CPT EKG / PGX → Manual triage (no module wired yet).
    - Other → Manual triage.
  - When the patient already exists in our spine, the worker attaches
    the ServiceRequest to that patient. When the patient does NOT exist,
    the worker creates a new `patient_screenings` row, fires identity
    match, and only attaches the ServiceRequest after identity is
    resolved.

---

## 11. Orders / ancillary routing

`ANCILLARY_ROUTING_DEFAULTS` in `ecwRoutingRules.ts` enforces destination
modules by ancillary type:

| Ancillary | Destination | Imaging Central? |
|---|---|---|
| Ultrasound | Imaging Central | yes (ultrasound only) |
| BrainWave | Ancillary Documents | no |
| VitalWave | Ancillary Documents | no |
| EKG | Ancillary Documents | no |
| PGX | Ancillary Documents | no |
| CGX | Ancillary Documents | no |
| Lab | Ancillary Documents | no |
| Imaging (Other) | Ancillary Documents | disabled |

This table is the runtime gate Phase 2 enforces. Imaging Central must
NEVER receive BrainWave / VitalWave / EKG / PGX / CGX / general lab
records — the boundary already documented in PR #294's Imaging Central
boundary comment.

---

## 12. Imaging Central ultrasound-only rule

Imaging Central is execution-only and ultrasound-only by design (see
`client/src/pages/imaging-central.tsx` header). The Integration Station
preserves this by:

1. Routing only `Ultrasound` ServiceRequests into Imaging Central
   (`ANCILLARY_ROUTING_DEFAULTS[id="anc-1"]`).
2. Marking every non-ultrasound ancillary destination as **NOT**
   `Imaging Central` (`imagingCentralUltrasoundOnly: true` flag).
3. Phase 2 normalization rejects writes to the Imaging Central table
   when the resource is not an ultrasound study type.

---

## 13. Billing readiness logic

The checklist in `ecwRoutingRules.ts:BILLING_READINESS_CHECKLIST` lists
each readiness flag and the FHIR resource + path that feeds it.

Phase 2 normalization fires the flags into the existing
`billing_readiness_checks` table (additive columns may be required if
the current table doesn't carry every flag yet — additive only per
do-not-touch policy).

Required readiness flags for go-live: Coverage active, Procedure CPT,
DiagnosticReport on file, Signed clinician note, ServiceRequest of
record, Linked Encounter.

---

## 14. Mission Control eCW Sync Health panel

PR #294 added Mission Control as a monitoring surface. PR #295 (this
branch) adds an **eCW Sync Health** section at the bottom of Mission
Control that surfaces:

- Connection status
- Last successful sync / next sync
- Per-resource imported counts (Patients, Encounters, Orders, Reports,
  Documents, Insurance, Procedures)
- Failed resources
- Unmapped providers / clinics
- Duplicate MRNs
- Missing insurance
- API sync errors
- Downstream routing errors

Phase 1 renders every counter as zero / "Not configured" and surfaces
a prominent **"Integration Station pending backend sync"** notice so
operators don't read placeholder zeros as live state.

Phase 2 wires the panel to a TanStack Query reading
`/api/integration-stations/ecw/health` (route TBD).

---

## 15. Audit + safety requirements

Phase 2 audit log writes (`integration_audit_log`) MUST fire on:

- Connection created / updated / disabled
- Authorization started / succeeded / failed
- Token refreshed
- Sync requested / completed / failed
- Mapping updated (with JSON diff)
- Scope toggled
- Secret rotated
- Manual patient merge

Rules:

1. **No PHI in audit summaries.** Use internal IDs only.
2. **Append-only.** No deletes, no edits.
3. **Actor required.** Every write captures `user_id`.
4. **Diff captured for config changes.** `mapping_updated` / `scope_toggled` carry before/after JSON.
5. **Retention:** 7 years (HIPAA-aligned). Long-term storage moves to S3 via the existing outbox/upload pattern.

---

## 16. Security and credential handling

**Hard rules (Phase 1 honors all of these — there is no backend yet,
so there is no place a secret could leak):**

1. Client secrets are stored server-side in the credential vault.
   Never in localStorage. Never in source code. Never echoed back to
   the UI after save.
2. The Connection Profile form stores a **vault reference** (opaque
   pointer), not the secret itself. The UI shows the masked reference
   only.
3. Tokens are stored in encrypted columns with explicit TTL. Refresh
   logic runs server-side under an advisory lock.
4. PHI is never logged. Error messages strip patient identifiers
   before persisting.
5. Audit log writes never include PHI.
6. The Raw FHIR Viewer reads from the raw store with admin-only auth
   and audit-event logging on every read.
7. The Secret Rotation flow (Phase 2) writes a `Secret Rotated` audit
   event and never returns the new secret to the browser.

---

## 17. Backend endpoints still needed (Phase 2)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/integration-connections` | GET / POST | List + create connection profiles |
| `/api/integration-connections/:id` | GET / PATCH / DELETE | Read / update / disable a connection |
| `/api/integration-connections/:id/credentials` | POST | Rotate the client secret (server-side; never returns the secret) |
| `/api/integration-connections/:id/authorize` | POST | Kick off OAuth client-credentials flow |
| `/api/integration-connections/:id/test` | POST | Diagnostic checks (connection / auth / sample fetch) |
| `/api/integration-scopes/:connectionId` | GET / PATCH | Read + toggle scopes per connection |
| `/api/integration-sync-jobs` | POST | Trigger a sync job |
| `/api/integration-sync-jobs/:id` | GET / DELETE | Status + cancel |
| `/api/integration-sync-errors` | GET / PATCH | List + acknowledge errors |
| `/api/integration-audit-log` | GET | Read audit trail (admin only) |
| `/api/integration-raw-resources` | GET | Admin raw-FHIR viewer (admin only) |
| `/api/integration-clinic-mappings` | GET / PATCH | Clinic mapping edits |
| `/api/integration-provider-mappings` | GET / PATCH | Provider mapping edits |
| `/api/integration-field-mappings` | GET / PATCH | Field mapping edits |
| `/api/integration-patient-matches` | GET / POST | Identity match queue + manual merge |
| `/api/integration-stations/ecw/health` | GET | Mission Control health panel |

All endpoints are `requireRole("admin")`-gated except the Mission
Control health endpoint (`admin` + `clinician`).

---

## 18. Migration / schema changes that will require approval

Phase 2 will need explicit operator approval (per `docs/architecture/do-not-touch.md`) for:

- New tables: `integration_connections`, `integration_scopes`,
  `integration_field_mappings`, `integration_clinic_mappings`,
  `integration_provider_mappings`, `integration_patient_matches`,
  `integration_sync_jobs`, `integration_sync_errors`,
  `integration_audit_log`, `integration_raw_resources`,
  `medication_catalog`, `device_catalog`, `specimen_catalog`,
  `medication_administrations`, `patient_immunizations`,
  `patient_allergies`, `service_requests`, `ancillary_observations`,
  `ancillary_documents`.
- Additive columns on existing tables to carry upstream FHIR provenance
  (`upstream_resource_id`, `upstream_version_id`, `upstream_last_updated`,
  `integration_connection_id`).
- New migration files starting at `0040_*` (current head is 0039 per
  `do-not-touch.md`). No renumbering of existing migrations.

**Approval gate:** each migration is its own PR with operator review.
Phase 2 will split across several PRs — at minimum:
1. Connections + scopes + audit (foundational).
2. Sync jobs + errors + raw resources.
3. Field/clinic/provider/coverage mappings.
4. Patient identity matching.
5. Per-resource normalization (one PR per resource group).

---

## Phase 1 vs Phase 2 — what ships now and later

**Phase 1 (this PR — UI foundation):**
- Admin shell at `/admin/settings-center/api-integrations`.
- All 18 scope definitions + dependency graph.
- Field/clinic/provider/coverage mapping tables (empty / read-only).
- ServiceRequest + ancillary + document routing defaults.
- Patient identity match rules.
- Billing readiness checklist.
- Sync Jobs / Error Center / Audit Log shells (empty).
- Security & Credentials policy page.
- Test Console with disabled diagnostics.
- Mission Control eCW Sync Health placeholder panel.
- This document.

**Phase 2 (separate PR series — backend + sync):**
- All schema migrations.
- Credential vault wiring.
- OAuth client-credentials + SMART-on-FHIR + Bulk FHIR.
- Sync worker (advisory-locked, per-resource).
- Normalization pipeline.
- Identity match service.
- Audit log writes.
- Raw FHIR viewer.
- Per-tile downstream routing handlers.
- Mission Control health endpoint.

**Phase 3 (later):**
- CCD decoding.
- Patient merge UI (with explicit operator approval per merge).
- Bulk FHIR `$export` processing.
- Additional vendors (Epic FHIR, Athena, Cerner) plugged into the same shell.
- Two-way write scopes (gated behind a separate write-scopes config).

---

## Risks + open questions

1. **Vendor tenant config.** eCW issues client credentials per tenant.
   The Connection Profile assumes one connection per tenant. Multi-tenant
   per-connection (one client serving N clinics) is an open question.
2. **Bulk FHIR `$export` rate limits.** eCW's $export quotas are not
   documented publicly; Phase 2 will need to add backoff + Rate Limit
   error category handling.
3. **Identity match false positives.** Auto-merge threshold of 80 is
   a starting point — operator review during Phase 2 dogfooding will
   tune the weights.
4. **PHI scrubbing in error messages.** Phase 2 must add a scrubbing
   middleware before persistence; the test suite must include negative
   tests (PHI passed in → scrubbed at persistence boundary).
5. **Cooldown reconciliation.** When a Coverage record changes payor,
   the existing cooldown profile may no longer apply. Phase 2 will
   recompute cooldown when Coverage mutates.
6. **`Encounter.status='planned'`.** eCW emits `planned` for future
   visits. Treat these as scheduling rows, not visit history.
7. **DocumentReference without Binary.** Some eCW DocumentReference
   payloads lack a `content.attachment.url`. Phase 2 catalogs the
   reference but flags `missing_binary` in `integration_sync_errors`.

---

## What should NOT be merged blindly

- **Don't merge to main while the credential vault and sync worker are
  missing.** The Integration Station UI looks operational but
  performs zero network calls. Merging into a customer-facing branch
  would mislead operators into thinking they can configure an EMR
  here.
- **Don't ship the Mission Control eCW panel without the "backend
  pending" notice.** Zeros without the notice would read as
  successful syncs with no data.
- **Don't enable scope toggles** in the UI until Phase 2 writes their
  state to `integration_scopes`. Today the switches are visual only;
  a future change must connect them to a real persistence layer
  before exposure to end users.
- **Don't accept client secrets through the form.** The field is
  hard-disabled until the vault rotation flow lands.
- **Don't decode Binary or CCD content in Phase 1 or Phase 2.** That
  is Phase 3 work; CCD parsing has its own security review.
- **Don't extend Imaging Central to non-ultrasound modalities** via
  the routing tables. Phase 2 normalization must enforce the
  ultrasound-only boundary.

---

## File map

```
client/src/lib/api-integrations/ecw/
  ecwTypes.ts              ── all TS types for the Integration Station
  ecwScopes.ts             ── 18 scope definitions + dependency graph
  ecwFieldMappings.ts      ── FHIR path → internal target seeds
  ecwRoutingRules.ts       ── ServiceRequest / Ancillary / Document /
                             Patient-match / Billing-readiness defaults
  ecwDemoData.ts           ── empty-by-design seeds for Phase 1 lists

client/src/components/api-integrations/
  BackendPendingNotice.tsx ── shared "backend pending" affordance
  SectionShell.tsx         ── section header + body wrapper + KPI card

client/src/pages/
  admin-api-integrations.tsx ── the API Integration Station page

client/src/App.tsx           ── route /admin/settings-center/api-integrations
client/src/pages/admin.tsx   ── tile in ADMIN_SECTIONS grid
client/src/pages/mission-control.tsx ── eCW Sync Health panel

docs/architecture/
  ecw-fhir-r4-integration-foundation.md  (this file)
```

End of Phase 1 foundation doc.

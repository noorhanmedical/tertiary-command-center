# API Integration Station — EMR foundation

Branch: `api-integration-station-foundation-clean`
Phase: **1 of 2** — UI + vendor-neutral framework + first vendor adapter (eClinicalWorks) + architecture plan.
Status: **demo-only**; no backend, no credential storage, no sync worker, no PHI ingestion, no writeback.

This document is the canonical, vendor-neutral architecture for the
Integration Station. The companion eCW-specific deep-dive lives in
`docs/architecture/ecw-fhir-r4-integration-foundation.md`.

---

## 1. API Integration Station overview

The Integration Station is the platform's central admin console for
third-party EMR and FHIR R4 integrations. It is the single place an
admin:

- Configures a vendor connection (OAuth, FHIR base URL, environment).
- Toggles per-resource scopes.
- Inspects mapping + routing rules.
- Triggers + monitors sync jobs (Phase 2).
- Reviews errors, audit, and security posture.
- Runs diagnostic checks before turning on full sync.
- Reads the Writeback Readiness gate before any write scope is even
  considered.

Phase 1 (this PR) ships the entire UI shell + the vendor-neutral
framework + the first vendor adapter (eClinicalWorks). It does not
ship any backend storage, credential vault, sync worker, or PHI
ingestion. Every action button is disabled with a "Backend endpoint
pending" affordance.

---

## 2. Vendor-neutral model

The Integration Station is built around a vendor-neutral contract:

```
┌─────────────────────────────────────────────────────────────────┐
│   API Integration Station (vendor-neutral shell)                │
│   ─────────────────────────────────────────────────────────     │
│   • Connection profile                                          │
│   • Scope management                                            │
│   • Field mapping                                               │
│   • Sync jobs + errors + audit                                  │
│   • Security & Credentials                                      │
│   • Writeback Readiness                                         │
│   • Downstream routing                                          │
│   • Test console                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │ uniform contract
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│   Vendor adapters                                               │
│   ─────────────────────────────────────────────────────────     │
│   eClinicalWorks FHIR R4   ← Phase 1 (this PR)                  │
│   Epic                       ← Future                           │
│   Athena                     ← Future                           │
│   Oracle Health (Cerner)     ← Future                           │
│   NextGen                    ← Future                           │
│   Veradigm                   ← Future                           │
│   Meditech                   ← Future                           │
│   Other FHIR R4 EMR          ← Future                           │
└─────────────────────────────────────────────────────────────────┘
```

The shared contract lives in
`client/src/lib/api-integrations/integration*.ts`:

| File | Contract |
|---|---|
| `integrationTypes.ts` | `IntegrationVendor`, `IntegrationConnection`, `IntegrationScope`, `IntegrationFieldMapping`, `IntegrationSyncJob`, `IntegrationSyncError`, `IntegrationAuditEvent`, `IntegrationCredentialPolicy`, `IntegrationResourceCount`, `IntegrationTestResult`, `IntegrationDownstreamDestination`, `IntegrationVendorAdapterCard` |
| `integrationVendors.ts` | Vendor catalog (eCW available; others marked "Future vendor adapter") |
| `integrationStatuses.ts` | Shared sync-status enum + UI tone hints |
| `integrationRouting.ts` | Pipeline stages (`fetch → raw store → field-map → identity-match → downstream route → audit → stats`) + canonical downstream destinations |
| `integrationSecurity.ts` | Security rules, credential policy, writeback gating checklist, future write candidates, Phase 1 summary string |

Per-vendor specifics live under
`client/src/lib/api-integrations/<vendor>/`. The eCW adapter lives at
`client/src/lib/api-integrations/ecw/`.

---

## 3. eClinicalWorks as the first vendor adapter

eClinicalWorks ships as the **first** available vendor adapter. The
adapter is NOT the whole system — it is one implementation behind the
shared contract above.

eCW adapter files:

| File | Purpose |
|---|---|
| `ecwTypes.ts` | eCW-specific narrowings (`EcwResourceType`, `EcwScopeString`, `IntegrationConnectionProfile`, etc.) |
| `ecwScopes.ts` | All 18 FHIR R4 read scopes with destinations + internal tables + dependency graph |
| `ecwFieldMappings.ts` | FHIR path → internal target seeds for every resource |
| `ecwRoutingRules.ts` | ServiceRequest / Ancillary / Document / patient-match / billing-readiness defaults |
| `ecwDemoData.ts` | Empty-by-design seeds for the Phase 1 lists |

When Epic / Athena / Cerner adapters land, they will create their
own `client/src/lib/api-integrations/<vendor>/` folders that re-implement
the same contract.

---

## 4. Future vendor adapter pattern

To add a new vendor:

1. Create `client/src/lib/api-integrations/<vendor>/` (one folder).
2. Implement `<vendor>Scopes.ts`, `<vendor>FieldMappings.ts`, `<vendor>RoutingRules.ts`, and a `<vendor>Adapter.ts` that exports a uniform `VendorAdapterContract` (Phase 2 will declare this).
3. Add the vendor to `INTEGRATION_VENDOR_ADAPTERS` in `integrationVendors.ts` with `status: "Available"` (was `"Future"`).
4. Add a vendor-specific Connection Profile section if the vendor has unique fields (e.g., Epic's `appOrchardId`).
5. Add a vendor-specific Scope Management section if the scope set differs.
6. Reuse the shell's Mappings / Operations / Security / Writeback sections — those are vendor-agnostic.

The shell never knows about a vendor's specifics; it only knows about
the shared contract.

---

## 5. 18 eCW FHIR R4 scopes

See `docs/architecture/ecw-fhir-r4-integration-foundation.md` §3 for
the full table. Summary:

`Patient · Encounter · Condition · MedicationRequest · Medication ·
Observation · DiagnosticReport · DocumentReference · Binary · Procedure ·
AllergyIntolerance · Coverage · Immunization · ServiceRequest · Practitioner ·
Device · MedicationAdministration · Specimen`

All 18 are represented in `ecwScopes.ts` with destinations, internal
tables, dependency edges, and go-live-required flags.

---

## 6. Read/import-first strategy

The Integration Station is read/import-first. Every Phase 1 scope is
`system/*.read`. The platform pulls upstream data, normalizes it, and
hands it off to internal modules — it does NOT push data back to the
EMR in Phase 1.

Read/import-first is the safer ship order because:

- Bugs in read flows only affect our local state. Bugs in write
  flows can corrupt the patient chart of record.
- Vendor approval for write scopes is per-tenant and slower.
- Clinical safety review must precede any write.

---

## 7. Writeback readiness strategy

Writeback is intentionally OFF in Phase 1. The Integration Station
surfaces a Writeback Readiness section that lists the gating
requirements every vendor + write scope must meet before any write
action is exposed:

1. Writeback is disabled by default.
2. Write scopes are not configured on the vendor tenant.
3. Vendor approval required (per clinic / tenant).
4. Clinical safety review required (per resource payload contract).
5. Audit + idempotency required (audit row before network call;
   no duplicates on retry).
6. Conflict handling required (FHIR `If-Match` version conflicts surfaced,
   never silently overwritten).

Future write candidates (cataloged only — none implemented):
`DocumentReference.write`, `ServiceRequest.write`, `Observation.write`,
`Procedure.write`, `Encounter.write`, and (last + strictest)
`Patient.write` with per-field allowlist.

---

## 8. Raw FHIR storage plan

Append-only table per connection, holds every fetched resource exactly
as received:

```sql
-- Phase 2 migration starting at 0040_*
CREATE TABLE integration_raw_resources (
  id              bigserial PRIMARY KEY,
  connection_id   uuid NOT NULL REFERENCES integration_connections(id),
  vendor          text NOT NULL,
  resource_type   text NOT NULL,
  upstream_id     text NOT NULL,
  version_id      text,
  last_updated    timestamptz,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  CONSTRAINT raw_resources_unique
    UNIQUE (connection_id, resource_type, upstream_id, version_id)
);
```

- Insert-only; never mutated. New `versionId` → new row.
- The Raw FHIR Viewer reads from this table with admin-only auth + audit logging on every read.

---

## 9. Sync job / error / audit plan

See the eCW deep-dive doc §5–6 for the table shapes. Summary:

- `integration_sync_jobs` — every full / incremental / per-resource / dry-run job.
- `integration_sync_errors` — categorized failures (`Authentication`, `Authorization`, `Network`, `Rate Limit`, `Validation`, `Mapping`, `Downstream Routing`, `PHI Integrity`, `Unknown`). PHI is scrubbed before persistence.
- `integration_audit_log` — append-only, no PHI. Catalog of event types is stable Phase 1 (declared in `integrationTypes.ts:IntegrationAuditEventType`).

The Phase 2 sync worker uses Postgres advisory locks (matches the
existing `absenceWatcher` / `morningRebuildScheduler` pattern).

---

## 10. Normalization plan

Canonical pipeline per resource:

```
[Fetch from EMR] → [Raw resource store] → [Field mapping]
                → [Patient identity match] → [Downstream route]
                → [Audit log] → [Stats update]
```

Defined in `integrationRouting.ts:INTEGRATION_PIPELINE_STAGES`. Phase
2's worker code uses the same stage IDs as the UI.

---

## 11. Patient identity matching

Five weighted signals (defined in `ecwRoutingRules.ts:PATIENT_MATCH_RULES`):

| Signal | Weight |
|---|---|
| MRN exact | 60 |
| Name + DOB exact | 40 |
| Name + DOB fuzzy | 25 |
| Phone exact | 20 |
| Insurance member ID exact | 30 |

Auto-merge threshold: **80** (`PATIENT_MATCH_AUTO_THRESHOLD`). Below
threshold → manual review queue. Conflict rule: when MRN matches
but name disagrees, hold as "Duplicate Suspect" — admin action
required.

---

## 12. Downstream routing

Per resource, where the normalized data lands. The shared catalog of
destinations (`INTEGRATION_DOWNSTREAM_DESTINATIONS`):

`Patient Directory · Scheduling · Engagement Center · Plexus IQ ·
Imaging Central · Ancillary Documents · Billing Readiness · Document
Library · Patient Journey Timeline · Mission Control · Team Ops`

Special rules:

- **Imaging Central is ultrasound-only.** Non-ultrasound ancillary types
  (BrainWave, VitalWave, EKG, PGX, CGX, Lab) MUST route to
  Ancillary Documents. The runtime gate lives in Phase 2 normalization;
  Phase 1 enforces it at the rule level.
- **Encounter vs ServiceRequest semantics.** Encounter = a scheduled
  visit on the EMR's calendar (reconciles with our scheduling
  pipeline, no qualification side-effect). ServiceRequest = an order
  or referral that needs to be qualified / scheduled / executed
  (routes by code/category into Plexus IQ, Imaging Central,
  Engagement Center, or Manual triage).

---

## 13. Billing readiness

The Integration Station seeds the Billing Readiness checklist with
the FHIR sources that feed each flag. See
`ecwRoutingRules.ts:BILLING_READINESS_CHECKLIST`:

| Check | Source resource |
|---|---|
| Active insurance coverage | Coverage (`status='active'`) |
| Performed procedure with CPT | Procedure (`code.coding[cpt].code`) |
| Diagnostic report on file | DiagnosticReport (`presentedForm[0].url`) |
| Signed clinician note | DocumentReference (signed event) |
| Order of record (ServiceRequest) | ServiceRequest (`intent='order' & status='active|completed'`) |
| Linked encounter | Encounter (`id`) |
| Allergy review | AllergyIntolerance (review timestamp) |

Phase 2 normalization fires the flags into `billing_readiness_checks`
(additive columns may be required per do-not-touch policy).

---

## 14. Future Mission Control EMR Sync Health (NOT in this PR)

When Mission Control lands on `main` (PR #294 is the candidate), it
should surface an **EMR Sync Health** panel with:

- Connection status per vendor
- Last successful sync / next sync
- Imported counts per resource
- Failed resources / unmapped providers / unmapped clinics / duplicate MRNs / missing insurance
- API sync errors / downstream routing errors

This PR does **not** add the Mission Control panel because Mission
Control does not exist on `main` yet. The panel is documented here as
a future integration point.

If Mission Control lands separately, the panel implementation is a
small additive section that consumes a single TanStack Query against
`/api/integration-stations/<vendor>/health` (Phase 2 endpoint).

---

## 15. Security and PHI rules

Hard rules (Phase 1 honors all of them — there is no backend, so
there is no place a secret could leak):

1. Client secrets are stored server-side in the credential vault.
   Never in localStorage. Never in source. Never echoed back to the
   UI after save.
2. The Connection Profile form stores a **vault reference**, not the
   secret. The UI shows the masked reference only.
3. Tokens are stored in encrypted columns with explicit TTL. Refresh
   logic runs server-side under an advisory lock.
4. PHI is never logged. Error messages strip patient identifiers
   before persisting.
5. Audit log writes never include PHI.
6. The Raw FHIR Viewer reads from the raw store with admin-only auth
   and audit-event logging on every read.
7. The Secret Rotation flow writes a `Secret Rotated` audit event
   and never returns the new secret to the browser.

Source of truth: `integrationSecurity.ts:INTEGRATION_SECURITY_RULES`.

---

## 16. Backend work still required (Phase 2)

| Layer | What ships in Phase 2 |
|---|---|
| Schema | `integration_connections`, `integration_scopes`, `integration_field_mappings`, `integration_clinic_mappings`, `integration_provider_mappings`, `integration_patient_matches`, `integration_sync_jobs`, `integration_sync_errors`, `integration_audit_log`, `integration_raw_resources` + supporting catalogs (`medication_catalog`, `device_catalog`, `specimen_catalog`, `medication_administrations`, `patient_immunizations`, `patient_allergies`, `service_requests`, `ancillary_observations`, `ancillary_documents`) |
| Migrations | Starting at `0040_*` (head on main is `0039`). No renumbering. |
| Credential vault | Server-side store + rotation endpoint. Never returns the secret to the browser. |
| Auth | OAuth client credentials + SMART-on-FHIR + Bulk FHIR per vendor. |
| Sync worker | Advisory-locked per connection. Per-resource sync ordering follows the dependency graph in `ecwScopes.ts`. |
| Normalization | Pipeline stages from `integrationRouting.ts`. PHI-scrubbing middleware before persistence of errors / audit. |
| Endpoints | See the eCW deep-dive doc §17 for the full route list (19 endpoints). All `requireRole("admin")`-gated. |

Each migration is its own operator-approved PR. Phase 2 will split
across ~5 PRs (connections + audit / sync-jobs + errors / mappings /
identity match / per-resource normalization).

---

## 17. What is MVP foundation-ready now

- The admin shell at `/admin/settings-center/api-integrations`.
- The vendor-neutral framework files (`integrationTypes.ts`,
  `integrationVendors.ts`, `integrationStatuses.ts`,
  `integrationRouting.ts`, `integrationSecurity.ts`).
- The eClinicalWorks vendor adapter with all 18 FHIR R4 scopes,
  field mappings, routing rules, and demo seeds.
- 22 sections in the UI (Overview, Vendor Adapters, eCW Connection,
  Scope Management, Sync Controls, Resource Counts, Raw FHIR Viewer,
  Field/Clinic/Provider/Patient/Scheduling/Orders/Documents/Insurance/
  Billing-Readiness Mapping, Sync Jobs, Error Center, Audit Log,
  Security & Credentials, Writeback Readiness, Downstream Routing,
  Test Console).
- This architecture doc + the eCW deep-dive doc.

---

## 18. What is not yet production-active

- No backend tables.
- No credential vault.
- No real OAuth / SMART-on-FHIR / Bulk FHIR.
- No sync worker.
- No normalization runs.
- No PHI ingestion.
- No Raw FHIR store.
- No Mission Control EMR Sync Health panel (Mission Control doesn't
  exist on main yet).
- No writeback. None. Disabled at the framework level.
- No fake success toasts. Every action button shows a "Backend
  endpoint pending" notice or is disabled.

---

## Phase boundary at a glance

| | Phase 1 (this PR) | Phase 2 (later PR series) |
|---|---|---|
| Admin UI shell | ✅ | — |
| Vendor catalog (1 available, 7 future) | ✅ | — |
| 18 eCW FHIR R4 scope definitions | ✅ | — |
| Field / clinic / provider / coverage mapping tables | ✅ (read-only) | persist edits |
| ServiceRequest / Ancillary / Document routing defaults | ✅ | per-clinic overrides |
| Patient identity rules + threshold | ✅ | merge worker + UI |
| Audit / error / sync-job table shells | ✅ (empty) | populate via worker |
| Writeback Readiness checklist | ✅ (read-only) | gate state machine |
| Architecture doc + eCW deep-dive | ✅ | — |
| Backend tables / migrations | ❌ | ✅ |
| Credential vault | ❌ | ✅ |
| OAuth / SMART-on-FHIR / Bulk FHIR | ❌ | ✅ |
| Sync worker (advisory-locked) | ❌ | ✅ |
| Normalization pipeline | ❌ | ✅ |
| Raw FHIR store + viewer reads | ❌ | ✅ |
| Mission Control EMR Sync Health | ❌ (Mission Control not on main) | ✅ (depends on Mission Control landing) |
| Writeback | ❌ | ❌ (Phase 3+ only after vendor + clinical-safety approvals) |

---

## What should NOT be merged blindly

- **Don't merge to main while the credential vault and sync worker
  are missing.** The Integration Station UI looks operational but
  performs zero network calls.
- **Don't enable scope toggles** until Phase 2 writes their state to
  `integration_scopes`. Today the switches are visual only.
- **Don't accept client secrets through the form.** The field is
  hard-disabled until the vault rotation flow lands.
- **Don't flip any vendor adapter from "Future" to "Available"**
  until its full adapter is implemented.
- **Don't enable any writeback** without the full Writeback Readiness
  checklist signed off per vendor and per write scope.
- **Don't decode Binary or CCD content** in Phase 1 or Phase 2 (Phase 3 work).
- **Don't extend Imaging Central** to non-ultrasound modalities via
  the routing tables. Phase 2 normalization must enforce the
  ultrasound-only boundary.

End of vendor-neutral foundation doc.

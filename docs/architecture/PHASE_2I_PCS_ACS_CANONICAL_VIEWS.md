# Phase 2I — PCS and ACS canonical views

Canonical DATA WIRING (not a redesign) of the two care-specialist surfaces to the
Phase 2A–2H canonical patient + ancillary-case lifecycle. Read-only, bounded,
clinic-scoped, behind two independent default-OFF flags. No migration.

## Acronyms (audited, not assumed)

- **PCS = Patient Care Specialist** workspace. Route `/patient-care-specialist-portal`
  → `client/src/pages/patient-care-specialist-portal.tsx` → `ClinicWorkflowPortal
  role="patientCareSpecialist"` → `TeamPortalShell` (internal role `liaison`,
  default mode `callList`).
- **ACS = Ancillary Care Specialist** workspace. Route `/ancillary-care-specialist-portal`
  → `client/src/pages/ancillary-care-specialist-portal.tsx` → `ClinicWorkflowPortal
  role="ancillaryCareSpecialist"` → `TeamPortalShell` (internal role `technician`,
  default mode `clinicSchedule`).

Both are full pages (not tabs) mounting the same shared `TeamPortalShell`.

## Current-state audit

| Aspect | PCS | ACS |
|---|---|---|
| Route | `/patient-care-specialist-portal` | `/ancillary-care-specialist-portal` |
| Page file | `client/src/pages/patient-care-specialist-portal.tsx` | `client/src/pages/ancillary-care-specialist-portal.tsx` |
| Shell | `ClinicWorkflowPortal` → `TeamPortalShell` | same |
| Internal role | `liaison` | `technician` |
| Default mode | `callList` | `clinicSchedule` |
| Legacy data feeds | `/api/scheduler-portal/cases`, `/api/portal/*` | `/api/technician-liaison/clinic-visits`, `/api/technician-liaison/ancillary-schedule`, `/api/scheduler-portal/cases` |
| mockData import | none (live) | none (live) |
| usePortalData | none | none |
| localStorage | UI prefs only (rail collapse/size), not a data source | same |
| Placeholder rows | none (demo injection removed Phase 1) | none |
| Role guard (server) | `requirePortalRole` = {admin, technician, liaison}, fail-closed `?? ""` | same |
| Clinic scope (legacy) | facility scope via `outreach_schedulers` | same |
| Manifest status | `protectedUi:true`, **`approvedException:true`** | `protectedUi:true`, **`approvedException:true`** |

Both page files are on `approvedExceptionPaths` in `docs/canonical-ui-manifest.json`,
so the manifest test SKIPS them (they may carry setup scaffolding). The Phase 2I
flag branch lives in these two files and is therefore manifest-safe. No other
protected UI file is touched.

The legacy surfaces are already live (no mock rows). What they do NOT surface is
the **canonical lifecycle stage vector** per ancillary case (Admin Review →
Engagement → Appointment → Order Note → Procedure → Report → Procedure Note →
Signature → Billing Readiness → Billing Document). Phase 2I adds that canonical
read model as a flag-gated replacement view.

## Legacy data sources → canonical replacement sources

| Stage | Canonical source (exact, non-superseded) |
|---|---|
| identity | `patient_ancillary_cases` (+ authorized display from `global_plexus_patients.display_name`/`dob`, `patient_clinic_memberships.clinic_mrn`) |
| adminReview | `patient_ancillary_cases.admin_review_status` projection (+ latest `ancillary_case_admin_review_events` for timestamp/source) |
| engagement | active `engagement_list_memberships` + `engagement_lists` (exact clinic + service) |
| appointment | `global_schedule_events` (canonical ancillary event types, current non-cancelled) |
| orderNote | `ancillary_document_references` (order_note) validated vs `procedure_notes` source |
| procedure | `procedure_events` (exact case ownership; terminal states preserved) |
| report | `ancillary_document_references` (report) validated vs `case_document_readiness` (exact episode) |
| procedureNote | `ancillary_document_references` (procedure_note) validated vs `procedure_notes` |
| signature | signature status of the exact validated Procedure Note source |
| billingReadiness | current non-superseded `canonicalBillingReadinessChecks` |
| billingDocument | current non-superseded `canonicalBillingDocumentRequests` |

All exact-source validation reuses the Phase 2H rules (episode ownership + exhaustive
reference/source status agreement) via a shared `server/services/canonicalStage/`
builder — the Phase 2H `clinicianPortal/canonicalOverview.ts` is NOT modified.

## Canonical endpoints and DTOs

- `GET /api/pcs/canonical-view` → `getPcsCanonicalView({ clinicId, cursor, limit, filters })`
- `GET /api/acs/canonical-view` → `getAcsCanonicalView({ clinicId, cursor, limit, filters })`
- Shared DTOs: `shared/pcsCanonicalView.ts`, `shared/acsCanonicalView.ts`, and the
  shared per-case `shared/canonicalStageVector.ts`.
- `clinicId` and actor identity come ONLY from server request context (session +
  `clinicContext` middleware). Never from query/body/params.

## Patient identity rules (PCS)

Anchored to `globalPlexusPatientId` + `patientClinicMembershipId` (opaque canonical
IDs). Display name/DOB/MRN are authorized display fields only, never identity. PCS
groups **episodes** under one exact canonical patient identity but keeps every
`ancillaryCaseId` as a distinct child episode (repeated same-service episodes stay
separate). No demographic (name/DOB/MRN) fallback — missing identity is surfaced as
`identity.available=false` with warnings, never merged by demographics.

## Ancillary-case episode rules (ACS)

One ACS row per exact `ancillaryCaseId`. No grouping by patient+service,
screening+service, or facility/date. Repeated same-service cases remain distinct
rows. `currentStage` is deterministically derived from the exact stage vector (the
earliest incomplete stage in canonical order) or `null` with an integrity warning
when evidence is conflicting/incomplete — never the most-advanced stage silently.

## Stage-vector contract

Per episode, a `stages` object with keys `identity, adminReview, engagement,
appointment, orderNote, procedure, report, procedureNote, signature,
billingReadiness, billingDocument`. Each stage carries `{ status, available,
sourceId?, at?, warnings[] }`. Server computes stage truth; the client renders it
directly and never reconstructs canonical status. Claim blockers are preserved
separately from billing blockers. No document bodies, no note text, no
claims/invoice/payment/revenue fields.

## Pagination / bounds

Default limit 25, hard max 100. Deterministic ordering; stable opaque keyset
cursor. PCS orders by `(globalPlexusPatientId, patientClinicMembershipId,
ancillaryCaseId)`; ACS orders by `(ancillaryCaseId)`. Batched source loads via
`inArray` — no per-row N+1.

## Role & tenant boundaries

- PCS endpoint: allowed roles **{admin, liaison}** (preserves the PCS↔liaison intent).
- ACS endpoint: allowed roles **{admin, technician}** (preserves the ACS↔technician intent).
- Missing/unknown/other roles → 403. Clinic scope from `req.clinicId` only; missing
  scope → 403. Cross-clinic records are never returned/counted/paginated.
- The difference in authorized roles between PCS and ACS is preserved (not unified).

## Flags (all default OFF)

- Server: `FEATURE_PCS_CANONICAL_VIEW`, `FEATURE_ACS_CANONICAL_VIEW`.
- Client: `VITE_FEATURE_PCS_CANONICAL_VIEW`, `VITE_FEATURE_ACS_CANONICAL_VIEW`.
- Neither auto-enables any upstream canonical flag; each endpoint truthfully reports
  `upstream_flag_off` per stage when a required upstream flag is disabled.

## Intentionally changed protected UI files

- `client/src/pages/patient-care-specialist-portal.tsx` (approvedException) — flag branch only.
- `client/src/pages/ancillary-care-specialist-portal.tsx` (approvedException) — flag branch only.

Both are `approvedException` so their blobs may drift; no other protected UI file
changes. No homepage or Clinician Portal exception is taken.

## Fields deliberately unavailable in Phase 2I

Claims, invoices, payments, remittances, revenue, clinic/Plexus splits, priority
scores, invented next actions, clinical findings, payer/authorization status,
document bodies, generated note text — none are added or surfaced.

## Navigation/actions deliberately preserved

Flag OFF renders the exact legacy `TeamPortalShell` workspace with all its routes,
headings, navigation, back buttons, detail links, and actions unchanged and with
zero canonical requests. Flag ON adds only read-only canonical rows/cards with
truthful loading/empty/unavailable/migration states and bounded pagination; existing
real detail destinations are reused only when the canonical row carries the exact
owning clinic/case/episode id.

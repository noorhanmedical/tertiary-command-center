# Plexus EHR V1 — Architecture & Closeout Reference

Stable as of: August 2026
Tag: `plexus-ehr-v1`

This document captures the canonical architecture so Engagement, Team Portals,
and Playground can consume these foundations without accidentally recreating them.

---

## 1. Canonical Patient Identity

| Concept | Table | Key |
|---------|-------|-----|
| Global patient | `global_plexus_patients` | `id` (PLX-XXXXXX) |
| Clinic membership | `patient_clinic_memberships` | patient + clinic |
| Screening record | `patient_screenings` | `id` (operational workhorse) |

Identity resolution lives in `server/services/plexusIdentity/screeningIntegration.ts`.
`resolveAndLinkPlexusIdentityForScreening()` is the single orchestrator that
creates/reuses global patients and back-links screening FKs. Every seed and
every server-side screening insert calls this.

---

## 2. Clinical Reference Domains

Stored in per-domain tables, managed through `server/repositories/clinicalData.repo.ts`:

- Providers (`patient_clinical_providers`)
- Diagnoses (on `patient_screenings.diagnoses` + structured)
- Medications (on `patient_screenings.medications` + structured)
- Allergies (`patient_clinical_allergies`)
- Labs (`patient_clinical_labs`)
- Imaging (`patient_clinical_imaging`)
- Vitals (`patient_clinical_vitals`)
- Encounters (`patient_clinical_encounters`) — paginated via `/api/patients/:id/encounters`

API: `GET /api/patients/:screeningId/clinical-data`

---

## 3. Service Episodes (Single Projection)

The `EmrServiceEpisode` type (`client/src/types/emr.ts`) drives:
- Overview "Current Tests"
- Ancillary Journey stepper
- Scheduling
- Billing readiness
- Admin Review
- Notes & Documents (episode-keyed)
- Re-engagement eligibility

Source: `patient_ancillary_cases` + `patient_test_history` + canonical appointments.

Canonical lifecycle stages (in order):
```
Qualified → Approved → Order → Outreach → Scheduled →
Signed → Screening → Test → Report → Procedure → Billing
```

---

## 4. Ancillary Episode Model

Each ancillary service creates a `patient_ancillary_cases` row (one per service
per screening). `syncAncillaryCasesFromScreening()` in `executionCase.repo.ts`
creates/updates these when a screening is committed.

Episode sequencing: `patient_test_history.episodeSequence` tracks repeated
instances of the same test (e.g., Carotid 2023, 2024, 2025, 2026 current).
Documents are episode-keyed — no cross-episode leakage.

---

## 5. Document / Version Model

| Table | Purpose |
|-------|---------|
| `patient_episode_documents` | Per-episode canonical documents (order, screening, addendum, procedure note, report, consent, billing) |
| `patient_episode_document_versions` | Append-only version/diff lineage per document |
| `procedure_notes` | Generated order/procedure note text + signature status |

API: `GET /api/patients/:screeningId/episode-documents` → `{ documents, versions }`

The `EpisodeDocsProvider` (React context) owns the single fetch and exposes
`openById(id, mode)` where mode is `"open" | "changes" | "history"`. Both the
Documents section and Story timeline consume the same context — no duplicate
diff/viewer model.

---

## 6. Admin Review

Table: `patient_ancillary_cases.admin_review_status` + `admin_review_events`
(append-only timeline).

API: `GET /api/patients/:screeningId/admin-review` → `{ services, events }`

Write: `POST /api/admin-review/:caseId` (role-gated to
`plexus_internal_clinical_reviewer`). Decisions propagate to service state.

---

## 7. Calls & Communications

Schema: `outreach_calls` table (extended by migration 0063 with multi-channel
columns: channel, direction, destination, staffName, staffRole, serviceType,
ancillaryCaseId, disposition, nextAction, sourceSystem, externalCallId,
recordingRef, transcriptRef).

Repository: `server/repositories/communications.repo.ts`
- `listCommunicationsForPatient(screeningId)` — read
- `logCommunication(input)` — write + propagate + Story event

API:
- `GET /api/patients/:screeningId/communications`
- `POST /api/patients/:screeningId/communications` (role-gated: admin/scheduler/liaison)

Operational propagation: `logCommunication` updates `patient_execution_cases`
(callAttemptCount, engagementStatus, lastCallOutcome, nextActionAt) and emits
a `communication_logged` event to `patient_journey_events`.

---

## 8. Plexus Notes Episode Hierarchy

```
Patient
  └─ Service (e.g., Bilateral Carotid Duplex)
       └─ Current Episode (2026)
       │    ├─ Order Note
       │    ├─ Screening Form
       │    ├─ Screening Addendum
       │    ├─ Procedure Note
       │    ├─ Consent
       │    ├─ Test Report
       │    └─ Billing Document
       └─ Previous Episodes
            ├─ 2025 → (same doc types)
            ├─ 2024 → ...
            └─ 2023 → ...
```

---

## 9. Physician Portal Signing Handoff

Signing lives exclusively in the Physician (Clinician) Portal. The EHR never
duplicates signature logic.

Deep link: `portalSignHref()` in `PlexusEhr.tsx` generates:
```
/clinician-portal?focus=sign&noteId=42&noteType=order_note&serviceType=EEG&screeningId=7
```

Portal consumption: `parseSignFocus()` in `portalContext.tsx` reads params →
`activePage` initializes to `"orders-notes"` → `SignFocusBanner` renders
note-specific guidance.

---

## 10. Patient Story

Table: `patient_journey_events`
API: `GET /api/patient-journey-events?patientScreeningId=X&limit=200`

Events carry `metadata.episodeDocumentId` + `metadata.documentAction` for
document shortcuts. Story timeline renders "View Changes" or "Open Document"
via the shared `EpisodeDocsContext`.

Sources that emit Story events:
- `logCommunication` → `communication_logged`
- Admin Review decisions → `admin_review_*`
- Document creation/signing → `document_*`
- Scheduling changes → `appointment_*`
- Execution case state changes → `case_*`

---

## 11. Permissions (Section Access)

Defined in `shared/patientDirectorySections.ts`. Each section has:
- `defaultAllowedRoles: { admin, clinician, biller, scheduler }` → `"full" | "summary" | "hidden"`

Client: `usePatientDirectorySectionAccess()` hook reads the matrix.
PatientChart renders sections conditionally: hidden → skip, summary → one-line
card, full → complete component.

---

## 12. Atlas Source

Both Plexus Atlas and Clinician Atlas are generated on-demand from canonical
`patient_screenings.reasoning` (Plexus IQ output). Keyed by
`patientScreeningId`. No separate atlas data store.

---

## 13. QA Seeds

| Command | Purpose |
|---------|---------|
| `npm run seed:testguy-flow` | Base TestGuy fixture |
| `npm run seed:testguy-spine` | Canonical identity |
| `npm run seed:testguy-clinical` | Clinical data domains |
| `npm run seed:testguy-findings` | Qualification findings |
| `npm run seed:testguy-reviewer` | QA reviewer user |
| `npm run seed:testguy-episode-docs` | Episode documents |
| `npm run seed:testguy-story` | Story events |
| `npm run seed:testguy-calls` | Communication history |
| `npm run seed:testguy-profile` | Patient profile |
| `npm run seed:qa-matrix` | 8 QA patients (A–H) |
| `npm run reconcile:testguy` | Reconcile identity |

All seeds are idempotent. TestGuy travels the same code paths as real patients.
Zero TestGuy-specific production business logic exists.

---

## 14. What Engagement / Portals / Playground Should Reuse

Do NOT recreate:
- Patient identity resolution
- Service episode model
- Communication records / logCommunication
- Document/version model
- Admin Review
- Execution cases
- Story events
- Section permission model
- Clinical data domains
- Cooldown / re-engagement derivation

All future modules should consume these canonical objects directly.

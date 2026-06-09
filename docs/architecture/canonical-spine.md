# Canonical patient spine — gap analysis

Mirrors §3 of `review-canonical-spine-2026-06-09.md`. The headline finding: a canonical spine has *begun* to emerge (`patient_execution_cases`, `patient_journey_events`, `procedure_events`, `global_schedule_events`) but is created as a **fire-and-forget side-effect** of `commitPatient` and is not the source of truth for portals.

Each row gives status (EXISTS / PARTIAL / MISSING), what plays that role today, what's broken, and the migration risk. **Do not act on any row in this doc directly** — every migration goes through an approved batch in `refactor-batches.md`.

> Cross-reference: original review `review-canonical-spine-2026-06-09.md` §3.1 – §3.12. The 22-batch orchestrator `full-21-batch-orchestrator-review.md` defines who can land each piece (Batches 5–8, 10, 11, 16, 17).

---

## Compact gap table

| Target table | Status | Current backing | Top risk | Lands in |
| --- | --- | --- | --- | --- |
| `patient_directory` | MISSING | `patient_screenings` (duplicating identity) | Touched by everything | Batch 5 (design), later batches (impl) |
| `patient_identifiers` | MISSING | `patient_screenings.notes` (text MRN) | None — fully additive | Batch 7 (design), later |
| `facilities` | MISSING | text strings + `VALID_FACILITIES` constant | All filters today use string | Batch 6 (design), later |
| `patient_screenings` (Plexus IQ episode) | EXISTS, mis-scoped | `patient_screenings` | Anchor of current code | Keep; identity moves out in later batches |
| `clinical_qualification_results` | PARTIAL | `procedure_events` + `reasoning` jsonb | Reasoning schema needs lock-down | Batch 8 |
| `qualification_factor_assignments` | MISSING (the most useful new table) | `reasoning.qualifying_factors / icd10_codes` jsonb | Cleanest table to add | Batch 8 |
| `patient_execution_cases` | EXISTS | `patient_execution_cases` (fire-and-forget) | Non-transactional spine | Batch 10 |
| `team_tasks` | PARTIAL | `plexus_tasks` + `scheduler_assignments` | Two parallel models | Batch 11 |
| `patient_journey_events` | EXISTS, partial coverage | `patient_journey_events` (uneven coverage) | Some flows skip it | Batch 12 |
| documents / reports | EXISTS, fragmented | 8 tables + on-read migration | OK; consolidate later | Batch 16 |
| billing_packets / claims / remittances / denials | PARTIAL | `billing_records` + `completed_billing_packages` | Two state machines | Batch 17 (design first) |
| `invoices` | EXISTS | `invoices` + line items + payments | OK | — |
| `revenue_share` | EXISTS | `projected_invoice_rows` (50% default) | Conversion path manual | Batch 17 |

---

## Per-table notes

### 1. `patient_directory` — MISSING (review §3.1)
- **Today:** `patient_screenings` carries patient identity. Same person can appear N times (one row per batch / one row per import). Roster aggregation in `server/routes/patientDatabase.ts` `GROUP BY` on `(lower(name), dob)` to fake a directory.
- **Recommended role:** Source of truth for patient identity, demographics, primary contact, insurance, facility linkage, soft-delete & merge tooling.
- **Migration risk: VERY HIGH.** Touches almost every table. Must be staged behind read-side helpers first; never rename `patient_screenings` until the full migration is done.
- **Do not touch yet:** any `patient_screenings.name` / `dob` write path.

### 2. `patient_identifiers` — MISSING (review §3.2)
- **Today:** `patient_screenings.notes` carries MRN as free-text stamped by `buildClinicalImportNotes` (`server/routes/plexusIqClinicalImport.ts` ~line 35). No PCC/eCW/TriZetto IDs anywhere.
- **Recommended role:** Cross-system identity (PCC ID, eCW ID, TriZetto subscriber, MRN, phone, email) with partial unique indexes.
- **Migration risk: HIGH.** Requires linker logic and dedupe during import.

### 3. `facilities` — MISSING (review §3.3)
- **Today:** Facility identity is a **string** (`"NWPG - Spring"`, `"Taylor Family Practice"`, `"NWPG - Veterans"`) duplicated across 20+ tables. Allow-list lives in `shared/plexus.ts` and `shared/platformSettings.ts` as a hardcoded constant `VALID_FACILITIES`.
- **Recommended role:** Master table with id, display name, address, billing contact, EMR system, time-zone, active flag.
- **Migration risk: HIGH.** All filter routes accept facility as string today. A `facility_id` column added next to existing strings (dual-write) is the safe pattern.

### 4. `patient_screenings` (Plexus IQ episode) — EXISTS, mis-scoped (review §3.4)
- **Today:** `shared/schema/screening.ts` lines 31–89. Carries identity (name/dob/phone/email/insurance/facility), qualification artefacts (qualifyingTests[], reasoning jsonb, cooldownTests), and workflow state (status, commitStatus, appointmentStatus, patientType, admin approval fields, soft-delete fields).
- **Problem:** Confuses *who the patient is* with *one Plexus IQ episode*. Should keep the episode semantics; identity should move to `patient_directory`.
- **Migration risk: VERY HIGH.** Anchor of most current code.

### 5. `clinical_qualification_results` — PARTIAL (review §3.5)
- **Today:** Qualification verdicts live in `patient_screenings.qualifyingTests[]` + `patient_screenings.reasoning` (jsonb). Per-service status lives in `procedure_events`. No structured per-service "result with findings".
- **Recommended role:** One row per ancillary qualification verdict per patient, with confidence, qualifying factors, ICD-10 list, evidence pointers, AI vs. admin authorship.
- **Migration risk: MEDIUM.** Reasoning jsonb shape is informal; a real table needs a strict contract.

### 6. `qualification_factor_assignments` — MISSING (review §3.6)
- **Today:** Supporting evidence (clicked "supporting buttons", ICD codes, qualifying diagnoses, medications, history evidence) is **only** stored as jsonb under `patient_screenings.reasoning[testName].qualifying_factors / icd10_codes` or `reasoning["adminReview:<ancillary>"]`.
- **Recommended role:** One row per (case, ancillary, factor) with kind (icd / med / history / symptom / prior_test), source (ai / admin / rule_engine), confidence, timestamp. Unique per (case, ancillary, kind, value) to prevent dupes.
- **Migration risk: MEDIUM.** Can be additive without changing existing reasoning blob.

### 7. `patient_execution_cases` — EXISTS (review §3.7)
- **Today:** `shared/schema/executionCase.ts` lines 29–52. Created by `patientCommitService.ts` via `createOrUpdateExecutionCaseFromScreening` on commit. Has FK to `patient_screenings`. Stores `engagementBucket`, `qualificationStatus`, `lifecycleStatus`, `engagementStatus`, `assignedTeamMemberId` (no FK), `selectedServices[]`, `priorityScore`, `nextActionAt`.
- **Problems:**
  1. Created **fire-and-forget** off the commit. If creation fails, screening lives but case doesn't.
  2. `assignedTeamMemberId` is an `int` with **no FK** to `users`.
  3. Identity (`patientName`, `patientDob`, `facilityId`) is **duplicated** here.
- **Migration risk: LOW** for additive fixes (FK, transaction wrapper). **HIGH** if used for redesign without preserving current consumers.

### 8. `team_tasks` — PARTIAL (review §3.8)
- **Today:** `plexus_tasks` (`shared/schema/plexus.ts`) is a generic task system. Outreach assignments live in `scheduler_assignments` (`shared/schema/outreach.ts` lines 75–115), which is a different model.
- **Problem:** Two parallel "task" models. Engagement Center, Scheduler Portal, and Team Portals each compute their own lists.
- **Recommended role:** Either keep `plexus_tasks` and standardize, or introduce a slim `team_tasks` that wraps execution-case actions.
- **Migration risk: MEDIUM.**

### 9. `patient_journey_events` — EXISTS, partial coverage (review §3.9)
- **Today:** `shared/schema/executionCase.ts` lines 70–87. Append-only. Written explicitly in `patientCommitService.ts`, `engagementAssignmentBoard.ts`, and `outreach.ts` (`createOutreachCallAtomic`).
- **Problem:** Coverage is uneven. Admin-review approval, regenerate-all, ICD edits, billing status changes, invoice payments do **not** append journey events. Some writes are fire-and-forget; failures are silent.
- **Migration risk: LOW** (additive event writes won't break anything).

### 10. documents / reports — EXISTS, fragmented (review §3.10)
- **Today:** Five+ tables: `documents` (+ `document_surface_assignments`), `document_blobs`, `uploaded_documents` (legacy Drive), `marketing_materials`, `generated_notes`, `ancillary_document_templates`, `case_document_readiness`, `document_requirements`. `documentLibrary.ts` route runs a migration-on-read each `GET /api/documents-library`.
- **Migration risk: MEDIUM.** Once the storage abstraction (Batch 16) lands, consolidation is straightforward.

### 11. billing_packets / claims / remittances / denials (review §3.11)

| Target table | Today |
| --- | --- |
| billing_packets | `completed_billing_packages` (status: pending_payment → completed_package → added_to_invoice → invoiced → closed) |
| claims | **Missing.** `billing_records` carries denormalized charges + insurance response inline. |
| remittances | **Missing.** `billing_records.paidAmount/insurancePaidAmount/secondaryPaidAmount` are flat fields. |
| denials | **Missing.** No structured denial reasons or appeals. |
| invoices | `invoices` + `invoice_line_items` + `invoice_payments` (transactional in `invoices.repo.ts`). |
| revenue_share | `projected_invoice_rows.projectedOurPortionPercentage` (default 50%). |

**Risk:** Two parallel state machines (`completed_billing_packages.packageStatus` and `invoices.status`) with no DB-level alignment. A package can show `invoiced` while invoice is `Draft`.

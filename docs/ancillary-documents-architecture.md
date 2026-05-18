# Ancillary Documents Architecture

> Honest map of the document side of the post-procedure spine. Every
> "wired" claim below traces to an existing route or table. Every
> "gap" is named explicitly.

## Lifecycle (target)

```
Scheduled (global_schedule_events)
  ↓
Procedure Performed (procedure_events.procedureStatus = "complete")
  ↓
Report Uploaded (documents row with kind=report, document readiness updated)
  ↓
Order Note / Procedure Note generated (procedure_notes/generated_notes)
  ↓
Billing Document generated (billing_document_requests → documents)
  ↓
Documents Complete (case_document_readiness all satisfied)
  ↓
Billing Ready → Completed Package → Invoice
```

Today the platform has the **read model** for every stage but is
missing several **write paths** between them. See "Gaps" below.

## Canonical tables

| Concern | Table | Notes |
| --- | --- | --- |
| Procedure performance | `procedure_events` | `procedureStatus`, `completedAt`, `completedByUserId`, FK to `global_schedule_events`. |
| Generated notes | `procedure_notes` (a.k.a. `generated_notes`) | `noteType` (order_note / post_procedure_note), `generationStatus`, `generatedText`, `generatedByAi`. |
| Patient + library documents | `documents`, `document_blobs`, `document_surface_assignments` | `kind` enum includes `consent`, `screening_form`, `report`, `marketing`, etc. |
| Template registry | `ancillary_document_templates` | Maps `serviceType + facilityId → documentType + documentId`. |
| Per-case readiness | `case_document_readiness` | One row per `(executionCaseId, documentType)`; tracks `documentStatus` + `blocksBilling`. |
| Audit | `patient_journey_events` | Append `documents_uploaded`, `report_uploaded`, `note_generated`, etc. |
| Tasks for gaps | `plexus_tasks` | Create a task per missing required document. |

## Routes (wired today)

| Method + Path | Behaviour | Status |
| --- | --- | --- |
| `POST /api/procedure-events/complete` | Mark procedure complete; cascade-creates `case_document_readiness` rows. | ✅ wired — `ProcedureCompleteButton` calls it from `PortalShell`. |
| `GET /api/procedure-events` / `GET /api/procedure-events/:id` | List + read. | ✅ |
| `GET /api/ultrasound-tech/completed-procedures` | Tech-scoped read. | ✅ |
| `GET /api/procedure-notes` / `GET /api/procedure-notes/:id` | Read-only. | ✅ read · ❌ no write endpoint to generate a note. |
| `GET /api/document-library` + sibling write routes | Document Library CRUD + surface assignments. | ✅ admin can upload, assign to surfaces, delete. |
| `GET /api/ancillary-document-templates` | Read templates. | ✅ read · 🟡 admin write UI is not wired. |
| `GET /api/case-document-readiness` | Read readiness. | ✅ |
| (no endpoint) | Generate Order Note for patient. | ❌ **missing.** |
| (no endpoint) | Generate Post-Procedure Note for patient. | ❌ **missing.** |
| (no endpoint) | Mark report uploaded → update readiness + create task for missing items. | 🟡 partial: report uploads land in `documents` but a coordinated "report-uploaded → readiness + tasks" flow doesn't exist yet. |

## Frontend

- `ProcedureCompleteButton` (in `PortalShell` ancillary schedule rows) writes through `POST /api/procedure-events/complete` and invalidates the readiness/notes/billing/packet query keys.
- Document Library (`/document-library`, `/document-upload`, `/documents`) is fully wired for upload + surface assignment.
- A dedicated **per-patient document readiness panel** does not exist as a standalone UI; readiness data is consumed inside the Billing page and could be surfaced into `PatientCommandCanvas`.

## Gaps (named, not faked)

1. **Note generation orchestration** — `procedure_notes` is read-only. No write endpoint generates a note from a template + patient/procedure context. Decision needed: AI generation vs. template-fill vs. hybrid.
2. **Report-uploaded → readiness side-effect** — uploading a document of `kind=report` doesn't currently bump `case_document_readiness.documentStatus` to `complete` or close any matching `plexus_tasks`. Wiring is straightforward once we decide whether to do it inside the document upload route or as a downstream job.
3. **Missing-document task creation** — `case_document_readiness` already carries a `blocksBilling` flag, but creating a `plexus_tasks` row when a required doc is missing is not wired.
4. **Per-patient readiness panel UI** — readiness data exists; the canvas does not yet show a "Consent / Screening / Report / Order / Procedure note / Billing doc" checklist.
5. **Multi-status procedure** — UI calls one button "Procedure Complete". The schema supports staged statuses (`not_started`, `in_progress`, `complete`, `cancelled`, `no_show`, `reschedule_needed`), but only the binary action is exposed.

## QA

- `npm run qa:document-billing-invoice-spine` (new) — smoke-reads every table named in this doc. Skips cleanly without `DATABASE_URL`.

## How to extend safely

- Adding a new ancillary template type: add the template via Document Library, then add an `ancillary_document_templates` row that maps `(serviceType, facilityId) → (documentType, documentId, required)`.
- Adding a new readiness check: extend `case_document_readiness.documentType` values + the cascade in `POST /api/procedure-events/complete`. Then update the readiness panel UI when we build it.
- Adding a generation endpoint: it must read patient + procedure context, write to `procedure_notes` (status `generating` → `generated` / `failed`), append a `patient_journey_events` row, and bump `case_document_readiness` for the matching `documentType`.

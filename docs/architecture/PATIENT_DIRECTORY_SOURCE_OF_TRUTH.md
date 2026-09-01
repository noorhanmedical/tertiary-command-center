# Patient Directory — Source-of-Truth Finding

> **Scope:** State as of `main` (`88c0a1d`), derived from the approved
> platform audit + main-branch verification. No Phase 3 work is included.

## 1. Hard finding

**De facto canonical patient row on `main` = `patient_screenings`**
(`shared/schema/screening.ts:31`). Every patient-attached resource on
main keys off `patient_screenings.id`:

- `patient_notes.patient_screening_id` (NOT NULL) — `shared/schema/patientNotes.ts:35-58`
- `outreach_calls.patient_screening_id` (NOT NULL) — `shared/schema/outreach.ts:36-53`
- `patient_execution_cases.patient_screening_id` (nullable, ON DELETE SET NULL) — `shared/schema/executionCase.ts:29-51`
- `ancillary_appointments.patient_screening_id`
- `procedure_events.patient_screening_id`, `case_document_readiness.patient_screening_id`, `billing_readiness_checks.patient_screening_id`, `invoice_readiness_snapshots.patient_screening_id`
- `global_schedule_events.patient_screening_id` — `shared/schema/globalSchedule.ts:46-74`
- `billing_records.patient_id` → `patient_screenings.id` — `shared/schema/billing.ts:4-40`

`patient_screenings` rows are **per-import**, not per-person. Each
batch creates a new row for the same physical person. Identity at the
person level is **derived** from `(lower(name), dob)` strings — never
materialized as an id.

## 2. Two parallel "Patient Directory" implementations on main

| Implementation | Status | Mounted at | Service |
| --- | --- | --- | --- |
| **Legacy** `PatientDatabasePage` | live, default | `/patient-directory` (`client/src/App.tsx:122-128`) | `server/routes/patientDatabase.ts` (aggregates `patient_screenings` by `(name, dob)`) |
| **Canonical** patient directory | gated, not consumed | none mounted at the canonical route today | `server/services/patientDirectory/*` + `server/routes/patientDirectory.ts:37-43` (only registers when `USE_PATIENT_DIRECTORY_ACTIVATION=1`) |

The canonical service exists in full (snapshot / profile / audit /
cooldown / prior-tests / contact-restrictions) but `/patient-directory`
in the UI still mounts the legacy aggregate page.

## 3. Person-identity gap

Notes, calls, billing rows, and documents are scoped to
`patient_screenings.id`. When a person is re-imported in a new batch:

- a **new** `patient_screenings` row is created
- a **new** `patient_execution_case` is created via
  `createOrUpdateExecutionCaseFromScreening` (called from
  `server/services/patientCommitService.ts:99`)
- prior notes and calls remain attached to the **previous** screening
  id — they do not surface against the new id

The only schema-level person-level link is `patient_journey_events`,
which keys on `patientName + patientDob` (`shared/schema/executionCase.ts:77-94`):

> ```ts
> patientName: text("patient_name").notNull(),
> patientDob: text("patient_dob"),
> patientScreeningId: integer("patient_screening_id"),    // nullable
> executionCaseId: integer("execution_case_id"),          // nullable
> ```

Code that needs person-level identity reconstructs it ad hoc by
joining `lower(patientScreenings.name)` + `patientScreenings.dob`:

- `server/routes/engagementAssignmentBoard.ts:30-89, 469-482` —
  enforces "two schedulers cannot share the same patient for the same
  date" via name+dob walk.
- `server/routes/patientDatabase.ts:14-24` (path: `client/src/pages/patient-database.tsx` for the page wrapper) — groups by `(name, dob)` for the roster.
- `server/services/patientDirectory/patientDirectoryService.ts:136-176` — computes a snapshot **per `patientScreeningId`** (NOT per person), so even the canonical service is per-screening, not per-person.

## 4. Longitudinal record — partial

| Question | Status on main |
| --- | --- |
| Is there a `patient_persons` table? | **No.** |
| Does any view aggregate notes + calls + billing + docs by person? | **No.** `PatientDatabasePage` aggregates roster fields but not notes / calls / billing. |
| Can admin see "everything that happened to this person across all batches"? | **Partial.** `patient_journey_events` rows can be queried by `(name, dob)`; `PatientAuditTrailModal` (`client/src/components/patient-directory/PatientAuditTrailModal.tsx:57-82`) renders 16 journey-event types. Notes, calls, billing remain siloed by screening id. |
| Can Team Portal see prior calls from previous batches? | **No** by default. `/api/portal/calls` is flag-gated `USE_PORTAL_CALL_HISTORY_READ`, returns 404 (`server/routes/portal.ts:870-914`). |

## 5. Internal-consistency call

- **Consistent** on "the screening row is the FK target" — every
  patient-attached resource keys off `patient_screenings.id`.
- **Inconsistent** on "what is a person?" — `patient_screenings.id` and
  `(name, dob)` are used interchangeably across surfaces.
- **Two parallel** patient-directory systems coexist; the user-facing
  `/patient-directory` route currently mounts the legacy aggregate.

## 6. Implications

These follow directly from §3–§5 and recur throughout
[OPERATIONAL_FLOW_MAP.md](./OPERATIONAL_FLOW_MAP.md) and
[CALL_WORKFLOW_MODEL.md](./CALL_WORKFLOW_MODEL.md):

1. **Same-person notes fragment across batches.** A caller in
   Scheduler Portal sees only the call history for the screening row
   they're acting on.
2. **Admin Review status is per-screening, not per-person.** Re-importing
   a person creates a fresh `adminApprovalStatus='pending'` row even if
   the prior screening was already approved or rejected.
3. **Execution cases multiply.** Every commit creates a new
   `patient_execution_case` row keyed to the new screening id.
4. **No "all prior contact attempts for this person" query** is
   possible without name+dob join logic at the call site.

## 7. What would change this (NOT recommended here — listing only)

- Introduce a canonical person id (`patient_persons(id, name, dob,
  normalizedKey)`) and add `patient_person_id` columns to
  `patient_screenings`, `patient_execution_cases`, `outreach_calls`,
  `patient_notes`, `documents`, `billing_records`.
- Mount the canonical Patient Directory page (under a feature flag
  guard) at `/patient-directory` and shadow-validate against the
  legacy aggregate.
- Aggregate `patient_notes` + `outreach_calls` + `patient_journey_events`
  per `(name, dob)` in a new read endpoint, ahead of any schema
  migration.

The latter two are pure-wiring and are tracked in
[PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md).

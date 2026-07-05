# Clinical Intelligence + Repeat Testing Loop — Implementation Blueprint

> **Status:** Prototype scaffolded. This document is the self-contained spec for
> completing the full loop. It is written so an agent (e.g. Claude Code) can
> implement it from GitHub with no other context.
>
> **Golden rule:** never fabricate data. No fake AI extraction, no fake
> email/SMS/open/click/reply status, no fake online-scheduling status, no fake
> scheduling reconciliation. When a capability is not wired, render an honest
> state: `Not connected yet` / `Unavailable` / `Needs integration`.

---

## 1. Goal

Build the loop:

```
Report uploaded / document imported
        ↓
Clinical Intelligence reviews evidence  (findings, ICD opportunities, ancillary opportunities, repeat eligibility)
        ↓
Documentation reconciliation  (order note + procedure note present?)
        ↓
Repeat eligibility / cooldown / future review dates calculated
        ↓
Plexus IQ Repeat Testing Review opens at the right time  (~1 month before due)
        ↓
Admin approves / edits / rejects / defers
        ↓
Scheduling reconciliation  (already scheduled?)
        ↓
If not scheduled → Engagement outreach sequence  (email → text → call list)
        ↓
Team Portal sees full communication + scheduling history
        ↓
Patient schedules repeat test → new order note pulls prior findings/DX/HX/RX/interval/rationale
```

### Module boundaries (do not violate)

| Module | Responsibility |
| --- | --- |
| **Clinical Intelligence** | Reads evidence; extracts findings; suggests ICDs; identifies ancillary + repeat opportunities; documentation reconciliation; future review dates. |
| **Plexus IQ** | Turns evidence into qualification / re-qualification. Two review types: Initial Qualification Review, Repeat Testing Review. Routes to Admin Review. |
| **Admin Review** | Human approval before any operational outreach. |
| **Engagement Center** | Outreach sequence, email/text/call-list state, assignment/distribution, call results. Tabs stay: Assignment Pool, Call Results, Call Settings. No new Distribution tab. No CI section inside Engagement. |
| **Team Portal** | Calls, scheduling, informed consent, screening form, report upload. |
| **Plexus EHR / Patient Directory** | Permanent source of truth for patient documents, reports, notes, timeline. |
| `patient_execution_cases` | Current operational work / assignment / call-list state. |
| `patient_journey_events` | Timeline / history / events. |

Do **not**: bury CI only inside Plexus IQ; create repeat outreach without admin
approval; message already-scheduled patients; assume all repeats are automatic;
fabricate medical necessity or ICDs; use Google Calendar; use old Outreach
Center; use scheduler cards; use `/api/scheduler-assignments` for Engagement work.

---

## 2. Current state (what already exists — reuse it)

| Concern | Where it lives | Notes |
| --- | --- | --- |
| Clinical Intelligence page + route | `client/src/pages/clinical-intelligence.tsx`, `/clinical-intelligence` | Governance module (rules, learning items, evidence traceability, audit). The 6 new "Repeat Testing Loop" sections are scaffolded here as honest shells. |
| CI server API | `server/routes/clinicalIntelligence.ts` → `server/repositories/clinicalIntelligence.repo.ts` | Mutations gated `requireRole("admin","clinician")`. |
| CI schema | `shared/schema/clinicalIntelligence.ts` | `ci_learning_items`, `ci_rules`, `ci_rule_versions`, `ci_evidence_records`, `ci_audit_entries`. Text ids, ISO-text timestamps. |
| Report upload | `client/src/components/portal/ReportUploadPanel.tsx` → `POST /api/portal/uploads` (`server/routes/portal.ts`) | Saves blob (`ownerType: "library_document"`), creates `documents` row, assigns `patient_chart` surface. Linked to `patientScreeningId`; serviceType-gated in UI. BrainWave-specific: `POST /api/portal/case-readiness/:executionCaseId/upload-brainwave-pdf`. |
| Order / procedure notes | `client/src/lib/noteGeneration.ts`, `server/services/noteGenerationServer.ts` | `autoGeneratePatientNotes` / `…Server`. Kinds `order_note`, `post_procedure_note` in `documents`. For BrainWave / VitalWave / Ultrasound. |
| Documentation reconciliation | `server/services/ancillary/ancillaryReadModel.ts` (`REQUIRED_KINDS = ["report","order_note","post_procedure_note"]`, `getAncillarySnapshot` → `blockers[]`) | Contract: `docs/architecture/ancillary-order-note-tracking-contract.md`. UI: `client/src/components/portal/AncillaryReadinessRow.tsx`, `client/src/components/patient/DocumentReadinessPanel.tsx`. |
| Doc readiness table | `shared/schema/documentReadiness.ts` (`case_document_readiness`) | Tracks `documentType`, `status` (`uploaded`…), links `executionCaseId`. |
| Execution cases | `shared/schema/executionCase.ts` (`patient_execution_cases`) | `patientScreeningId`, `patientName`, `facilityId`, `engagementBucket`, `engagementStatus`, `selectedServices[]`, `assignedTeamMemberId`, `assignedRole`, `nextActionAt`, `lastCallOutcome`, etc. |
| Journey events | `shared/schema/executionCase.ts` (`patient_journey_events`); write via `server/services/journey/appendJourneyEvent.ts`; types in `shared/contracts/journeyEvents.ts` | Read via `server/routes/engagementAssignmentBoard.ts`, scoped by Name+DOB or execution case id. Read UNCAPPED (generic helper clamps to 500). |
| Appointments | `shared/schema/appointments.ts` (`ancillary_appointments`: `patientScreeningId`, `patientName`, `facility`, `scheduledDate`, `scheduledTime`, `testType`, `status`) | Status: `scheduled`, `cancelled`, `missed`/`no_show`, `completed`. Also `global_schedule_events` (`shared/schema/globalSchedule.ts`) eventType `ancillary_appointment`. |
| Cooldown / re-eligibility | `shared/schema/cooldown.ts` (`cooldown_records`: `cooldownStartDate`, `cooldownEndDate`, `cooldownStatus`, `overrideStatus`, `reviewedByUserId`, `reviewedAt`) | Business rule: PPO 6 months, Medicare 12 months. Intake fields on `patient_screenings`: `previousTestsDate`, `noPreviousTests`, `cooldownTests` (jsonb). |
| Engagement Assignment Pool | `server/routes/engagementAssignmentBoard.ts`; `client/src/pages/engagement-center.tsx`; `client/src/components/engagement/*` | Loads active, non-terminal `patient_execution_cases` joined w/ screenings + batches. Assignment updates `assignedTeamMemberId`/`assignedRole` + appends journey event. Short status via `shortStatusOf` in `engagementShared.ts`. |
| SMS | `server/integrations/twilioSms.ts`, `patient_sms_messages` | Gated adapter (null when unconfigured; never fakes sends). |
| Email | — | **No provider wired.** Email steps must show honest "not connected" until one is added. |

---

## 3. Prototype already in the repo (this pass)

- **CI page — new "Repeat Testing Loop" group** (`client/src/pages/clinical-intelligence.tsx`): 6 sections — Evidence Inbox, Result Review, Ancillary Opportunities, Repeat Eligibility, Documentation Reconciliation, Evidence Timeline. Rendered by `RepeatLoopShell` (honest "Not connected yet"; each names the tables it will read/write). No data fabricated.
- **Plexus IQ — Repeat Testing Review tile** (`client/src/pages/plexus-iq.tsx`, `data-testid="tile-repeat-testing-review"`): establishes the second review type next to Initial Qualification. Honest "Not connected yet".
- **Report-upload trigger comment** (`server/routes/portal.ts`, `POST /api/portal/uploads`): documents the exact catch-all steps to wire.

Nothing above changes engine behavior. Existing flows untouched.

---

## 4. Proposed schema — `repeat_opportunities` (NOT YET APPLIED)

`cooldown_records` covers dates + override status but lacks interval type,
admin-review-open date, engagement/scheduling reconciliation status, and
findings/ICD summary. Add a dedicated table. Propose the migration and get
sign-off before applying.

```ts
// shared/schema/repeatOpportunities.ts  (barrel-export from shared/schema.ts)
export const repeatOpportunities = pgTable("repeat_opportunities", {
  id: serial("id").primaryKey(),
  patientScreeningId: integer("patient_screening_id"),          // FK patient_screenings
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  testType: text("test_type").notNull(),                         // "BrainWave" | "VitalWave" | "Ultrasound" | full ancillary name
  priorExecutionCaseId: integer("prior_execution_case_id"),     // FK patient_execution_cases
  priorReportDocumentId: integer("prior_report_document_id"),   // FK documents
  priorTestDate: text("prior_test_date"),
  reportUploadedDate: text("report_uploaded_date"),
  payerType: text("payer_type"),                                // "PPO" | "Medicare" | "commercial" | "unknown"
  repeatIntervalMonths: integer("repeat_interval_months"),      // 6 | 12 | custom | null
  repeatDueDate: text("repeat_due_date"),
  adminReviewOpenDate: text("admin_review_open_date"),          // = repeatDueDate - 1 month
  status: text("status").notNull().default("future_repeat_pending"),
  priorFindingsSummary: text("prior_findings_summary"),         // human/AI-verified only; else null
  suggestedIcds: text("suggested_icds").array(),               // suggestion-only; requires review
  medicalNecessityRationale: text("medical_necessity_rationale"),
  source: text("source").notNull().default("clinical_intelligence"),
  adminReviewStatus: text("admin_review_status").default("not_reviewed"),
  engagementStatus: text("engagement_status"),
  schedulingReconciliationStatus: text("scheduling_reconciliation_status"),
  nextOutreachStep: text("next_outreach_step"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

**Status enum (`status`):** `future_repeat_pending`, `in_cooldown`,
`ready_for_admin_review`, `admin_approved`, `admin_rejected`, `deferred`,
`already_scheduled`, `not_scheduled`, `outreach_active`, `scheduled`,
`completed`, `cancelled`, `missed`, `needs_reschedule`.

Follow existing schema conventions: `createInsertSchema` + `.omit` auto fields,
insert type via `z.infer`, select type via `$inferSelect`; use `.array()` as a
method; register in the `shared/schema.ts` barrel. Add a migration file under
`migrations/` (next sequential number). **Do not** apply until approved.

If schema change is rejected: represent repeat opportunities by extending
`cooldown_records` + deriving the rest, accepting the reduced fidelity.

---

## 5. Repeat eligibility rules

On upload of a BrainWave / VitalWave / Ultrasound report:

1. CI reviews the report (extraction honest/placeholder until AI wired).
2. Determine payer type from the screening if available (else `unknown`).
3. Interval: **PPO/commercial → 6 months**, **Medicare → 12 months**, only
   when medically supported. Unknown payer → `unknown`, do not guess a date.
4. `repeatDueDate = priorTestDate (or reportUploadedDate) + intervalMonths`.
5. `adminReviewOpenDate = repeatDueDate − 1 month`.
6. Create/update the repeat opportunity. Dedupe by
   `patientScreeningId + testType + repeatDueDate window`.
7. Do **not** send to Engagement unless due now **and** admin-approved.
8. Store cooldown state until the due/review date.
9. Route to Plexus IQ Repeat Testing Review when `adminReviewOpenDate` arrives.

Medical necessity must be supported by prior abnormal findings, ongoing
diagnoses, symptoms, risk factors, prior report findings, payer timing, and
admin/provider approval. Never phrase repeats as automatic.

---

## 6. Documentation reconciliation (at report upload)

Reuse `getAncillarySnapshot` (`ancillaryReadModel.ts`). For the uploaded
patient + test + execution case, check and surface honest states
(`Present` / `Missing` / `Generated` / `Needs Review` / `Failed` /
`Not supported yet`):

1. Report saved to chart? Save if missing, else link. (Upload already saves.)
2. Order note exists for patient+ancillary+case? Present, else generate (if
   `noteGenerationServer` supports it) or flag **Missing Order Note**. Order
   note is normally created at **scheduling**; upload only catches a miss.
3. Procedure note exists? Present, else generate (normally created **at report
   upload**) or flag **Missing Procedure Note**.
4. Billing/supporting doc? Preserve existing behavior; generate/flag only if
   infra exists.
5. Write journey events: `report_uploaded`, `procedure_note_generated`/`_missing`,
   `order_note_present`/`_catchup_needed`, `ci_review_created`,
   `repeat_opportunity_created`.

---

## 7. Plexus IQ Repeat Testing Review

Add a queue distinct from Initial Qualification Review (prototype tile already
present in `plexus-iq.tsx`). Card shows: Patient, prior test + date, report
uploaded date, prior report link, key prior findings, suggested ICDs, existing
DX/HX/RX/risk factors, payer type, interval, repeat due date, admin-review-open
date, medical-necessity rationale, scheduling reconciliation status. Actions:
Approve Repeat, Edit Rationale, Reject, Defer, Open Patient, Open Report.

**Timing:** future due date → stays `future_repeat_pending`/`in_cooldown`, and
enters the queue at `adminReviewOpenDate` (due − 1 month). Within window or
overdue → appears immediately. Admin approval does **not** auto-place patients
on call lists.

---

## 8. After admin approval → scheduling reconciliation

```
Admin approves repeat → Scheduling Reconciliation → already scheduled?
  yes → mark Already Scheduled, no outreach (unless confirmation needed)
  no  → create Engagement repeat outreach item
```

Build a reusable helper (`server/services/scheduling/reconcileSchedule.ts`)
that checks `ancillary_appointments` + `global_schedule_events` by
`patientScreeningId` + testType + repeat-due window + appointment status.
States: `Not Scheduled`, `Already Scheduled`, `Scheduled Online`,
`Scheduled by Team`, `Cancelled`, `Missed`, `Needs Reschedule`, `Completed`.
**Re-check before every outreach step; stop outreach if scheduled.** Approved
but not-yet-due → keep future-dated. Cancelled/missed → back to Engagement as
`Needs Reschedule` / `Reschedule Missed Test`.

---

## 9. Engagement outreach sequence

Approved + not scheduled repeat items enter the **Assignment Pool** as:
`Category: Ancillary Scheduling`, `Call Type: Repeat Test Due`,
`Source: Plexus IQ Repeat Testing Review` (or `Clinical Intelligence`),
`Status: Awaiting assignment / Not Scheduled`.

Default sequence (configurable later), re-checking schedule between steps:
**1 month before due → email reminder**; **1 week before → text reminder**;
**2 days before → call-list item** (only if still not scheduled). If the
patient schedules online after email/text, stop remaining steps.

Email is **not wired** — show honest "not connected" for email steps until a
provider is added. SMS uses the existing gated Twilio adapter (never fake a
send). Timed steps should run in a background job following the existing
advisory-lock pattern (`server/lifecycle.ts`, `server/lib/advisoryLock.ts`).

Use chronological status trails (no tag soup), e.g.
`Plexus IQ Repeat Approved → Scheduling Reconciled → Not Scheduled → Email Pending`.

---

## 10. Communication events & Team Portal

Write to `patient_journey_events` where infra supports it:
`Email Pending/Sent/Delivered/Opened/Clicked/Failed`, `Text
Pending/Sent/Delivered/Replied/Failed`, `Patient Scheduled
Online/by Team`, `No Response`, `Added to Call List`, `Call Completed`,
`Appointment Cancelled/Missed`. Fabricate none of these.

Team Portal call rows for repeats show: Repeat Test Due, test type, prior test
date, repeat due date, payer interval, prior findings summary, why repeat is
reasonable, email/text sent + reply status, online-scheduling status, whether
already scheduled, call reason, next action. Do not call already-scheduled
patients.

---

## 11. Repeat order note

When the repeat is scheduled, the new order note pulls prior evidence: prior
test type/date, prior report findings, relevant ICDs, symptoms/history,
meds/risk factors, payer interval, repeat due date, admin-approved rationale.
Never assert automatic repeat or unsupported medical necessity.

---

## 12. Patient Directory / Plexus EHR

Ensure uploaded reports, generated notes, and timeline events are saved/linked
so the chart can show the longitudinal record (prior tests, reports, notes,
findings, approved ICDs, repeat eligibility date, cooldown state, admin
decisions, outreach history, appointment status).

---

## 13. Homepage tile

Clinical Intelligence already has a dedicated route/tile. If/when adding a
top-level homepage tile, use title **"Clinical Intelligence"**, subtitle
*"AI review of reports, labs, imaging, documents, ICD opportunities, and repeat
eligibility."* Do not break existing tiles.

---

## 14. Suggested phasing

1. **P1 — evidence foundation:** wire report-upload trigger → documentation
   reconciliation (reuse read model) + journey events; populate CI Evidence
   Inbox / Documentation Reconciliation from real data. (No schema change.)
2. **P2 — repeat opportunity:** apply `repeat_opportunities` (after approval);
   create opportunities on upload; populate CI Repeat Eligibility + Plexus IQ
   Repeat Testing Review; timing rule (open at due − 1 month).
3. **P3 — approval → reconciliation → Engagement:** admin approval, scheduling
   reconciliation helper, hand-off to Assignment Pool (Ancillary Scheduling /
   Repeat Test Due).
4. **P4 — outreach sequence:** timed email/text/call background job; email
   honest-unavailable until a provider is added; Team Portal repeat context.

---

## 15. Validation checklist (per PART 22 of the source spec)

CI is a dedicated tile/route separate from Plexus IQ but feeds it • report
upload saves to chart + links patient/test/case • upload triggers
reconciliation (or honest placeholder) • procedure note checked at upload,
missing order note detected, order note stays tied to scheduling • repeat
eligibility created after BrainWave/VitalWave/Ultrasound report • PPO 6mo /
Medicare 12mo • repeat review opens 1 month before due • Plexus IQ has Repeat
Testing Review separate from Initial Qualification • admin approval required
before outreach • scheduling reconciliation before outreach; already-scheduled
get no outreach • not-scheduled enter sequence (email 1mo / text 1wk / call
2days), re-checked each step; online scheduling stops remaining steps;
cancel/miss → Needs Reschedule • Engagement receives Ancillary Scheduling /
Repeat Test Due / correct Source • Team Portal shows repeat context • EHR stores
report + notes • journey events written/read where supported • **no fake AI /
email / text / scheduling** • no Google Calendar / old Outreach Center /
scheduler cards / `/api/scheduler-assignments` • existing Admin Review,
Assignment Pool, Team Portal still work • `npm run check` + `npm run build` pass.

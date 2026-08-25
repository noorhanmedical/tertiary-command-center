# Plexus Platform — Complete End-to-End Flow

**Read this document top to bottom.** It describes the entire Plexus platform as one
connected system: the object model, the setup lanes, the operational lanes, every
stage of a patient's journey from EMR to Plexus Bank, and all the cross-cutting
systems (state machine, events, tasks, audit, permissions, exceptions).

Every stage is annotated with its **current implementation status** so this doubles
as a build map:

- ✅ **Live** — works in production today
- 🟡 **Built / gated** — modeled in schema + services but behind a feature flag or only partially wired
- ❌ **Missing** — does not exist yet

The governing principle: **there is one spine, and every module is a view onto it.**

```
Facility → Patient → Ancillary Service Episode → Documents → Claim → Invoice → Payment
```

Nothing in the platform should exist outside this spine. If a screen shows patient
data, it reads the spine. If a screen changes patient data, it writes the spine and
emits an event.

---

## PART I — CONCEPTS & OBJECT MODEL

### 1. The canonical spine

| Object | What it is | Backing table(s) | Status |
|---|---|---|---|
| **Facility** | A clinic/tenant. Root of all scoping. | `clinics`, config in `admin_settings` | 🟡 table ✅, structured settings ❌ |
| **Patient (Plexus EHR)** | One canonical human, longitudinal record. | `global_plexus_patients` + `patient_clinic_memberships` + `patient_external_identifiers` | 🟡 built, flag `FEATURE_PLEXUS_IDENTITY_WRITE` OFF |
| **Ancillary Service Episode** | One (patient × service) journey. The unit of workflow. | `patient_ancillary_cases` | 🟡 built, flag `FEATURE_ANCILLARY_CASE_WRITE` OFF |
| **Service definition** | Configurable definition of a service (BrainWave, etc.) | *none — hard-coded* | ❌ missing |
| **Documents** | Consent, screening, report, order note, procedure note, billing doc. | `case_document_readiness`, `generated_notes`, `ancillary_document_templates` | 🟡 mixed |
| **Claim** | A payer claim for an episode. | `canonical_claims` (+ legacy `billing_records`) | 🟡 canonical flag-gated |
| **Invoice** | Facility invoice of paid claims. | `invoices`, `invoice_batches` (+ `canonical_invoices`) | 🟡 legacy ✅, canonical gated, claim-linkage ❌ |
| **Payment** | Money received. | `canonical_payments`, `invoice_payments` | 🟡 ledger exists, Bank view ❌ |

**Critical architectural note — the two-track reality.** The codebase currently runs
a **legacy track** (live) and a **canonical track** (built, mostly flag-gated):

- **Legacy (live):** `patient_screenings` → `patient_execution_cases` →
  `ancillary_appointments` → `billing_records` → legacy `invoices`.
- **Canonical (built, gated):** `global_plexus_patients` → `patient_ancillary_cases`
  → `canonical_appointments` → `generated_notes` → `billing_readiness` →
  `canonical_claims`/`canonical_payments`/`canonical_invoices`.

**The end-state target is the canonical track.** Most of this document describes the
canonical spine because that is where the platform is going; the legacy track is what
serves users until the flags flip.

### 2. The Ancillary Service Episode (why it matters)

A patient is **not** "in one status." A patient has **N episodes**, one per service:

```
John Smith (patient)
├── BrainWave     → Scheduled
├── VitalWave     → Admin Approved
├── Carotid US    → Completed
└── Echo          → Claim Submitted
```

Each episode carries its own state, documents, order note, procedure note, claim,
and invoice line. All episodes hang off the same patient. **The episode — not the
patient — is the unit that moves through the workflow.** This is already modeled in
`patient_ancillary_cases` (per `(patient, clinic, service_type)` with
`episode_sequence` for re-qualification history).

### 3. Configurable service definitions (the missing keystone)

Today BrainWave / VitalWave / ultrasound are **hard-coded** (keyword matching in
`shared/ancillaryCategory.ts`). The target is a **Service Registry** table so an admin
can add a service without code changes. Every service definition holds:

- Identity: name, category, code, enabled facilities, active flag
- Qualification: relevant diagnoses / meds / symptoms / encounter phrases, inclusion
  & exclusion criteria, age criteria, frequency restrictions, required evidence, and
  the **IQ qualification instructions** (prompt/rules) used by Plexus IQ
- Documents: required screening form, required consent, order-note template,
  procedure-note template, billing-document template
- Billing: CPT/HCPCS, modifiers, required report type, required provider signature
- Lifecycle: requalification interval

**Everything downstream keys off this registry.** Until it exists, "add a new service"
means editing code. This is the highest-leverage missing piece. ❌

---

## PART II — THE LANES (who and what)

### 4. Actor lanes (roles)

| Lane | Spec role | Today's role(s) | Primary surface | Status |
|---|---|---|---|---|
| Platform Admin | cross-facility config | `admin` (global) | Admin Settings | 🟡 no facility-admin split |
| Facility Admin | facility-scoped admin | *(none — admins are global)* | — | ❌ |
| **PCS** (Patient Care Specialist) | outreach + scheduling | `scheduler` → workspace `patientCareSpecialist` | Team Portal / Canvas (Call List) | ✅ |
| **ACS** (Ancillary Care Specialist) | testing workflow | `technician`/`liaison` → `ancillaryCareSpecialist` | Team Portal / Canvas (Ancillary Schedule) | ✅ |
| Clinician / Physician | signatures | `clinician` | Clinician Portal | ✅ |
| Biller | claims | `biller` | Billing | 🟡 coarse |
| Finance | invoices + bank | *(none — folded into biller/admin)* | Invoices, Plexus Bank | ❌ role, ❌ bank backend |

`USER_ROLES = [admin, clinician, scheduler, biller, technician, liaison]`. PCS/ACS are
**workspace types**, mapped from user role (`scheduler→PCS`, `technician/liaison→ACS`).
Target adds `finance` and a facility-admin vs platform-admin distinction.

### 5. Setup lanes (configuration that must exist before operations)

1. **Facility setup** — name, **timezone**, EMR integration, enabled services,
   notification settings. (§Facility Configuration)
2. **Service setup** — the Service Registry entries. (§3)
3. **Team setup** — which PCS/ACS cover the facility, capacity, availability,
   distribution rules. Lives in `outreach_schedulers` + `engagement_call_settings`. ✅ partial
4. **Document/template setup** — consent, screening, order/procedure/billing
   templates per facility/service, versioned. `ancillary_document_templates`. 🟡
5. **Billing/invoice setup** — CPT mapping, invoice frequency, cutoff, timezone,
   recipients, payment terms, template. 🟡 partial / ❌ tz
6. **Permissions setup** — role assignments + clinic scope. ✅ partial

### 6. Operational lanes (the moving work)

Intake → Qualification → Review → Engagement → PCS Outreach → Scheduling →
Clinical Documentation & Signature → ACS Testing → Report → Procedure Note & Signature
→ Billing → Claims → Invoicing → Bank. Detailed in Part IV.

### 7. Cross-cutting lanes (always on)

State machine · Events/automation · Tasks/notifications · Audit · AI traceability ·
Permissions · Exceptions · Timeline · Reporting. Detailed in Part V.

---

## PART III — FACILITY & SERVICE CONFIGURATION

### 8. Facility configuration (per `clinics` + structured settings)

Every operational behavior is **facility-scoped**. A facility record should carry (or
reference) the following. Today most of this lives as opaque JSONB in `admin_settings`;
the target promotes them to structured, validated config. 🟡

- **Identity & locale:** name, **timezone** (used for invoice cutoff — see §31), address
- **EMR integration:** provider, credentials/handle, sync enabled, last sync
- **Enabled ancillary services:** subset of the Service Registry
- **Qualification criteria overrides** per service
- **Team:** PCS members, ACS members, active flags, capacity, availability
- **Distribution rules:** auto vs manual, round-robin, capacity weighting, coverage
- **Scheduling rules:** locations, providers, slot rules
- **Documents:** consent requirements, screening forms, order/procedure/billing templates
- **Billing/invoice:** invoice frequency (weekly/biweekly/monthly/custom), day-of-week,
  **cutoff time**, recipient(s), payment terms, invoice template
- **Notifications:** which events notify whom

> Rule: **nothing on this list is a global constant.** Two facilities may differ on
> every line.

### 9. Service configuration (Service Registry) — see §3. ❌ (build target)

---

## PART IV — THE END-TO-END FLOW (stage by stage)

Each stage uses the same template so you can read straight through:
**Lane · Trigger · Preconditions · What happens · Data written · Episode state ·
Documents · Events · Tasks · Audit · Exceptions · Today.**

The canonical **episode state machine** (target) is the through-line:

```
Imported → AI_Evaluation → Potentially_Qualified → Admin_Review → Approved
→ Assigned → Outreach → Scheduled → Order_Generated → Order_Pending_Signature
→ Order_Signed → Ready_For_Test → Arrived → Screening_Completed → Test_Completed
→ Report_Uploaded → Procedure_Note_Generated → Proc_Pending_Signature
→ Procedure_Note_Signed → Billing_Doc_Generated → Ready_To_Bill → Claim_Submitted
→ Claim_Paid → Added_To_Invoice → Invoice_Sent → Invoice_Paid → Posted_To_Bank
```

Today these states are **implicit**, spread across `patient_screenings.status/commit_status/
admin_approval_status`, `patient_execution_cases.*`, `patient_ancillary_cases.*`,
`invoices.status`, etc. The target makes them **one explicit column per episode** with a
transition log. 🟡→ (unify)

---

### STAGE 0 — Intake Lane A: Automatic EMR sync  ❌

- **Lane:** System (EMR Integration Layer)
- **Trigger:** scheduled sync or webhook from external EMR (e.g. eClinicalWorks)
- **Preconditions:** facility has EMR integration configured + enabled
- **What happens:** pull the facility's patient population + clinical data
  (demographics, contact, insurance, diagnoses, problem list, meds, allergies,
  encounters + notes, providers, labs, existing orders/procedures). For each: **match
  or create** a Plexus patient (dedup by external ID / normalized identifiers), update
  changed fields, record source EMR + external patient ID + last-sync timestamp.
- **Data written:** `global_plexus_patients`, `patient_clinic_memberships`,
  `patient_external_identifiers` (already support `ehr_patient_id`, `clinic_mrn`,
  `external_import_id`, dedup match value, `source_system`)
- **Episode state:** patient exists; episodes created in Stage 2
- **Events:** `PATIENT_IMPORTED`, `PATIENT_CLINICAL_DATA_UPDATED`
- **Exceptions:** EMR API failure → queue retry, surface sync issue; never duplicate patients
- **Today:** ❌ **No EMR adapter exists.** Only Google Drive/Sheets integrations. The
  **identity layer is ready to receive** EMR patients — the adapter is the build.

### STAGE 1 — Intake Lane B: Manual / Batch  ✅

- **Lane:** PCS / admin (Plexus IQ → Add Patient → Batch Flow)
- **Trigger:** user creates a screening batch, adds or imports patients (text/file)
- **What happens:** patients entered/imported into a batch; import source metadata
  captured; batch queued for AI analysis
- **Data written:** `screening_batches`, `patient_screenings` (+ import session fields)
- **Episode state:** `Imported`
- **Events:** `PATIENT_IMPORTED`
- **Today:** ✅ fully working (`useScreeningBatches`, `VisitBuildPane`, import routes).

> **Convergence rule:** Lane A and Lane B must land in the **same** patient + episode
> structure and share every downstream step. Today Lane B is live; Lane A is absent;
> both are designed to converge on `global_plexus_patients` + `patient_ancillary_cases`
> once identity write is on. 🟡

### STAGE 2 — Plexus IQ: automatic qualification  ✅ (with gaps)

- **Lane:** System (AI)
- **Trigger:** `PATIENT_IMPORTED` / `PATIENT_CLINICAL_DATA_UPDATED`
- **Preconditions:** facility's enabled services known
- **What happens:** for each enabled service, evaluate the patient's clinical data
  (diagnoses, meds, encounter text, symptoms, history) using the service's
  qualification instructions; produce **structured** output.
- **Structured output (per service):** status, confidence, supporting
  diagnoses/meds/encounter excerpts, clinical justification, relevant dates, **model +
  version**, processing timestamp. Persisted today in `patient_screenings.reasoning`
  (`testReasoningSchema`: clinician_understanding, talking points, confidence, ICD-10,
  pearls, approvalRequired) via OpenAI `gpt-4o`.
- **Episode state:** `AI_Evaluation` → `Potentially_Qualified` / `Not_Qualified` /
  `Needs_Additional_Information`
- **Events:** `PATIENT_QUALIFIED`
- **Audit / AI traceability:** preserve model/version, prompt/rule version, inputs,
  original output, later human edits (never overwrite)
- **Today:** ✅ AI qualification with structured output + batch mode. **Gaps:**
  model/version not persisted; qualification is **not** final approval; re-qual
  overwrites screening-level reasoning (no version history) 🟡.

### STAGE 3 — Requalification  🟡

- **Trigger:** `PATIENT_CLINICAL_DATA_UPDATED` (new dx/med/encounter/test) or a change
  in service criteria
- **What happens:** re-evaluate affected services; **preserve prior qualification
  history** rather than overwriting.
- **Data:** new episode via `patient_ancillary_cases.episode_sequence`;
  `ancillary_case_admin_review_events.source = 'reanalysis'`
- **Today:** 🟡 episode-level versioning exists; screening-level overwrite persists;
  auto-trigger on data change not wired.

### STAGE 4 — Admin Review  ✅

- **Lane:** Platform/Facility Admin
- **Trigger:** episode reaches `Potentially_Qualified`
- **What happens:** admin reviews patient, facility, recommended service, AI
  qualification + evidence, prior testing, qualification history; takes an action:
  **Approve / Reject / Request info / Edit / Hold.**
- **Data written:** legacy `patient_screenings.admin_approval_*`; canonical append-only
  `ancillary_case_admin_review_events` (previous/new status, reviewer, timestamp,
  rationale, evidence snapshot, source)
- **Episode state:** `Approved` / `Admin_Rejected` / `Needs_Additional_Information` / on hold
- **Events:** `ADMIN_APPROVED` → hand to Engagement
- **Audit:** user, timestamp, action, reason, **original AI recommendation**
- **Today:** ✅ live screening-level approval + 🟡 canonical event-sourced review
  (flag `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW`).

### STAGE 5 — Engagement (distribution)  ✅

- **Lane:** Engagement (admin/system)
- **Trigger:** `ADMIN_APPROVED`
- **What happens:** place approved episode into an engagement list; assign to a team
  member. **Automatic distribution** (facility, role, availability, current workload,
  capacity, round-robin, service type) or **manual** assign/reassign.
- **Data written:** `engagement_lists`, `engagement_list_memberships`,
  `patient_execution_cases.assigned_team_member_id`, `patient_journey_events` (every
  assignment logged: who/when/reason)
- **Episode state:** `Assigned`
- **Events:** `PATIENT_ASSIGNED`
- **Config source:** team + capacity + rules from Facility Settings
  (`outreach_schedulers`, `engagement_call_settings`)
- **Today:** ✅ **strongest area** — auto (`distributionService`) + manual board, fully
  logged. Gaps: live capacity/current-load recomputed at read time; coverage override limited.

### STAGE 6 — PCS Outreach (Canvas / Call List)  ✅

- **Lane:** PCS
- **Trigger:** `PATIENT_ASSIGNED`
- **What happens:** assigned patients appear on the PCS **Call List** (patient, facility,
  qualified service, reason, phone, outreach status, attempts, last attempt, next
  action, scheduling status). PCS calls; each attempt records who/when/outcome/notes/
  follow-up. Outcomes: New / Attempt Needed / Attempted / Left VM / Reached / Interested
  / Declined / Needs Callback / Scheduled / Unable to Reach / Closed.
- **Data written:** `outreach_calls`, `patient_execution_cases` (attempt count, last
  attempt/outcome, next action), `patient_journey_events`
- **Episode state:** `Outreach`
- **Events:** call-result events; architected for future phone-provider auto-logging
- **Today:** ✅ call list + call logging live (`callListEngine`, `recordCallResult`).
  Gap: statuses derived (no discrete `call_list_status` enum/transition log).

### STAGE 7 — Scheduling  ✅

- **Lane:** PCS (from Canvas)
- **Trigger:** patient agrees during outreach
- **What happens:** schedule the ancillary test: patient, facility, service, date,
  time, assigned ACS, location, provider, status, notes. Reschedule **preserves
  history**.
- **Data written:** `ancillary_appointments` (legacy) / `canonical_appointments` +
  `global_schedule_events` (rich statuses + `parent_event_id` reschedule lineage)
- **Statuses:** Pending / Scheduled / Confirmed / Arrived / In Progress / Completed /
  Cancelled / Rescheduled / No Show
- **Episode state:** `Scheduled`
- **Events:** `APPOINTMENT_SCHEDULED` → triggers Order Note + document tasks
- **Today:** ✅ scheduling + reschedule lineage (canonical behind `FEATURE_CANONICAL_APPOINTMENT`).

### STAGE 8 — Document sending at scheduling  🟡

- **Lane:** PCS
- **Trigger:** `APPOINTMENT_SCHEDULED`
- **What happens:** send facility/service documents from the **Document Library**
  (informed consent, screening form, patient/prep instructions). Track sent, date/time,
  method, completion, signed doc, **version used**.
- **Data written:** `case_document_readiness`, `ancillary_document_templates` (version)
- **Today:** 🟡 templates stored + versioned but **passive** — no auto-select-by-service,
  no send→sign→return workflow, no expiry. Build target.

### STAGE 9 — Order Note (auto-generated) + physician signature  🟡 / ❌ body

- **Lane:** System generates → Clinician signs
- **Trigger:** episode is qualified **and** approved **and** scheduled
- **What happens:** generate the Order Note (clinical justification/order) from patient
  info + service + qualification evidence + AI justification + facility template +
  ordering provider. Enters `Pending Provider Signature`, appears in the Clinician
  Portal. Provider reviews/edits/signs/rejects/requests correction. Records e-signature,
  signer, timestamp.
- **Data written:** `generated_notes` (noteType `order_note`; generationStatus;
  signatureStatus needs_signature→ready_to_sign→signed→returned; signedAt/signedBy)
- **Statuses:** Draft / Pending Signature / Signed / Rejected / Voided
- **Episode state:** `Order_Generated` → `Order_Pending_Signature` → `Order_Signed`
- **Events:** `ORDER_GENERATED` → physician queue
- **Today:** 🟡 record + eligibility (`orderNoteEligibility`: approved + scheduled) +
  signature flow exist. ❌ **the note body is not auto-generated** — reuses legacy note
  or manual entry. Build target: AI/template body generation.

### STAGE 10 — Physician Portal (orders)  ✅

- **Lane:** Clinician
- **What happens:** task queue of **Pending Orders** requiring signature; each shows
  patient, facility, service, type, date, status; open patient context inline; sign.
- **Data:** `generated_notes` via `signatureWorkflow`; `/api/physician-portal/*`
- **Today:** ✅ worklist + sign endpoint (canonical data behind
  `FEATURE_CANONICAL_ORDER_NOTE` / `FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA`).

### STAGE 11 — ACS Ancillary Schedule → patient arrives  ✅ / 🟡

- **Lane:** ACS
- **Trigger:** `APPOINTMENT_DATE_REACHED`
- **What happens:** ACS Ancillary Schedule (defaults to **today**, day/week nav) shows
  patients scheduled for testing. ACS opens a patient → the testing workspace (Canvas)
  shows the three components: **Consent, Screening, Report**.
- **Episode state:** `Ready_For_Test` → `Arrived`
- **Today:** ✅ schedule view (`scheduleDashboardService`). Gap: no inline
  arrive/in-progress/complete/no-show actions from the schedule grid (they live in the
  patient Canvas). 🟡

### STAGE 12 — Informed Consent  🟡

- **What happens:** if valid consent already exists for the service, recognize it
  automatically (completed, date, version, signature, expiration) — **do not duplicate**.
  Otherwise capture it.
- **Data:** `case_document_readiness` (documentType `informed_consent`)
- **Episode state:** consent satisfied (a test-day prerequisite)
- **Today:** 🟡 status-tracked (missing/pending/uploaded/approved/completed). Missing:
  sent date/method, version tie-back, expiry, signature-based completion.

### STAGE 13 — Screening Form  🟡

- **What happens:** the service-appropriate screening form is selected, completed, and
  saved to the patient record.
- **Data:** `case_document_readiness` (documentType `screening_form`), template from
  `ancillary_document_templates`
- **Today:** 🟡 tracked via templates; no auto-select-by-service / auto-render.

### STAGE 14 — Test performed → Test Report uploaded  ✅

- **Lane:** ACS
- **What happens:** ACS performs the test; uploads/attaches the report with metadata
  (patient, facility, service, test date, performing ACS, upload time, status).
  Report becomes part of the patient record. **Finalizing the report is the key
  downstream trigger.**
- **Data:** `case_document_readiness` (documentType `report`), attachment service
- **Episode state:** `Screening_Completed` → `Test_Completed` → `Report_Uploaded`
- **Events:** `TEST_REPORT_FINALIZED`
- **Today:** ✅ upload + status tracking.

### STAGE 15 — Test-Day Gating  🟡

- **What happens:** before a test can be marked fully complete, configurable
  prerequisites must pass: valid order, provider signature, consent, screening,
  arrival. Blocking behavior is **configurable per service/facility**.
- **Data:** `ancillary_service_prerequisite_config` (blocker category + blocks stage +
  required + override allowed), `procedure_events`
- **Today:** 🟡 framework built (Phase 2F, migration 0054) but **flag OFF**
  (`FEATURE_CANONICAL_PROCEDURE_LIFECYCLE`) — no active gating in prod.

### STAGE 16 — Procedure Note (auto-generated) + signature  🟡

- **Trigger:** `TEST_REPORT_FINALIZED` (procedure complete + report available)
- **What happens:** auto-generate the Procedure Note from the configured template
  (patient, test type/date, facility, performing member, order note, justification,
  screening, report metadata). Enters Clinician Portal for signature.
- **Data:** `generated_notes` (noteType `post_procedure_note`), eligibility = completed
  + report
- **Statuses:** Draft / Pending Signature / Signed / Rejected / Voided
- **Episode state:** `Procedure_Note_Generated` → `Proc_Pending_Signature` →
  `Procedure_Note_Signed`
- **Events:** `PROCEDURE_DOCUMENTATION_COMPLETE`
- **Today:** 🟡 generator + signature flow built; **flag OFF**
  (`FEATURE_PROCEDURE_NOTE_GENERATOR`).

### STAGE 17 — Physician Portal (procedure notes)  ✅ / 🟡

- Same portal as Stage 10, **Pending Procedure Notes** queue. Sign → episode advances.
- **Today:** ✅ worklist; canonical data behind `FEATURE_CANONICAL_PROCEDURE_NOTE`.

### STAGE 18 — Billing Document (auto-generated)  🟡

- **Trigger:** `PROCEDURE_DOCUMENTATION_COMPLETE` (test complete + required docs present)
- **What happens:** generate the Billing Document — patient, facility, DOS, service,
  provider, diagnosis, CPT/procedure, supporting docs, order + procedure-note status,
  report, insurance. Deterministic from **exact evidence** (no inference). Appears in
  Billing.
- **Data:** `billing_document_requests` / `canonical_billing_document_requests`,
  `completed_billing_packages`
- **Episode state:** `Billing_Doc_Generated`
- **Events:** feeds Billing
- **Today:** 🟡 generator + readiness built (Phase 2G) but **flag OFF**.

### STAGE 19 — Billing / Claim queue  🟡

- **Lane:** Biller
- **What happens:** billing queue with claim statuses; biller can see **why** something
  isn't billable (missing signature/consent/report/insurance/invalid code).
- **Statuses:** Documentation Pending / Ready to Bill / Submitted / Accepted / Rejected
  / Pending Payer / Denied / Appealed / Partially Paid / Paid / Closed
- **Data:** `billing_readiness` (per-doc blockers, evidence snapshot + fingerprint);
  canonical `canonical_claims`; legacy `billing_records`
- **Episode state:** `Ready_To_Bill` → `Claim_Submitted`
- **Events:** `CLAIM_SUBMITTED`
- **Today:** 🟡 granular readiness/blockers built (Phase 2G, gated); live path
  (`billing_records`) is coarse (Not Billed/Submitted/Paid), no "why not billable".

### STAGE 20 — Claim payment  🟡

- **What happens:** on payer response, record claim, amounts (billed / allowed / paid /
  adjustment / patient responsibility), payment date. **Claim `Paid` is the trigger**
  for invoicing — not submission.
- **Data:** `canonical_claims` (status `paid`/`partially_paid`/`denied`),
  `canonical_payments` (append-only ledger), `canonical_payment_allocations`
- **Episode state:** `Claim_Paid`
- **Events:** `CLAIM_PAID`
- **Today:** 🟡 claims/payments reach `paid` (Phase 2J, gated), but ❌ **`claim.paid`
  does not trigger invoicing** — the join is missing.

### STAGE 21 — Invoice Accumulator  🟡

- **What happens:** each facility has an open invoice period; as claims are **paid**,
  eligible amounts accumulate into the upcoming invoice.
- **Data:** `invoice_batches` + `invoice_batch_items` (currently fed from
  `invoice_readiness_snapshots` — execution cases, **not** paid claims)
- **Episode state:** `Added_To_Invoice`
- **Events:** `CLAIM_PAID` → accumulate
- **Today:** 🟡 accumulator exists but keyed off readiness snapshots; ❌ **should key off
  paid claims.**

### STAGE 22 — Invoice cutoff (facility timezone)  ❌

- **What happens:** at the configured cutoff, include all eligible paid claims through
  the facility-local boundary (e.g. *Sunday 11:59 PM Arizona time* for a Monday,
  Arizona-tz facility). **Never use server timezone.**
- **Events:** `INVOICE_CUTOFF_REACHED` → finalize
- **Today:** ❌ facility timezone not stored/used; all cutoffs are **server UTC**.

### STAGE 23 — Invoice generation / send  🟡

- **What happens:** finalize the invoice with a **fixed snapshot** of included claims
  (immutable; corrections via adjustment). Send to configured recipients.
- **Statuses:** Building / Ready / Sent / Viewed / Partially Paid / Paid / Overdue / Voided
- **Data:** `invoices` + `invoice_batches` (`policy_snapshot`, `recipient_snapshot`,
  `totals`); `canonical_invoices` (richer statuses + supersede)
- **Episode state:** `Invoice_Sent`
- **Events:** invoice sent
- **Today:** 🟡 legacy statuses only (Draft/Sent/Partially Paid/Paid — no Overdue/Viewed);
  canonical richer but gated; corrections via supersede, not adjustment.

### STAGE 24 — Invoice paid → Plexus Bank  ❌ backend

- **What happens:** on invoice payment, post to **Plexus Bank** — the financial ledger.
  Each record links Facility → Invoice → Payment → Claims → Patients/services, with
  payment date/amount/method/destination, fully traceable:
  `Bank Payment → Invoice → Paid Claim → Billing Document → Test Episode → Patient`.
- **Episode state:** `Invoice_Paid` → `Posted_To_Bank`
- **Events:** `INVOICE_PAID` → post to bank
- **Data:** target ledger table(s); real payments today live in `canonical_payments`
- **Today:** ❌ **Plexus Bank is a frontend mock** (localStorage, no backend). No
  ledger, no lineage, no reconciliation surface. Build target.

---

## PART V — CROSS-CUTTING SYSTEMS

### 25. Workflow state machine  🟡→ (unify)

The episode carries **one explicit state** (the sequence in Part IV) plus a **transition
log** (from-state, to-state, actor, timestamp, reason). Today states are inferred from
6+ columns across `patient_screenings`, `patient_execution_cases`,
`patient_ancillary_cases`, `invoices`. **Target:** a single `episode_state` on
`patient_ancillary_cases` + an append-only `episode_state_transitions` table. This is the
unification that makes the timeline, gating, and reporting trivial.

### 26. Events / automation architecture  🟡

Downstream work is **event-driven**, not UI-triggered. Canonical events:

```
PATIENT_IMPORTED              → Plexus IQ evaluation
PATIENT_CLINICAL_DATA_UPDATED → requalification check
ADMIN_APPROVED                → Engagement
PATIENT_ASSIGNED              → PCS workflow
APPOINTMENT_SCHEDULED         → Order Note + document tasks
ORDER_GENERATED               → physician signature queue
APPOINTMENT_DATE_REACHED      → ACS schedule
TEST_REPORT_FINALIZED         → Procedure Note
PROCEDURE_DOCUMENTATION_COMPLETE → Billing Document
CLAIM_PAID                    → invoice accumulator
INVOICE_CUTOFF_REACHED        → finalize invoice
INVOICE_PAID                  → post to Plexus Bank
```

**Today:** 🟡 `outbox_items` exists **only** for Drive/Sheets sync; a few schedulers
(absence watcher, invoice reminder) exist; the **core workflow chain is not yet
event-driven**. Target: a real event bus/outbox for the events above, with background
workers (Postgres advisory locks) so logic isn't duplicated in UI components.

### 27. Notifications & task generation  🟡

Major events create tasks/notifications so users aren't polling pages:

| Event | Task → lane |
|---|---|
| Patient approved | Engagement |
| Patient assigned | PCS notification |
| Appointment scheduled | ACS schedule |
| Order generated | Physician |
| Consent missing before appt | PCS/ACS warning |
| Test completed | Procedure Note |
| Documentation complete | Billing |
| Claim denied | Biller |
| Invoice due | Finance/admin |

**Today:** 🟡 `plexus_tasks` + `plexus_task_events` exist; a few events create tasks
(absence, invoice reminder); **systematic event→task mapping is missing.**

### 28. Audit trail  🟡

Every meaningful action emits an audit event recording: user/system, timestamp,
facility, patient, **episode**, action, **previous state**, **new state**.
**Today:** `audit_log` records action + entity + `changes` JSONB but **no
previous/new state, no episode context**; `patient_journey_events` and
`ancillary_case_admin_review_events` cover only parts of the chain. Target: unify onto
the state-transition log (§25).

### 29. AI traceability  🟡

Whenever Plexus IQ generates content, preserve: model/provider, prompt/rule version,
timestamp, input references, structured output, **original output**, and subsequent
human edits — **never overwrite AI output after a human edits it.**
**Today:** structured output persisted; ❌ model/version not stored; screening-level
re-runs overwrite. Target: an AI-generation record per output with version + edit history.

### 30. Role-based permissions  🟡

Roles control **what a user can see** and **what they can modify**, scoped by facility.
Target roles: Platform Admin, Facility Admin, PCS, ACS, Clinician, Biller, Finance.
**Today:** `[admin, clinician, scheduler, biller, technician, liaison]`; authorization
via `requireRole` + clinic scoping (`clinicContext`); ❌ no `finance`, ❌ no
facility-admin vs platform-admin, PCS/ACS are workspace types not roles.

### 31. Multiple services per patient  🟡

Each service is its **own episode** with independent state, documents, claim, and
invoice line — all linked to the same patient. **Do not** collapse a patient to a single
status. Already modeled in `patient_ancillary_cases`; needs to be the live default.

### 32. Exception handling  🟡

No exception removes a patient from the workflow.

| Exception | Handling |
|---|---|
| Patient declines | close/defer episode (don't delete) |
| Unable to reach | configurable attempts + follow-up dates |
| No show | return to outreach/reschedule |
| Cancellation | record reason |
| Reschedule | new appointment, preserve history |
| Test can't be completed | record reason + next action |
| Provider rejects order | return episode for correction |
| Claim denied | stays in Billing; denial/appeal workflow |
| Partial invoice payment | track outstanding balance |
| EMR API failure | queue retry + surface sync issue |

**Today:** 🟡 outreach/reschedule/no-show handled; denial/appeal + partial-payment +
EMR-retry are partial or absent.

### 33. Global patient timeline  🟡

The Plexus EHR patient profile shows the complete journey across all episodes:

```
Imported from eClinicalWorks → IQ identified BrainWave → Admin approved →
Assigned to Sarah (PCS) → Contacted → Scheduled → Consent sent → Order generated →
Dr. Smith signed order → Arrived → Screening completed → BrainWave performed →
Report uploaded → Procedure Note generated → Dr. Smith signed → Billing doc generated →
Claim submitted → Claim paid → Invoice #1234 → Invoice paid
```

**Today:** 🟡 partial (journey events + admin-review events); becomes trivial once the
state-transition log (§25) is unified.

### 34. Reporting / dashboards  🟡

Because every stage is structured, the platform reports:

- **Qualification:** imported, screened, qualification rate, by service, admin approval rate
- **Engagement:** awaiting assignment, per PCS/ACS, contact rate, scheduling conversion
- **Operations:** scheduled/completed today, no-shows, cancellations, reschedules, by service
- **Clinical docs:** orders/procedure notes awaiting signature, missing consents/screenings/reports
- **Billing:** ready to bill, submitted, pending, denied, paid
- **Financial:** paid claims awaiting invoice, invoice amount by facility, outstanding
  invoices, collected revenue, Bank receipts

**Today:** 🟡 billing reports are real; **Clinic Analytics is a mock**; clinical/engagement
dashboards absent.

---

## PART VI — UI PRINCIPLE & BUILD SEQUENCE

### 35. UI principle

Each module is a **different view onto the same spine**, never a standalone mini-app:

- Plexus IQ = qualification view · Admin Review = approval view · Engagement =
  assignment view · Canvas = operations view · Physician Portal = signature view ·
  Billing = revenue-cycle view · Plexus Bank = financial view.

All patient data displayed anywhere reads the Plexus EHR patient/episode; all changes
write the spine and emit an event.

### 36. Recommended build sequence (close the gaps)

1. **Unify the spine** — promote `patient_ancillary_cases` + an explicit episode state
   machine to the live source of truth; turn on identity write. Connects the flagged middle.
2. **Service Registry** (§3) — unblocks configurable services everywhere.
3. **EMR adapter** (Stage 0) — feed the waiting identity layer.
4. **Clinical chain on** (Stages 9–18) — order-note **body generation**, flip
   signature/gating/procedure-note/billing-readiness flags.
5. **Financial close** (Stages 20–24) — `claim.paid` event → accumulator;
   facility-timezone cutoff; **build the Plexus Bank backend** + lineage.
6. **Automation + reporting** (§26–34) — event→task generation, real analytics, roles
   (`finance`, facility-admin, PCS/ACS).

### 37. Preservation rules (when implementing)

- Inspect current code; **reuse and extend**, don't duplicate existing Plexus IQ, Admin
  Review, Engagement, Canvas, Document Library, Clinician Portal, Billing, or Settings.
- Extend existing models rather than forking new patient systems.
- Preserve the existing visual design system and navigation.
- Connect placeholder/demo components (Plexus Bank, Clinic Analytics) to the real spine
  rather than rebuilding their UI.
- Preserve working functionality while wiring the end-to-end data flow.

---

## APPENDIX A — Status summary

| Area | Live ✅ | Built/gated 🟡 | Missing ❌ |
|---|---|---|---|
| Intake | Manual/batch | Identity write | **EMR adapter** |
| Qualification | AI structured output | Ancillary episodes, requal history | model/version persistence |
| Review | Screening approval | Canonical event-sourced review | — |
| Engagement | Auto + manual distribution | — | live capacity view |
| PCS / Canvas | Call list, calling | — | discrete call-status log |
| Scheduling | Appointments + reschedule | Canonical appointments | — |
| Documents | — | Templates (passive) | send→sign→return, versions/expiry |
| Order Note | Signature flow | Record + eligibility | **body generation** |
| Clinician Portal | Signature worklist | Canonical data | — |
| Test-day gating | — | Prereq framework | active enforcement |
| Procedure Note | — | Generator + signature | flip on |
| Billing | Coarse status | Granular readiness/blockers | "why not billable" live |
| Claims | — | Canonical claims/payments | **claim.paid → invoice** |
| Invoicing | Legacy invoices + accumulator | Canonical invoices | **timezone cutoff**, claim-fed accumulator |
| Plexus Bank | — | Payment ledger | **entire backend + lineage** |
| Roles | 6 roles + clinic scope | — | finance, facility-admin, PCS/ACS |
| Events | Outbox (files) | — | workflow event bus |
| Tasks | plexus_tasks | ad-hoc generation | systematic event→task |
| Audit | audit_log | journey/review events | prev/new state + episode |
| Reporting | Billing reports | — | clinical/engagement dashboards; Analytics is mock |

## APPENDIX B — Feature flags gating the canonical track

`FEATURE_PLEXUS_IDENTITY_WRITE` · `FEATURE_ANCILLARY_CASE_WRITE` ·
`FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW` · `FEATURE_CANONICAL_APPOINTMENT` ·
`FEATURE_CANONICAL_ORDER_NOTE` · `FEATURE_PROCEDURE_NOTE_GENERATOR` ·
`FEATURE_CANONICAL_PROCEDURE_LIFECYCLE` · `FEATURE_CANONICAL_PROCEDURE_NOTE` ·
`FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` · (Phase 2G billing) · (Phase 2J claims/payments/invoices)

Flipping these on — after the spine is unified — is most of the "wire it together" work.

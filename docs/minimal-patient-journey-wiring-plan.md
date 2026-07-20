# Minimal Patient Journey Wiring Plan

**Purpose:** Proposed implementation sequence to bring the patient journey to end-to-end continuity, based strictly on the findings in `docs/full-patient-journey-platform-audit.md` and the visualization gaps in `docs/ancillary-document-visualization-map.md`.

**Status:** Proposal only. Not implemented. Awaits owner approval of canonical identities and sequence before any code change.

**Repository baseline:** `main` at `2aaa23b`.

## Guiding Principles (enforced by every phase below)

1. **Preserve the existing UI.** No layout, color, spacing, typography, or navigation changes. Data-contract additions are optional fields the current UI ignores.
2. **Reuse canonical tables.** Do not create competing sources of truth for patient, appointment, ancillary case, note, document, invoice, or payment.
3. **Additive schema only.** New columns are nullable with defaults; new tables reference existing canonical IDs. No destructive migrations. No `TRUNCATE`. No column removal.
4. **Feature-flag every write path** that isn't a pure read swap. Default OFF. Flip only after E2E green.
5. **Incremental PRs.** Each phase is a small stack; each stack has a rollback plan.
6. **Test gates at every step.** Static contract test + unit + Playwright targeted, before every merge; full 39-test suite + operator-confirmed at every stage boundary.
7. **Do NOT restore Twilio / patient SMS / patient messaging.** The retirement is verified and must stay.
8. **Separate schema work from wiring work.** Schema PR lands first (approved and applied); wiring PR uses the new column.
9. **Separate document wiring from claim/payment wiring.** Documents/notes can be rewired without touching finance; claims and payments are their own phase.
10. **Prioritize minimum viable end-to-end continuity.** The shortest path from ingested patient → paid invoice, over shiny features.

## Dependency Graph

```
2A: Canonical patient identity
      ↓  (patient rows now stable across renames + duplicates)
2B: Qualification + Admin Review timestamp + persistence fixes
      ↓
2C: One canonical appointment (globalScheduleEvents primary)
      ↓  (appointment IDs are the anchor for order-note eligibility)
2D: Order Note lifecycle enforcement + retire legacy /api/generated-notes read
      ↓  (procedure-time gates now stable)
2E: Procedure event states + report + Procedure Note generator
      ↓  (documentation lineage is complete)
2F: Billing readiness + Billing Document lifecycle wiring
      ↓  (billing artifacts have canonical links to documents)
2G: Clinician Portal live-data replacement (LinkedDocumentsPanel + Finance)
      ↓  (physician surface reads canonical state)
2H: PCS / ACS canonical document visualization
      ↓  (portals show canonical documents)
2I: Claims + Remittance + Payment + Invoice + Allocation + Journey Completion
      ↓
2J: Full journey E2E test suite + Mission Control finance activation
```

The order is deliberate. **Do not reorder 2C before 2A** — appointment linkage relies on stable patient IDs. **Do not reorder 2F before 2E** — billing readiness requires the note lifecycle to actually complete.

## Phase 2A — Canonical patient identity + patient-resolution wiring

**Goal:** One durable identifier per real-world patient, immune to name / DOB corrections.

**Rationale:** Every downstream stage joins on `patient_screenings.id`, but the identity itself is keyed on mutable name+dob with no uniqueness or merge path (audit §5.1, §7).

**Schema (additive, no destructive changes):**
- Add table `canonical_patients (id uuid PK, name_normalized text, dob text, first_screening_id int, created_at timestamptz, merged_into_canonical_patient_id uuid null)`.
- Add column `patient_screenings.canonical_patient_id uuid null` (nullable during backfill).
- Backfill algorithm mirrors the existing unwired `server/modules/patient-directory/repo.ts` grouping. Land as a one-shot backfill script; not part of `drizzle-kit push`.

**Wiring:**
- Every new create endpoint sets `canonical_patient_id` on the new screening row.
- PATCH `/api/patients/:id` on name change → detect duplicate against `canonical_patients` by new name+dob. If collision, refuse or open an admin merge task.
- Add `POST /api/patients/merge` (admin, feature-flagged `FEATURE_PATIENT_MERGE`) — sets `merged_into_canonical_patient_id`; every subsequent read follows the chain.
- Retire the unwired `server/modules/patient-directory/repo.ts` in favor of the wired path.
- Add repository helpers: `getCanonicalPatientByScreening(id)`, `listScreeningsForCanonical(canonicalId)`.

**Test gates:**
- Unit: `tests/unit/canonicalPatientIdentity.test.ts` — validates (a) backfill hash matches, (b) merge chain resolves, (c) PATCH name change refuses on collision.
- Static architecture test: `patient_screenings.canonical_patient_id` non-null after backfill runs.
- E2E: canonical-route smoke passes; new merge dialog (if surfaced) is admin-only.

**Rollback point:** Drop the FK reference in code; the `canonical_patients` table stays as an orphan. No data lost; UI unchanged.

**Feature flag:** `FEATURE_PATIENT_MERGE` (default OFF). Backfill runs without flag; merge writes gated.

## Phase 2B — Qualification + Admin Review persistence

**Goal:** No admin-added reasoning ever lost; approval history is auditable; effective-date recorded when clinically needed.

**Rationale:** `batchAnalysisRunner.ts:714-728` silently overwrites `patient_screenings.reasoning` on re-run, losing every `adminReview:*` key (audit §5.2). Admin approval timestamp is always `new Date()` with no way to record an effective date (audit §5.3).

**Schema (additive):**
- Add nullable column `patient_screenings.admin_effective_at timestamptz null` (documents effective clinical date separate from `adminApprovedAt`).
- Add table `admin_approval_history` (append-only) with columns: `id`, `patient_screening_id`, `previous_status`, `new_status`, `approved_by_user_id`, `approved_at` (never backdated), `effective_at` (optional), `note`, `reasoning_snapshot` (jsonb).

**Wiring:**
- Wire `preserveAdminReviewReasoning` (exists at `shared/plexus-iq/adminReviewEvidence.ts:969-985`) into `server/services/batchAnalysisRunner.ts:714-728`. Reasoning merge preserves `adminReview:*` keys on every batch re-run.
- On `/api/patient-screenings/:id/admin-approval`, insert a row into `admin_approval_history` alongside the current update. Never mutate history rows.
- Accept optional `effective_at` in the approval payload; store on the screening + history row. Never modify `adminApprovedAt`.
- Add role gate (product decision): `requireRole('admin', 'clinician')` on approval — see §5.3 defect (currently no role check).

**Test gates:**
- Unit: `tests/unit/adminReviewEvidence.test.ts` extended to prove batch re-run preserves `adminReview:*` keys.
- Unit: new `tests/unit/adminApprovalHistory.test.ts` verifies history row insertion on each approval + immutability.
- Playwright: no UI change; regression check.

**Rollback:** Revert the wiring commit; history table is additive and can remain as orphan. Approval semantics revert to old behavior.

**Feature flag:** Not needed — additive persistence fix. Role gate can be flag-gated `FEATURE_ADMIN_REVIEW_ROLE_GATE` if soft rollout desired.

## Phase 2C — One canonical appointment across Global Calendar, PCS, ACS, Patient EHR

**Goal:** Declare `global_schedule_events` sole canonical appointment. Every read follows this table.

**Rationale:** Four independent stores today (audit §3.1, §5.5). Patient-EHR / PCS / ACS / shared-schedule reads can silently disagree.

**Schema (additive):**
- Add `ancillary_appointments.global_schedule_event_id int null` (nullable during backfill).
- Add `global_schedule_events.parent_event_id int null` (self-FK for reschedule lineage).
- Add `global_schedule_events.cancellation_reason text null`, `no_show_reason text null`.

**Wiring:**
- Backfill: for every `ancillary_appointments` row, upsert a matching `global_schedule_events` row (`eventType='ancillary_appointment'`, `source='backfill'`) and set the FK. Idempotent.
- New writes to `ancillary_appointments` also write a linked `global_schedule_events` row atomically; use the linked row's ID as canonical.
- Reschedule creates a new `global_schedule_events` row with `parent_event_id` pointing at the previous row.
- Read-only compatibility: `ancillary_appointments` continues to be readable via legacy route, but the returned status is derived from the linked `global_schedule_events.status`.
- Retire `patient_screenings.appointmentStatus` mutation from outreach in favor of a computed read; keep the column with a nullable default for backward compatibility, but remove writes.
- Consolidate the two call-outcome writers (`/api/outreach/calls` vs `/api/engagement-center/call-result`) into `recordCallOutcome(scope)` service that transactionally: inserts `outreach_calls`, updates `engagementStatus` on the case, appends journey event, opens `scheduling_triage_cases` when needed. See audit §5.4.

**Test gates:**
- Unit: `tests/unit/appointmentCanonical.test.ts` — verifies FK, reschedule lineage.
- Integration (Playwright API-level): backfill produces stable IDs across surfaces.
- E2E: full 39-test suite; canonical route smoke passes.

**Rollback:** Revert wiring commit; FK column stays nullable; legacy dual writes resume.

**Feature flag:** `FEATURE_CANONICAL_APPOINTMENT` default OFF for the atomic double-write; ON after backfill.

## Phase 2D — Order Note lifecycle enforcement + retire legacy `/api/generated-notes` read

**Goal:** Order notes are created only when (Admin Review complete AND scheduled appointment). Ancillary Documents reads from `procedure_notes`, not legacy `generated_notes`.

**Rationale:** `createPendingProcedureNotes` fires unconditionally on procedure-complete (audit §5.6). `/ancillary-documents` page reads `/api/generated-notes` (legacy) while all writes go to `procedure_notes` (audit §3.3).

**Schema (additive):**
- Add `procedure_notes.notes_lineage_id uuid null` — lineage grouping for corrections/amendments/replacements. First row in a lineage sets `notes_lineage_id = gen_random_uuid()` and later corrections copy the same value.
- Add `procedure_notes.effective_date text null` — separate effective clinical date, never overwrites `signedAt`.

**Wiring:**
- Add eligibility gate to `createPendingProcedureNotes` (`server/repositories/generatedNotes.repo.ts:82-132`):
  - Fail closed if `patient_screenings.adminApprovalStatus != 'approved'`.
  - Fail closed if there is no `global_schedule_events` row with `patientScreeningId` + `serviceType` + `status IN ('scheduled', 'completed')`.
  - Emit clear structured error to the caller.
- Retire legacy `/api/generated-notes` read on `/ancillary-documents`. New read path: fetch `procedure_notes` filtered by patient / service / kind + `documents` for report artifacts. Fold legacy DOC_KIND_LABELS (`preProcedureOrder`, `postProcedureNote`, `billing`, `screening`) into the canonical `noteType` + `kind` via a mapping layer at the client hook, not in the UI component. Zero visual change.
- Add `requireAuth` + clinic scope to `/api/generated-notes` OR delete the route (product decision).
- Implement a minimal note **generation service** that transitions `procedure_notes.generationStatus: pending → generating → generated`. Templates + AI call live in `server/services/notes/generatorService.ts`. Feature-flagged.

**Test gates:**
- Unit: `tests/unit/orderNoteEligibility.test.ts` — verifies gate rejects unapproved / unscheduled cases.
- Static architecture: no client file imports `/api/generated-notes` after this phase.
- Playwright: `/ancillary-documents` renders the same UI with data now sourced from `procedure_notes`; add specific assertions for order_note visibility.

**Rollback:** Feature-flag OFF the eligibility gate (`FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`); legacy read route can be re-enabled by removing the auth wrapper.

**Feature flags:** `FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`, `FEATURE_NOTE_GENERATOR`, `FEATURE_ANCILLARY_DOCS_CANONICAL_READ` — all default OFF.

## Phase 2E — Procedure event states + report + Procedure Note lifecycle

**Goal:** Procedure has real start/complete/cancel/no-show endpoints. Procedure Note is produced only when (procedure complete AND report uploaded).

**Rationale:** `PROCEDURE_STATUSES` includes 6 values but only `/complete` endpoint exists (audit §5.7). `createPendingProcedureNotes` unconditionally writes `post_procedure_note` on complete regardless of report presence (audit §5.9). Report requirement is enforced only at signature time.

**Schema (additive):**
- Add `procedure_events.started_at timestamptz null`, `paused_at timestamptz null`, `cancelled_at timestamptz null`, `no_show_at timestamptz null`, `unable_to_complete_reason text null`.
- Add `procedure_notes.correction_of_note_id int null` (self-FK for amendment chain within a lineage).
- Consider adding `documents.replaced_by_document_id` for report replacement lineage (already have `supersededByDocumentId` — verify sufficient).

**Wiring:**
- New endpoints: `POST /api/procedure-events/start`, `.../pause`, `.../resume`, `.../cancel`, `.../no-show`, `.../unable-to-complete`. Each transitions `procedureStatus` deterministically.
- Prerequisites classified in code:
  - **Hard blockers** (block start): patient identity, valid appointment, active clinic tenancy.
  - **Soft warnings** (allow start with warning): missing consent, missing screening form.
  - **Documentation follow-up** (never block): missing marketing form.
  - **Billing blockers** (block billing not procedure): missing insurance verification, missing authorization.
- Gate `createPendingProcedureNotes` for `noteType='post_procedure_note'` on report presence AT GENERATION time, not just signature time. Fail-closed with structured error.
- Note generator produces `generatedText` when both preconditions satisfied.
- Report upload triggers procedure-note generation attempt idempotently.
- Correction / amendment: create a new `procedure_notes` row with same `notes_lineage_id` and `correction_of_note_id = previous_row.id`. Old row keeps `signatureStatus='returned_for_correction'`.
- Void state (rare): admin sets `signatureStatus='voided'` (extend enum, additive).

**Test gates:**
- Unit: `tests/unit/procedureLifecycle.test.ts`, `tests/unit/procedureNoteEligibility.test.ts`.
- Playwright: ACS workspace exercises new endpoints; document lineage renders correctly.

**Rollback:** Additive endpoints can be un-registered; the schema columns are nullable.

**Feature flags:** `FEATURE_PROCEDURE_STATE_MACHINE`, `FEATURE_PROCEDURE_NOTE_ELIGIBILITY_STRICT` — default OFF.

## Phase 2F — Billing readiness + Billing Document lifecycle wiring

**Goal:** Billing document requests atomically produce a canonical `documents` row via a real generator. `generatedDocumentId` becomes a real FK.

**Rationale:** `generatedDocumentId` orphan (audit §5.11). Generator missing. Fire-and-forget race.

**Schema (additive):**
- Convert `billing_document_requests.generatedDocumentId` from bare int to FK → `documents.id`. Nullable; enforce foreign key at DB level in a follow-up migration only if data is clean.
- Add `billing_document_requests.attempt_count int default 0` and `last_error_at timestamptz null` for retry tracking.

**Wiring:**
- Merge the fire-and-forget flow into a single transaction: `evaluateBillingReadinessForProcedure` + `createPendingBillingDocumentRequestFromReadiness` in one call. See `server/repositories/billingReadiness.repo.ts:173`.
- Add a **billing document generator service** (`server/services/billing/documentGenerator.ts`) that:
  - Renders billing document (PDF or structured) from encounter data + templates.
  - Writes to `documents` table with `kind='billing_document'` + `patientScreeningId` + `sourceNotes` marker.
  - Sets `billing_document_requests.generatedDocumentId` = new documents.id.
  - Transitions `requestStatus: pending → generating → generated`.
- On generation success, create a draft `invoices` row linked to the encounter (extend invoice creation service to accept a billing_document_request id).
- Add `invoices.billing_document_request_id int null` FK.
- Add reconciliation job (cron via `node-cron` already used elsewhere) to catch orphaned `billing_readiness_checks.readinessStatus='ready_to_generate'` rows with no request.

**Test gates:**
- Unit: `tests/unit/billingDocumentGeneration.test.ts` — full lifecycle.
- Integration: end-to-end from procedure complete → note signature → billing readiness → billing document → invoice draft.
- Playwright: Billing workspace shows generated document link.

**Rollback:** Revert generator service; FK stays nullable.

**Feature flags:** `FEATURE_BILLING_DOCUMENT_GENERATOR` default OFF.

## Phase 2G — Clinician Portal mock/live replacement

**Goal:** LinkedDocumentsPanel + Finance surfaces read live data instead of empty mock arrays.

**Rationale:** `client/src/components/physician/mockData.ts:203-214` — `DOCUMENTS: [] , AUDIT_EVENTS: []`. LinkedDocumentsPanel renders empty forever (audit §6.1).

**No schema change.**

**Wiring:**
- Add `server/routes/physicianPortal.ts` endpoints (extend the existing service):
  - `GET /api/physician-portal/linked-documents?patientScreeningId=` — returns procedure_notes + documents for the current physician's assigned patients.
  - `GET /api/physician-portal/audit-events?patientScreeningId=` — returns patient_journey_events filtered for physician-relevant types.
- Client hook: `useLinkedDocuments`, `useAuditEvents` — replace mockData imports.
- Preserve the LinkedDocumentsPanel UI exactly. Only the data source changes.

**Test gates:**
- Unit: `tests/unit/physicianLinkedDocuments.test.ts` — service returns only physician-scoped patients.
- Playwright: LinkedDocumentsPanel renders live documents when patient has procedure notes.

**Rollback:** Revert client hook to mockData imports.

**Feature flag:** `FEATURE_CLINICIAN_PORTAL_LIVE_DOCS` default OFF; matches existing `FEATURE_CLINICIAN_PORTAL_BACKEND` gate pattern.

## Phase 2H — PCS + ACS canonical document visualization

**Goal:** PCS and ACS portals reference canonical document IDs; no independent projections.

**Rationale:** Portals currently mix reads from live `procedure_notes` + `documents` + legacy `generated_notes` (audit §5.6, §5.8). Consolidate.

**No schema change.**

**Wiring:**
- Consolidate document-panel data hooks in the portal shell:
  - Reports: `documents` with `kind='report'` + `case_document_readiness.documentStatus`
  - Order/Procedure notes: `procedure_notes` (canonical)
  - Consent / Screening Form: `documents` with `kind='informed_consent'` / `'screening_form'`
- Remove any surface-side reference to legacy `generated_notes`.
- Add a small mapping layer that translates legacy `docKind` values → canonical `(noteType, kind)`.
- Keep the UI identical.

**Test gates:**
- Static architecture: no PCS/ACS component imports `/api/generated-notes` after this phase.
- Playwright: portal document panels render live documents identical to Ancillary Documents.

**Rollback:** Revert client hook; each portal reverts to its pre-phase reads.

**Feature flag:** Bundled with Phase 2D `FEATURE_ANCILLARY_DOCS_CANONICAL_READ`.

## Phase 2I — Claims, remittance, payment, invoice, allocations, financial completion

**Goal:** Provide a real claim → payment → invoice → allocation pipeline OR delegate to external RCM. Product decision required (audit §12.2).

**Rationale:** No claims table, no clearinghouse call, no allocation compute (audit §5.12, §5.14).

**Two options — pick one before implementation:**

### Option A: In-house claims pipeline
- Schema: add `claim_submissions`, `claim_submission_events`, `payer_remittance_files` tables. All additive.
- EDI 837 formatter + clearinghouse SFTP adapter (Change Healthcare or Availity).
- 835 remittance parser.
- Feature flag: `FEATURE_CLAIMS_INHOUSE`, default OFF.

### Option B: Delegate to external RCM
- Adapter service posts encounters to partner API.
- Ingest partner statuses via webhook.
- Minimal schema: `claim_status_snapshots` table for partner's status ledger.
- Feature flag: `FEATURE_CLAIMS_EXTERNAL`, default OFF.

**Common wiring:**
- Add `invoices.status = 'closed'` state (extend enum additively). Transition from `Paid` when all balances = 0 for N days.
- Compute revenue allocation from `projectedInvoices.projectedOurPortionPercentage` + adjustments. Add `revenue_allocations` table with `invoice_id`, `clinic_id`, `plexus_amount`, `clinic_amount`.
- Journey completion view (see Phase 2J).

**Test gates:**
- Unit: claim submission flow (mocked clearinghouse or partner API).
- Integration: end-to-end from paid invoice → allocation posted → journey stage `financially_closed`.

**Rollback:** All work is behind feature flags; disable to fall back to today's manual finance workflow.

## Phase 2J — Full journey E2E + Mission Control finance activation

**Goal:** A single Playwright test drives a patient from ingestion to fully closed. Mission Control finance section shows real numbers.

**Deliverables:**
- Add a `patient_journey_status(patient_screening_id)` view returning the discrete list of completed stages (audit §11.8):
  - qualification_complete, admin_review_complete, engagement_complete, scheduling_complete, procedure_complete, report_uploaded, documentation_complete, signature_complete, billing_ready, billing_document_generated, claim_submitted (if 2I option A), payment_received, invoice_closed, clinically_closed, financially_closed, fully_closed.
- Turn on `sections.finance.sourceMissing=false` in Mission Control once the underlying billing/payment/allocation is stable (Phase 3 correction currently keeps it deliberately `sourceMissing:true`).
- New Playwright spec: `tests/e2e/interactions/full-journey.spec.ts` — drives one patient from ingestion through paid invoice.

**Rollback:** Feature-flag the Mission Control finance activation.

## Cross-cutting items

### Legacy `/sms/twilio/inbound` auth exemption cleanup

Pre-existing dead code at `server/routes.ts:210-214` (from `e23face`, before Phase 1). No route registered under that path. Remove the exemption branch as a 3-line hygiene commit — no functional change, no restoration.

### Retire legacy `uploaded_documents` name-based match

Under Phase 2A (canonical patient identity), rewrite `documentLibraryLegacy.repo.ts::findLatestPatientScreeningByExactName` to prefer `canonical_patient_id + dob` join. Deprecate exact-name matching. Migration is a one-shot backfill; no destructive change.

### Retire unwired `server/modules/patient-directory/*`

Under Phase 2A, the wired canonical patient identity replaces this module. Delete after Phase 2A merges.

### Plexus Bank isolation

Under a small hygiene PR (not a lifecycle phase): gate `client/src/pages/plexus-bank*` behind `?sandbox=1` OR an admin-only preview flag. Do not delete — it's a design deliverable. Explicit disclaimer already at `client/src/pages/plexus-bank.tsx:230`.

### Prototype routes

`/home-preview` and `/plexus-iq-prototype` — gate behind admin-only wrapper OR move under `/sandbox/*`. Same hygiene PR as Plexus Bank.

## Migration Dependencies (for future phases only — none in Phase 1)

Every migration is additive, non-destructive, and idempotent. None run during this audit.

| Phase | New table | New column | Notes |
|-------|-----------|------------|-------|
| 2A | `canonical_patients` | `patient_screenings.canonical_patient_id` | Backfill via one-shot script; not `drizzle-kit push` |
| 2B | `admin_approval_history` | `patient_screenings.admin_effective_at` | History table is append-only |
| 2C | (none) | `ancillary_appointments.global_schedule_event_id`, `global_schedule_events.parent_event_id`, `global_schedule_events.cancellation_reason`, `global_schedule_events.no_show_reason` | Backfill script |
| 2D | (none) | `procedure_notes.notes_lineage_id`, `procedure_notes.effective_date` | |
| 2E | (none) | `procedure_events.started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_reason`, `procedure_notes.correction_of_note_id` | |
| 2F | (optional index) | `billing_document_requests.generatedDocumentId` → FK to `documents.id`; `attempt_count`, `last_error_at`; `invoices.billing_document_request_id` | Enforce FK only after clean data |
| 2I option A | `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations` | `invoices.status='closed'` (enum extend) | |
| 2I option B | `claim_status_snapshots`, `revenue_allocations` | Same enum extend | |
| 2J | (none) | `patient_journey_status` VIEW | Compute-only |

## Test Gates and E2E Gates (universal)

Every phase gate:

- `npm run check` exit 0
- `npm run test:unit` all passing
- `npm run build` exit 0
- `git diff --check` exit 0
- Playwright canonical UI manifest test still passes for all protected files
- No new imports of `@/pages/plexus-bank/mockData` outside `client/src/pages/plexus-bank/*`
- No new imports of `mockPortalMessages` outside `client/src/components/portal/messaging/*`
- No new `.name === ` matches on patient/document/appointment tables
- No new writes to `patient_screenings.appointmentStatus` after Phase 2C
- No new writes to legacy `/api/generated-notes` write path
- No new client-side hardcoded medical or billing data
- Operator-confirmed Replit production Playwright: 39 / 39 (or expanded matching set) passes before merging any phase

## Do Not

- Do not begin ANY of Phase 2A–2J during Phase 1 (this audit).
- Do not enable any feature flag introduced by future phases without an explicit approval.
- Do not merge future PRs into `main` without Playwright green from the Replit workspace.
- Do not restore Twilio / patient SMS / patient messaging at any point.
- Do not delete mock or legacy files during Phase 1 audit. Deletion is a future phase.
- Do not create competing patient / appointment / ancillary-case / billing tables.
- Do not modify UI styling, layout, colors, spacing, typography, or navigation.
- Do not run destructive migrations. Every migration is additive.
- Do not backdate an actual action timestamp; introduce a separate `effective_at` field when clinical effective date differs from action time.

## Recommended Source-of-Truth Principle — for evaluation

The audit's recommended principle:

> Patient Directory / Patient EHR = authoritative longitudinal patient visualization.
> Ancillary Documents = global operational projection of canonical patient-linked ancillary records.
> Clinician Portal = role-specific clinical review and signature projection.
> PCS Portal = role-specific outreach, scheduling, and readiness projection.
> ACS Portal = role-specific execution, report, and readiness projection.
> Document Library = administrative file and version repository.
> Finance / Billing = role-specific financial workflow projections.
> Every projection must reference canonical source IDs. Do not create independent copies merely for display.

**Repository evidence supports this principle.** The canonical tables are all in place for identity, case, note, document, readiness, request, payment, invoice, and journey events. What is missing is:
1. Consolidated appointment (Phase 2C).
2. Enforcement gates and generators for notes + billing docs (Phase 2D–2F).
3. Live wiring of the Clinician Portal (Phase 2G).
4. Retiring the legacy Ancillary Documents read path (Phase 2D).
5. Claims / allocations / journey completion (Phase 2I–2J).

The recommended principle can be adopted **without new source-of-truth tables** other than `canonical_patients`, `admin_approval_history`, `claim_submissions` (or partner snapshots), `revenue_allocations`, and `patient_journey_status` (view). Everything else is wiring + gates.

## Awaiting owner approval

Per Phase 1 stop condition:

1. Canonical patient identity — approve or refuse `canonical_patients` table.
2. Canonical ancillary-case identity — confirm `patient_execution_cases` remains sole case.
3. Canonical appointment identity — confirm `global_schedule_events` becomes sole (deprecating `ancillary_appointments` as canonical).
4. Canonical document architecture — confirm `procedure_notes` for notes + `documents` for files + retire legacy `generated_notes` display.
5. Minimal wiring sequence — approve/adjust the 2A → 2J ordering above.

No implementation until each of these has an explicit go-ahead.

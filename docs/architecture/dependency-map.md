# Module dependency map

Manual fan-in / fan-out map for the modules most likely to be touched (or accidentally touched) by a refactor batch. Lines and counts cite `review-canonical-spine-2026-06-09.md`; verify against current source before relying on them.

> Cross-reference: review §4 (backend findings), §5 (frontend findings), §6 (flow-wiring). Protected flows live in [`protected-flows.md`](./protected-flows.md). Do-not-touch surface lives in [`do-not-touch.md`](./do-not-touch.md).

The legend:
- **Fan-in** = files that import / call this module.
- **Fan-out** = files this module imports / calls.

A high fan-in module is fragile: changes here ripple. A high fan-out module is brittle: it depends on many things.

---

## Frontend high-coupling modules

### `client/src/lib/pdfGeneration.ts` (904 lines) — PDF engine
Highest cross-cut on the frontend.

**Fan-in (callers):**
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/PatientCard.tsx`
- `client/src/components/ResultsView.tsx`
- `client/src/components/qualification/AdminReviewDialog.tsx`
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/outreach/CanonicalRowActions.tsx`

**Fan-out:**
- `client/src/lib/pdfPacketGrouping.ts` (`splitPatientsByFacilityDate`, `validateSameFacilityDatePacket`, `isPatientPdfEligible`)
- `html2pdf.js` (vendored chunk, 975 KB)
- Patient screening data shape (`reasoning`, `qualifyingTests`, demographics)

**Invariants:**
- Clinician PDF does NOT render ICD codes (`reasoning[testName].icd10_codes` is read but not drawn).
- Plexus PDF DOES render ICD codes.
- Multi-patient packets use print-preview (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`).

---

### `client/src/components/qualification/AdminReviewDialog.tsx` (4,230 lines)
Most fragile UI component in the repo.

**Fan-in:**
- `client/src/pages/plexus-iq.tsx` (and other entry points that open the dialog)
- `client/src/pages/admin-review.tsx` (if present)

**Fan-out:**
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/adminReviewStatus.ts`
- `client/src/features/schedule/*`
- `client/src/hooks/api/keys.ts` (`qk`)
- React Query (inline `useQuery` / `useMutation`)
- `shared/plexus-iq/*` types
- Backend endpoints: `/api/patient-screenings/:id/admin-review/{evidence,regenerate,regenerate-all,regenerate-ancillary}`

**Sub-features that must remain:** supporting buttons, qualifying factors, per-ancillary regenerate, regenerate-all, sibling Next/Prev auto-advance, ICD chips, under-16 guardrails, OpenAI regeneration, "Updates Made In Patient" change log, admin approval.

**Test-ids:** 30+ `data-testid` attributes referenced by `scripts/qa-*.mjs`. A rename is a regression.

---

### `client/src/components/engagement/EngagementAssignmentBoard.tsx` (2,028 lines)

**Fan-in:**
- `client/src/pages/engagement-center.tsx`
- Any page that links to engagement bulk actions

**Fan-out:**
- `client/src/lib/pdfGeneration.ts`
- `client/src/hooks/api/keys.ts`
- React Query
- Backend endpoints: `GET /api/engagement/assignment-board`, `POST /api/engagement/assignment-board/assign`

**Invariants:** Conflict guard rejects assignment if same person+DOB has an active case on the same scheduleDate assigned to a different scheduler. Outreach patients with null scheduleDate are exempt.

---

### `client/src/components/portal/TeamPortalShell.tsx` (2,693 lines) and `PortalShell.tsx` (1,816 lines)

**Fan-in:**
- `client/src/components/workflow/ClinicWorkflowPortal.tsx`
- `/patient-care-specialist-portal`, `/ancillary-care-specialist-portal` wrappers

**Fan-out:**
- `client/src/lib/workflow/teamMemberWorkspaceApi.ts`
- `client/src/lib/portal/commandCenterApi.ts`
- Backend: `/api/patient-packet`, execution cases, plexus tasks, scheduler assignments

---

## Backend high-coupling modules

### `server/services/patientCommitService.ts` — spine orchestrator
Fire-and-forget today; the most central commit path.

**Fan-in (callers):**
- `server/services/batchAnalysisRunner.ts` (after AI screening)
- `server/routes/patients.ts` (commit endpoints)
- Anywhere a manual commit is triggered

**Fan-out (writes / calls):**
- `server/repositories/screening.repo.ts` (`patient_screenings`)
- `server/repositories/executionCase.repo.ts` (`patient_execution_cases`)
- `server/services/globalSchedule.ts` (`global_schedule_events`)
- `server/services/insuranceEligibility.ts` (`insurance_eligibility_reviews`)
- `server/services/cooldown.ts` (`cooldown_records`)
- `server/services/auditService.ts` (`patient_journey_events`, `audit_log`)
- Scheduler auto-assign helper

**Risk:** Six writes, no transaction. Batch 10 wraps them.

---

### `server/services/screening.ts` — AI qualification
**Fan-in:**
- `server/services/batchAnalysisRunner.ts`
- `server/routes/patients.ts` (admin-review regenerate flows)

**Fan-out:**
- `server/replit_integrations/chat/*` (Claude)
- `server/services/plexusIq/*` (admin-review rule engine, AI regen helpers)
- `shared/clinicWorkflow.ts`, `shared/plexus.ts`, `shared/plexus-iq/*`

---

### `server/storage.ts` — legacy god-facade (538 lines, ~305 methods)

**Fan-in:** Most routes. Removing it is a long, careful project.

**Fan-out:** Every `server/repositories/*` file.

**Rule (CLAUDE.md):** `server/storage.ts` is a facade only. New code edits repos in `server/repositories/` directly. Removing the facade requires migrating all consumers first.

---

### `server/routes/billing.ts` and `server/routes/invoices.ts`

**`billing.ts` Fan-in:** `client/src/pages/billing.tsx`.
**`billing.ts` Fan-out:** `server/repositories/billing.repo.ts`, `server/services/auditService.ts`, `server/services/billingAutoCreateService.ts` (if Batch 3 ships).
**Known fragility:** Auto-create scan inside `GET /api/billing-records` (lines 67–111) — O(batches × patients × tests) on every read.

**`invoices.ts` Fan-in:** `client/src/pages/invoices.tsx`.
**`invoices.ts` Fan-out:** `server/repositories/invoices.repo.ts` (`createInvoiceWithLineItems`, `createPayment`, `deletePayment` — all transactional), `server/services/auditService.ts`, email sender.

---

### `server/routes/engagementAssignmentBoard.ts`

**Fan-in:** Engagement Center UI.
**Fan-out:** `server/repositories/executionCase.repo.ts`, `server/services/auditService.ts` (journey events), conflict-guard internals.

---

### `server/routes/plexusIqClinicalImport.ts`

**Fan-in:** `client/src/lib/plexusIqClinicalImportApi.ts`.
**Fan-out:** `server/services/screening.ts`, batch creation, MRN stamping via `buildClinicalImportNotes`, scheduler auto-assign.

---

## Cross-cutting infra

### `server/db.ts`
Single PostgreSQL pool (Drizzle + node-postgres). **CLAUDE.md guard:** requires explicit approval before editing.

### `server/integrations/fileStorage.ts` (+ `s3FileStorage.ts`, Drive client)
Provider switch (`STORAGE_PROVIDER=s3 | google_drive`). 24h presigned URL TTL on S3.

### `server/lib/validateEnv.ts`
Boot-time env validation. Enforces S3 in production unless explicitly allowed.

### `server/middleware/errorHandler.ts` and `rateLimiter.ts`
Error-handling order matters; request-ID middleware (Batch 20) must mount before errorHandler.

### `shared/schema.ts` (barrel) and `shared/schema/*.ts`
Drizzle table defs. Renames / drops are very high-blast. `shared/schema/index.ts` is in CLAUDE.md's explicit-approval list.

---

## Visual summary

Highest-fan-in (fragile):
1. `client/src/lib/pdfGeneration.ts`
2. `client/src/components/qualification/AdminReviewDialog.tsx`
3. `server/storage.ts`
4. `client/src/hooks/api/keys.ts` (`qk`)
5. `server/services/patientCommitService.ts`

Highest-fan-out (brittle to changes upstream):
1. `client/src/components/qualification/AdminReviewDialog.tsx`
2. `server/services/patientCommitService.ts`
3. `client/src/components/portal/TeamPortalShell.tsx`
4. `server/routes/plexusIqClinicalImport.ts`

Any refactor touching the intersection of these two sets needs extra care — that's where Batches 4, 10, 12, 15 live.

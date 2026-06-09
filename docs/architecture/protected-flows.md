# Protected working flows

These are the flows that are **working today** and must remain working after every refactor batch. Each flow is paired with the QA script(s) that exercise it and the key entry points in the code.

> Cross-reference: `review-canonical-spine-2026-06-09.md` §6 (flow-wiring review) and §10 (do-not-touch list). Live do-not-touch surface: [`do-not-touch.md`](./do-not-touch.md).

If a PR would change behavior in any flow below, that PR must be in a batch whose orchestrator entry (`full-21-batch-orchestrator-review.md`) explicitly allows it. Otherwise the PR must be either docs-only or add additive endpoints without switching UI.

---

## Flow → QA script map

| Flow | QA script | Notes |
| --- | --- | --- |
| Global navigation, dock, home tiles | `scripts/qa-navigation-dock-home-tiles.mjs` | First gate on any UI structure change. |
| Command Center architecture | `scripts/qa-command-center-architecture.mjs` | Verifies command-center composition. |
| Visit / Outreach tile parity | `scripts/qa-visit-outreach-tile-parity.mjs` | Engagement-bucket tile rendering. |
| Plexus IQ interior (workspace, calendar, sidebar) | `scripts/qa-plexus-iq-interior.mjs` | Calendar + workspace UX. |
| Plexus IQ backend (qualification jobs, batch runner) | `scripts/qa-plexus-iq-backend.mjs` | Backend job lifecycle. |
| Team Portals restore | `scripts/qa-team-portals-restore.mjs` | Team portal data wiring. |
| Team Portal workspace engine | `scripts/qa-team-portal-workspace-engine.mjs` | Patient packet + tabs. |
| Engagement assignment runtime | `scripts/qa-engagement-assignment-runtime.mjs` | Conflict guard + bulk assign. |
| Admin Review (regenerate, approve, ICD chips, under-16 guardrails) | **Manual** | No automated script today — gap noted for Batch 21. |
| Clinician PDF / Plexus PDF | **Manual** (Batch 9 will add an optional baseline snapshot) | Visual diff against pre-batch capture. |
| Outreach call flow | Covered indirectly via visit-outreach + engagement scripts | — |
| Document upload / library | **Manual** | Drive/S3 flows. |
| Billing list, invoice creation, payment | **Manual** | High blast radius; Batch 17 design-only first. |

Run all eight automated scripts (`scripts/qa-*.mjs`) on every batch.

---

## Detailed protected flows

### 1. Plexus IQ — calendar, workspace, sidebar, add-patient
- **UI entry:** `client/src/pages/plexus-iq.tsx`, `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`, `PlexusIQBulkImportModal.tsx`, `PlexusIQQualificationJobsStatus.tsx`.
- **Backend:** `server/routes/plexus.ts` and friends; qualification-jobs endpoints.
- **QA:** `qa-plexus-iq-interior.mjs`, `qa-plexus-iq-backend.mjs`.

### 2. Plexus IQ import — bulk clinical paste → batch → screenings
- **UI entry:** `PlexusIQBulkImportModal.tsx` → `client/src/lib/plexusIqClinicalImportParser.ts` → `client/src/lib/plexusIqClinicalImportApi.ts`.
- **Backend:** `server/routes/plexusIqClinicalImport.ts` (`resolveBatchForGroup`, `buildClinicalImportNotes`).
- **QA:** `qa-plexus-iq-backend.mjs` (covers backend); manual for UI.

### 3. Clinical qualification — AI screening + admin review rules
- **Backend:** `server/services/screening.ts` (`screenSinglePatientWithAI`), `server/services/batchAnalysisRunner.ts`, `server/services/plexusIq/*` (admin-review rule engine, AI regen).
- **QA:** `qa-plexus-iq-backend.mjs`; manual for AI output.

### 4. Admin Review — supporting buttons, qualifying factors, per-ancillary regenerate, regenerate-all, admin approval, sibling Next/Prev, ICD chips, under-16 guardrails
- **UI entry:** `client/src/components/qualification/AdminReviewDialog.tsx` (4,230 lines).
- **Backend:** `server/routes/patients.ts` admin-review endpoints (`/evidence`, `/regenerate`, `/regenerate-all`, `/regenerate-ancillary`).
- **QA:** Manual today. Batch 21 will expand coverage. Until then any Admin Review behavior change requires a per-batch manual regression.

### 5. Clinician PDF, Plexus PDF, selected patient PDF actions
- **Frontend:** `client/src/lib/pdfGeneration.ts` (904 lines), `client/src/lib/pdfPacketGrouping.ts`.
- **Callers:** `PatientPdfActions.tsx`, `PatientCard.tsx`, `ResultsView.tsx`, `AdminReviewDialog.tsx`, `EngagementAssignmentBoard.tsx`, `CanonicalRowActions.tsx`.
- **Invariants:** Clinician PDF **does not render ICD codes** (intentional). Plexus PDF renders them. Both require `reasoning` to contain `qualifying_factors`, `icd10_codes`, `clinician_understanding`, `patient_talking_points`. Multi-patient packets use print-preview (`openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`).
- **QA:** Manual; Batch 9 adds an optional baseline.

### 6. Engagement Center — board read + bulk assignment + conflict guard
- **UI entry:** `client/src/components/engagement/EngagementAssignmentBoard.tsx` (2,028 lines), `ChangeEngagementAssignmentDialog.tsx`.
- **Backend:** `server/routes/engagementAssignmentBoard.ts` — `findConflictingActiveAssignment` (lines 29–88), assign handler (lines 388–540).
- **QA:** `qa-engagement-assignment-runtime.mjs`.

### 7. Scheduler Portal — daily list + assignment diff
- **UI entry:** `client/src/pages/outreach.tsx`, `client/src/pages/outreach-scheduler-portal.tsx`.
- **Backend:** `server/repositories/schedulerAssignments.repo.ts` (`applySchedulerAssignmentDiff` transactional bulk release + create), `server/services/morningRebuildScheduler.ts`, `server/services/callListEngine.ts`, `server/services/callListPriority.ts`.
- **QA:** Manual; partial coverage via `qa-visit-outreach-tile-parity.mjs`.

### 8. Team Portals — Patient Care Specialist, Ancillary Care Specialist, Team Portal Shell, Portal Shell
- **UI entry:** `client/src/pages/team-member-portals.tsx`, `/patient-care-specialist-portal`, `/ancillary-care-specialist-portal`, `client/src/components/portal/TeamPortalShell.tsx`, `PortalShell.tsx`, `client/src/components/workflow/ClinicWorkflowPortal.tsx`.
- **Data API:** `client/src/lib/workflow/teamMemberWorkspaceApi.ts`, `client/src/lib/portal/commandCenterApi.ts`, `server/routes/patientPacket.ts`.
- **QA:** `qa-team-portals-restore.mjs`, `qa-team-portal-workspace-engine.mjs`.

### 9. Patient assignment
- **UI entry:** `EngagementAssignmentBoard.tsx`, `ChangeEngagementAssignmentDialog.tsx`.
- **Backend:** `server/routes/engagementAssignmentBoard.ts` (assign endpoint; conflict guard; journey events).
- **QA:** `qa-engagement-assignment-runtime.mjs`.

### 10. Report upload / document flows
- **UI entry:** `client/src/pages/document-library.tsx`, `client/src/pages/document-upload.tsx`.
- **Backend:** `server/routes/documentLibrary.ts` (incl. migration-on-read), `server/routes/documents.ts` (legacy `uploaded_documents` path), `server/services/blobStore.ts`, `server/integrations/fileStorage.ts` (S3/Drive abstraction).
- **QA:** Manual today.

### 11. Billing list, invoice creation, invoice payment, invoice email, projected invoices
- **UI entry:** `client/src/pages/billing.tsx`, `client/src/pages/invoices.tsx`.
- **Backend:** `server/routes/billing.ts` (auto-create scan on GET — known fragility), `server/routes/invoices.ts`, `server/repositories/invoices.repo.ts` (transactional payments).
- **QA:** Manual today. Batch 17 is design-first.

### 12. Background tasks (in-process; advisory-locked)
- `server/services/morningRebuildScheduler.ts`, `absenceWatcher.ts`, `invoiceReminderService.ts`, `syncService.ts`, `batchAnalysisRunner.ts`.
- **Risk:** Moving any of these to a worker without a recovery plan is unsafe. Batch 18 is design-only.

---

## "If you touch X, also re-run Y" matrix

| If you change | You must re-run |
| --- | --- |
| `client/src/lib/pdfGeneration.ts` or any direct caller | All 8 QA scripts + manual Clinician PDF + Plexus PDF + Engagement bulk PDF |
| `client/src/components/qualification/AdminReviewDialog.tsx` | All 8 QA scripts + full Admin Review manual flow + Clinician PDF + Plexus PDF |
| `server/services/patientCommitService.ts` | All 8 QA scripts + manual Plexus IQ import → commit |
| `server/routes/engagementAssignmentBoard.ts` | `qa-engagement-assignment-runtime.mjs` + manual conflict-guard test |
| `server/routes/plexusIqClinicalImport.ts` | `qa-plexus-iq-backend.mjs` + manual bulk-import end-to-end |
| `server/services/screening.ts` or `server/services/plexusIq/*` | `qa-plexus-iq-backend.mjs` + manual Admin Review regenerate / regenerate-all |
| `server/routes/billing.ts` or `invoices.ts` | All 8 QA scripts + manual billing list + invoice create + payment + email |
| `server/integrations/fileStorage.ts` or `s3FileStorage.ts` | Manual document upload + download |
| Any `data-testid` value referenced in `scripts/qa-*.mjs` | All 8 QA scripts (mandatory; a rename is a test failure) |

# Architecture Review — Canonical Patient Spine & Team Portals

**Branch:** `architecture/review-canonical-spine-team-portals`
**Date:** 2026-06-09
**Repository:** `tertiary-command-center-replit-sync-clean`
**Author:** Architecture review (Dr. Ali Imran, Noorhan Medical)
**Scope:** READ-ONLY review. No application code changed. This document is the only file added by this branch.

---

## 0. Branch summary

| Item | Value |
| --- | --- |
| Branch | `architecture/review-canonical-spine-team-portals` |
| Files modified | None |
| Files added | This file only (`docs/architecture/review-canonical-spine-2026-06-09.md`) |
| `npm run check` | PASS (clean tsc) |
| `npm run build` | PASS (client + server). Bundle warnings noted below. |
| QA scripts | All 8 PASS (navigation/dock/home tiles; command center; visit/outreach tile parity; Plexus IQ interior; Plexus IQ backend; team portals restore; team portal workspace engine; engagement assignment runtime) |
| Working flows protected | Yes — no behavior changes |

This review is **batch 0** in the safe-refactor plan in §11.

---

## 1. Executive summary

The repo is a working, end-to-end clinical screening / outreach / ancillary-procedure / billing platform with **42 backend route modules**, **38 client pages**, and **~38 domain tables** behind Drizzle ORM. The product flows (Plexus IQ → Admin Review → Engagement Center → Scheduler Portal → Team Portals → Billing → Invoices) all work, but they were built workflow-by-workflow rather than on a canonical patient spine. The result:

- **Patient identity is duplicated** across ~15 tables. Most operational tables carry `patientName`, `patientDob`, and `facility` directly as text columns alongside an FK to `patient_screenings`. There is no `patient_directory`, no `patient_identifiers` cross-system table, and no `facilities` master table.
- **A canonical spine has begun to emerge** under the names `patient_execution_cases`, `patient_journey_events`, `procedure_events`, and `global_schedule_events` — created by `patientCommitService.ts` as a **fire-and-forget side-effect** of `commitPatient`. This is the right direction, but it is not transactional, not always written, and not the source of truth for portals.
- **Routes contain meaningful business logic** (admin-review reasoning merge, billing auto-creation on GET, status transitions, spine creation orchestration). Services and repositories exist but the boundary is leaky.
- **The frontend has several monoliths**: `AdminReviewDialog.tsx` is **4,230 lines**, `TeamPortalShell.tsx` **2,693 lines**, `EngagementAssignmentBoard.tsx` **2,028 lines**, `PortalShell.tsx` **1,816 lines**, `PlexusIQWorkspace.tsx` **1,657 lines**. None are lazy-loaded, and they share business logic with `lib/pdfGeneration.ts` (904 lines) which is imported by 6+ unrelated features.
- **The build works** but ships a single ~1.7 MB JS bundle plus a 975 KB `html2pdf` chunk with no code-splitting.
- **No AWS deployment scaffolding** (no Dockerfile, no ECS/Fargate config, no SQS, no Secrets Manager wiring) — but the S3 client is already integrated via `STORAGE_PROVIDER=s3` and the file-storage layer is correctly abstracted.

The recommended first code change after this report is **Batch 1: docs + dependency map only**.

---

## 2. Current architecture map

### 2.1 Repo layout (top-level)

```
client/        React + Vite + wouter + @tanstack/react-query + Radix/shadcn
  src/
    App.tsx
    pages/         38 page components
    components/    flat + nested feature folders (qualification, portal, engagement, plexus-iq, outreach, billing, ...)
    features/      schedule, command-center
    hooks/         shared hooks; hooks/api/ has react-query wrappers
    lib/           pdfGeneration, queryClient, workflow APIs, calendar VMs, etc.
    calendar/
server/        Node 20 + Express 5 + Drizzle ORM (pg)
  index.ts        boot, sessions, validateEnv, lifecycle
  routes.ts       auth + audit-log + users (inline); registers route modules
  routes/         42 route modules (one per feature/domain)
  services/       business logic; includes services/plexusIq/* for admin-review rules
  repositories/   per-domain CRUD (~15 repos); transactions used in some
  storage.ts      legacy god-facade (538 lines) delegating to repos
  parsers/        AI / Excel / CSV / PDF / image parsers
  integrations/   fileStorage (google_drive | s3) + Google Drive client
  replit_integrations/  Claude chat, batch, image, audio
  middleware/     errorHandler, rateLimiter
  lib/            advisoryLock, validateEnv, ...
shared/        Drizzle table defs + shared types
  schema.ts      barrel
  schema/        per-domain files (screening, executionCase, billing, ...)
  models/        derived TS types
  clinicWorkflow.ts, plexus.ts, plexus-iq/, patientType.ts, ...
migrations/    27 SQL files (0000..0025; one duplicate 0010, 0018, 0021)
script/        dev/admin/seed/QA scripts (referenced by package.json)
scripts/       Node QA scripts (qa-*.mjs), shipped + runnable
docs/          PLEXUS_IQ_RECOVERY_BASELINE.md, clinic-workflow-spine.md, (this file)
storage/       local document blob root (storage/documents/)
```

### 2.2 Runtime topology

- **Single Node process.** `server/index.ts` boots Express, mounts sessions (PG-backed via `connect-pg-simple`), runs `validateEnv`, calls `registerRoutes`, then starts lifecycle tasks (`morningRebuildScheduler`, `absenceWatcher`, `invoiceReminderWatcher`, sync hooks).
- **Single Postgres pool** in `server/db.ts` (Drizzle + node-postgres, max 20, min 2, idle 30s, connect 3s).
- **Background work runs in-process.** Batch AI analysis (`batchAnalysisRunner.ts`) is a long-running JS task with internal concurrency cap; not a worker. Morning rebuild and absence watcher use Postgres advisory locks for HA-safety.
- **File storage is abstract.** `integrations/fileStorage.ts` picks `google_drive` (default) or `s3` via `STORAGE_PROVIDER`. S3 path uses `@aws-sdk/client-s3` + presigned URLs. Local FS is fallback (`storage/documents/...`) when not in production.
- **AI calls** go through `replit_integrations/chat/` (Claude). Used by `screenSinglePatientWithAI` and admin-review regeneration.

### 2.3 Domain tables (count + role)

`shared/schema/` contains **~38 domain tables** (+ `sessions`). Grouped:

| Category | Tables |
| --- | --- |
| Identity / intake | `users`, `patient_screenings`, `screening_batches`, `patient_test_history`, `patient_reference_data` |
| Case spine | `patient_execution_cases`, `patient_journey_events`, `procedure_events`, `global_schedule_events`, `ancillary_appointments` |
| Outreach | `outreach_calls`, `outreach_schedulers`, `scheduler_assignments` |
| Billing | `billing_records`, `invoices`, `invoice_line_items`, `invoice_payments`, `completed_billing_packages`, `projected_invoice_rows`, `cash_price_settings`, `billing_readiness_checks`, `billing_document_requests` |
| Documents | `documents`, `document_blobs`, `document_surface_assignments`, `uploaded_documents`, `marketing_materials`, `generated_notes`, `document_requirements`, `case_document_readiness`, `ancillary_document_templates` |
| Tasks | `plexus_projects`, `plexus_tasks`, `plexus_task_collaborators`, `plexus_task_messages`, `plexus_task_events`, `plexus_task_reads` |
| Insurance / regulatory | `insurance_eligibility_reviews`, `cooldown_records`, `scheduling_triage_cases` |
| Admin / async | `admin_settings`, `app_settings`, `audit_log`, `pto_requests`, `analysis_jobs`, `outbox_items` |

Full per-table FK and column detail is captured in §3 (gap analysis) and the schema files themselves.

### 2.4 Front-end map (high level)

- `App.tsx` registers **~34 wouter routes** eagerly (no `React.lazy`). Sidebar/guards applied per-route.
- `/components` is a mix of feature folders (`qualification/`, `portal/`, `engagement/`, `plexus-iq/`, `outreach/`, `billing/`, `workflow/`, `plexus/`, `patient/`) and root-level "shared" components (`PatientCard`, `ResultsView`, `EditableScreeningFormModal`, etc.).
- `client/src/lib/pdfGeneration.ts` (904 lines) is the **PDF rendering engine**. Used by `PatientPdfActions`, `PatientCard`, `ResultsView`, `AdminReviewDialog`, `EngagementAssignmentBoard`, `CanonicalRowActions`. This is the most cross-cut module in the front-end and the most fragile area to refactor.
- `client/src/lib/queryClient.ts` provides the React Query client with `staleTime: Infinity` default (mutation-driven invalidation everywhere).
- `client/src/hooks/api/keys.ts` (`qk`) is a centralized query-key factory — a clean foundation already.

---

## 3. Canonical spine — gap analysis

Target spine vs. current repo. Each row gives status (exists / partial / missing), what plays that role today, what's broken, and the migration risk (**do not act on these in this branch**).

### 3.1 `patient_directory` — **MISSING**
- **Today:** `patient_screenings` carries patient identity. Same person can appear N times (one row per batch / one row per import). Roster aggregation in `routes/patientDatabase.ts` GROUP BYs on `(lower(name), dob)` to fake a directory.
- **Recommended role:** Source of truth for patient identity, demographics, primary contact, insurance, facility linkage, soft-delete & merge tooling.
- **Migration risk: VERY HIGH.** Touches almost every table. Must be staged behind read-side helpers first; never rename `patient_screenings` until full migration is done.
- **Do not touch yet:** any `patient_screenings.name` / `dob` write path.

### 3.2 `patient_identifiers` — **MISSING**
- **Today:** `patient_screenings.notes` carries MRN as free-text stamped by `buildClinicalImportNotes` (`server/routes/plexusIqClinicalImport.ts` ~line 35). No PCC/eCW/TriZetto IDs anywhere.
- **Recommended role:** Cross-system identity (PCC ID, eCW ID, TriZetto subscriber, MRN, phone, email) with partial unique indexes.
- **Migration risk: HIGH.** Requires linker logic and dedupe during import.

### 3.3 `facilities` — **MISSING**
- **Today:** Facility identity is a **string** (`"NWPG - Spring"`, `"Taylor Family Practice"`, `"NWPG - Veterans"`) duplicated across 20+ tables. Allow-list lives in `shared/plexus.ts` and `shared/platformSettings.ts` as a hardcoded constant `VALID_FACILITIES`.
- **Recommended role:** Master table with id, display name, address, billing contact, EMR system, time-zone, active flag.
- **Migration risk: HIGH.** All filter routes accept facility as string today. A `facility_id` column added next to existing strings (dual-write) is the safe pattern.

### 3.4 `patient_screenings` (Plexus IQ episode) — **EXISTS, mis-scoped**
- **Today:** `shared/schema/screening.ts` lines 31-89. Carries identity (name/dob/phone/email/insurance/facility), qualification artefacts (qualifyingTests[], reasoning jsonb, cooldownTests), and workflow state (status, commitStatus, appointmentStatus, patientType, admin approval fields, soft-delete fields).
- **Problem:** Confuses *who the patient is* with *one Plexus IQ episode*. Should keep the episode semantics; identity should move to `patient_directory`.
- **Migration risk: VERY HIGH.** Anchor of most current code.

### 3.5 `clinical_qualification_results` — **PARTIAL**
- **Today:** Qualification verdicts live in `patient_screenings.qualifyingTests[]` + `patient_screenings.reasoning` (jsonb). Per-service status lives in `procedure_events`. No structured per-service "result with findings".
- **Recommended role:** One row per ancillary qualification verdict per patient, with confidence, qualifying factors, ICD-10 list, evidence pointers, AI vs. admin authorship.
- **Migration risk: MEDIUM.** Reasoning jsonb shape is informal; a real table needs a strict contract.

### 3.6 `qualification_factor_assignments` — **MISSING (the most useful new table)**
- **Today:** Supporting evidence (clicked "supporting buttons", ICD codes, qualifying diagnoses, medications, history evidence) is **only** stored as jsonb under `patient_screenings.reasoning[testName].qualifying_factors / icd10_codes` or `reasoning["adminReview:<ancillary>"]`.
- **Recommended role:** One row per (case, ancillary, factor) with kind (icd / med / history / symptom / prior_test), source (ai / admin / rule_engine), confidence, and timestamp. Unique per (case, ancillary, kind, value) to prevent dupes — exactly the "should prevent duplicates per target" constraint.
- **Migration risk: MEDIUM.** Can be additive without changing existing reasoning blob.

### 3.7 `patient_execution_cases` — **EXISTS**
- **Today:** `shared/schema/executionCase.ts` lines 29-52. Created by `patientCommitService.ts` via `createOrUpdateExecutionCaseFromScreening` on commit. Has FK to `patient_screenings`. Stores `engagementBucket` (visit / outreach / scheduling_triage), `qualificationStatus`, `lifecycleStatus`, `engagementStatus`, `assignedTeamMemberId` (no FK), `selectedServices[]`, `priorityScore`, `nextActionAt`.
- **Problem 1:** Created **fire-and-forget** off the commit (see `patientCommitService.ts` lines ~97-182). If creation fails, screening lives but case doesn't. No transaction across screening commit + spine writes.
- **Problem 2:** `assignedTeamMemberId` is an `int` with **no FK** to `users`.
- **Problem 3:** Identity (`patientName`, `patientDob`, `facilityId`) is **duplicated** here.
- **Migration risk: LOW for additive fixes (FK, transaction wrapper). HIGH if used for redesign without preserving current consumers** (Engagement Center board, team portal lists).

### 3.8 `team_tasks` — **PARTIAL**
- **Today:** `plexus_tasks` (`shared/schema/plexus.ts`) is a generic task system: project-based, hierarchical (parentTaskId), with type/urgency/priority/status/assignedTo, collaborators, messages, events, read-receipts. It is used for absence alerts and ad-hoc operational work. Outreach assignments live in `scheduler_assignments` (`shared/schema/outreach.ts` lines 75-115), which is a different model.
- **Problem:** Two parallel "task" models depending on domain. Engagement Center, Scheduler Portal, and Team Portals each compute their own task lists from execution cases + scheduler assignments + plexus tasks.
- **Recommended role:** Either keep `plexus_tasks` and standardize on it (giving each portal a typed view), or introduce a slim `team_tasks` that wraps execution-case actions.
- **Migration risk: MEDIUM.**

### 3.9 `patient_journey_events` — **EXISTS, partial coverage**
- **Today:** `shared/schema/executionCase.ts` lines 70-87. Append-only. Written explicitly in `patientCommitService.ts` (`screening_committed`, `execution_case_created/updated`), in `engagementAssignmentBoard.ts` on assignment, and in `outreach.ts` via `createOutreachCallAtomic`.
- **Problem:** Coverage is uneven. Admin-review approval, regenerate-all, ICD edits, billing status changes, invoice payments do **not** append journey events. Some writes are fire-and-forget; failures are silent.
- **Recommended role:** Canonical event timeline (one centralized writer with typed event kinds). Same table can serve.
- **Migration risk: LOW** (additive event writes won't break anything).

### 3.10 `documents / reports` — **EXISTS, fragmented**
- **Today:** Five+ tables: `documents` (+ `document_surface_assignments`), `document_blobs`, `uploaded_documents` (legacy Drive), `marketing_materials`, `generated_notes` (Plexus-generated structured notes with Drive link), `ancillary_document_templates`, `case_document_readiness`, `document_requirements`. `documentLibrary.ts` route has a **migration-on-read** that backfills `uploaded_documents` → `documents` on every `GET /api/documents-library`.
- **Migration risk: MEDIUM.** Once the storage abstraction (Batch 11) lands, consolidation is straightforward.

### 3.11 `billing_packets / claims / remittances / denials / invoices / revenue_share` — **PARTIAL**

| Target table | Today |
| --- | --- |
| billing_packets | `completed_billing_packages` (status machine: pending_payment → completed_package → added_to_invoice → invoiced → closed) |
| claims | **Missing.** `billing_records` carries denormalized charges + insurance response inline. |
| remittances | **Missing.** `billing_records.paidAmount/insurancePaidAmount/secondaryPaidAmount` are flat fields. |
| denials | **Missing.** No structured denial reasons or appeals. |
| invoices | `invoices` + `invoice_line_items` + `invoice_payments` (transactional in `invoices.repo.ts`). |
| revenue_share | `projected_invoice_rows.projectedOurPortionPercentage` (default 50%). |

**Risk:** Two parallel state machines (`completed_billing_packages.packageStatus` and `invoices.status`) with no DB-level alignment. A package can show `invoiced` while invoice is `Draft`.

### 3.12 Compact gap table

| Target table | Status | Current backing | Top risk |
| --- | --- | --- | --- |
| patient_directory | MISSING | `patient_screenings` (duplicating identity) | Touched by everything |
| patient_identifiers | MISSING | `patient_screenings.notes` (text MRN) | None — fully additive |
| facilities | MISSING | text strings + `VALID_FACILITIES` constant | All filters today use string |
| patient_screenings | EXISTS | `patient_screenings` | Anchor of current code |
| clinical_qualification_results | PARTIAL | `procedure_events` + `reasoning` jsonb | Reasoning schema needs lock-down |
| qualification_factor_assignments | MISSING | `reasoning.qualifying_factors / icd10_codes` jsonb | Cleanest table to add |
| patient_execution_cases | EXISTS | `patient_execution_cases` (fire-and-forget) | Non-transactional spine |
| team_tasks | PARTIAL | `plexus_tasks` + `scheduler_assignments` | Two parallel models |
| patient_journey_events | EXISTS | `patient_journey_events` (uneven coverage) | Some flows skip it |
| documents / reports | EXISTS | 8 tables + on-read migration | OK; consolidate later |
| billing_packets / claims / remittances / denials | PARTIAL | `billing_records` + `completed_billing_packages` | Two state machines |
| invoices | EXISTS | `invoices` + line items + payments | OK |
| revenue_share | EXISTS | `projected_invoice_rows` (50% default) | Conversion path manual |

---

## 4. Backend architecture findings

### 4.1 Routes containing business logic
- **`routes.ts`** keeps auth, audit-log, and user CRUD inline (lines 102-349). Should move to a dedicated `auth` module.
- **`routes/patients.ts`** is the heaviest route file. Admin-review regenerate endpoints contain non-trivial reasoning-merge logic inline (lines ~292-308, ~459-473, ~630-641). No service wrapper. No transactions.
- **`routes/billing.ts`** auto-creates missing billing records inside `GET /api/billing-records` (lines 67-111) — O(batches × patients × tests) on every read.
- **`routes/engagementAssignmentBoard.ts`** does conflict detection inline in `findConflictingActiveAssignment` (lines 29-88) using lowered-name joins against execution cases.
- **`routes/plexusIqClinicalImport.ts`** owns the entire import-and-batch lifecycle inline, including batch resolution, MRN stamping, scheduler auto-assignment, and post-import patient-count fix-up.

### 4.2 Services doing too much
- **`server/storage.ts`** — 538-line god-facade exposing **~305 methods** (`IStorage` interface). Each method delegates to a repo. This is currently the only safe edge for existing routes; it must not be removed in any near-term batch. New code should import repos directly.
- **`server/services/patientCommitService.ts`** — orchestrates **screening commit + execution case + global schedule + insurance eligibility + cooldown records + journey events + scheduler auto-assign** in one function, fire-and-forget, no transaction.
- **`server/services/screening.ts`** — owns AI qualification, qualification mode selection, PDF/Excel/image parsing fan-out.
- **`server/services/callListEngine.ts`** + **`callListPriority.ts`** — daily assignment build (priority ranking + greedy capacity allocation). Pure but not locked at the assignment-write layer.

### 4.3 Repository boundaries that exist
- Good: `invoices.repo.ts` (createWithLineItems, createPayment, deletePayment) — all in `db.transaction`.
- Good: `schedulerAssignments.repo.ts` (applySchedulerAssignmentDiff — transactional bulk release + create).
- Good: `documentLibrary.repo.ts` (transactional supersede with row lock).
- Good: `outreach.repo.ts` (createOutreachCallAtomic in transaction).
- Weak: `screening.repo.ts` (individual ops, no transactions for multi-write commit spine).
- Weak: `executionCase.repo.ts` (createOrUpdate is idempotent but not coordinated with the other spine writes).

### 4.4 Missing transaction boundaries
1. **Patient commit spine** (`patientCommitService.ts` lines ~97-182): screening update + execution case + global schedule + insurance eligibility + cooldown — **not in a transaction**. If any fails, others succeed silently.
2. **`PATCH /api/patients/:id` test-history auto-capture** (`routes/patients.ts` lines 140-166): screening update + test history insert + spine sync — three independent writes.
3. **Billing record auto-creation on GET** (`routes/billing.ts` lines 67-111): iterative inserts, no transaction; concurrent GETs could duplicate.
4. **Batch scheduler auto-assignment** (`routes/batches.ts` lines 52-74): not transactional with batch creation.

### 4.5 Patient identity creation paths (5 entry points, zero dedupe)
1. Manual entry — `POST /api/batches/:id/patients`
2. File import — `POST /api/batches/:id/import-file` (Excel/CSV/PDF/image with AI parsing)
3. Text paste — `POST /api/batches/:id/import-text`
4. Plexus IQ bulk clinical import — `POST /api/plexus-iq/clinical-import`
5. Test fixtures / seed scripts (`script/seed*.ts`)

**None** check existing patients by phone, MRN, or DOB before inserting a new `patient_screenings` row. MRN is stamped into `notes` text. Phone column has no unique index.

### 4.6 Audit / event writes
- `audit_log` is best-effort via `auditService.logAudit`. Called explicitly in some routes (batches create, patient update, patient delete, billing record CRUD, invoice CRUD) and missing in others (batch status updates, qualification regenerate, admin approval).
- `patient_journey_events` is the canonical timeline. Coverage is uneven (see §3.9).
- No central event bus, no event versioning, no replay capability.

### 4.7 Expensive / dangerous endpoints
- `GET /api/billing-records` — auto-create scan on every read. **High blast radius if patient count grows.**
- `GET /api/patients/database` — full roster aggregation with name+dob group, joins to test history, generated notes, cooldown. 30-second in-memory cache only.
- `GET /api/execution-cases` — appears to return all cases without filter.
- `GET /api/outreach/dashboard` — recomputed per request (no materialized view).
- `POST /api/scheduler-assignments/rebuild` — pulls all eligible patients for a facility/date and runs priority ranking in memory.

### 4.8 Background tasks (in-process)
- `morningRebuildScheduler` — daily 7 AM rebuild of scheduler assignments (advisory-locked).
- `absenceWatcher` — every 10 minutes during business hours; creates `absence_alert` plexus tasks; auto-executes redistribute after 30 minutes if untouched.
- `invoiceReminderService` — invoice follow-up.
- `syncService` — fire-and-forget Drive/Sheets exports.
- `batchAnalysisRunner` — long-running AI batch analyzer (in-process; concurrency cap from env).

### 4.9 AWS / S3 usage today
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` are in `package.json`.
- `server/integrations/s3FileStorage.ts` implements the storage interface; `server/integrations/fileStorage.ts` picks provider via `STORAGE_PROVIDER` env (`google_drive` default, `s3` for prod). 24h presigned URL TTL.
- `server/lib/validateEnv.ts` enforces S3 in production unless explicitly allowed.
- No Dockerfile, no ECS task definitions, no Secrets Manager wiring, no SQS, no CloudWatch hooks today.

---

## 5. Frontend architecture findings

### 5.1 Component size (the biggest fragility)

| File | Lines | What's mixed |
| --- | --- | --- |
| `components/qualification/AdminReviewDialog.tsx` | **4,230** | data fetch, tabs, reasoning UI, supporting buttons, ICD chips, per-ancillary regen, sibling navigation with auto-advance, PDF preview, admin approval, in-memory audit log |
| `components/portal/TeamPortalShell.tsx` | **2,693** | multi-tab shell, role-specific customization, patient/schedule/tasks/docs tabs |
| `components/engagement/EngagementAssignmentBoard.tsx` | **2,028** | board read, conflict-guarded bulk assignment, grouping (none/date/facility/scheduler), per-row PDF actions |
| `components/portal/PortalShell.tsx` | **1,816** | tab implementations (patient, schedule, consent, PDFs, signature pad, tasks) |
| `components/plexus-iq/PlexusIQWorkspace.tsx` | **1,657** | calendar + sidebar + add patient + bulk import + qualification jobs status |
| `pages/team-ops.tsx` | **1,455** | facility, team, schedule, bulk ops |
| `pages/billing.tsx` | **1,333** | billing records, facility filters, Sheets integration |
| `pages/invoices.tsx` | **1,151** | invoice aging, detail, PDF |
| `pages/settings.tsx` | **1,122** | admin user management |
| `pages/outreach-scheduler-portal.tsx` | **993** | dual-patient model (legacy callList + canonicalCases) |
| `pages/plexus-tasks.tsx` | **967** | task board |
| `components/plexus-iq/PlexusIQBulkImportModal.tsx` | **940** | CSV bulk import UX |
| `pages/plexus-iq.tsx` | **891** | top-level Plexus IQ page |
| `lib/pdfGeneration.ts` | **904** | clinician + plexus PDF rendering for **the entire app** |

Together these ~13 files are ~20,000+ lines — half the front-end's complexity.

### 5.2 No code-splitting / lazy loading
- Every route in `App.tsx` is statically imported. The build emits **`assets/index-*.js` 1,713 kB** + **`assets/html2pdf-*.js` 975 kB** (warning: "Some chunks are larger than 500 kB after minification").
- This is the single largest performance win available without changing behavior.

### 5.3 Cross-feature coupling
- `lib/pdfGeneration.ts` is imported by: `qualification/PatientPdfActions`, root `PatientCard`, root `ResultsView`, `qualification/AdminReviewDialog`, `engagement/EngagementAssignmentBoard`, `outreach/CanonicalRowActions`. Any change to the PDF API touches 6 components.
- `qualification/AdminReviewDialog` imports from `features/schedule`, `lib/pdfGeneration`, `lib/adminReviewStatus`, `shared/plexus-iq` — high fan-in.
- Root-level components (`PatientCard`, `ResultsView`) act as both feature components and shared library. This is the natural place a future `features/patient-card/` module emerges.

### 5.4 What's already clean
- React Query is consistently used; query keys are centralized in `hooks/api/keys.ts` (`qk`).
- `lib/queryClient.ts` is the single source for the client.
- `apiRequest(method, url, data)` is the canonical fetch wrapper.
- `client/src/hooks/api/` already separates 11 API hooks by domain — good foundation for batch 4.

### 5.5 Test-id surface area
- AdminReviewDialog has **30+** `data-testid` attributes (per-ancillary regenerate buttons, panel toggles, approval buttons, PDF actions, tab triggers).
- QA scripts (`scripts/qa-*.mjs`) depend on these test-ids. Any rename without QA-script update will appear as a behavioral regression. **Preserve all existing test-ids in any refactor batch.**

---

## 6. Flow-wiring review

### 6.1 Plexus IQ import → patient screening → AI qualification → spine

Trigger: "Confirm Import" in `PlexusIQBulkImportModal.tsx`.

```
client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx (UI; ~940 lines)
  → client/src/lib/plexusIqClinicalImportParser.ts (~779; parses tab/comma-delimited clinical paste)
  → client/src/lib/plexusIqClinicalImportApi.ts (POST /api/plexus-iq/clinical-import)
  → server/routes/plexusIqClinicalImport.ts
       resolveBatchForGroup (lines 130-148; looks up batch by facility+scheduleDate; creates if missing)
       bulk db.insert(patientScreenings) per group (line ~339)
       buildClinicalImportNotes (lines 35-65; embeds [plexus-iq-clinical-import] header + rowIndex + MRN)
       batch.patientCount update (NOT in same tx)
  → POST /api/plexus-iq/qualification-jobs → startBatchAnalysis(batchId)
  → server/services/batchAnalysisRunner.ts (background loop, concurrency cap, calls screenSinglePatientWithAI)
  → server/services/screening.ts (Claude prompt; returns qualifyingTests + reasoning)
  → server/services/patientCommitService.ts commitPatient({auto: true})
       (1) update patient_screenings.commitStatus → Ready
       (2) fire-and-forget: createOrUpdateExecutionCaseFromScreening
       (3) fire-and-forget: createGlobalScheduleEventFromScreeningCommit
       (4) fire-and-forget: createOrUpdateInsuranceEligibilityReviewFromScreening
       (5) fire-and-forget: createOrUpdateCooldownRecordsFromScreening
       (6) appendPatientJourneyEvent: screening_committed, execution_case_created/updated
       (7) scheduler auto-assign attempt
```

**Identity creation:** step (above) — no MRN/phone/DOB dedupe.
**Patient Directory:** bypassed (not present).
**Facility / date grouping:** done client-side in parser + server-side in `resolveBatchForGroup`.

### 6.2 Qualification / Admin Review

Where AI qualification runs: `server/services/screening.ts → screenSinglePatientWithAI` (Claude). Modes: permissive / standard / conservative (mode pulled from `adminSettings` per facility).
Where reasoning is stored: `patient_screenings.reasoning` (jsonb keyed by test name). Admin overrides additionally write `reasoning["adminReview:<ancillary>"]`.
Supporting factors / buttons: stored only inside `reasoning[testName].qualifying_factors` and `reasoning[testName].icd10_codes` (jsonb, no schema).
Admin approval: `patient_screenings.adminApprovalStatus` + `adminApprovedAt` + `adminApprovedByUserId`.
Regenerate endpoints (all under `/api/patient-screenings/:id/admin-review/`):
- `evidence` — runs `runAdminReviewRuleEngine` (deterministic, no AI).
- `regenerate` — single-ancillary regen; stores under `reasoning["adminReview:<ancillary>"]`.
- `regenerate-all` — full patient regen; can also update diagnoses, meds, history, ICD codes.
- `regenerate-ancillary` — per-ancillary regen only, preserves other ancillaries verbatim.

**Could break Clinician PDF / Plexus PDF:** anything that reshapes `patient.reasoning` keys/values, anything that strips `icd10_codes`, anything that loses `clinician_understanding` / `patient_talking_points` / `qualifying_factors`. The Clinician PDF intentionally does **not** render ICD codes (`lib/pdfGeneration.ts` line ~403-409 source marker) but they must remain in the reasoning blob for Admin Review and downstream coding (memory: `feedback_pdf_icd_codes`).

### 6.3 Clinician packets / PDF

UI: `PatientPdfActions`, `PatientCard`, `ResultsView`, `AdminReviewDialog`, `EngagementAssignmentBoard`, `CanonicalRowActions`.
Engine: `client/src/lib/pdfGeneration.ts` (904 lines) + `client/src/lib/pdfPacketGrouping.ts` (235 lines; `splitPatientsByFacilityDate`, `validateSameFacilityDatePacket`, `isPatientPdfEligible`).
Source of truth: client-side `PatientScreening` object (qualifyingTests, reasoning, demographics, insurance, facility, scheduleDate). No API call — PDFs are read-only client renders.
PDF print-preview path: `openPatientPacketPrintPreview` / `openSchedulerPacketPrintPreview` — used for multi-patient packets to avoid html2canvas freezes (referenced in commits 4dd40df, f0c9e90, 449580e, 88c5467).
Document generation/upload happens elsewhere (`generated_notes`, `documentLibrary`); PDFs in this flow are not stored.

**Files to protect (do-not-touch — see §10):**
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/components/qualification/PatientPdfActions.tsx`
- Any call site of `generatePlexusPDF`, `generateClinicianPDF`, `openPatientPacketPrintPreview`, `openSchedulerPacketPrintPreview`.

### 6.4 Engagement Center

Board read: `GET /api/engagement/assignment-board` (`server/routes/engagementAssignmentBoard.ts` lines 165-227) — joins `patient_execution_cases` + `patient_screenings` + `screening_batches` + `outreach_schedulers`; computes `missingInfo[]`.
Powered by: `patient_execution_cases` (the spine table).
Assignment: `POST /api/engagement/assignment-board/assign` (lines 388-540). Conflict guard: `findConflictingActiveAssignment` lines 29-88 (rejects assignment if same person+DOB has an active case on the same scheduleDate assigned to a different scheduler; outreach patients with null scheduleDate are exempt).
Cancel/unassign: same endpoint with empty target; journey event `assignment_made` / `assignment_changed` appended.
Journey events: yes, but conflict-guard failures are not journaled.
Bulk: client groups rows by date/facility/scheduler and POSTs a `patientScreeningIds[]` payload. Conflict guard runs per id; partial success is possible. No row-level lock.

### 6.5 Scheduler portal / team portals

Scheduler portal entry: `/scheduler-portal` (`pages/outreach.tsx`, 283) and `/outreach/scheduler/:id` (`pages/outreach-scheduler-portal.tsx`, 993).
Team Member Portals landing: `/team-member-portals` (`pages/team-member-portals.tsx`, 105) — card grid linking to:
- `/patient-care-specialist-portal` (17-line wrapper)
- `/ancillary-care-specialist-portal` (14-line wrapper)
- `/engagement-center`

Both portal wrappers render `components/workflow/ClinicWorkflowPortal.tsx` (76 lines), which wraps `PortalShell` / `TeamPortalShell`.
Data source: read from execution cases + global schedule + plexus tasks via `lib/workflow/teamMemberWorkspaceApi.ts`, `lib/portal/commandCenterApi.ts`. Patient data via `/api/patient-packet` (multi-lookup endpoint: executionCaseId, patientScreeningId, or name+DOB).
Patient appears in a team portal when `patient_execution_cases.assignedTeamMemberId == user.id`. **Not direct patient rows** — read from execution cases.
Status updates: portals patch execution case fields (`engagementStatus`, `lifecycleStatus`), procedure events, ancillary appointments. Outreach calls go via `POST /api/outreach/calls` which atomically updates `patient_screenings.appointmentStatus` (denormalized).
How completed work moves downstream: outreach call outcome → appointment status denormalization → engagement bucket changes → procedure events for ancillaries → billing readiness checks → billing record creation → invoices.

### 6.6 Reports / documents

Upload paths (two):
1. **Admin document library** — `pages/document-library.tsx` → `POST /api/documents-library` (multer) → `storage.createDocument` → blob save → outbox enqueue (Drive sync).
2. **Patient document upload** — `pages/document-upload.tsx` → `POST /api/documents/upload` + `POST /api/documents/ocr-name` (Google Drive legacy path; stores `uploaded_documents` rows).

Migration on read: `GET /api/documents-library` runs `migrateLegacyUploadedDocuments` (lines 86-145 of `routes/documentLibrary.ts`) which backfills legacy → `documents` with `sourceNotes = legacy_uploaded_document_id=<id>` dedupe marker. Idempotent. Race possible (two concurrent GETs both attempt migration; `onConflictDoNothing` prevents double-insert).
Storage: `server/services/blobStore.ts` writes to `storage/documents/<ownerType>/<sha256[0..2]>/<sha256[2..16]>_<safeName>`; production requires S3. Provider switch in `integrations/fileStorage.ts`.
Reports: post-procedure reports flow through the same `documents` library plus `case_document_readiness` table (`documentReadiness.ts` schema) — each case tracks per-document readiness with status: missing / pending / uploaded / generated / approved / completed / blocked.
Document → patient linkage: FK `documents.patientScreeningId`, plus free-text `documents.facility`. No FK to `patient_execution_cases`. `case_document_readiness` has FKs to both screening and execution case — better.

### 6.7 Billing / invoice

Billing record auto-create on GET (`routes/billing.ts` lines 67-111): for every completed patient with qualifying tests, insert missing `billing_records` row. O(batches × patients × tests). No transaction.
Invoice creation: `POST /api/invoices` filters billing records by facility + date range, computes line items inline, calls `storage.createInvoiceWithLineItems` (transactional). No billing-readiness gate is enforced (despite `billing_readiness_checks` existing).
Invoice payment: `POST /api/invoices/:id/payments` — transactional (`invoices.repo.ts` lines 86-122). Recomputes invoice totals and updates status.
Invoice email: `POST /api/invoices/:id/send-email` — 14 MB base64 PDF cap; on success marks invoice Sent (not idempotent if DB update fails).
Projected invoices: `projected_invoice_rows` with 50% default revenue share; conversion to real invoice line items happens via `realInvoiceLineItemId` FK — **no specific route found** that drives the conversion.
Completed billing packages: parallel state machine (`packageStatus`: pending_payment → ... → closed) with no DB-level alignment to `invoices.status`.

---

## 7. Enterprise architecture issues (current-state report)

| Concern | Current state | Risk |
| --- | --- | --- |
| **Modularity (backend)** | Routes/services/repos exist but storage.ts is a 538-line god-facade with ~305 methods. Routes still embed business logic for admin-review and billing auto-create. | MEDIUM |
| **Modularity (frontend)** | 13 components > 800 lines; `pdfGeneration.ts` is a shared module imported by 6+ unrelated features. | HIGH |
| **Database design** | No facilities master, no patient directory, no patient identifiers. Identity scattered (name, DOB) in ~15 tables. JSONB reasoning blob is unschematized. | HIGH |
| **Performance** | `GET /api/billing-records` does O(n³); roster aggregation runs per request with 30 s in-mem cache; engagement board reads all active cases without pagination; some endpoints lack any pagination. | HIGH (long-term) |
| **API boundaries** | Auth + audit-log + user CRUD live in `routes.ts`. `/api/patient-packet` has three aliases. Routes mutate status without service layer in places. | MEDIUM |
| **Frontend bundle** | Single ~1.7 MB JS chunk + 975 KB html2pdf; no React.lazy; build warning emitted. | HIGH |
| **Role-based access** | `requireAuth` / `requireAdmin` / `requireRole(roles)` / `requireBillerOrAdmin` exist. Portal-clinic scoping is via `outreach_schedulers.userId` (lines 69-76 of `portal.ts`). Some routes lack explicit guards. | MEDIUM |
| **Audit trail** | `audit_log` is best-effort, fire-and-forget. Coverage uneven. Journey events more reliable but also uneven. | MEDIUM |
| **Event logging** | No central event bus; no replay. | MEDIUM |
| **Background jobs** | All in-process: `morningRebuildScheduler`, `absenceWatcher`, `invoiceReminderWatcher`, `syncService`, `batchAnalysisRunner`. Advisory locks used in two of them. No retries, no DLQ. | MEDIUM (worker pattern needed before scale) |
| **S3 / file storage** | `STORAGE_PROVIDER` switch is correct, `s3FileStorage.ts` ready. Local FS fallback exists. Migration from Drive → S3 not yet executed. | LOW |
| **RDS / Postgres readiness** | Drizzle + node-postgres pool (max 20). Migrations are plain SQL (`migrations/0000..0025.sql`). Two duplicate numbered files (`0010_central_document_library.sql` + `0010_patient_lookup_indexes.sql`; `0018_*` and `0021_*` similar) — works because filenames are distinct but is a footgun. | MEDIUM |
| **AWS deployment** | No Dockerfile, no ECS/Fargate task def, no SSM/Secrets Manager wiring, no SQS, no CloudWatch. `DEPLOY_AWS.md` documents the target. `.replit` present. | LOW (deferred) |
| **Observability / logging** | Console logging only. No structured logs, no request IDs, no metrics. | MEDIUM |
| **Test coverage / QA** | 8 working QA scripts (`scripts/qa-*.mjs`), ~30 `script/test*.ts` runners (package.json scripts). No automated test runner (Jest/Vitest) configured. | MEDIUM |

---

## 8. Recommended target architecture (proposal, do not implement here)

### 8.1 Backend (target)

```
server/
  platform/
    db/           pool, transaction helpers, advisory locks
    auth/         session, login, role guards, audit-aware request
    logger/       structured logging (pino) + request-id middleware
    storage/      fileStorage interface (s3 prod, local dev)
    queue/        outbox + future SQS worker dispatch
    config/       env validation, settings loader
    audit/        centralized audit + journey event writer
  modules/
    patient-directory/        routes.ts service.ts repo.ts contracts.ts patientMatcher.ts
    facilities/               routes.ts service.ts repo.ts contracts.ts
    plexus-iq/                routes.ts service.ts repo.ts contracts.ts importParser.ts
    qualification/            routes.ts service.ts repo.ts contracts.ts factorAssignmentRules.ts
    admin-review/             routes.ts service.ts repo.ts contracts.ts
    execution-cases/          routes.ts service.ts repo.ts contracts.ts stateMachine.ts
    engagement-center/        routes.ts service.ts repo.ts contracts.ts
    scheduler/                routes.ts service.ts repo.ts contracts.ts
    team-tasks/               routes.ts service.ts repo.ts contracts.ts
    documents/                routes.ts service.ts repo.ts contracts.ts
    reports/                  routes.ts service.ts repo.ts contracts.ts
    billing/                  routes.ts service.ts repo.ts contracts.ts
    invoicing/                routes.ts service.ts repo.ts contracts.ts
```

**Notes:**
- `storage.ts` god-facade stays in place during migration and is gradually emptied by per-module repo direct imports.
- `contracts.ts` per module is the **only** path crossing module boundaries. Types in `shared/` continue to exist for cross-tier schemas (Drizzle tables + Zod inputs).
- State machines (execution case lifecycle, billing package status, invoice status, scheduler assignment status) get explicit transition functions inside `stateMachine.ts` per module.

### 8.2 Frontend (target)

```
client/src/
  app/
    router.tsx       wouter routes (lazy-loaded)
    providers.tsx    QueryClientProvider + tooltips + toasts
    authGuard.tsx
  shared/
    api/             apiRequest, queryKeys, fetch wrappers
    ui/              shadcn primitives, layout
    hooks/           use-toast, use-mobile, generic data hooks
    types/           re-exports of shared/ schemas
    layout/          GlobalNav, TopBanner, GlobalFloatingDock, SidebarProvider
  features/
    patient-directory/
    plexus-iq/
    admin-review/        AdminReviewDialog broken up (ApprovalPanel, EvidencePanel, ClinicalEditor, AuditLog, SiblingNav)
    engagement-center/   EngagementAssignmentBoard split into RowList, BulkAssign, ConflictGuard
    scheduler-portal/
    team-portals/        TeamPortalShell composed from tabs; each tab a module
    testing-portal/
    reports-portal/
    billing-portal/
    invoice-portal/
```

- `lib/pdfGeneration.ts` moves to `shared/pdf/` and exposes a stable, narrow API. Print-preview side effects move out of pure render functions.

---

## 9. Safe refactor batches

Each batch lists goal, files likely touched, risk, why it should not break UI, behavior that must remain identical, validation commands, manual regression checklist, and rollback notes.

### Batch 0 — Review report (THIS BRANCH)
- **Goal:** Architecture report only.
- **Files:** `docs/architecture/review-canonical-spine-2026-06-09.md` only.
- **Risk:** None.
- **Behavior to preserve:** Everything — no code touched.
- **Validation:** `npm run check`, `npm run build`, all 8 `scripts/qa-*.mjs`.
- **Manual regression:** None required.
- **Rollback:** Delete file or `git checkout main -- .`.

### Batch 1 — Architecture docs + dependency map
- **Goal:** Add `docs/architecture/` index, module-dependency graph (`madge`-like manual map), do-not-touch list (§10), and the safe-batch plan as a living document.
- **Files:** `docs/architecture/*.md` only.
- **Risk:** None.
- **Behavior to preserve:** All.
- **Validation:** `npm run check`, `npm run build`.
- **Rollback:** Delete docs.

### Batch 2 — Shared contracts / types extraction only
- **Goal:** Pull stable contracts (e.g., reasoning blob shape, admin review status union, engagement board row type, journey event kinds) into `shared/contracts/` where they are not in any code path that mutates behavior.
- **Files:** `shared/contracts/*.ts` (new), and **only** consumers that already import the same shape from inline definitions can be updated to import from `shared/contracts/`.
- **Risk:** LOW. Pure type moves.
- **Behavior to preserve:** Runtime identical (types only).
- **Validation:** `npm run check` (must remain clean), `npm run build`, all QA scripts.
- **Manual regression:** None.
- **Rollback:** Revert imports + delete `shared/contracts/`.

### Batch 3 — Backend service wrappers around existing route logic
- **Goal:** Wrap the inline business logic in `routes/patients.ts` admin-review endpoints and `routes/billing.ts` auto-create scan in **services that call the same code**, without changing request/response shapes or DB writes.
- **Files:** `server/services/adminReviewService.ts` (new), `server/services/billingAutoCreateService.ts` (new), small edits to two route files to delegate.
- **Risk:** MEDIUM. Touches code paths with no automated tests.
- **Behavior to preserve:** Identical responses for `evidence`, `regenerate`, `regenerate-all`, `regenerate-ancillary`, and `GET /api/billing-records`.
- **Validation:** `npm run check`, `npm run build`, all QA scripts, plus manual: load Admin Review, regenerate one ancillary, regenerate all, approve a patient, hit billing page.
- **Manual regression:** Plexus IQ (sanity), Clinician PDF + Plexus PDF (must be identical), Engagement Center board (unchanged), billing list (unchanged).
- **Rollback:** Inline the service back into the route.

### Batch 4 — Frontend hooks extraction
- **Goal:** Pull data fetches out of `AdminReviewDialog`, `EngagementAssignmentBoard`, and `PortalShell` into custom hooks under `hooks/api/` or feature-local hook files. **No JSX changes, no test-id changes, no UI behavior changes.**
- **Files:** New `hooks/api/admin-review.ts`, `hooks/api/engagement-board.ts`, `hooks/api/portal-shell.ts`; small import edits in the three components.
- **Risk:** MEDIUM.
- **Behavior to preserve:** Test-ids, markup, modal sequencing, sibling navigation, conflict-guard behavior, bulk assignment behavior, PDF preview triggers.
- **Validation:** `npm run check`, `npm run build`, all QA scripts; click-through of Admin Review with regenerate buttons, sibling Next/Prev, approve.
- **Rollback:** Revert hook imports.

### Batch 5 — Patient Directory preparation (read-side only)
- **Goal:** Add `server/modules/patient-directory/` with **read-only** helpers that compute a canonical view from `patient_screenings` (group by lower(name)+dob+facility). Add `getCanonicalPatientId(screeningId)` helper. Do **not** create a new table. Do **not** migrate any data.
- **Files:** `server/modules/patient-directory/{contracts,repo,service}.ts`, used only by new internal helpers.
- **Risk:** LOW. No new DB objects.
- **Behavior to preserve:** All UI flows unchanged.
- **Validation:** `npm run check`, `npm run build`, QA scripts.
- **Rollback:** Delete module.

### Batch 6 — Execution case / team task spine preparation
- **Goal:** Add `server/modules/execution-cases/stateMachine.ts` with named transitions covering today's enums (`lifecycleStatus`, `engagementStatus`). Wrap (do not replace) the existing direct status writes in a typed function. Map current `plexus_tasks` types + `scheduler_assignments` rows to a unified `TeamTask` view (read-only).
- **Files:** new module files; **no** UI changes.
- **Risk:** LOW.
- **Behavior to preserve:** Existing status writes still work; new writer is opt-in.
- **Validation:** `npm run check`, build, QA.
- **Rollback:** Remove new module.

### Batch 7 — Journey event standardization
- **Goal:** Add `server/platform/audit/journeyEventWriter.ts` with typed event kinds. Add missing journey events (`admin_review_regenerated`, `admin_review_approved`, `admin_review_rejected`, `regenerate_all`, `billing_record_status_changed`, `invoice_payment_recorded`). **Preserve existing events; new events are additive only.**
- **Files:** new writer + augmentations to 3-5 routes/services.
- **Risk:** LOW (additive).
- **Behavior to preserve:** Existing events identical.
- **Validation:** check/build/QA.
- **Manual regression:** Admin Review regenerate + approve; confirm new journey events appear (or just confirm UI unchanged).
- **Rollback:** Disable the writer with a feature gate.

### Batch 8 — Engagement Center read-model optimization
- **Goal:** Add a paginated/filtered `GET /api/engagement/assignment-board?page=...&facility=...` alongside today's endpoint. UI keeps the old endpoint until safety tests exist for the new one.
- **Files:** new route + service; **no UI changes**.
- **Risk:** LOW (additive endpoint).
- **Validation:** check/build/QA.
- **Rollback:** Remove new endpoint.

### Batch 9 — Plexus IQ read-model optimization
- **Goal:** Replace per-batch all-row scans (e.g., the recomputed dashboard) with aggregate endpoints. Keep existing endpoints alive.
- **Files:** server routes/services only.
- **Risk:** LOW (additive).
- **Validation:** check/build/QA.
- **Rollback:** Remove new endpoints.

### Batch 10 — Admin Review modularization
- **Goal:** Split `AdminReviewDialog.tsx` into ApprovalPanel, EvidencePanel, ClinicalEditor, ReasoningEditor, SiblingNav, AuditLog. **Preserve** all test-ids, the four regenerate endpoints, sibling Next/Prev navigation, PDF preview, and the "Updates Made In Patient" change log.
- **Files:** `components/qualification/AdminReviewDialog.tsx` + new sub-files in `components/qualification/admin-review/`.
- **Risk:** HIGH. This is the riskiest UI batch; ship only after Batches 2, 3, 4, 7 and a manual QA pass.
- **Validation:** check/build/QA + full manual regression of Plexus IQ, Admin Review, Clinician PDF, Plexus PDF, Engagement Center (because PDF helpers are shared).
- **Rollback:** Keep the original `AdminReviewDialog.tsx` on a branch tag; revert to it if regression appears.

### Batch 11 — S3 / storage abstraction
- **Goal:** Make `STORAGE_PROVIDER=s3` the production default, document the cutover, add a one-shot script to migrate `uploaded_documents.driveFileId` to S3 keys with `sourceNotes` provenance. **Do not** delete Drive data.
- **Files:** small edits to `validateEnv.ts`, `integrations/fileStorage.ts`; new script under `script/`.
- **Risk:** LOW for the abstraction; MEDIUM for cutover.
- **Validation:** check/build/QA; manual upload/download test.
- **Rollback:** Set `STORAGE_PROVIDER=google_drive`.

### Batch 12 — Worker / job architecture
- **Goal:** Add `platform/queue/` with an in-process worker that pulls from a typed queue (today: `outbox_items`; tomorrow: SQS). **No production job moves** until automated tests cover it.
- **Files:** new module; no existing routes/services modified.
- **Risk:** LOW.
- **Validation:** check/build/QA.
- **Rollback:** Disable worker.

### Batch 13 — AWS deployment readiness
- **Goal:** Add Dockerfile, ECS Fargate task definition (or EC2 plan), RDS, S3, Secrets Manager, SQS, CloudWatch hooks. No application behavior changes.
- **Files:** `Dockerfile`, `.dockerignore`, `infra/` folder, `DEPLOY_AWS.md` updates.
- **Risk:** LOW for the app; MEDIUM for ops.
- **Validation:** check/build/QA.

---

## 10. Do-not-touch list (until safety tests exist)

Anything that handles patient identity, qualification reasoning, PDF rendering, admin approval, or engagement assignment should not be moved or renamed in any batch before Batch 4 + dedicated regression coverage. Specifically:

**Frontend:**
- `client/src/components/qualification/AdminReviewDialog.tsx` (4,230 lines; sibling nav and PDF preview are subtle)
- `client/src/components/qualification/PatientPdfActions.tsx`
- `client/src/components/qualification/AdminApprovalControl.tsx`
- `client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx`
- `client/src/lib/pdfGeneration.ts`
- `client/src/lib/pdfPacketGrouping.ts`
- `client/src/components/engagement/EngagementAssignmentBoard.tsx`
- `client/src/components/portal/TeamPortalShell.tsx`, `PortalShell.tsx`
- `client/src/components/plexus-iq/PlexusIQWorkspace.tsx`, `PlexusIQBulkImportModal.tsx`, `PlexusIQQualificationJobsStatus.tsx`
- `client/src/components/outreach/CanonicalRowActions.tsx` (PDF entry from outreach)
- `client/src/components/PatientCard.tsx`, `ResultsView.tsx`, `EditableScreeningFormModal.tsx` (PDF + reasoning consumers)
- All `data-testid` attributes referenced by `scripts/qa-*.mjs`.

**Backend:**
- `server/routes/plexusIqClinicalImport.ts` (bulk import pipeline)
- `server/routes/patients.ts` admin-review endpoints (`/evidence`, `/regenerate`, `/regenerate-all`, `/regenerate-ancillary`)
- `server/services/screening.ts` (AI qualification)
- `server/services/patientCommitService.ts` (commit + spine creation; fragile, do not move yet)
- `server/services/batchAnalysisRunner.ts`
- `server/services/plexusIq/*` (admin review rule engine, ai regeneration, ICD search)
- `server/routes/engagementAssignmentBoard.ts` (conflict guard logic)
- `server/services/callListEngine.ts`, `callListPriority.ts`, `morningRebuildScheduler.ts`, `absenceWatcher.ts` (advisory-locked daily flow)
- `server/routes/billing.ts` auto-creation on GET (the O(n³) scan is a known fragility — quarantine via a new route in Batch 9; do not edit the original until then)
- `server/routes/invoices.ts` payment flow
- `server/routes/patientPacket.ts` (powers all team portal patient views and PDF source)
- `server/storage.ts` (god-facade — do not shrink it before consumers are migrated)

**Shared:**
- `shared/schema/screening.ts`, `shared/schema/executionCase.ts`, `shared/schema/procedureEvents.ts`, `shared/schema/globalSchedule.ts`, `shared/schema/billing.ts`, `shared/schema/invoices.ts`, `shared/schema/documents.ts` — column additions are OK (Batch 5+); renames / drops are not.
- `shared/clinicWorkflow.ts`, `shared/plexus.ts`, `shared/plexus-iq/*` — hardcoded clinical config; changes here ripple into reasoning and PDFs.

**DB migrations:**
- `migrations/0000..0025` — there are duplicate-numbered files (`0010_central_document_library.sql` vs `0010_patient_lookup_indexes.sql`; same for `0018_*` and `0021_*`). Do not renumber. New migrations should start at `0026_*`.

---

## 11. First safe code-change batch (recommendation only — do not implement here)

**Batch 1 — Architecture docs + dependency map only.**

Why this and not Batch 2 (types extraction):
- The biggest immediate risk is that future contributors will inadvertently start refactoring inside the do-not-touch list. A `docs/architecture/` folder with the dependency map, the do-not-touch list, and the safe-batch plan turns this report into a living guard.
- Zero runtime change. Cannot break `npm run check`, `npm run build`, or any QA script.
- Cheap to land. Sets up the next 12 batches with shared vocabulary.

Concrete plan for Batch 1 (not part of this branch):
1. Add `docs/architecture/README.md` (index).
2. Add `docs/architecture/module-dependency-map.md` (manual edge list — pdfGeneration, AdminReviewDialog, EngagementAssignmentBoard, patientCommitService, screening, billing, invoices).
3. Add `docs/architecture/do-not-touch.md` (copy of §10).
4. Add `docs/architecture/safe-batches.md` (copy of §9).
5. No source-code changes.

---

## 12. Validation log (this branch)

| Check | Result |
| --- | --- |
| `npm run check` | PASS (clean tsc; no errors) |
| `npm run build` | PASS (client build emits "chunks larger than 500 kB" warning — pre-existing, see §5.2; server `dist/index.cjs` 3.4 MB) |
| `scripts/qa-navigation-dock-home-tiles.mjs` | PASS |
| `scripts/qa-command-center-architecture.mjs` | PASS |
| `scripts/qa-visit-outreach-tile-parity.mjs` | PASS |
| `scripts/qa-plexus-iq-interior.mjs` | PASS |
| `scripts/qa-plexus-iq-backend.mjs` | PASS |
| `scripts/qa-team-portals-restore.mjs` | PASS |
| `scripts/qa-team-portal-workspace-engine.mjs` | PASS |
| `scripts/qa-engagement-assignment-runtime.mjs` | PASS |

All commands run from a clean working tree on branch `architecture/review-canonical-spine-team-portals`. No app code was modified.

---

## 13. Final report summary

- **Branch:** `architecture/review-canonical-spine-team-portals`
- **Files modified:** none (this doc only added).
- **Check / build:** PASS / PASS.
- **QA scripts:** 8 / 8 PASS.
- **Architecture map:** §2.
- **Canonical spine gap analysis:** §3 (12 target tables compared).
- **Patient Directory source-of-truth recommendation:** create `patient_directory` + `patient_identifiers` + `facilities` as additive new tables in later batches (5+); keep `patient_screenings` as a Plexus IQ episode going forward.
- **Team Portal architecture recommendation:** team portals should read execution cases + team tasks (a unified view of today's `plexus_tasks` and `scheduler_assignments`), not patient rows. The shell is `PortalShell` / `TeamPortalShell` — split in Batch 10 only after Batches 2-4 ship.
- **Backend modularization recommendation:** §8.1 (16 modules around the spine; storage.ts god-facade stays until consumers migrate).
- **Frontend modularization recommendation:** §8.2 (`features/*` modules, lazy-loaded; `lib/pdfGeneration.ts` → `shared/pdf/`).
- **Performance risks:** §4.7 + §5.2 (top three: `GET /api/billing-records` O(n³), single 1.7 MB JS bundle, no pagination in several read endpoints).
- **AWS readiness risks:** §7 row "AWS deployment" — no Dockerfile / ECS / Secrets Manager yet; S3 abstraction already correct.
- **Do-not-touch list:** §10.
- **Safe batch plan:** §9 (Batches 0-13).
- **First recommended implementation batch:** Batch 1 — docs + dependency map only (§11).
- **Blocked items:** None. No prerequisites missing.

End of report.

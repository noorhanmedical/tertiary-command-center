# Backend route parity inventory (Batch 3a)

**Branch:** `architecture/batch-3a-parity-inventory`
**Date:** 2026-06-09
**Scope:** Read-only inventory. No source code changed by this branch.
**Purpose:** Lock down byte-identical parity expectations for every protected route before Batch 3 (or any future batch) wraps route logic behind a service layer.

> Cross-reference: `docs/architecture/protected-flows.md`, `docs/architecture/do-not-touch.md`, `docs/architecture/full-21-batch-orchestrator-review.md` (Batches 3, 13, 14, 17).

---

## 0. How this document is used

1. **Before any code in `server/routes/*.ts` is moved into a service**, the relevant section of this inventory must be referenced in the PR description.
2. **The "what parity must be preserved" subsection of each route is the contract.** A wrapper that changes any line of that subsection is not parity-preserving — it is a behavior change and belongs in a different batch.
3. **The "recommended parity checks" subsection lists the minimum test fixtures and assertions** that the implementation batch must add.
4. **The "stop conditions" subsection lists the situations where Claude (or any contributor) must stop and ask** before continuing.

Conventions used below:

- Routes are listed by **method + path**. Source file + line range is cited.
- **Request inputs** = body schema (Zod where present), path params, query params, headers consumed.
- **Response shape** = the JSON keys + types returned for the happy path, plus error envelopes.
- **Status codes** = the 4xx/5xx codes the handler can return (only those that are observable from the route's own code).
- **Side effects** = DB writes, audit-log calls, journey-event writes, cache invalidations, background fans-out, external service calls.
- **Database dependencies** = tables read or written.
- **Storage dependencies** = blob / file-storage / Google Drive / S3 interaction.
- **External service dependencies** = AI providers (Anthropic / OpenAI), Google Sheets, SMTP.
- **Protected flows at risk** = which entries in `protected-flows.md` would regress if this route changes.
- **Parity to preserve** = the contract.
- **Recommended parity checks** = test-script bullets.
- **Recommended future service boundary** = where the logic should live after refactor.
- **Risk level** = very low / low / low-medium / medium / medium-high / high.
- **Stop conditions** = pre-implementation gates.

A few enterprise-wide standards are referenced throughout (defined once in §13):

- **ES-1:** Routes should not gain more business logic.
- **ES-2:** Future services should hold use-case / business logic.
- **ES-3:** Future repositories should hold database access only.
- **ES-4:** Shared contracts / types must not introduce runtime behavior.
- **ES-5:** No duplicate sources of truth.
- **ES-6:** No hidden patient-identity duplication.
- **ES-7:** No direct status mutation without a clear future state-machine path.
- **ES-8:** No new broad scans or all-row APIs.
- **ES-9:** No local-storage assumptions for production documents.
- **ES-10:** No PHI or large response body in logs.
- **ES-11:** No migrations without design review.
- **ES-12:** No fragile flow edits without dedicated review and QA.

---

## 1. Admin Review routes — `server/routes/patients.ts`

This is the **highest-risk** group in the inventory. Admin Review owns the reasoning blob, the supporting-buttons UI, the per-ancillary regenerate flow, regenerate-all, regenerate-test, remove-test, remove-ancillary, ICD search, and the admin-approval gate. Any wrapper must preserve every line of behavior below.

### 1.1 `GET /api/patient-screenings/:id/admin-review/evidence` *(patients.ts:207–227)*

- **Purpose:** Deterministic rule-engine output for the Admin Review evidence panel. No AI.
- **Request inputs:** Path `:id`. No body, no query.
- **Response shape (happy path):** `{ ok: true, patientId: number, ...runAdminReviewRuleEngine(patient) }` — the rule-engine result is spread into the top level.
- **Status codes:** 200; 400 `Invalid patient id`; 404 `Patient not found`; 500 `Failed to build admin review evidence`.
- **Side effects:** None (read-only).
- **Database deps:** `storage.getPatientScreening(id)` (read of `patient_screenings`).
- **Storage deps:** None.
- **External deps:** None.
- **Protected flows at risk:** Admin Review evidence panel; ICD-needed flags; per-ancillary candidate hint UI.
- **Parity to preserve:** Spread layout (`{ ok, patientId, ...result }`). The keys returned by `runAdminReviewRuleEngine` are part of the contract and must not be re-shaped by a future wrapper. The dynamic import path (`../services/plexusIq/adminReviewRuleEngine`) is internal but the spread shape is observable.
- **Recommended parity checks:** Snapshot the JSON for a canned patient fixture; assert deep-equal pre/post wrap.
- **Recommended future boundary:** `server/services/adminReview/runAdminReviewEvidence(patient)` — a pure function returning the same spread shape.
- **Risk level:** **medium-high** (read-only but consumed directly by AdminReviewDialog's Evidence Panel).
- **Stop conditions:** Any field name change in the spread; any 4xx/5xx code change.

### 1.2 `POST /api/patient-screenings/:id/admin-review/regenerate` *(patients.ts:232–315)*

- **Purpose:** Regenerate clinician + patient reasoning for a single ancillary using admin-selected evidence. Writes the result under `reasoning["adminReview:<ancillary>"]`. Canonical per-test reasoning is **not** touched by this endpoint.
- **Request inputs (body):** `ancillaryId: string`, `mode: "clinician"|"patient"|"all"` (default "all"), `assignedEvidence: any[]`, `ancillaryNote: string`.
- **Response shape (happy path):** `{ ok: true, patient: PatientScreening, ancillaryId: string, clinicianReasoning, patientExplanation }`.
- **Status codes:** 200; 400 `Invalid patient id`; 404 `Patient not found`; 500 `Failed to regenerate admin review reasoning`.
- **Side effects:**
  - `storage.updatePatientScreening(id, { reasoning: nextReasoning })`.
  - `invalidatePatientDatabase()`.
- **Database deps:** Reads `patient_screenings`; writes `patient_screenings.reasoning`.
- **Storage deps:** None.
- **External deps:** Anthropic (via `regenerateAdminReviewReasoning` — dynamic import).
- **Protected flows at risk:** Admin Review per-ancillary regenerate, supporting buttons, qualifying factors merge, Clinician PDF + Plexus PDF.
- **Parity to preserve:**
  - The key `reasoning["adminReview:${ancillaryId || "unknown"}"]` MUST remain the storage key.
  - Mode-based merging: `mode === "patient"` preserves `prior.clinicianReasoning`; `mode === "clinician"` preserves `prior.patientExplanation`.
  - `regeneratedAt` ISO timestamp + `regeneratedMode` field.
  - Other reasoning keys (canonical per-test entries + sibling `adminReview:*` entries) MUST be preserved verbatim via the spread.
- **Recommended parity checks:** Pre/post `reasoning` deep diff for a canned patient with three pre-existing reasoning keys; assert only `adminReview:<ancillaryId>` changes.
- **Recommended future boundary:** `server/services/adminReview/regenerateAncillaryReasoning(params)` returning the same response shape. The merge logic stays in the service; the route remains a thin adapter.
- **Risk level:** **high** (AI call, reasoning blob write, Admin Review user flow).
- **Stop conditions:** Any change in merge order; any change in stored key name; any change in returned keys.

### 1.3 `POST /api/patient-screenings/:id/admin-review/regenerate-all` *(patients.ts:321–492)*

- **Purpose:** Canonical regenerate. Rebuilds `patient.reasoning[testName]` for every qualifying test and stores supplemental `adminReview:<ancillary>` metadata for each of brainwave/vitalwave/ultrasound. Optionally updates `diagnoses`, `medications`, `history`.
- **Request inputs (body):** `assignedEvidenceByAncillary: { brainwave[], vitalwave[], ultrasound[] }`, `ancillaryNotes: { brainwave, vitalwave, ultrasound }`, `adminNote: string`, `icdCodes: [{ code, label }]`, `diagnoses?: string`, `medications?: string`, `history?: string`, `removedFactorsByTest?: Record<testName, string[]>`, `removedFactorsByAncillary?: Record<ancillaryId, string[]>`, `priorQualifyingFactorsByTest?: Record<testName, string[]>`.
- **Response shape (happy path):** `{ ok: true, patient: PatientScreening }`.
- **Status codes:** 200; 400 `Invalid patient id`; 404 `Patient not found`; 500.
- **Side effects:**
  - `storage.updatePatientScreening(id, updatePayload)` — writes `reasoning`, optionally `diagnoses`/`medications`/`history`.
  - `invalidatePatientDatabase()`.
- **Database deps:** Reads + writes `patient_screenings`.
- **Storage deps:** None.
- **External deps:** Anthropic (via `regenerateCanonicalReasoning`).
- **Protected flows at risk:** Clinician PDF + Plexus PDF (read `reasoning[testName]`), Admin Review supporting buttons, qualifying factors merge, ICD chips, Engagement Center (downstream).
- **Parity to preserve:**
  - Existing `reasoning` keys not in `qualifyingTests` MUST be preserved verbatim via spread.
  - Three `adminReview:<ancillary>` entries are always rewritten with: `ancillaryId`, `assignedEvidence`, `ancillaryNote`, `regeneratedAt`, `regeneratedMode: "all"`.
  - Per-test canonical reasoning entries returned by `ai.reasoningByTest` overwrite their existing entries.
  - Conditional updates to `diagnoses` / `medications` / `history` ONLY if changed.
  - Selected-support-buttons mapping by ancillary is derived via `getAncillaryCategory(testName)` — the mapping rule must not be changed.
- **Recommended parity checks:**
  - Fixture: patient with two `brainwave` tests + one `ultrasound` test + non-empty prior reasoning. Run twice with identical input; the second response's `reasoning` must equal the first's modulo timestamps.
  - Assert non-overwrite of sibling `reasoning` keys.
- **Recommended future boundary:** `server/services/adminReview/regenerateAllCanonicalReasoning(params)`.
- **Risk level:** **high**.
- **Stop conditions:** Any divergence in spread-merge order; any change to the `adminReview:<ancillary>` payload shape; any change to which writes happen on `diagnoses`/`medications`/`history`.

### 1.4 `POST /api/patient-screenings/:id/admin-review/regenerate-ancillary` *(patients.ts:498–664)*

- **Purpose:** Same as regenerate-all but scoped to one of brainwave/vitalwave/ultrasound. Other ancillaries' canonical reasoning is preserved.
- **Request inputs (body):** `ancillaryId: "brainwave"|"vitalwave"|"ultrasound"`, `assignedEvidence: any[]`, `ancillaryNote: string`, `adminNote: string`, `icdCodes: [{ code, label }]`, `diagnoses?`, `medications?`, `history?`, `removedFactors?: string[]`, `removedFactorsByTest?: Record<string, string[]>`, `priorQualifyingFactorsByTest?: Record<string, string[]>`.
- **Response shape (happy path):** `{ ok: true, patient: PatientScreening, ancillaryId: string }`.
- **Status codes:** 200; 400 (multiple variants: invalid id, invalid ancillaryId); 404; 500.
- **Side effects:** As 1.3, scoped to filtered tests + the one `adminReview:<ancillaryId>` entry (`regeneratedMode: "ancillary"`).
- **Parity to preserve:**
  - `getAncillaryCategory(t) === ancillaryId` is the filter rule for which tests get regenerated.
  - Other ancillaries' canonical reasoning entries and `adminReview:<otherAncillary>` entries are preserved verbatim.
  - `regeneratedMode: "ancillary"` literal must remain.
- **Recommended parity checks:** Fixture: patient with brainwave + ultrasound tests. Regenerate brainwave only. Assert ultrasound entries unchanged byte-for-byte.
- **Recommended future boundary:** `server/services/adminReview/regenerateOneAncillary(...)`.
- **Risk level:** **high**.
- **Stop conditions:** Any reshape of the filter rule; any leak across ancillaries.

### 1.5 `POST /api/patient-screenings/:id/admin-review/regenerate-test` *(patients.ts:743–900)*

- **Purpose:** Canonical regenerate for exactly one qualifying test. Writes `patient.reasoning[testName]` and `reasoning["adminReview:test:<testName>"]`. Other tests preserved verbatim.
- **Request inputs (body):** `testName: string` (must be in `patient.qualifyingTests`), `ancillaryId: "brainwave"|"vitalwave"|"ultrasound"`, `assignedEvidence: any[]`, `ancillaryNote: string`, `adminNote: string`, `icdCodes: [{ code, label }]`, optional `diagnoses`/`medications`/`history`, `removedFactors?: string[]`, `priorQualifyingFactorsByTest?: Record<string, string[]>`.
- **Response shape (happy path):** `{ ok: true, patient: PatientScreening, testName: string, ancillaryId: string }`.
- **Status codes:** 200; 400 (invalid id; testName required; testName not in `qualifyingTests`; ancillaryId out of set); 404; 500.
- **Parity to preserve:**
  - The `adminReview:test:<testName>` key prefix is the contract — do not collapse with `adminReview:<ancillaryId>`.
  - `regeneratedMode: "test"` literal.
  - Validation order: id check → testName presence → ancillaryId enum → patient existence → testName-in-qualifyingTests.
- **Recommended parity checks:** Fixture with two qualifying tests in different ancillaries; regenerate one; assert the other's reasoning + `adminReview:test:*` key unchanged.
- **Recommended future boundary:** `server/services/adminReview/regenerateOneTest(...)`.
- **Risk level:** **high**.
- **Stop conditions:** Any change to validation order; any key-name reshape.

### 1.6 `POST /api/patient-screenings/:id/admin-review/remove-test` *(patients.ts:907–957)*

- **Purpose:** Removes a single qualifying test from `qualifyingTests` and deletes the `adminReview:test:<testName>` metadata. Canonical `reasoning[testName]` is **intentionally preserved** (historical context).
- **Request inputs (body):** `testName: string`.
- **Response shape:** `{ ok: true, patient: PatientScreening, removedTestName: string }`.
- **Status codes:** 200; 400 (invalid id; testName required; testName not in `qualifyingTests`); 404; 500.
- **Side effects:** `storage.updatePatientScreening(id, { qualifyingTests, reasoning })`; `invalidatePatientDatabase()`.
- **Parity to preserve:**
  - **DO NOT delete `reasoning[testName]`** — only the `adminReview:test:<testName>` metadata.
  - UI display invariant: presence in `qualifyingTests` governs whether the test renders; `reasoning` is the data source.
- **Recommended parity checks:** Assert `reasoning[testName]` exists after the call. Assert `reasoning["adminReview:test:<testName>"]` is absent.
- **Recommended future boundary:** `server/services/adminReview/removeTest(...)`.
- **Risk level:** **high** (subtle invariant about not deleting canonical reasoning).
- **Stop conditions:** Any code that deletes `reasoning[testName]` in the wrapper.

### 1.7 `POST /api/patient-screenings/:id/admin-review/remove-ancillary` *(patients.ts:964–1027)*

- **Purpose:** Removes every qualifying test whose `getAncillaryCategory()` is the given ancillary. Clears `adminReview:<ancillaryId>` and per-removed-test `adminReview:test:<testName>` metadata. Canonical `reasoning[testName]` preserved.
- **Request inputs (body):** `ancillaryId: "brainwave"|"vitalwave"|"ultrasound"`.
- **Response shape:** `{ ok: true, patient: PatientScreening, ancillaryId, removedTests: string[] }`.
- **Status codes:** 200; 400; 404; 500.
- **Parity to preserve:** Same invariant as 1.6 — never delete canonical `reasoning[testName]`. `getAncillaryCategory` is the filter rule.
- **Risk level:** **high**.
- **Stop conditions:** Same as 1.6.

### 1.8 `POST /api/patient-screenings/:id/admin-review/icd-search` *(patients.ts:668–738)*

- **Purpose:** OpenAI ICD-10-CM search for the Admin Review "Available Buttons" section. **PHI-conscious logging** is the documented contract (no key, no PHI, no full query).
- **Request inputs (body):** `query: string` (min length 2), `patientContext: { diagnoses?, history?, medications? }`.
- **Response shape:** Happy: `{ ok: true, results: ICDResult[] }` where shape comes from `searchAdminReviewIcdCodes`. Empty: `{ ok: true, results: [] }` if query < 2 chars. Error: `{ ok: false, error: "OpenAI universal ICD search failed", detail: string }`.
- **Status codes:** 200; 400; 404; 500.
- **Side effects:** Logs **only**: `patientId`, `queryLength`, `hasAIIntegrationsKey`, `hasOpenAIKey`, `hasBaseUrl`, `message` (truncated to 240 chars).
- **Database deps:** Reads `patient_screenings`.
- **External deps:** OpenAI (one of two env-key paths).
- **Protected flows at risk:** Admin Review ICD chips, ICD-needed UI.
- **Parity to preserve:**
  - **The logging contract is part of the API contract** — wrapping must not log the query, PHI, or AI keys (ES-10).
  - The response envelope shape (`ok`/`error`/`detail` triple) is consumed by the UI.
  - The min-length-2 short-circuit returning `{ ok: true, results: [] }` is observable.
- **Recommended parity checks:** Assert no log line contains the query body or any PHI field name.
- **Recommended future boundary:** `server/services/adminReview/searchIcdCodes(...)` with a typed `PhiAwareLogger`.
- **Risk level:** **medium-high** (PHI-aware logging contract).
- **Stop conditions:** Any log line that contains PHI; any change to env-key precedence.

### 1.9 `POST /api/patient-screenings/:id/admin-approval` *(patients.ts:1048–1201)*

- **Purpose:** Sets admin approval state. **On `"approved"` this is the trigger that fires the canonical commit + scheduler routing pipeline.** This is the most complex side-effect endpoint in this file.
- **Request inputs (body):** `status: "pending"|"approved"|"needs_info"|"rejected"`, `note?: string`.
- **Response shape:** `{ ok: true, patient: PatientScreening, routedToEngagement: boolean, routedSchedulerName: string|null, routedSchedulerSettingsSource: "outreach-schedulers-table"|"missing", routedByScheduledSettings: boolean }`.
- **Status codes:** 200; 400 (invalid id; invalid status); 404; 500.
- **Side effects (in order):**
  1. `storage.updatePatientScreening(id, { adminApprovalStatus, adminApprovedAt, adminApprovedByUserId, adminApprovalNote })`.
  2. On `"approved"`: `lookupSchedulerFromSettings(facility)` (dynamic import).
  3. On `"approved"` + `commitStatus === "Draft"`: `commitPatient(id, userId, { auto: true })` — this fires the canonical spine via `patientCommitService`.
  4. Best-effort `patient_journey_events` insert with `eventType: "admin_approval_updated"`, `eventSource: "plexus_iq_admin_review"`.
  5. `logAudit(req, "update", "patient", id, { ... })`.
  6. `invalidatePatientDatabase()`.
  7. On `routedToEngagement`, refetch via `storage.getPatientScreening(id)`.
- **Database deps:** `patient_screenings`, `patient_execution_cases`, `patient_journey_events`, `outreach_schedulers` (via service), `audit_log`.
- **External deps:** None directly; `commitPatient` fans out to AI eligibility checks.
- **Protected flows at risk:** Admin Review approval; Engagement Center routing; Scheduler Settings lookup; Engagement assignment creation; Plexus IQ admin-approval status chip.
- **Parity to preserve:**
  - Allowed status union order: `pending`, `approved`, `needs_info`, `rejected`.
  - **All seven side effects in the same order.** Re-ordering can race with the engagement-board refresh signal on the client.
  - Best-effort journey-event insert must remain wrapped in try/catch with `console.error` only — must not block the response.
  - `routedSchedulerSettingsSource` literal union (`"outreach-schedulers-table" | "missing"`).
  - `routedToEngagement === true` MUST trigger the refetch before returning.
- **Recommended parity checks:**
  - Approve a Draft patient; assert `routedToEngagement === true`, `routedSchedulerName !== null` when a scheduler exists.
  - Approve an already-committed patient; assert `routedToEngagement === true` without a re-commit.
  - Inject a forced error in the journey-event insert; confirm response is still 200.
- **Recommended future boundary:** `server/services/adminReview/setAdminApproval(...)` returning the full response shape; commit/route fan-out belongs in `patientCommitService` (which already exists).
- **Risk level:** **high** (this is the trigger for the entire engagement pipeline).
- **Stop conditions:** Any change in side-effect order; any change to the response envelope keys; any change in the SOURCE MARKER comments — these are used as code-search anchors.

### Group-level parity table (Admin Review)

| Route | Method | Key write | Reasoning blob touched | AI? | Audit | Journey event | Cache invalidation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /admin-review/evidence | GET | — | no | no | no | no | no |
| /admin-review/regenerate | POST | reasoning | `adminReview:<a>` | yes (Anthropic) | no | no | yes |
| /admin-review/regenerate-all | POST | reasoning + optional dx/hx/rx | per-test + 3× `adminReview:<a>` | yes (Anthropic) | no | no | yes |
| /admin-review/regenerate-ancillary | POST | reasoning + optional dx/hx/rx | filtered per-test + 1× `adminReview:<a>` | yes (Anthropic) | no | no | yes |
| /admin-review/regenerate-test | POST | reasoning + optional dx/hx/rx | one per-test + `adminReview:test:<t>` | yes (Anthropic) | no | no | yes |
| /admin-review/remove-test | POST | qualifyingTests + reasoning | deletes `adminReview:test:<t>` only | no | no | no | yes |
| /admin-review/remove-ancillary | POST | qualifyingTests + reasoning | deletes `adminReview:<a>` + matching `adminReview:test:*` | no | no | no | yes |
| /admin-review/icd-search | POST | — | no | yes (OpenAI) | no (PHI-aware) | no | no |
| /admin-approval | POST | adminApprovalStatus + 3 admin* fields | no | yes (commit fan-out) | yes | best-effort | yes |

---

## 2. Qualification / regenerate routes — `server/routes/patients.ts`

These three routes drive AI qualification outside the Admin Review flow.

### 2.1 `POST /api/patients/:id/analyze` *(patients.ts:1203–1276)*

- **Purpose:** Per-patient AI screening. Writes `qualifyingTests`, `reasoning`, `cooldownTests`, `diagnoses`/`history`/`medications`/`age`/`gender`, sets `status: "completed"`. Auto-commits via `commitPatient(id, userId, { auto: true })` if Draft. On success and qualifying tests, calls `assignNewlyEligiblePatient` to slot the patient into today's call list.
- **Request inputs:** Path `:id`. No body.
- **Response shape:** `{ ...PatientScreening, autoCommittedSchedulerName: string|null }` (spread of the post-commit patient).
- **Status codes:** 200; 404; 500 `AI analysis failed after retries` or generic.
- **Side effects (in order):**
  1. `getQualificationMode(facility)` setting lookup.
  2. `screenSinglePatientWithAI(...)` — AI call.
  3. On AI error: `storage.updatePatientScreening(id, { status: "error" })` then 500 response.
  4. `storage.updatePatientScreening(id, { qualifyingTests, reasoning, cooldownTests, diagnoses, history, medications, age, gender, status: "completed" })`.
  5. `commitPatient(id, userId, { auto: true })`.
  6. `invalidatePatientDatabase()`.
  7. `assignNewlyEligiblePatient(storage, finalPatient, finalPatient.facility, today)` (fire-and-forget) if qualifying tests + facility.
- **Database deps:** `patient_screenings`, `patient_execution_cases`, `outreach_schedulers`, `audit_log`, `scheduler_assignments` (downstream).
- **External deps:** Anthropic (via `screenSinglePatientWithAI`).
- **Protected flows at risk:** Plexus IQ analyze (single patient), commit pipeline, scheduler auto-assign, mid-day eligibility.
- **Parity to preserve:** Side-effect order (AI → update → commit → invalidate → assignNewlyEligiblePatient). The error-path write `{ status: "error" }` MUST happen before the 500 response.
- **Risk level:** **high**.

### 2.2 `POST /api/patients/:id/analyze-test` *(patients.ts:1361–1421)*

- **Purpose:** AI analyze a single named test for a patient.
- **Inventory needed before wrapping:** A re-read of lines 1361-1421 is required when this route is wrapped. Logic is small but it writes targeted reasoning entries.
- **Risk level:** **medium-high**.

### 2.3 `POST /api/patients/:patientId/refresh-notes` *(patients.ts:1422–1477)*

- **Purpose:** Regenerate generated notes for a patient.
- **Inventory needed before wrapping:** Re-read required.
- **Risk level:** **medium**.

### 2.4 `POST /api/generate-justification` *(patients.ts:1478–1520)*

- **Purpose:** Free-form AI justification generator. Not patient-scoped; takes inputs in the body.
- **Risk level:** **medium**.

### 2.5 `POST /api/ai-select-conditions` *(patients.ts:1521–1645)*

- **Purpose:** AI helper that selects conditions for a patient context.
- **Risk level:** **medium**.

### 2.6 `POST /api/parse-patient-paste` *(patients.ts:1646–end)*

- **Purpose:** Parse a free-text patient paste into structured fields.
- **Risk level:** **medium**.

> **Note:** Sections 2.2–2.6 are listed as scope items for Batch 3. Their detailed parity blocks must be filled out **before** they are wrapped — that is a follow-on inventory PR if Batch 3 expands to cover them.

---

## 3. Plexus IQ routes — `server/routes/plexusIqClinicalImport.ts`

### 3.1 `POST /api/plexus-iq/clinical-import` *(plexusIqClinicalImport.ts:177–412)*

- **Purpose:** Bulk-insert patients from a parsed clinical paste. Groups by `(facility, scheduleDate)`. Creates/resolves a batch per group. Single multi-row INSERT per group via Drizzle `.values(inserts)`.
- **Request inputs (body, Zod-validated):** `rows: ClinicalImportRow[]`, `defaultFacility?: string`, `defaultScheduleDate?: string`, `defaultPatientType?: "visit"|"outreach"`.
- **Response shape:** `{ ok: boolean, importedCount: number, skippedCount: number, errors: SkipError[], batchIds: number[], patientIds: number[], batchPatientMap: [{ batchId, patientIds, facility, scheduleDate }] }`.
- **Status codes:** 200; 400 (Zod failure; all rows skipped); 500 (bulk insert error).
- **Side effects:**
  1. `resolveBatchForGroup(facility, scheduleDate, userId)` per group — may create a batch.
  2. `db.insert(patientScreenings).values(inserts).returning()` per group.
  3. `storage.updateScreeningBatch(batchId, { patientCount })` per group.
  4. `logAudit(req, "create", "patient_screenings_bulk", batchId, { count, source: "plexus-iq-clinical-import" })` per group.
  5. `invalidatePatientDatabase()` at the end.
- **Database deps:** `screening_batches`, `patient_screenings`, `audit_log`.
- **External deps:** None.
- **Protected flows at risk:** Plexus IQ bulk import, MRN stamping, batch resolution.
- **Parity to preserve:**
  - Skip-error envelope (`{ rowIndex, patientName?, reason, raw? }`) — UI relies on these fields.
  - `buildClinicalImportNotes(...)` stamps MRN + rowIndex + parser warnings + raw row trace into `notes`. The notes shape is the only place MRN lives today. **DO NOT change this without a migration plan.**
  - Single multi-row INSERT per group — switching to per-row INSERT would slow imports 50–200× and likely time out.
  - Reconciliation guard at lines ~349-356 (`insertedRows.length !== inserts.length`) MUST remain — silent patient loss is a HIPAA-grade incident.
- **Recommended parity checks:** Fixture: paste with 3 groups × 5 rows each, 2 forced skips. Assert `importedCount === 15`, `skippedCount === 2`, `batchIds.length === 3`, `errors.length === 2`.
- **Recommended future boundary:** `server/services/plexusIq/importClinicalRows(...)`. The route stays as the HTTP boundary.
- **Risk level:** **high** (data ingestion correctness; PHI flow).
- **Stop conditions:** Any change to the skip-error envelope; any change to the multi-row INSERT pattern; any change to `buildClinicalImportNotes` semantics.

### 3.2 `POST /api/plexus-iq/qualification-jobs` *(plexusIqClinicalImport.ts:419–end)*

- **Purpose:** Start one or more `analysis_jobs` for the given batches (or batches inferred from patientIds).
- **Side effects:** Calls `startBatchAnalysis(batchId)` per batch. Background job runs in `batchAnalysisRunner.ts`.
- **Protected flows at risk:** Plexus IQ qualification jobs status panel; batch progress UI.
- **Risk level:** **medium-high** (background job lifecycle).

### 3.3 `GET /api/plexus-iq/qualification-jobs/:batchId` *(plexusIqClinicalImport.ts:490+)*

- **Purpose:** Read qualification-job status for a batch.
- **Risk level:** **medium**.

### 3.4 `POST /api/plexus-iq/qualification-jobs/:jobId/cancel` *(plexusIqClinicalImport.ts:577+)*

- **Purpose:** Cancel a running qualification job.
- **Risk level:** **medium**.

---

## 4. Engagement Center routes

Two files participate: `server/routes/engagementAssignmentBoard.ts` (legacy board) and `server/routes/executionCases.ts` (newer engagement-center endpoints).

### 4.1 `GET /api/engagement/assignment-board` *(engagementAssignmentBoard.ts:165–428)*

- **Purpose:** Returns the full engagement board: rows + summary aggregates. Filters by query param (`q`, `facility`, `assignedTeamMemberId`, `engagementStatus`, `engagementBucket`, `patientType`, `unassignedOnly=1`, `missingInfoOnly=1`).
- **Response shape:** `{ rows: BoardRow[], summary: { total, assigned, unassigned, needsInfo, byFacility: [{ facility, count }], byAssignedTeamMember: [{ name, count }], byEngagementStatus: [{ status, count }] } }`. `BoardRow` shape is mirrored in `shared/contracts/engagementBoard.ts`.
- **Side effects:** None (read-only).
- **Database deps:** `patient_execution_cases` (filtered by active lifecycle + non-archived engagement status), `patient_screenings`, `screening_batches`, `outreach_schedulers`, `patient_journey_events` (latest per case).
- **Protected flows at risk:** Engagement Center board read.
- **Parity to preserve:**
  - Filter chain order (q → facility → assignedTeamMemberId → engagementStatus → engagementBucket → patientType → unassignedOnly → missingInfoOnly).
  - Default sort: unassigned first, then `nextActionAt` ascending, then `lastActivityAt` descending.
  - `missingInfo[]` content from `computeMissingInfo(screening)`.
  - Lifecycle filter: `lifecycleStatus IS NULL OR = 'active'`.
  - Engagement-status filter: `engagementStatus IS NULL OR NOT IN ('archived','closed','cancelled','completed')`.
- **Recommended parity checks:** Sort-order parity fixture with 5 rows: 2 unassigned (one with future `nextActionAt`, one without), 3 assigned (mixed `lastActivityAt`).
- **Recommended future boundary:** `server/modules/engagement/readBoard(...)` (already described in orchestrator Batch 13 as an *additive* v2 endpoint). The legacy reader stays untouched until that batch ships and its parity test passes.
- **Risk level:** **high** (board is the primary Engagement Center UI source).
- **Stop conditions:** Any change to filter chain order; any change to sort order; any change to lifecycle / engagement-status filter SQL.

### 4.2 `POST /api/engagement/assignment-board/assign` *(engagementAssignmentBoard.ts:431–578)*

- **Purpose:** Bulk assign N patients to one scheduler. Per-patient conflict guard (`findConflictingActiveAssignment`). Writes `patient_execution_cases` + appends `patient_journey_events`.
- **Request inputs (body, Zod-validated via `assignBoardSchema`):** `patientScreeningIds: number[]` (min 1), `schedulerId: number`, `assignedRole?: "scheduler"|"patientCareSpecialist"|"ancillaryCareSpecialist"` (default "scheduler"), `reason?: string`.
- **Response shape:** `{ ok: boolean, updated: [{ patientScreeningId, executionCaseId, previousSchedulerId, previousSchedulerName }], failed: [{ patientScreeningId, reason }], summary: { requested, updated, failed, schedulerId, schedulerName, schedulerFacility, assignedRole } }`.
- **Side effects:** Per accepted patient: `UPDATE patient_execution_cases SET assignedTeamMemberId, assignedRole, engagementStatus`; `INSERT INTO patient_journey_events ... eventType: "engagement_assignment_changed"`. **No transaction across the batch — partial success is possible.**
- **Status codes:** 200 (always — `ok: false` carried in body for partial success); 400 (Zod); 404 (`Scheduler not found`); 500.
- **Database deps:** `patient_screenings`, `patient_execution_cases`, `outreach_schedulers`, `screening_batches`, `patient_journey_events`.
- **Protected flows at risk:** Engagement bulk assign; conflict guard ("two schedulers cannot share the same patient for the same date"); Team Portal patient lists (which read assignedTeamMemberId).
- **Parity to preserve:**
  - The conflict-guard error message format: `"Already assigned to <name> for <scheduleDate>. Two schedulers cannot share the same patient for the same date."` — UI parses this for the toast.
  - `NEW_STATES` set: `["new", "ready", "assigned", "not_reached"]` — only these transition to `"assigned"` on assignment; other engagement statuses preserved.
  - Outreach patients (null scheduleDate) are exempt from conflict — see `findConflictingActiveAssignment`.
  - `eventType: "engagement_assignment_changed"` literal (UI may filter on it).
  - Partial-success envelope structure.
- **Recommended parity checks:** Bulk assign 3 patients where one has a conflict; assert `updated.length === 2`, `failed.length === 1`, `failed[0].reason` matches the exact format.
- **Recommended future boundary:** `server/modules/engagement/bulkAssign(...)`. Conflict guard moves into `server/modules/engagement/conflictGuard.ts`.
- **Risk level:** **high**.
- **Stop conditions:** Any change to `NEW_STATES` set; any change in the conflict-error message format; any wrap that introduces a transaction without revisiting partial-success semantics (potential silent regression).

### 4.3 `POST /api/engagement/assignment-board/cancel-many` *(engagementAssignmentBoard.ts:588–681)*

- **Purpose:** Bulk cancel: sets `engagementStatus = 'cancelled'`, `lifecycleStatus = 'cancelled'`, `assignedTeamMemberId = null` for each execution case. Appends one `engagement_assignment_cancelled` journey event per case (best-effort). Does **not** delete patient_screenings.
- **Request inputs (body, Zod):** `executionCaseIds: number[]` (min 1), `reason?: string`.
- **Response shape:** `{ ok, cancelled: [{ executionCaseId, patientScreeningId, previousEngagementStatus, previousLifecycleStatus }], failed: [{ executionCaseId, reason }], summary: { requested, cancelled, failed } }`.
- **Side effects:** Per case: update + best-effort journey event.
- **Protected flows at risk:** Engagement bulk cancel; Plexus IQ "re-import" assumption (the underlying screening row stays alive).
- **Parity to preserve:** `lifecycleStatus = 'cancelled'` literal; the screening row remains intact; `eventType: "engagement_assignment_cancelled"` literal.
- **Risk level:** **medium-high**.
- **Stop conditions:** Any code path that deletes `patient_screenings` rows in this handler.

### 4.4 `GET /api/engagement-center/cases` *(executionCases.ts:123–143)*

- **Purpose:** Filtered list of execution cases via `listEngagementCenterCases`.
- **Side effects:** None.
- **Parity to preserve:** Filter pass-through semantics; default limit (100, max 500).
- **Risk level:** **medium**.

### 4.5 `POST /api/engagement-center/assign` *(executionCases.ts:152–163)*

- **Purpose:** Algorithmic assignment for a role's bucket scope. Distinct from 4.2 (the manual bulk assign).
- **Risk level:** **medium-high**.

### 4.6 `POST /api/engagement-center/call-result` *(executionCases.ts:174–end of block)*

- **Purpose:** Logs call result, updates case status, opens a scheduling-triage case for scheduling actions, opens a plexus task for manager-action results, appends journey event.
- **Side effects:** Up to 4 DB writes (execution case update + journey event + scheduling triage or plexus task).
- **Protected flows at risk:** Scheduler Portal call dialog, manager review, scheduling triage.
- **Parity to preserve:** Patient resolution order (executionCaseId → patientScreeningId → name+dob); always-append journey-event behavior (best-effort); the `default_callback_due_hours` setting drives the default `nextActionAt`.
- **Risk level:** **high**.

---

## 5. Scheduler Portal routes

### 5.1 `GET /api/scheduler-portal/cases` *(executionCases.ts:423–end)*

- **Purpose:** Scheduler-portal-scoped case list.
- **Risk level:** **medium**.

### 5.2 `/api/scheduler-portal/patient-packet` *(patientPacket.ts:44)*

- **Purpose:** Convenience alias for the patient-packet endpoint. Identical contract to `/api/patient-packet`.

### 5.3 `GET /api/scheduler-assignments` *(schedulerAssignments.ts:26–54)*

- **Purpose:** List scheduler assignments with filters.
- **Risk level:** **low**.

### 5.4 `POST /api/scheduler-assignments/rebuild` *(schedulerAssignments.ts:55–88)*

- **Purpose:** Force-rebuild scheduler assignments for a facility/date. Pulls all eligible patients and runs priority ranking.
- **Side effects:** Advisory-locked. Touches `scheduler_assignments` transactionally via `schedulerAssignments.repo.ts`.
- **Protected flows at risk:** Morning rebuild; absence-watcher auto-redistribute.
- **Risk level:** **high** (this is the canonical morning-rebuild trigger).

### 5.5 `POST /api/scheduler-assignments/redistribute` *(schedulerAssignments.ts:89–111)*

- **Risk level:** **medium-high**.

### 5.6 `POST /api/scheduler-assignments/approve-absence` *(schedulerAssignments.ts:112–142)*

- **Risk level:** **medium**.

### 5.7 `GET /api/scheduler-assignments/dashboard` *(schedulerAssignments.ts:143–end)*

- **Risk level:** **low-medium**.

---

## 6. Team Portal routes — `server/routes/portal.ts`

All routes guarded by `requirePortalRole`. Facility allow-listing via `allowedFacilities(req)`.

| Route | Method | Purpose | Risk |
| --- | --- | --- | --- |
| `/api/portal/today-schedule` *(:131)* | GET | Today's clinic schedule grouped by patient (anchored on `ancillary_appointments`) | **medium** |
| `/api/portal/month-summary` *(:247)* | GET | Month-level aggregates | low |
| `/api/portal/outreach-call-list` *(:286)* | GET | Scheduler call list | **medium-high** |
| `/api/portal/ensure-tech-tasks` *(:444)* | POST | Materialize per-test technician tasks | **medium** |
| `/api/portal/my-tasks` *(:524)* | GET | Tasks for the authenticated user | low-medium |
| `/api/portal/consent-templates` *(:561)* | GET | Per-test consent templates | low |
| `/api/portal/uploads` *(:584)* | POST | File upload (`upload.single("file")`) — patient document path | **medium-high** |
| `/api/portal/sign-consent` *(:644)* | POST | Capture a signed consent | **medium-high** |
| `/api/portal/patient-documents/:id` *(:758)* | GET | Read patient documents | low-medium |
| `/api/portal/my-facilities` *(:785)* | GET | Facilities accessible to the user | low |

- **Protected flows at risk:** Team Portal patient list, schedule, tasks, docs, consent signing, file upload.
- **Parity to preserve:**
  - The `requirePortalRole` + facility allow-listing semantics. A wrapper must call the same guards.
  - The grouped-by-patient response shape for `today-schedule` and `outreach-call-list`.
  - The upload contract (`upload.single("file")` — single file, multer-buffered).
  - `consent-templates` returns the per-test signature requirement.
- **Recommended future boundary:** `server/modules/team-portal/*` (one service per tab). See orchestrator Batch 11 (Team Task spine) for the unified read view that subsumes much of `my-tasks` / `outreach-call-list`.
- **Stop conditions:** Any change in facility-allow-list semantics; any change to the file-upload contract.

---

## 7. PDF / packet routes — `server/routes/patientPacket.ts`

### 7.1 `GET /api/patient-packet` *(patientPacket.ts:40)*
### 7.2 `GET /api/scheduler-portal/patient-packet` *(patientPacket.ts:44)*
### 7.3 `GET /api/technician-liaison/patient-packet` *(patientPacket.ts:48)*

All three are aliases for the same handler.

- **Purpose:** Resolve a patient by `executionCaseId`, `patientScreeningId`, or `patientName + patientDob`. Returns the full patient packet from `getPatientPacket(lookup)` — includes screening data, journey events, latest engagement assignment, documents.
- **Request inputs:** Query: one of `executionCaseId`, `patientScreeningId`, or `patientName` (+ optional `patientDob`).
- **Response shape:** Whatever `getPatientPacket(lookup)` returns — defined in `server/repositories/patientPacket.repo.ts`. **This response is the canonical data source for every team-portal view + every PDF caller.**
- **Status codes:** 200; 400 (no lookup provided); 500.
- **Protected flows at risk:** **All Team Portal flows; Clinician PDF; Plexus PDF; Engagement Center bulk PDF; Outreach PDF.** Any change to the response shape ripples through 6+ UI consumers.
- **Parity to preserve:** Every field returned by `getPatientPacket`. Aliases stay identical. Lookup precedence order: `executionCaseId` → `patientScreeningId` → `patientName`. The 400 envelope `"One of executionCaseId, patientScreeningId, or patientName (DOB optional) is required"` is part of the contract.
- **Recommended parity checks:** Fixture with three lookups producing the same patient; assert byte-identical responses.
- **Recommended future boundary:** Already a thin handler over `repositories/patientPacket.repo.ts`. The shape contract belongs in `shared/contracts/patientPacket.ts` (future Batch 2 addition).
- **Risk level:** **high** (single point of failure for many UI views).
- **Stop conditions:** Any change to the response shape; any reorder of lookup precedence.

---

## 8. Reports / documents routes

### 8.1 `server/routes/documentLibrary.ts` — canonical document library

Mounted under **two base paths**: `/api/document-library` (legacy) and `/api/documents-library` (canonical task-spec path). Every handler is registered at both. The duplication is intentional and is part of the contract.

| Route | Auth | Purpose | Risk |
| --- | --- | --- | --- |
| `GET <base>` | `requireAuth` | List current documents (runs `migrateLegacyUploadedDocuments` first — see "side effects") | **high** |
| `GET <base>/meta` | `requireAuth` | Static metadata (kinds, surfaces, signature requirements) | low |
| `GET <base>/:id` | `requireAuth` | Read one document | low-medium |
| `GET <base>/:id/versions` | `requireAuth` | Version chain for a document | low |
| `GET <base>/:id/file` | `requireAuth` | Stream blob bytes; falls back to Drive presigned URL for legacy rows | **high** |
| `POST <base>` | `requireAdmin` | Upload a new document (multer `upload.single("file")`) | **medium-high** |
| `POST <base>/:id/supersede` | `requireAdmin` | Upload a new version + chain | **medium-high** |
| `POST <base>/:id/assignments` | `requireAdmin` | Assign a document to a surface | **medium** |
| `PATCH <base>/:id/assignments` | `requireAdmin` | Update assignments | **medium** |
| `DELETE <base>/:id/assignments/:surface` | `requireAdmin` | Remove an assignment | **medium** |
| `POST <base>/send-to-patient` | `requireAuth` | Email/SMS a document to the patient + append `document_sent` journey event | **medium-high** |
| `DELETE <base>/:id` | `requireAdmin` | Soft-delete | **medium** |

- **Critical parity items:**
  - The **migration-on-read** at line ~237 (`migrateLegacyUploadedDocuments()`) runs on every list request. Removing it would break legacy reads (rows back-filled from `uploaded_documents`). **Move semantics into a service, do not remove the call.** ES-5: this is currently a duplicate source-of-truth pattern between `documents` and `uploaded_documents`; the migration-on-read is the bridge.
  - The **legacy Drive fallback** at lines ~302-330 of `<base>/:id/file`: if local blob bytes are missing and `documents.sourceNotes` has the `LEGACY_SOURCE_PREFIX`, the handler redirects to the Drive web view link rather than 404'ing.
  - `Content-Disposition` toggles between `inline` and `attachment` based on `?disposition=inline`.
- **Storage deps:** `storage/documents/*` blobs (local FS in dev, S3 in prod via `STORAGE_PROVIDER`); legacy Google Drive via `uploadedDocuments.driveWebViewLink`.
- **Protected flows at risk:** Document library list and read; legacy document fallback (clinics that still have Drive-only docs).
- **Risk level:** **high** (storage abstraction + migration-on-read + Drive fallback are all intertwined).

### 8.2 `server/routes/documentReadiness.ts` — case-document-readiness

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/document-requirements` | GET | List per-test document requirements |
| `/api/document-requirements/:id` | GET | One requirement |
| `/api/case-document-readiness` | GET | List readiness rows |
| `/api/case-document-readiness/:id` | GET | One row |
| `/api/case-document-readiness/complete` | POST | Mark a document complete + best-effort journey event `document_completed` |

- **Risk level:** **medium**.

### 8.3 `server/routes/generatedNotes.ts` — plexus generated notes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/generated-notes` | GET | List |
| `/api/generated-notes/batch/:batchId` | GET | By batch |
| `/api/generated-notes` | POST | Create |
| `/api/generated-notes/service` | POST | Service-mode create |
| `/api/generated-notes/patient/:patientId` | DELETE | Bulk delete by patient |
| `/api/generated-notes/patient/:patientId` | GET | List by patient |
| `/api/procedure-notes` | GET | Procedure note list |
| `/api/procedure-notes/:id` | GET | Procedure note read |

- **Risk level:** **low-medium**.

### 8.4 `server/routes/marketingMaterials.ts`

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/marketing-materials` | GET | List | requireAuth |
| `/api/marketing-materials` | POST | Upload | requireAdmin |
| `/api/marketing-materials/:id/file` | GET | File read |
| `/api/marketing-materials/:id` | DELETE | Delete | requireAdmin |

- **Risk level:** **low**.

---

## 9. Billing / invoice routes

### 9.1 `GET /api/billing-records` *(billing.ts:67–111)*

- **Purpose:** Returns all billing records. **Performs read-as-write auto-create scan** before returning: for every completed patient with qualifying tests, INSERT missing `billing_records` rows.
- **Request inputs:** None.
- **Response shape:** `BillingRecord[]` (full row shape).
- **Side effects (per request):**
  1. `storage.getAllScreeningBatches()`.
  2. For each batch: `storage.getPatientScreeningsByBatch(batch.id)`.
  3. For each completed patient with qualifying tests: for each test: `storage.getBillingRecordByPatientAndService(patient.id, test)`; if absent, `storage.createBillingRecord(...)` with `billingStatus: "Not Billed"`, `paidStatus: "Unpaid"`.
  4. If any rows were created, fire `backgroundSyncBilling()` (fire-and-forget).
  5. `storage.getAllBillingRecords()` to compose the response.
- **Database deps:** `screening_batches`, `patient_screenings`, `billing_records`.
- **Protected flows at risk:** Billing list page.
- **Critical observations (enterprise-grade):**
  - **ES-8 violation:** O(batches × patients × tests) on every read. As patient count grows this becomes the slowest endpoint.
  - **ES-1 violation:** Routes shouldn't gain more business logic, but this one is already business logic.
  - Concurrent GETs can race and double-create — `storage.getBillingRecordByPatientAndService` then `createBillingRecord` has no row-level lock.
- **Parity to preserve (for Batch 3 wrapper):** Exact column defaults (`billingStatus: "Not Billed"`, `paidStatus: "Unpaid"`); the response is `getAllBillingRecords()` AFTER the auto-create scan; fire-and-forget `backgroundSyncBilling()` only if rows were created.
- **Recommended parity checks:** Capture the SQL trace on a known dataset; assert N create-or-skip decisions match pre-batch.
- **Recommended future boundary:**
  - Short-term (Batch 3): wrap in `server/services/billing/autoCreateBillingRecords()` returning `{ createdCount }`, then the route returns `getAllBillingRecords()`.
  - Long-term (Batch 14 / 17): move the auto-create to a write-only path (on patient `commit` / qualification), making the read endpoint a pure query.
- **Risk level:** **high** (revenue path).
- **Stop conditions:** Any change to the default column values; any silent removal of the auto-create (will leave revenue gaps); any concurrent-safety change that's not backed by a transaction.

### 9.2 `GET /api/billing-records/invoice-links` *(billing.ts:113–120)*

- **Auth:** `requireBillerOrAdmin`.
- **Purpose:** `storage.getBillingRecordInvoiceLinks()` — many-to-many mapping rows between billing records and invoices.
- **Risk level:** **low-medium**.

### 9.3 `POST /api/billing-records` *(billing.ts:122–154)*

- **Purpose:** Create one billing record. Zod-validated.
- **Side effects:** `storage.createBillingRecord(...)`, `logAudit(...)`, `backgroundSyncBilling()`.
- **Risk level:** **medium**.

### 9.4 `PATCH /api/billing-records/:id` *(billing.ts:156–172)*

- **Purpose:** Partial update; Zod-validated with `updateBillingRecordSchema`.
- **Side effects:** Update + audit + background sync.
- **Risk level:** **medium**.

### 9.5 `DELETE /api/billing-records/:id` *(billing.ts:174–184)*

- **Side effects:** Delete + audit + background sync.
- **Risk level:** **medium**.

### 9.6 `POST /api/billing-records/import-from-sheet` *(billing.ts:186–311)*

- **Purpose:** Import / update billing records from a Google Sheet (column map defined inline at lines 191–207).
- **Side effects:** `db.transaction(...)` wrapping inserts + updates.
- **External deps:** Google Sheets via `server/integrations/googleSheets.readSheetData`.
- **Risk level:** **medium-high** (external integration + bulk DB write).

### 9.7 Invoice routes — `server/routes/invoices.ts`

All routes guarded by `requireBillerOrAdmin`. `INVOICE_STATUSES` and `PAYMENT_METHODS` are imported from `@shared/schema`.

| Route | Method | Purpose | Risk |
| --- | --- | --- | --- |
| `/api/invoices` | GET | List | low |
| `/api/invoices/aging` | GET | Per-facility outstanding aging buckets (0-30 / 31-60 / 60+) | **medium** |
| `/api/invoices/:id` | GET | One invoice + lineItems + payments | low-medium |
| `/api/invoices` | POST | Create from filtered billing records (`facility` + `fromDate`/`toDate`) via `storage.createInvoiceWithLineItems` (transactional) | **high** |
| `/api/invoices/:id/status` | PATCH | Update status | medium |
| `/api/invoices/:id/send-email` | POST | Send invoice email with attached PDF (base64 ≤ 14 MB; PDF magic-number check); marks `Sent` on success | **high** |
| `/api/invoices/:id/payments` | GET | List payments | low |
| `/api/invoices/:id/payments` | POST | Record payment (transactional; recomputes totals) | **high** |
| `/api/invoices/:id/payments/:paymentId` | DELETE | Delete payment (transactional) | **high** |
| `/api/invoices/:id` | DELETE | Delete invoice | medium |

- **Critical observations:**
  - **Status invariant:** Cannot record payments on a Draft invoice (`return 400` at line ~363) — keep this guard intact.
  - **Sent semantics:** Email send is followed by `storage.markInvoiceSent(...)`. If the invoice was deleted between send + update, the handler returns 409 — preserve this race-avoidance.
  - **PDF validation:** `pdfBuffer.slice(0, 5).toString("ascii") !== "%PDF-"` check — keep.
  - **Transactional repo:** `storage.createInvoicePayment` and `storage.deleteInvoicePayment` are transactional in the repo. Wrappers must not bypass them.
- **Parity to preserve:** Status code matrix; the 409-on-delete-race; the 14 MB base64 cap; the PDF magic-number check.
- **Recommended future boundary:** `server/services/invoices/*` — one service per use case (create, sendEmail, recordPayment, deletePayment, deleteInvoice).
- **Risk level:** **high** (revenue path).

### 9.8 `server/routes/completedBillingPackages.ts`

| Route | Method | Purpose | Risk |
| --- | --- | --- | --- |
| `/api/completed-billing-packages` | GET | List | low |
| `/api/completed-billing-packages/:id/payment` | POST | Payment-state change (best-effort journey event `billing_payment_updated`) | medium-high |
| `/api/completed-billing-packages/:id` | GET | Read | low |
| `/api/billing/complete-package-payment` | POST | Complete package + journey events `billing_payment_updated` and `added_to_invoice` | **high** |

- **Critical observation:** This file holds the **second** billing state machine (`packageStatus`). See `canonical-spine.md` §11 — `invoices.status` and `packageStatus` can drift today. Batch 17 design covers alignment.
- **Risk level:** **high**.

### 9.9 `server/routes/projectedInvoices.ts`, `cashPricing.ts`, `billingReadiness.ts`, `billingDocuments.ts`

These hold smaller billing-adjacent endpoints. **Each requires its own per-route parity inventory before wrapping.** Out of scope for Batch 3a beyond the cross-reference here.

---

## 10. Patient directory / patient screening routes

### 10.1 `server/routes/patientDatabase.ts`

| Route | Method | Purpose | Risk |
| --- | --- | --- | --- |
| `/api/patients/database` *(:107)* | GET | Roster aggregation — `GROUP BY (lower(name), dob)` join to test history, generated notes, cooldown. 30-second in-memory cache. | **high** |
| `/api/patients/database/cooldown-summary` *(:186)* | GET | Aggregated cooldown counts | medium |
| `/api/patients/database/import-report` *(:211)* | GET | Recent import summary | low |
| `/api/patients/database/:encodedKey` *(:245)* | GET | Single roster entry by encoded `(name, dob)` key | medium |

- **Parity to preserve:** The 30-second cache + `invalidatePatientDatabase()` call sites across other routes. Cache invalidation is currently called from:
  - `patients.ts` PATCH/POST (multiple handlers)
  - `plexusIqClinicalImport.ts`
  - `batches.ts`
  - `admin-approval` route (1.9)
- **ES-8 risk:** This is an all-row roster reader. As patient count grows it must be paginated; but the UI consumes it as a single list today.
- **Risk level:** **high**.

### 10.2 `server/routes/patients.ts` non-admin-review routes (selected)

Already covered in §2 above (analyze, analyze-test, commit, recall, refresh-notes, generate-justification, ai-select-conditions, parse-patient-paste).

Plus:
- `GET /api/patient-screenings/recently-deleted` *(:35)* — list recently soft-deleted.
- `POST /api/patient-screenings/:id/restore` *(:49)* — restore within window.
- `PATCH /api/patients/:id` *(:75)* — main patient update.
- `GET /api/patients/:id` *(:174)* — read one.
- `DELETE /api/patients/:id` *(:185)* — soft delete.
- `POST /api/patients/:id/commit` *(:1281)* — manual commit (Send to Schedulers).
- `POST /api/patients/:id/recall` *(:1325)* — undo commit within recall window.

**Critical:** `PATCH /api/patients/:id` calls `ensureCanonicalSpineForScreening(id, ...)` when any of `SPINE_FIELDS = ["appointmentStatus", "patientType", "time", "name", "dob", "qualifyingTests"]` changes and `commitStatus !== "Draft"`. Fire-and-forget. This is the second-most-fragile non-admin-review handler in the file.

### 10.3 `server/routes/batches.ts`

14 endpoints covering batch CRUD, manual patient entry, file/text imports, AI analyze, archive, calendar summary, batch export.

- **Critical:** `POST /api/batches/:id/import-file` (multer `upload.array("files", 10)`) and `POST /api/batches/:id/import-text` are non-Plexus-IQ identity-creation paths. They share the AI parsing pipeline.
- **Risk level:** **high** for the identity-creation routes.

---

## 11. Execution case routes — `server/routes/executionCases.ts`

| Route | Method | Purpose | Risk |
| --- | --- | --- | --- |
| `/api/execution-cases` | GET | Filtered list via `listExecutionCases` | low-medium |
| `/api/engagement-center/cases` | GET | Filtered list via `listEngagementCenterCases` | low-medium |
| `/api/engagement-center/assign` | POST | Algorithmic assignment (§4.5) | **medium-high** |
| `/api/engagement-center/call-result` | POST | Call-result logging (§4.6) | **high** |
| `/api/scheduler-portal/cases` | GET | Scheduler-portal-scoped list | medium |
| `/api/execution-cases/by-screening/:patientScreeningId` | GET | Lookup by screening id | low |
| `/api/execution-cases/:id` | GET | Read by id | low |
| `/api/patient-journey-events` | GET | Journey-event list | low |

---

## 12. Journey event routes

The only read endpoint is `GET /api/patient-journey-events` *(executionCases.ts:474)*.

There is **no dedicated write endpoint**. Journey events are written as **side effects** from many other routes via `appendPatientJourneyEvent`. This is documented in `shared/contracts/journeyEvents.ts` (Batch 2). The full list of writer call sites is in that contract's header.

**ES-5 / ES-7 implication:** The lack of a centralized writer is the exact gap that orchestrator Batch 12 closes. Until that lands, any new code path that emits a journey event must do so via the existing `appendPatientJourneyEvent` repository function — never inline a raw insert.

---

## 13. Enterprise-grade standards (referenced above)

- **ES-1: Routes should not gain more business logic.** New logic goes in services. Existing inline logic should be wrapped (Batch 3) and migrated incrementally.
- **ES-2: Future services should hold use-case / business logic.** One service per use case; one file per service. Pure functions where possible. Side effects pushed to the edge.
- **ES-3: Future repositories should hold database access only.** No HTTP concerns, no AI calls, no business rules. The current `server/repositories/*` already follow this pattern (mostly).
- **ES-4: Shared contracts/types must not introduce runtime behavior.** `shared/contracts/` is type-only (Batch 2). No values, no functions, no runtime imports.
- **ES-5: No duplicate sources of truth.** Today we have several: `documents` ↔ `uploaded_documents` (migration-on-read bridge); `completed_billing_packages.packageStatus` ↔ `invoices.status` (no DB-level alignment); `patient_screenings.facility` (text) vs. future `facilities.id`.
- **ES-6: No hidden patient-identity duplication.** Today: identity duplicated across ~15 tables. Batch 5 (read helpers) and Batch 7 (matcher design) attack this.
- **ES-7: No direct status mutation without a clear future state-machine path.** Today: status enums are mutated inline in many routes (Engagement assignment, billing, invoices, execution case). Batch 10 introduces typed transitions.
- **ES-8: No new broad scans or all-row APIs.** Today: `/api/billing-records` (auto-create + return all), `/api/patients/database` (roster aggregation with 30 s cache), `/api/engagement/assignment-board` (all active cases). New endpoints must paginate (orchestrator Batches 13 and 14).
- **ES-9: No local-storage assumptions for production documents.** Production must use `STORAGE_PROVIDER=s3`. The legacy local `storage/documents/*` path is dev-only.
- **ES-10: No PHI or large response body in logs.** Verified in §1.8 ICD search. The structured logger (orchestrator Batch 20) extends this rule via PHI redactors.
- **ES-11: No migrations without design review.** `migrations/` is in the explicit-approval list in `do-not-touch.md`. Duplicate-numbered files exist; new migrations must start at `0026_*`.
- **ES-12: No fragile flow edits without dedicated review and QA.** The full do-not-touch surface in `do-not-touch.md` covers this. The 8 QA scripts in `scripts/qa-*.mjs` are the minimum bar; Batch 21 expands coverage.

---

## 14. Cross-route parity matrix (which Batch-3 wrappers need a parity test)

| Route | Owner of parity test | Test fixture |
| --- | --- | --- |
| `GET /api/patient-screenings/:id/admin-review/evidence` | `server/services/__tests__/adminReviewEvidenceParity.test.ts` | Canned patient with full reasoning blob |
| `POST /api/patient-screenings/:id/admin-review/regenerate` | `server/services/__tests__/adminReviewRegenerateParity.test.ts` | Patient with 2 prior `adminReview:*` entries |
| `POST /api/patient-screenings/:id/admin-review/regenerate-all` | `server/services/__tests__/adminReviewRegenerateAllParity.test.ts` | Patient with 3 tests across 2 ancillaries |
| `POST /api/patient-screenings/:id/admin-review/regenerate-ancillary` | `server/services/__tests__/adminReviewRegenAncillaryParity.test.ts` | Patient with brainwave + ultrasound; regen brainwave |
| `POST /api/patient-screenings/:id/admin-review/regenerate-test` | `server/services/__tests__/adminReviewRegenTestParity.test.ts` | Patient with two qualifying tests |
| `POST /api/patient-screenings/:id/admin-review/remove-test` | `server/services/__tests__/adminReviewRemoveTestParity.test.ts` | Assert `reasoning[testName]` preserved |
| `POST /api/patient-screenings/:id/admin-review/remove-ancillary` | `server/services/__tests__/adminReviewRemoveAncillaryParity.test.ts` | Patient with mixed ancillaries |
| `POST /api/patient-screenings/:id/admin-review/icd-search` | `server/services/__tests__/adminReviewIcdSearchParity.test.ts` | Assert no PHI in mocked logger |
| `POST /api/patient-screenings/:id/admin-approval` | `server/services/__tests__/adminApprovalParity.test.ts` | Approve Draft → expect 7-step side-effect order |
| `GET /api/billing-records` | `server/services/__tests__/billingAutoCreateParity.test.ts` | Dataset of 3 batches × 5 patients × 2 tests |
| `POST /api/billing-records/import-from-sheet` | (deferred; needs Google Sheets stub) | Fixture sheet with create + update + skip cases |

Each test must:
- Use **fictional PHI only** (synthetic name + DOB).
- Run idempotently.
- Assert response JSON deep-equality where applicable.
- Assert DB-row counts and column values before and after the call.

---

## 15. Stop conditions for the eventual Batch 3 implementation

The following situations require Claude (or any contributor) to **stop and ask** before continuing the Batch 3 implementation:

1. Any response-body diff between the wrapped service and the original route on the parity fixture.
2. Any change in the **order** of side effects (writes, audit, journey events, cache invalidations).
3. Any change to the **PHI-aware logging contract** in `/admin-review/icd-search`.
4. Any change to the `migrateLegacyUploadedDocuments` invocation in `documentLibrary.ts`.
5. Any change to the `reasoning` blob key format (`adminReview:<ancillary>`, `adminReview:test:<testName>`).
6. Any change to the conflict-guard error message in `/api/engagement/assignment-board/assign`.
7. Any change to the multi-row INSERT pattern in `/api/plexus-iq/clinical-import`.
8. Any change to the auto-create defaults in `GET /api/billing-records` (`billingStatus: "Not Billed"`, `paidStatus: "Unpaid"`).
9. Any unexpected new `data-testid` references that would imply a UI change disguised as a backend wrap.
10. Any need to add a `migrations/` file.

---

## 16. What this batch confirms

- **Protected flows preserved:** Yes — no source code edited; only one documentation file added.
- **API response shapes:** Only documented, not changed.
- **UI behavior and test IDs:** Untouched.
- **PDF and packet source data:** Untouched (no edits to `pdfGeneration.ts`, `patientPacket.ts`, or `getPatientPacket`).
- **Admin Review, Plexus IQ, Engagement Center, Scheduler Portal, Team Portals, billing, and documents:** Not changed.
- **Modular and reversible:** A single new doc file. `git rm docs/architecture/backend-route-parity-inventory.md` is a complete rollback.
- **Validation and QA run:** Per the validation block in the orchestrator. Results captured in the final report.

---

## 17. Rollback plan

`git rm docs/architecture/backend-route-parity-inventory.md` + revert this branch's single commit. No DB, app, or runtime state is affected.

---

## 18. Next safe steps after Batch 3a

1. **Batch 3b — wrap Admin Review handlers behind `adminReviewService.ts`.** Use the parity matrix in §14. Ship 1.1 → 1.9 each as a separate PR with its own parity test. Sub-batches in approval order:
   - 3b.1: `/admin-review/evidence` (lowest risk; no writes)
   - 3b.2: `/admin-review/regenerate` (single-ancillary)
   - 3b.3: `/admin-review/regenerate-ancillary` (filtered tests)
   - 3b.4: `/admin-review/regenerate-test` (single test)
   - 3b.5: `/admin-review/regenerate-all` (broadest writer)
   - 3b.6: `/admin-review/remove-test` and `/admin-review/remove-ancillary` (subtle invariant)
   - 3b.7: `/admin-review/icd-search` (PHI-aware logger contract)
   - 3b.8: `/admin-approval` (highest risk — touches commit + scheduler routing)
2. **Batch 3c — wrap `GET /api/billing-records` auto-create scan behind `billingAutoCreateService.ts`.** Separate PR with §14 parity test. Sets up Batch 17 (state-machine alignment).
3. **Inventory deepening for §2.2–§2.6 and §11.4** before any wrapper touches those routes.
4. **Resume orchestrator order** with Batch 5 (Patient Directory prep) once Batch 3 is complete.

End of inventory.

# PHASE 2L FUNCTIONAL FREEZE — Baseline Behavioral Contract

**Scope:** Documentation-only. This is the FROZEN behavioral contract of the Phase 2K enterprise-hardening baseline.
**Branch / HEAD:** `phase/2l-ui-discovery` @ `08a78978fcbca954f828c3f8a52f7eeffb3c40ba`
**Rule:** Every behavior below is a **factual mapping of EXISTING canonical code** at this HEAD. Any later 2L redesign MUST preserve each behavior flagged **`MUST PRESERVE IN 2L`**. Items that could not be confirmed from source are marked **`UNKNOWN_NEEDS_VERIFICATION`**.

> This document maps **behavior**, not intent. Where a canonical flag is OFF-by-default, the *canonical* behavior at HEAD is "flag OFF" — the disabled contract is the truth to preserve, not the (dormant) canonical write path.

---

## 1. AUTH / TENANCY

### 1.1 Authentication flow

| Concern | Endpoint | Source | Notes |
|---|---|---|---|
| Login | `POST /api/auth/login` | `server/routes.ts:152-172` | Zod `{username,password}` both `min(1)` (`:147-150`). `storage.validateUserPassword` (`:158`). 401 bad creds (`:160`); 403 if `user.active === false` (`:162-163`). |
| Logout | `POST /api/auth/logout` | `server/routes.ts:174-179` | `req.session.destroy()` + `res.clearCookie("connect.sid")`. |
| Current user | `GET /api/auth/me` | `server/routes.ts:181-186` | 401 if no `req.session.userId`; returns `{ id, username, role ?? "clinician", clinicId ?? null }`. |
| Password store | — | `server/repositories/users.repo.ts:39,50,61` | bcryptjs cost 12; `bcrypt.compare` on validate. |
| Session store | — | `server/index.ts:62-81` | `connect-pg-simple` over Postgres, `tableName:"session"`, `createTableIfMissing:true`. Cookie `httpOnly`, `secure` gated on `COOKIE_SECURE==="true"`, `sameSite:"lax"`, `maxAge:24h`. `resave:false`, `saveUninitialized:false`, secret `SESSION_SECRET`. |

**Session object (assigned ONLY at login, `server/routes.ts:165-170`; typed `server/session.d.ts:4-10`):** `userId` (uuid), `username`, `role` (string), `clinicId` (`number|null`). No other fields are stored.

- **Frontend surface:** `client/src/pages/login.tsx`; client auth via React Query custom `getQueryFn` (401 → redirect) in `client/src/lib/queryClient.ts`.
- **`MUST PRESERVE IN 2L`:** login/logout/me contract, 24h `lax` httpOnly cookie, bcrypt-12, `active===false` → 403, and the exact session shape `{userId,username,role,clinicId}`.

### 1.2 Middleware & role gates

| Middleware | Source | Behavior |
|---|---|---|
| `requireAuth` | `server/routes.ts:209-219`; mounted `app.use("/api", requireAuth)` (`:239`) | 401 if no `userId`. **Exemption:** `POST /sms/twilio/inbound` (validated by X-Twilio-Signature in-handler, `:212-214`). |
| `requireAdmin` | `server/routes.ts:221-229` | 403 if `role!=="admin"`. Gates `/api/users*` CRUD (`:404,423,437,446,459`). |
| `requireRole(...roles)` | `server/routes.ts:231-237` | Factory; absent role defaults to `"clinician"` (`:232`). **Every direct call site is `requireRole("admin")`** — the multi-role capability is currently unused. Passed into engagement registrars (`:288-290`). |
| `requireClinicianOrAdmin` | `server/routes/clinicianPortalGuard.ts:28-43` | Allowed `{clinician,admin}`; **fails closed** (no `?? "clinician"`). Gates Physician/Clinician Portal routes. |
| `requireRoles(Set)` | `server/routes/pcsAcsCanonical.ts:25-32` | `PCS_ROLES={admin,liaison}` → `GET /api/pcs/canonical-view`; `ACS_ROLES={admin,technician}` → `GET /api/acs/canonical-view`. Fails closed. |
| `clinicContext` | `server/middleware/clinicContext.ts:30-38`; mounted `server/index.ts:85` | admin → `req.clinicId=null` (sees all); else `req.clinicId = req.session.clinicId ?? null`. |

### 1.3 Roles (SIX real roles — NOT four)

`shared/schema/users.ts:4` → `USER_ROLES = ["admin","clinician","scheduler","biller","technician","liaison"]`. DB default role `"clinician"` (`users.ts:11`).

| Role | Server-side access | Client surface |
|---|---|---|
| `admin` | All `requireRole("admin")` + `requireAdmin` routes; **bypasses clinic filter** (`clinicContext.ts:31-33`); member of every guard set. | `AdminGuard` routes (`client/src/App.tsx`). |
| `clinician` | Physician/Clinician Portal via `requireClinicianOrAdmin`. | `/clinician-portal` `RoleGuard {admin,clinician}` (`App.tsx:184`). |
| `liaison` | PCS canonical view (`PCS_ROLES`). | `/liaison-portal`, `/liaison-technician-portal` (`App.tsx:182,189`). |
| `technician` | ACS canonical view (`ACS_ROLES`). | `/technician-portal` (`App.tsx:181`). |
| `biller` | No dedicated server `requireRole` gate; auth + `req.clinicId` scope only. | `/invoices` `RoleGuard {admin,biller}` (`App.tsx:168`). |
| `scheduler` | No dedicated server `requireRole` gate; auth + `req.clinicId` scope only. | `/scheduler-portal`, `/outreach/scheduler/:id` (`App.tsx:172,176`). |

- **`UNKNOWN_NEEDS_VERIFICATION`:** whether `scheduler`/`biller` have any server-side role restriction beyond `requireAuth`+clinic scope (grep found none — enforcement is client-side).
- **Note:** client references demo-only labels (`"Clinic Admin"`, `"Owner"`, `"patientCareSpecialist"`, `"ancillaryCareSpecialist"`) — UI/demo constructs, NOT real session roles.

### 1.4 Tenancy / clinic scope

- Tenant root: `clinics` table (`shared/schema/clinics.ts:13`); row id=1 = "Default Clinic" for legacy/nullable data.
- User→clinic: `users.clinicId → clinics.id` (`shared/schema/users.ts:16`, nullable, `onDelete:set null`).
- Scope derived **only from server session context** (never body/query/params). A **non-admin with null clinicId sees NO tenant-scoped data** (pre-backfill). Per-clinic guards return 403 on null clinic (`clinicianPortalGuard.ts:59-66`, `pcsAcsCanonical.ts:33-37`).
- **`MUST PRESERVE IN 2L`:** admin = clinic-null-bypass; non-admin = strict `req.clinicId` filter; clinic scope never derivable from client-supplied input.

---

## 2. PATIENT IDENTITY

Two identity models coexist at HEAD; the global model is **flag-gated OFF**.

### 2.1 Model A — Legacy Patient Directory (active)
- `patient_directory` — one row per unique person (`shared/schema/patientDirectory.ts:31`). `plexus_id` `PLX-000001…` via DB trigger (`:34-36`); FK target of `patient_screenings.patient_directory_id`.
- `PATIENT_DIRECTORY_STATUSES = ["active","inactive","merged","deleted"]` (`:23-28`), column default `"active"`.

### 2.2 Model B — Global Plexus Identity (Phase 2A, flag-gated OFF)
Gated by `FEATURE_PLEXUS_IDENTITY_WRITE` + `FEATURE_PLEXUS_IDENTITY_REVIEW` (default OFF); migration `0049` NOT auto-applied. Tables (`shared/schema/plexusIdentity.ts`): `global_plexus_patients` (`:105`), `patient_clinic_memberships` (`:159`), `patient_external_identifiers` (`:210`), `patient_identity_match_candidates` (`:265`), `patient_identity_merge_events` (`:313`), `plexus_id_aliases` (`:355`), `plexus_identity_link_failures` (`:389`).
- Vocabularies: `IDENTITY_STATUSES=["active","possible_duplicate","merged","inactive"]` (`:44-49`); `MEMBERSHIP_STATUSES=["active","inactive","withdrawn","merged_away"]` (`:52-57`); `MATCH_TIERS=["definitive","high","medium","low"]` (`:81`); `MATCH_REVIEW_STATUSES=["pending","confirmed","rejected","deferred"]` (`:84-89`).
- **No unique constraint on (name,dob)** — identity is opaque, resolver-controlled (`:132-134`).

### 2.3 Verified / unresolved (runtime outcomes, not stored columns)
- PCS identity boundary (`server/services/pcs/pcsIdentity.ts:36-62`): a case's PHI resolves **ONLY through a verified exact active clinic membership**, never from bare `case.globalPlexusPatientId`. Failure → `unresolved` with a PHI-free warning; display fields null; case **never grouped with another patient** (keyed by its own ancillaryCaseId). Warning codes: `identity_membership_missing/_wrong_clinic/_inactive`, `identity_patient_membership_conflict`, `identity_global_patient_missing/_not_current`.

### 2.4 Merged-patient behavior
- Merges written only via `createMergeEvent` (`server/repositories/plexusIdentity.repo.ts:382-393`) into append-only IMMUTABLE `patient_identity_merge_events`; reversal creates a NEW row, never mutates (`plexusIdentity.ts:310-312`). Reads follow `merged_into_patient_id` chain; old Plexus ID preserved in `plexus_id_aliases`.

### 2.5 "No demographic fallback" rule (IMMUTABLE policy)
`server/services/plexusIdentity/resolver.ts:27-32`:
- Name + DOB alone are **never** a definitive match.
- Fuzzy demographic similarity is **never** definitive.
- A cross-clinic clinic-MRN collision is **never** a match (MRNs scoped per clinic).
- Only prior Plexus ID (Step 1) and same-clinic MRN (Step 2) yield `definitive_match`; name+DOB/phone/email → `possible_match` (review queue, **never auto-merge**).

### 2.6 Identity routes (blocked)
- `server/routes/plexusIdentity.ts` is **NOT registered** in `routes.ts`; `requirePlexusIdentityAccess` **always denies** (no Plexus-internal role in `USER_ROLES`; blocker in `server/services/plexusIdentity/authorization.ts`). `match-candidates` → 501.
- **`MUST PRESERVE IN 2L`:** no-demographic-fallback rule; unresolved cases never grouped/merged; PHI only via verified active membership; merge events append-only/immutable.
- **`UNKNOWN_NEEDS_VERIFICATION`:** production source-of-truth between `patient_directory` and `global_plexus_patients` (uncommitted `docs/architecture/PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md` not read here).
- **Behavioral test:** `tests/unit/patientIdentity.test.ts`, `tests/unit/plexusIdentity.test.ts`, `tests/patientKey.test.ts`.

---

## 3. PATIENT / CASE LIFECYCLE

### 3.1 Status vocabularies (quoted from schema at HEAD)

| Schema file | Table | Column → allowed values |
|---|---|---|
| `screening.ts` | `patient_screenings` | `status` default `"pending"` (no enum); `appointment_status` default `"pending"` (no enum); `commit_status` default `"Draft"` → `COMMIT_STATUSES=["Draft","Ready","WithScheduler","Scheduled"]` (`:137`); `admin_approval_status` default `"pending"` → `ADMIN_APPROVAL_STATUSES=["pending","approved","needs_info","rejected"]` (`:129-134`). `screening_batches.status` default `"processing"` (no enum). |
| `adminReviewEvents.ts` | `ancillary_case_admin_review_events` | `ANCILLARY_REVIEW_STATUSES=["pending","approved","needs_info","rejected"]` (`:28-33`); legacy `"denied"`→`"rejected"`. `ANCILLARY_REVIEW_SOURCES=["manual","bulk","same_day_retroactive","reanalysis","migration","system_reconciliation"]` (`:38-45`). |
| `engagement.ts` | `engagement_call_settings` | `ENGAGEMENT_TEAMS=["PCS","ACS"]` (`:18`); `ROUNDING_MODES=["round","floor","ceil"]`. (Config table — no lifecycle status.) |
| `ancillaryCases.ts` | `patient_ancillary_cases` | `lifecycle_status`="new" → `ANCILLARY_LIFECYCLE_STATUSES=["new","active","on_hold","closed","cancelled","archived"]` (`:33-40`); active subset `["new","active","on_hold"]`; `qualification_status` → `["unscreened","qualified","not_qualified","pending_review"]`; `admin_review_status` → `["pending","approved","needs_info","rejected"]`. |
| `executionCase.ts` | `patient_execution_cases` | `QUALIFICATION_STATUSES=["unscreened","qualified","not_qualified","pending_review"]`; `LIFECYCLE_STATUSES=["active","completed","archived","cancelled"]`; `ENGAGEMENT_STATUSES=["new","contacted","scheduled","completed","not_reached","unable_to_reach"]`; `ENGAGEMENT_BUCKETS=["visit","outreach","scheduling_triage"]`. |
| `procedureEvents.ts` | `procedure_events` | `PROCEDURE_STATUSES=["not_started","in_progress","paused","complete","cancelled","no_show","unable_to_complete","reschedule_needed"]` (`:11-20`); `PROCEDURE_TERMINAL_STATUSES=["complete","cancelled","no_show","unable_to_complete"]` (`reschedule_needed` NOT terminal). |
| `procedurePrerequisites.ts` | `ancillary_service_prerequisite_config` | `PREREQUISITE_BLOCKER_CATEGORIES=["hard_procedure_blocker","soft_operational_warning","documentation_follow_up","billing_blocker","claim_submission_blocker"]`; `PREREQUISITE_STAGES=["scheduling","check_in","procedure_start","billing","claim_submission"]`. |
| `notes.ts` | `procedure_notes` | `NOTE_TYPES=["order_note","post_procedure_note"]`; `NOTE_GENERATION_STATUSES=["pending","generating","generated","failed","approved","voided"]`; `SIGNATURE_STATUSES=["needs_signature","ready_to_sign","signed","returned_for_correction"]`. |
| `generatedNotes.ts` | `generated_notes` | NO status column (legacy Drive-backed artifact; `doc_kind` free text). |
| `canonicalAppointments.ts` | (stored on `global_schedule_events`) | `CANONICAL_APPOINTMENT_STATUSES=["scheduled","completed","cancelled","no_show","rescheduled"]`; transitions `["complete","cancel","no_show","reschedule"]`. Only `event_type IN ("ancillary_appointment","same_day_add")` qualifies; `doctor_visit` EXCLUDED. |

### 3.2 Lifecycle stages & owning services

| Stage | Service (source) | Route / surface |
|---|---|---|
| Intake + AI screening | `server/services/screening.ts` (`screenSinglePatientWithAI:115`, `checkCooldownsForPatients:192`) | `server/routes/patients.ts`, `batches.ts`; qualification pages |
| Batch analysis | `server/services/batchAnalysisRunner.ts` (`startBatchAnalysis:244`, `runAnalysisLoop:559`) | `server/routes/batches.ts`, `admin-analysis-jobs.tsx` |
| Admin review | `server/services/adminReview/recordAdminReview.ts` (`recordAncillaryCaseAdminReview:139`), `bulkAdminReview.ts`, `screeningProjection.ts`, `authorization.ts` (**always 403**) | `server/routes/adminReviewEvents.ts` |
| Engagement | `server/services/engagement/distributionService.ts` (`buildDistributionPlan:181`, `applyDistribution:910`), `basketRules.ts`, `teamMetricsService.ts` | `server/routes/engagement*.ts`; `engagement-center.tsx` |
| Scheduling / order note | `server/services/canonicalAppointments/scheduleAncillaryOrchestrator.ts`, `transitionOrchestrator.ts`; `server/services/canonicalAppointments/canonicalAppointmentService.ts` (Order Note) | `server/routes/globalSchedule.ts`, `appointments.ts` |
| Ancillary case | `server/services/ancillaryCases/{screeningSync,reconciliation,failureRetry}.ts` | `server/routes/executionCases.ts` |
| Procedure lifecycle | `server/services/procedureLifecycle/procedureStateMachine.ts`, `canonicalProcedureCompletion.ts` (`completeCanonicalProcedure:252`), `procedureLifecycleOrchestration.ts` | `server/routes/procedureEvents.ts` |
| Report / procedure note / signature | `procedureNoteEligibility.ts` (2-condition gate), `procedureNoteGenerator.ts`, `procedureNoteService.ts`, `procedureNoteLineage.ts` (void/amend) | `server/routes/generatedNotes.ts`, `physicianPortal.ts` |

### 3.3 Completion / cancellation / no-show / failure paths

**Procedure state machine (`server/services/procedureLifecycle/procedureStateMachine.ts:11-16`):**
```
not_started → in_progress
in_progress ↔ paused
{not_started,in_progress,paused} → cancelled      (voidsNote:true)
{not_started,in_progress,paused} → no_show        (voidsNote:true)
{in_progress,paused}            → unable_to_complete (voidsNote:true)
{in_progress,paused}            → complete
```
- Terminal rows never reopened (`terminal_state` conflict). Each terminal transition stamps `cancelledAt/noShowAt/unableToCompleteAt`+reason, voids current note lineage, re-triggers billing readiness.
- Completion outcome codes (`canonicalProcedureCompletion.ts:73-97`): pre-commit — `skipped_flag_off`, `exact_case_required`, `cross_clinic_denied`, `service_mismatch`, `identity_mismatch`, `case_not_found/_inactive`, `zero_row_conflict`, `timestamp_conflict`, `invalid_from_state`, `migration_missing`, …; post-commit — `completed_and_linked`, `completed_note_created/_reused`, `completed_waiting_for_report`, `completed_reconciliation_deferred/_not_recorded/_migration_missing`, `error`.
- Note void/reconciliation outcomes: `not_required | voided | no_current_note | deferred_retry_recorded | reconciliation_not_recorded | migration_missing | reference_missing`.
- Admin-review engagement outcomes (`recordAdminReview.ts:69-77`): `activated | restored | already_active | deferred_no_list | deactivated | no_change | skipped_flag_off | failed`.
- Ancillary case failure actions: `RECONCILIATION_FAILURE_ACTIONS=["ensure_active","place_on_hold","cancel","archive","refresh_projection"]`.

- **`MUST PRESERVE IN 2L`:** terminal states never reopened; every terminal procedure transition voids current note lineage AND re-triggers billing readiness; completion is idempotent (`complete→complete` allowed); no silent success on failure.
- **`UNKNOWN_NEEDS_VERIFICATION`:** `patient_screenings.status`/`.appointment_status`/`screening_batches.status` have no schema enum (free-text, convention-driven set); the exhaustive writer set for `execution_case.engagement_status`/`unable_to_reach` was not located in the scanned services.
- **Behavioral tests:** `tests/unit/procedureStateMachineAndGenerator.test.ts`, `procedureFinalAcceptance.test.ts`, `procedureNoteEligibility.test.ts`, `procedureNoteCaseIdentity.test.ts`, `adminReviewAndEngagement*.test.ts`, `ancillaryCases.test.ts`, `caseStageVector2J.test.ts`.

---

## 4. DOCUMENT LIFECYCLE

### 4.1 Canonical ancillary documents (Phase 2E, flag-gated OFF)
`shared/schema/ancillaryDocuments.ts`, table `ancillary_document_references` (`:68`):
- `ANCILLARY_DOCUMENT_KINDS=["order_note","report","consent","screening_form","procedure_note","billing_document"]` (`:37-46`).
- `ANCILLARY_DOCUMENT_STATUSES=["pending","pending_signature","signed","uploaded","superseded","voided"]` (`:49-59`).
- **Supersession:** `supersededAt` column (`:95`); failure action `supersede_reference` (`:128`), `reconcile_procedure_note_lineage` (supersede + amend on report replacement), `supersede_billing_document` (`:143,150`).
- Retry ledger `ancillary_document_reconciliation_failures` (`:156`): `attemptCount` default 1, `lastAttemptedAt`, `resolvedAt` nullable (unresolved = `resolvedAt IS NULL`); **no max-attempt cap** in schema.

### 4.2 Document readiness & requirements
`shared/schema/documentReadiness.ts`: `document_requirements`, `case_document_readiness`; `DOCUMENT_STATUSES=["missing","pending","uploaded","generated","approved","completed","blocked"]` (`:20-28`).

### 4.3 Legacy uploaded documents & notes
`shared/schema/documents.ts`: `uploaded_documents` (`kind` text, `DOCUMENT_KINDS`), `document_blobs`, `documents`, `document_surface_assignments`, `marketing_materials`. `generated_notes` (legacy Drive-backed notes).

### 4.4 Signature behavior
- `procedure_notes` (`shared/schema/generatedNotes.ts`) is the ONLY table with a real signature state machine: `SIGNATURE_STATUSES=["needs_signature","ready_to_sign","signed","returned_for_correction"]` + `signedAt`/`signedByUserId`/`returnReason`. Signature fields are **omitted from the insert schema** and stamped **exclusively at the repository boundary** (`signProcedureNoteRow`/`returnProcedureNoteRow`) — a client body can NEVER seed signer/signed-at/status (`generatedNotes.ts:107-135`).
- Order Note: `ORDER_NOTE_SIGNATURE_REQUIREMENTS=["unresolved","required","not_required"]` — **"We NEVER auto-sign in Phase 2E-A"** (`ancillaryDocuments.ts:63`).
- Consents: `POST /api/case-document-readiness/complete` sets `signedAt=completedAt` ONLY when `referenceKind==="consent"` && `finalStatus==="completed"` (`server/routes/documentReadiness.ts:274`) — implicit-on-completion.
- **Signed bodies immutable**; report replacement supersedes a signed note and opens a pending amendment (`procedureNoteLineage.ts`). Reconciliation action `sync_procedure_note_signature` mirrors a signature transition onto the exact reference. Void safety: a source-bearing void NEVER resolves without terminal evidence (`ancillaryDocuments/retryWorker.ts:498-529`).
- **Behavioral test:** `tests/unit/physicianSignatureWorkflow.test.ts`, `ancillaryDocumentsProjection.test.ts`, `ancillaryDocumentRetryAndBackfill.test.ts`, `ancillaryDocumentsFinalStateSync.test.ts`.

- **`MUST PRESERVE IN 2L`:** kind & status vocabularies; supersede-on-replacement (never delete/mutate signed evidence); void requires terminal evidence; exact-source binding on reconciliation (never name/facility/newest).

---

## 5. FINANCIAL LIFECYCLE

All canonical financial stages (Phase 2G/2J) are **flag-gated OFF** (migrations 0055/0056 not auto-applied). The canonical semantics below are the *contract*; at HEAD the runtime behavior is the disabled path.

| Domain | Table | Status vocabulary (source) |
|---|---|---|
| Billing readiness | `billing_readiness_checks` | `BILLING_READINESS_STATUSES=["not_ready","missing_requirements","ready_to_generate","billing_document_generated","sent_to_billing"]`; canonical `["missing_requirements","ready_to_generate","billing_document_pending","billing_document_generated","superseded","invalidated","migration_missing"]` (`shared/schema/billingReadiness.ts:10-31`). |
| Billing Document | `billing_document_requests` | request `["pending","generating","generated","failed","sent_to_billing"]`; canonical `["pending","generating","generated","approved","failed","superseded","voided"]` (`shared/schema/billingDocuments.ts:11-31`). **Operational packet — NOT a claim/invoice/payment.** |
| Claim | `canonical_claims` | `CANONICAL_CLAIM_STATUSES=["not_ready","ready","draft","queued","submitted","accepted","rejected","denied","partially_paid","paid","voided","superseded"]` (`canonicalClaims.ts:12-15`). |
| Invoice | `canonical_invoices` | `CANONICAL_INVOICE_STATUSES=["draft","approved","issued","delivered","partially_paid","paid","voided","superseded","delivery_failed"]` (`canonicalInvoices.ts:11-14`). |
| Payment | `canonical_payments` | `CANONICAL_PAYMENT_EVENT_TYPES=["payment","refund","reversal","adjustment"]`; `CANONICAL_PAYMENT_STATUSES=["pending","imported","posted","reversed","failed"]`; only `"payment"` counts as collected (`canonicalPayments.ts:12-20`). |
| Allocations | `canonical_payment_allocations` | `CANONICAL_ALLOCATION_EVENT_TYPES=["apply","refund","reversal","adjustment"]` (`:19`); `parentAllocationId` links refund/reversal to exact parent apply. |

**Refund / reversal semantics (`MUST PRESERVE IN 2L`):** append-only ledger. A refund/reversal is a **NEW `canonical_payment_allocations` row** (`eventType ∈ {refund,reversal}`) naming an exact parent `apply` allocation via `parentAllocationId`; originals are **never mutated** (`canonicalPayments.ts:2-4`, `canonicalPaymentAllocations.ts:17-19`). Command path `paymentCommands.negateAllocation` (`refundCanonicalPayment`/`reverseCanonicalPayment`) under advisory lock; lineage `validateNegationLineage` (`allocationLineage.ts:74-95`) requires matching payment+target+clinic/case/service/currency and cumulative negation ≤ parent applied → else `exceeds_original`; equal → `already_reversed`. **Balances are DERIVED from the ledger, never stored** (`balance.ts`): only `payment` events with `posted` status count as collected; net = paid − refunded − reversed. Payment-level `reversesPaymentId` + status `reversed` also exist. Every command writes exactly ONE `canonical_financial_transitions` audit row (idempotencyKey + commandFingerprint; same key+different fingerprint → conflict). `SUPPORTED_CURRENCIES={"USD"}`. All canonical financial tables are append-only with NO `updated_at`. **No revenue-share/commission/profit-split target ever exists.**
- **`UNKNOWN_NEEDS_VERIFICATION`:** business-semantic distinction between `refund` vs `reversal` (code treats both as identical negations); `adjustment` eventType has no command path yet; precedence of payment-level `reversesPaymentId` vs allocation-level negation; whether canonical Billing Documents require signing (`CANONICAL_BILLING_DOCUMENT_STATUSES` has no signature state).

**Claim/invoice lineage:** a canonical claim is built from the **EXACT current Billing Document evidence version**; invoices derive from a claim; corrections create new versioned rows (`canonical_financial_transitions`).

**Legacy Phase-4 operational billing (active, non-flagged) — separate stack; canonical 2J "never reads or rewrites" it (`canonicalInvoices.ts:2-4`):**
- `invoices` (`shared/schema/invoices.ts`): `INVOICE_STATUSES=["Draft","Sent","Partially Paid","Paid"]`; `INVOICE_APPROVAL_STATUSES=["draft","pending_review","approved","voided","revised"]`; `INVOICE_DELIVERY_STATUSES`. Void requires reason, stamps `voidedAt`/`voidReason` (`billing/invoiceApprovalService.ts`).
- `invoice_line_items`, `invoice_payments` (`PAYMENT_METHODS`); `invoice_readiness_snapshots` (`INVOICE_READINESS_STATUSES`, 17 `INVOICE_READINESS_BLOCKERS`); `invoice_delivery_events`; `invoice_batches`/`invoice_batch_items` (`INVOICE_BATCH_STATUSES` incl `voided`); `invoice_adjustments` (`["write_off","contractual","correction","discount","dispute_hold","manual"]`), `invoice_denials` (`["open","appealed","overturned","upheld","closed"]`), `remittance_events` (`invoiceFinancialEvents.ts`); `completed_billing_packages` (`PAYMENT_STATUSES=["not_received","pending","updated","disputed","reversed"]`); `cash_price_settings`; `billing_records` (free-text `billingStatus`/`paidStatus`); `projected_invoice_rows`.
- Phase-4 `invoiceFinancialService.ts`: forward payments only (no refund/reversal); balance = charges − (paid + adjusted) → derives "Paid"/"Partially Paid". `invoicing/invoicingScaffold.ts` is DORMANT (pure projection, no DB writes; throws unless `readinessStatus==="ready"`).

- **Behavioral tests:** `tests/unit/canonicalFinancialLifecycle.test.ts`, `canonicalFinancialCommands.test.ts`, `canonicalFinancialLineageCorrection.test.ts`, `canonicalFinancialExactVersion.test.ts`, `billingReadinessAndDocument.test.ts`, `billingBlockerCloseout.test.ts`, `invoiceRecompute.test.ts`.

---

## 6. RETRY / RECOVERY / FAIL-CLOSED

### 6.1 Outbox (`server/services/outbox.ts`)
- Durable queue for external side-effects (Drive/S3 uploads, Sheets sync); table `outbox_items`; `OUTBOX_STATUSES=["pending","uploading","completed","failed"]` (`shared/schema/outbox.ts:11-12`); kinds `drive_file`, `sheet_billing`, `sheet_patients`.
- `markFailed` increments `attempts` (`:81-87`) but **no max-attempts cap** — failed items retried indefinitely on every drain. `drainOutbox` (`:178-207`) processes `["pending","failed"]`, per-item try/catch (one failure never aborts batch). Sheet-sync coalescing dedupes pending/failed by kind (`:35-48`). On success, Drive metadata written back to `generated_notes`/`uploaded_documents` (outbox-first).
- **`UNKNOWN_NEEDS_VERIFICATION`:** no periodic driver for `drainOutbox` is registered in `startBackgroundServices` (`server/lifecycle.ts:22-31`); trigger appears route-driven (`/api/outbox/drain`). Retry is uncapped; no dead-letter threshold observed.

### 6.2 Canonical document reconciliation retry (`server/services/ancillaryDocuments/retryWorker.ts`)
- **Flag gate:** returns `skipped` / `{processed:0}` when `unifiedAncillaryDocuments` OFF (`:193-195,569`).
- **Exact source binding:** loads the EXACT canonical source, validates `clinicId` (`cross_clinic_denied`), document-kind→action, screening/execution IDs; source-less failures use deterministic discovery ("never first/newest").
- **Resolve ONLY the exact failure id** (`resolveAncillaryDocumentFailureById`) — never sibling/case-shared failures.
- **Structured non-resolving (fail-closed) statuses:** `still_deferred`, `not_yet_eligible`, `signed_evidence_conflict`, `reference_missing`, `active_kind_conflict`, `cross_clinic_denied`, `case_mismatch`, `ownership_conflict`, `source_type_mismatch`, `service_mismatch`, `migration_missing`, `terminal_evidence_missing`.
- On thrown error: re-records a durable failure row, returns `status:"error"` — never silently swallowed.

### 6.3 Advisory locks (`server/lib/advisoryLock.ts`)
- `withAdvisoryLock(name,fn)` — sha256→two int32 key, `pg_try_advisory_lock` (NON-blocking; `{acquired:false}` if held), released in `finally`. Session-level callers: `syncService.ts` (patients/billing/export-notes), `morningRebuildScheduler.ts`, `absenceWatcher.ts`, `invoiceReminderService.ts`, `schedulerAssignments.ts`.
- Transaction-level `pg_advisory_xact_lock` on `(clinicId,paymentId)` + `(target)` before allocation in `canonicalFinancial/paymentCommands.ts` — **FAILS CLOSED** ("derived target status update must affect EXACTLY ONE row").
- **Fleet safety:** background jobs (`startBackgroundServices`, `server/lifecycle.ts:22-31`) each acquire their advisory lock per tick → side-effects fire once per tick across multiple ECS tasks.

### 6.4 Other fail-closed sites
`canonicalStage/caseStageVector.ts:240` (failed receipt load → empty), `canonicalFinancial/allocationLineage.ts:51` ("never silently reduce owed"), `financialVersion.ts:68,80`, `financialLineageContext.ts:118`, `lineageValidators.ts:171,180`, `billingLifecycle/billingReadinessEvaluator.ts:198,245,338`, `pcs/pcsCanonicalView.ts:278` (propagate, never fabricate), `ancillaryCases/reconciliation.ts:26-27` ("Never fire-and-forget. Never `.catch(()=>{})`.").

- **`MUST PRESERVE IN 2L`:** exact-source binding on all retries; resolve only the exact failure id; every fail-closed status stays open (no silent success); advisory-lock single-fire per tick; append-only durable failure ledger.
- **Behavioral tests:** `tests/unit/phase2KFailureInjection.test.ts`, `phase2KConcurrencyHardening.test.ts`, `phase2KRetryInventoryCoverage.test.ts`, `procedureRetryExecutionFinalization.test.ts`, `canonicalAppointmentRetryIntegration.test.ts`, `procedureDurabilityPass.test.ts`.

---

## 7. PORTALS

| Portal | Page (client) | Route path | Primary `/api/` surface | Gate |
|---|---|---|---|---|
| PCS (Patient Care Specialist) | `patient-care-specialist-portal.tsx` | `/patient-care-specialist-portal` | `/api/portal/widgets`, `/api/portal/workspace-prefs`, `/api/pcs/canonical-view` (flag-gated) | `PCS_ROLES={admin,liaison}` |
| ACS (Ancillary Care Specialist) | `ancillary-care-specialist-portal.tsx` | `/ancillary-care-specialist-portal` | `/api/portal/widgets`, `/api/portal/workspace-prefs`, `/api/acs/canonical-view` (flag-gated) | `ACS_ROLES={admin,technician}` |
| Clinician / Physician Portal | `physician-portal.tsx` | `/physician-portal`, `/clinician-portal` | `/api/physician-portal/{summary,signature-items,signature-items/bulk-sign,reports,ancillary-metrics,financial-health}` | `requireClinicianOrAdmin` |
| Team Member / Scheduler | `team-member-portals.tsx`, `outreach-scheduler-portal.tsx`, `technician-portal.tsx`, `liaison-portal.tsx` | `/team-member-portals`, `/scheduler-portal`, `/outreach/scheduler/:id`, `/technician-portal`, `/liaison-portal` | `/api/scheduler-assignments*`, `/api/outreach/*` | client `RoleGuard`; scheduler/technician/liaison |
| Admin | `admin.tsx`, `admin-settings-center.tsx`, `admin-users.tsx`, `admin-outbox.tsx`, `admin-analysis-jobs.tsx`, `admin-ops.tsx` | `/admin*`, `/admin-ops` | `/api/users`, `/api/outbox*`, `/api/admin/*`, `/api/admin-settings*` | `AdminGuard` / `requireAdmin` |
| Finance / Billing | `billing.tsx`, `billing-readiness.tsx`, `invoices.tsx`, `invoice-review.tsx`, `invoice-batches.tsx`, `invoice-delivery.tsx`, `remittance-audit.tsx`, `billing-auditor.tsx`, `billing-reports.tsx` | `/billing*`, `/invoices` | `/api/invoices*`, `/api/billing-readiness-checks`, `/api/billing-document-requests`, `/api/completed-billing-packages` | `/invoices` `RoleGuard {admin,biller}`; others `AdminGuard` |

- **`MUST PRESERVE IN 2L`:** each portal's role gate and its `/api/` surface. Canonical portal views (`/api/pcs|acs|clinician-portal/canonical-*`) return an **explicit disabled contract** while their flag is OFF and the portal renders exactly as before.
- **Behavioral tests:** `tests/unit/pcsAcsCanonicalView.test.ts`, `clinicianPortalCanonicalOverview.test.ts`, `physicianPortalSummaryService.test.ts`, `physicianReportsService.test.ts`, `teamPortalCanonicalRouteParity.test.ts`.

---

## 8. FEATURE FLAGS

### 8.1 Server env flags — `server/lib/featureFlags.ts` (ALL default OFF; read once at startup; runtime flip unsupported)

| Flag (key) | Env var | Default | Behavior when OFF |
|---|---|---|---|
| `internalDirectMessages` | `FEATURE_INTERNAL_DIRECT_MESSAGES` | OFF | Every DM endpoint returns 501 `{error:"internal direct messages feature disabled"}` (`routes/directMessages.ts:38-41`). |
| `portalAssistant` | `FEATURE_PORTAL_ASSISTANT` | OFF | Portal AI chat backend off; route registration commented out (`routes.ts:308`). |
| `clinicalIntelligenceLive` | `FEATURE_CLINICAL_INTELLIGENCE_LIVE` | OFF | No server persistence; Clinical Intelligence stays on client localStorage. |
| `clinicianPortalBackend` | `FEATURE_CLINICIAN_PORTAL_BACKEND` | OFF | Alt clinician-portal backend disabled. |
| `clinicianPortalCanonicalData` | `FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` | OFF | Endpoint returns explicit disabled contract before any canonical read; portal renders as before. |
| `pcsCanonicalView` | `FEATURE_PCS_CANONICAL_VIEW` | OFF | Disabled contract before any canonical read; PCS workspace unchanged. |
| `acsCanonicalView` | `FEATURE_ACS_CANONICAL_VIEW` | OFF | Disabled contract before any canonical read. |
| `plexusIdentityWrite` | `FEATURE_PLEXUS_IDENTITY_WRITE` | OFF | No identity persistence; read helpers return empty; ON w/o migration fail-fasts at write. |
| `plexusIdentityReview` | `FEATURE_PLEXUS_IDENTITY_REVIEW` | OFF | Review endpoints off; must stay off until a Plexus-internal role exists. |
| `ancillaryCaseWrite` | `FEATURE_ANCILLARY_CASE_WRITE` | OFF | Reconciliation returns `skipped_flag_off`; zero DB reads/writes; ingestion byte-identical. |
| `serviceSpecificAdminReview` | `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW` | OFF | Admin-review write path off; compatibility reads still work. |
| `engagementAdminReviewSync` | `FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC` | OFF | Engagement eligibility does not reconcile on review-status change. |
| `engagementMultiListRepository` | `FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` | OFF | Multi-list Repository model hidden. |
| `engagementRecentLists` | `FEATURE_ENGAGEMENT_RECENT_LISTS` | OFF | "Most Recently Sent" (top-10) section hidden. |
| `canonicalAppointment` | `FEATURE_CANONICAL_APPOINTMENT` | OFF | All Phase 2D orchestrators return `skipped_flag_off`/empty; projections empty. |
| `unifiedAncillaryDocuments` | `FEATURE_UNIFIED_ANCILLARY_DOCUMENTS` | OFF | Zero `/api/ancillary-documents` reads; retry worker returns `skipped`/`{processed:0}`. |
| `canonicalOrderNote` | `FEATURE_CANONICAL_ORDER_NOTE` | OFF | Order Note flow off (service returns early). |
| `canonicalProcedureLifecycle` | `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE` | OFF | No case-linkage write on completed `procedure_events`; hook no-op. |
| `canonicalProcedureNote` | `FEATURE_CANONICAL_PROCEDURE_NOTE` | OFF | Procedure Note eligibility/create off. |
| `procedureNoteGenerator` | `FEATURE_PROCEDURE_NOTE_GENERATOR` | OFF | No clinical-body generation; never auto-signs. |
| `canonicalBillingReadiness` | `FEATURE_CANONICAL_BILLING_READINESS` | OFF | Zero migration-0055 reads/writes; legacy billing untouched. |
| `canonicalBillingDocument` | `FEATURE_CANONICAL_BILLING_DOCUMENT` | OFF | Billing Document lifecycle off. |
| `billingDocumentGenerator` | `FEATURE_BILLING_DOCUMENT_GENERATOR` | OFF | No packet body generation; `generatedByAi=false`. |
| `canonicalClaims` | `FEATURE_CANONICAL_CLAIMS` | OFF | Zero migration-0056 reads/writes; invoice desk untouched. |
| `canonicalInvoices` | `FEATURE_CANONICAL_INVOICES` | OFF | Canonical invoice lifecycle off. |
| `canonicalPayments` | `FEATURE_CANONICAL_PAYMENTS` | OFF | Canonical payment ledger off. |
| `canonicalClaimTransmission` | `FEATURE_CANONICAL_CLAIM_TRANSMISSION` | OFF | Present-but-inert; NO transmission adapter exists in the repo. |

**Composite AND-chained runtime gates (any partial combo → false → no canonical read/write; legacy path preserved):** `procedureNoteRuntimeEnabled()` (lifecycle+note+unifiedDocs); `billingReadinessRuntimeEnabled()` (+ancillaryCaseWrite+canonicalAppointment+canonicalOrderNote+canonicalBillingReadiness); `billingDocumentRuntimeEnabled()`; `canonicalClaimsRuntimeEnabled()`/`Invoices`/`Payments` (`featureFlags.ts:224-281`).

**PERMANENT EXCLUSION:** no flag under any name for Twilio/patient SMS (`featureFlags.ts:8-9`).

### 8.2 Additional env activation flags (default OFF)
- `USE_PATIENT_DIRECTORY_ACTIVATION` — `server/services/patientDirectory/patientDirectoryActivationFlag.ts` (Patient EHR route registration gate).
- `USE_PATIENT_DIRECTORY_SERVICE` — `patientDirectoryService.ts`.

### 8.3 Client build-time flags (`import.meta.env.VITE_FEATURE_*`, default OFF)
`client/src/lib/*Flag.ts`: `canonicalAppointmentUiFlag`, `unifiedAncillaryDocumentsFlag` (+`VITE_FEATURE_CANONICAL_ORDER_NOTE`), `acsCanonicalViewFlag`, `pcsCanonicalViewFlag`, `clinicianPortalCanonicalFlag`, `procedureLifecycleFlag`, `canonicalClaimsFlag`, `canonicalInvoicesFlag`, `canonicalPaymentsFlag`, `engagementCanonicalCallResultsUiFlag`. `engagement-center.tsx:122-133` reads `VITE_FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` / `_RECENT_LISTS` inline (OFF → default tab "pool", repository tab hidden).

### 8.4 DB-backed admin/app settings (runtime-mutable; NOT env flags)
- `app_settings` (`shared/schema/appSettings.ts`): flat key/value via `getSetting`/`setSetting` (`server/dbSettings.ts`). Qualification mode default `"permissive"`; invoice-reminder threshold.
- `admin_settings` (`shared/schema/adminSettings.ts`): scoped JSONB, precedence testType > facility > user > global > compile-default (`server/services/adminSettings/adminSettingsEffectiveService.ts`).
- **Only OFF-by-default behavioral toggle among admin settings:** `assignment.scheduler_auto_assign_enabled` default **false** (`adminSettingsEffectiveService.ts:235`) ⇒ commit-time auto-assign is a no-op; case stays unassigned in the Engagement Center pool for manual distribution (`schedulerAutoAssign.ts:181-195`). Remaining toggles default **true** (facility-scope respect, global-schedule source-of-truth, PTO blocks, terminal DNC/declined, queue re-entry, etc.).

- **`MUST PRESERVE IN 2L`:** all flags default OFF; OFF = disabled-contract/no canonical read-write with legacy path byte-identical; composite AND-gating (no partial canonical enablement); no SMS flag ever; `scheduler_auto_assign_enabled` OFF-by-default.
- **Behavioral tests:** `tests/unit/directMessagesFeatureGate.test.ts`, `phase2KQueryBoundaries.test.ts`, `canonicalRouteMap.test.ts`, `canonicalUiManifest.test.ts`, `livePagesNoPrototypeImports.test.ts`.

- **`UNKNOWN_NEEDS_VERIFICATION`:** `POST /api/settings/qualification-modes` lacks a `requireRole` guard (`server/routes/settings.ts:179`) — intentional vs oversight not determinable from source.

# Plexus Command Center Production-Readiness Gap Analysis

- **Assessment date:** 2026-08-25
- **Assessment type:** Read-only evidence review with WP1 source remediation; no deployment or AWS/data mutation
- **Production AWS account verified:** `374604322534`
- **Development AWS account verified:** `107554921331` — includes development and QA workloads
- **Overall verdict:** **NOT DEPLOY READY**

## 1. Executive Summary

Plexus Command Center is not ready for additional production rollout or expanded PHI workflows. The completed source, production, development, and QA review found **50 gaps: 10 Critical, 31 High, 8 Medium, and 1 Low**. Twenty-three items are Sprint 0 release blockers or immediate containment work.

The most urgent risks are:

1. Tenant isolation fails open in core data paths, creating cross-clinic broken-object-level authorization risk.
2. The primary API-response and AI diagnostic logging paths now have locally validated source mitigations, but deployment, historical log/data review, and broader legacy console cleanup remain open.
3. Production database/session credentials, development ECS AWS access keys, and development FHIR Lambda private keys are configured as ordinary runtime environment values rather than secret references.
4. Production disables database TLS certificate verification and runs with `NODE_ENV=development`.
5. Privileged approval and administrative endpoints do not consistently enforce role and tenant boundaries.
6. Every production container start runs a forced Drizzle schema push against the database.
7. The external-AI BAA, HIPAA-eligible configuration, retention policy, and PHI-use controls were not evidenced.
8. The production deployment pipeline uses mutable `latest` images and lacks mandatory tests, staged promotion, stability checks, and automatic rollback.
9. Development has no CloudTrail and its EKS API is public to `0.0.0.0/0` with all control-plane logging disabled.
10. PHI-likely development/QA storage exists without evidence that non-production data is synthetic or formally approved and de-identified.

WP1 application source remediation was implemented and validated locally for GAP-004, GAP-005, and GAP-016. No deployment, AWS mutation, deletion, database mutation, secret retrieval, data-plane object access, or production API mutation was performed.

## 2. Scope and Evidence Standard

The review covered four dimensions:

- **Application Code:** authentication, authorization, tenant isolation, schema, imports, PHI handling, auditability, and clinical AI.
- **AWS Infrastructure:** ECS, EKS, Lambda, RDS/Aurora, S3, OpenSearch, Valkey, SQS, CloudTrail, CloudWatch, WAF/ALB, IAM, ECR, Secrets Manager, KMS, networking, security services, backups, and cost inventory.
- **Operations and Delivery:** container startup, CI/CD, release immutability, rollback, tests, and smoke coverage.
- **Product and Clinical Readiness:** canonical patient workflows, interoperability, record lifecycle, production-visible prototypes, and regulatory governance.

Evidence labels used below:

- **Confirmed — source:** directly observed in repository code or configuration.
- **Source-remediated — locally validated:** the identified source path has a tested local fix, but the change is not deployed and historical data/log containment may remain.
- **Confirmed — production runtime:** directly observed with read-only AWS CLI calls against account `374604322534`.
- **Confirmed — development runtime:** directly observed with read-only AWS CLI calls against account `107554921331`; this account contains both development and QA workloads.
- **Runtime-unverified:** static or control-plane evidence exists, but the relevant data plane or deployed behavior was not inspected.
- **Governance-unverified:** required contract, policy, classification, or review evidence was unavailable; this does not assert that the artifact does not exist.

Severity reflects release and patient-data risk, not a formal legal conclusion. HIPAA, FDA/SaMD, GxP, and contractual applicability require qualified compliance and regulatory review.

## 3. Risk and Sprint Summary

| Severity | Count | Meaning |
|---|---:|---|
| Critical | 10 | Credible PHI exposure, cross-tenant access, credential, transport, or destructive production-change risk; block release. |
| High | 31 | Material security, compliance, clinical workflow, availability, or data-integrity risk. |
| Medium | 8 | Important hardening, operability, cost, interoperability, or assurance gap. |
| Low | 1 | Deferred capability gap with limited immediate safety impact. |
| **Total** | **50** | |

| Sprint | Count | Objective |
|---|---:|---|
| Sprint 0 | 23 | Contain release blockers, PHI leakage, tenant bypass, unsafe deployment, exposed management planes, and clinical governance risks. |
| Sprint 1 | 20 | Establish durable security, audit, resilience, canonical identity, and release controls. |
| Sprint 2 | 6 | Complete data lifecycle, interoperability, assurance, and cost optimization work. |
| Sprint 3 | 1 | Address deferred offline/cross-platform capability after core safety controls. |

## 4. Detailed Gap Register

### 4.1 Application Code

| Gap | Dimension | Severity | Sprint | Current State | Target State | Effort | Automated Fix? | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|
| GAP-001 | Application Code | Critical | 0 | **Confirmed — source.** Clinic scope is fail-open when `clinicId` is `null` or `undefined`; ID-based reads and writes constrain by record ID rather than record ID plus tenant. Core patient, batch, billing, document, and patient-database routes are not consistently clinic-scoped. | Derive immutable tenant context from the authenticated session; deny requests with absent scope; enforce tenant predicates in every repository read/write; add database-level isolation or an equivalent infrastructure-enforced boundary; test cross-tenant denial. | XL | Partial | `server/repositories/screening.repo.ts`; `server/routes/patients.ts`; `server/routes/batches.ts`; `server/routes/billing.ts`; `server/routes/documentLibrary.ts`; `server/routes/patientDatabase.ts`. Primary BOLA/PHI-isolation release blocker. |
| GAP-002 | Application Code | Critical | 0 | **Confirmed — source.** `POST /api/patient-screenings/:id/admin-approval` is authenticated but does not enforce an administrator role. | Require explicit least-privilege permission, tenant ownership, reauthentication where appropriate, and an immutable approval audit event. | S | Yes | `server/routes/patients.ts`. Add negative role and cross-tenant tests before release. |
| GAP-003 | Application Code | Critical | 0 | **Confirmed — source.** `/api/audit-log`, `/api/audit-log/users`, and `/api/admin/analysis-jobs` lack consistent administrator authorization and tenant scoping. | Restrict endpoints to approved administrative permissions and tenant boundaries; expose minimum necessary fields; audit access to audit data. | M | Yes | `server/routes.ts`. Audit logs can themselves contain sensitive operational and user information. |
| GAP-004 | Application Code | Critical | 0 | **Source-remediated — locally validated.** The response-body capture was removed, and centralized API completion telemetry now projects only a PHI-free allowlisted envelope: server-generated request ID, process-local keyed opaque route token, method, status, duration, and outcome. Regression coverage confirms that response payloads and concrete path identifiers are not logged. Deployment, broader non-AI legacy `console.*` exception cleanup, and controlled review/containment of historical CloudWatch logs remain open. | Log only a PHI-free allowlisted envelope such as request ID, route template, status, duration, actor pseudonym, and tenant pseudonym; redact structured errors; prohibit response-body logging. | M | Yes | `server/index.ts`; `server/lib/phiSafeLogger.ts`; `server/middleware/requestObservability.ts`; `tests/unit/phiSafeObservability.test.ts`. The primary response-logging path is remediated in source; operational closure requires deployment and historical review. |
| GAP-005 | Application Code | High | 0 | **Source-remediated — locally validated.** Centralized API handling now returns stable generic JSON envelopes for unapproved 5xx failures with request IDs, preserves predefined or sanitized 4xx contracts and centrally approved PHI-free operational 501/503 responses, guards legacy route-level JSON 5xx responses, and emits protocol-safe generic scheduler SSE failures. Regression coverage includes thrown and legacy 5xx paths, approved and unapproved 501–504 behavior, intentional 400 responses, mixed-case `/API` requests, and post-header stream failures. Deployment remains open. | Return stable public error codes and generic messages; preserve sanitized diagnostic context only in restricted logs with correlation IDs. | M | Yes | `server/middleware/errorHandler.ts`; `server/middleware/requestObservability.ts`; `server/routes/schedulerAi.ts`; `tests/unit/phiSafeObservability.test.ts`. Source mitigation is locally validated, not yet operationally deployed. |
| GAP-006 | Application Code | High | 0 | **Confirmed — source.** Login does not regenerate the session; role, password, or activation changes do not invalidate existing sessions, creating fixation and stale-privilege risk. | Regenerate on authentication and privilege change; rotate identifiers; revoke sessions after password/role/status changes; enforce idle and absolute expiration; record security events. | L | Partial | Passport/session setup and user-management routes in `server/routes.ts`. Validate cookie flags and revocation in integration tests. |
| GAP-007 | Application Code | Critical | 0 | **Confirmed — source.** A default `admin` / `admin` account is automatically created when no users exist. | Remove deterministic bootstrap credentials; require one-time, expiring, out-of-band bootstrap with forced strong-password setup and auditable completion. | M | Partial | `server/routes.ts`. Existing environments must be checked for unchanged bootstrap credentials without exposing credential values. |
| GAP-008 | Application Code | High | 0 | **Confirmed — source.** Password schemas permit one-character values; no login throttling, MFA enforcement, CSRF middleware, Helmet baseline, or general request-rate controls were found. | Adopt strong credential policy and privileged-user MFA; rate-limit login and sensitive APIs; add CSRF protection for cookie sessions; apply security headers and abuse controls. | L | Partial | Auth schemas and Express middleware. Coordinate application throttles with WAF; do not rely on WAF alone. |
| GAP-009 | Application Code | High | 1 | **Confirmed — source; deployed schema runtime-unverified.** `patientDirectory` is omitted from `shared/schema/index.ts`; its `clinicId` is text without a clinic FK, MRN is not tenant-unique, and `plexusId` depends on trigger behavior. | Export the canonical schema consistently; use typed foreign keys; enforce tenant-scoped identity uniqueness; generate identifiers in a deterministic, migration-controlled path. | L | Partial | `shared/schema/index.ts`; `shared/schema/patientDirectory.ts`. No additional table reference was proven absent from deployed databases through static analysis alone. |
| GAP-010 | Application Code | High | 1 | **Confirmed — source.** `patient_screenings` remains the live identity source and is not durably linked to the canonical patient directory with a modeled patient FK/MRN contract. | Make a canonical patient record the identity anchor; link screenings, appointments, billing, documents, and imports through constrained foreign keys and a migration/reconciliation plan. | XL | No | `shared/schema/screening.ts`; canonical patient schema and repository usage. Complete before patient merge or reliable longitudinal export. |
| GAP-011 | Application Code | High | 0 | **Confirmed — source.** FHIR import increments inserted counts before persistence, catches chunk insert failures, updates optimistic counts, and can return `ok: true` after database failure. | Report success only after committed persistence; fail or explicitly mark partial runs; reconcile accepted, rejected, deduplicated, and committed counts; surface safe operator errors. | L | Yes | `server/services/fhirImport/fhirImportOrchestrator.ts`. Data-integrity and operator-trust blocker. |
| GAP-012 | Application Code | High | 1 | **Confirmed — source and development runtime.** FHIR import lacks durable run/checksum/idempotency state, transaction boundaries, resumability, manifest verification, and streaming; canonical upsert is disabled. The development SQS consumer has no redrive policy/DLQ, and FHIR Lambdas have no DLQ. | Implement durable import runs/manifests, checksums, idempotency keys, transactional chunks, resumability, canonical upsert, quarantine, bounded-memory streaming, retry budgets, and poison-message isolation. | XL | Partial | `server/services/fhirImport/fhirImportOrchestrator.ts`; development `fhir-poll-queue` and FHIR Lambda metadata. Six messages were in flight during inspection; content was not accessed. |
| GAP-013 | Application Code | Medium | 2 | **Confirmed — source.** CSV, text, and history ingestion paths do not share a canonical deduplication and durable idempotency contract. | Route all ingestion through canonical identity resolution, source provenance, deterministic deduplication, replay protection, and operator reconciliation. | L | Partial | Import services and route handlers. Align behavior with the FHIR import-run model. |
| GAP-014 | Application Code | High | 1 | **Confirmed — source and AWS runtime.** Complete PHI access, mutation, export, approval, authentication, and administrative event coverage with tamper-evident long-term retention was not demonstrated. Development has no CloudTrail, while production CloudTrail lacks PHI-relevant data events. | Emit structured, PHI-minimized application audit events for every sensitive action; include actor, tenant, purpose/context, pseudonymous object, outcome, and correlation ID; archive immutably per policy. | XL | Partial | Audit routes/services plus GAP-022. Management-plane CloudTrail does not replace application data-access auditing. |
| GAP-015 | Application Code | Critical | 0 | **Governance-unverified; source confirms external model use.** The AI workflow uses OpenAI, but an applicable BAA, approved PHI configuration, retention/training controls, subprocessor review, and minimum-necessary data contract were not evidenced. | Block PHI transmission until legal/security approval documents provider, eligible configuration, BAA, retention/training controls, region, incident obligations, and minimum-necessary payload. | M | No | `server/services/screening.ts`. Release gate, not an assertion that no agreement exists. Do not test with production PHI. |
| GAP-016 | Application Code | Critical | 0 | **Source-remediated — locally validated.** In the working tree, reviewed active AI, Google OCR, Admin Review, service, and parser logging no longer emits patient/test names, model-output excerpts, dynamic labels, or raw provider diagnostics. Scheduler SSE errors and persisted or HTTP-200 job-failure projections now use stable generic categories, with request IDs where available. Runtime assertions cover AI operation and failure classification, while source regression checks cover the remaining active AI diagnostic projections. Deployment and controlled review/containment of historical CloudWatch logs and persisted diagnostic fields remain open. | Remove identifiers and clinical content from AI logs; use correlation IDs and allowlisted metadata; review and contain historical logs under incident procedures. | M | Yes | `server/services/aiClient.ts`; `server/services/screening.ts`; `server/services/batchAnalysisRunner.ts`; `server/services/plexusIq/adminReviewAddService.ts`; `server/routes/google.ts`; `server/routes/patients.ts`; `server/routes/schedulerAi.ts`; `tests/unit/aiPhiLogging.test.ts`. Historical `analysis_jobs.errorMessage` and patient reasoning failure fields may retain pre-remediation diagnostics. |
| GAP-017 | Application Code | High | 1 | **Confirmed — source.** The model is hard-coded (`gpt-4o`), default behavior is permissive, partial-response recovery can mark work complete without reasoning evidence, and no durable model/prompt/guardrail/version hashes are stored. | Persist model, prompt, policy, context, guardrail, input/output hash, reviewer, override, and disposition versions; fail closed on incomplete output; require qualified human review for consequential recommendations. | XL | Partial | `server/services/screening.ts` and AI result schema. Define reproducibility/change-control requirements after regulatory classification. |

### 4.2 AWS Infrastructure

| Gap | Dimension | Severity | Sprint | Current State | Target State | Effort | Automated Fix? | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|
| GAP-018 | AWS Infrastructure | Critical | 0 | **Confirmed — source, production runtime, and development runtime.** Production exposes `DATABASE_URL` and `SESSION_SECRET` as ECS environment values and in CDK source. Both active development ECS task definitions declare `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` as ordinary environment values despite having a task role. Three ECW/FHIR Lambdas declare `ECW_PRIVATE_KEY_B64` as an ordinary environment value and have no customer KMS environment key. | Remove secrets/static keys from source and task/Lambda environments; revoke and rotate exposed credentials; use task roles and versioned secret references; enable approved encryption; inspect history/logs for exposure; document emergency rotation. | L | Partial | Production task revision 18; development task families `plexus-ecw-cluster-ecw:4` and `plexus-ecw-cluster-ecw-2:1`; `ecw-encounter-query`, `fhir-file-processor`, `fhir-poller`. Values were deliberately not retrieved. Protected infrastructure source was not modified. |
| GAP-019 | AWS Infrastructure | Critical | 0 | **Confirmed — source and production runtime.** The live production task has `NODE_ENV=development`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, and `PGSSLMODE=no-verify`. RDS has `rds.force_ssl=1`, but client certificate verification is disabled. | Run production mode; require TLS with certificate and hostname verification using an approved CA bundle; fail startup if secure configuration is absent. | M | Partial | `infrastructure/lib/plexus-stack.ts`; production task revision 18; RDS parameter inspection. Encryption without peer verification does not provide server authenticity. |
| GAP-020 | AWS Infrastructure | High | 1 | **Confirmed — architecture/source and both AWS accounts.** Isolation relies primarily on application filtering. Production uses shared RDS/storage; development and QA share EKS/VPC infrastructure, and both environment roles can access the same patient/role-named buckets. Per-tenant cryptographic/storage boundaries are absent. | Separate shared control plane from PHI data plane; enforce tenant/environment identity at every layer; use tenant-isolated storage/key strategy where required; add policy-based isolation tests and tenant-aware telemetry. | XL | No | See GAP-001. Final bridge/silo choices must reflect contracts and risk assessment; dev and QA role access should not implicitly bridge patient data. |
| GAP-021 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Production document storage and all audited Plexus/FHIR/AI/patient-named development buckets use SSE-S3. Development buckets block public access and enforce bucket ownership, but none has access logging, Object Lock, or lifecycle; Plexus-file, AI-backend, and patient/role buckets generally have versioning disabled. Patient/role buckets lack bucket policies/TLS enforcement, and account-level public blocking is absent. | Use approved KMS design; enforce TLS and least-privilege policies; enable account/bucket public controls, data-event/access logging, versioning, retention/lifecycle, immutable retention where required, and ownership/data-classification tags. | L | Partial | Metadata-only `s3api` and `s3control` checks across production and 24 PHI-likely development/QA buckets. No objects were listed or retrieved. |
| GAP-022 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Production CloudTrail is active/KMS-encrypted with validation but records management events only and lacks immutable lifecycle. Development has no CloudTrail in `us-east-1` or `us-east-2`, despite a raw-EMR bucket in `us-east-2`. | Deploy centralized multi-region organization trails; capture justified PHI-relevant data events; define policy retention; use immutable/WORM controls and restricted KMS keys; alert on trail changes. | L | Partial | Production trail `duplo-multiregion` has empty data resources. Development `describe-trails` returned no trails in both inspected regions. |
| GAP-023 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Config, GuardDuty, Macie, Security Hub, IAM Access Analyzer, and AWS Backup are absent in both accounts. Development Inspector scanning is disabled for EC2, ECR, Lambda, Lambda code, and repositories. | Enable an organization-approved security baseline, centralize findings, tune alerts, assign owners/SLAs, and document exceptions. | L | Partial | Read-only service status calls. Confirm service eligibility/BAA scope before PHI use. |
| GAP-024 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Production RDS has seven-day automated backups but no AWS Backup/deletion protection. Development and QA Aurora each retain only one day, have one member, no AWS Backup/deletion protection, and no restore-test evidence. | Define RPO/RTO; configure policy-based cross-account/cross-region backups as required; enable deletion protection; retain per policy; run and evidence restore/DR tests. | L | Partial | Databases are private/encrypted and recent automated encrypted snapshots exist; backups alone do not prove recoverability. |
| GAP-025 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Production ECS and RDS are single-instance/Single-AZ. Development and QA Aurora each have one member; EKS worker groups are pinned to one AZ per environment. | Run application/database tiers across failure domains according to RTO; provide deployment headroom and tested failover/degraded-mode behavior. | L | Partial | Production ECS was `1/1`; development/QA target groups were healthy but single-target. OpenSearch availability is separately tracked in GAP-049. |
| GAP-026 | AWS Infrastructure | High | 0 | **Confirmed — production and development runtime.** Production lacks Plexus alarms. Development has only ECS autoscaling/rollback alarms; ECS, Lambda, and RDS log groups generally have unlimited retention and no KMS key, and EKS control-plane logs are disabled. | Establish PHI-safe SLO, security, error, latency, saturation, task, DB, backup, ingestion, and cost alarms; encrypt logs where required; set evidence-based retention; route to owned escalation channels. | L | Partial | Development FHIR functions have no X-Ray tracing or DLQ; no budgets were configured. Do not enable statement/body logging that captures PHI. |
| GAP-027 | AWS Infrastructure | High | 0 | **Confirmed — production and development runtime.** Production WAF is attached to a different ALB and remains Count-only without rate rules. Development has no regional web ACL despite internet-facing dev, QA, and ECS-gateway ALBs. | Associate dedicated tested web ACLs; move tuned managed rules to Block; add login/API rate controls, logging, alarms, and safe rollout. | M | Partial | WAF does not replace application authorization. |
| GAP-028 | AWS Infrastructure | Medium | 1 | **Confirmed — production and development runtime.** Production and inspected development/QA/ECS ALBs have access logging, deletion protection, and invalid-header dropping disabled. Production uses an older TLS policy; development uses current TLS 1.2/1.3 policies and redirects HTTP for EKS ALBs. | Enable protected access logs, deletion protection, invalid-header dropping, current compatible TLS, and justified timeouts; monitor certificates. | M | Partial | Development certificates are issued/renewal-eligible; all inspected app target groups were healthy. |
| GAP-029 | AWS Infrastructure | High | 0 | **Confirmed — production and development runtime.** Production runtime/deploy roles are broad. Development FHIR task role grants `s3:*` on the FHIR bucket; ECS execution uses `CloudWatchLogsFullAccess`; dev/QA roles can delete objects in shared patient buckets. Five IAM users exist, four have active long-lived keys, and no users have permissions boundaries. | Replace static keys with roles/federation; split duties; narrow actions/resources/conditions; remove broad managed policies; protect pass-role; add boundaries/analyzer review; test denied operations. | L | Partial | IAM metadata/policies only; no key values or object data were accessed. Root-account MFA is enabled and two MFA devices are in use, which is positive. |
| GAP-030 | AWS Infrastructure | High | 0 | **Confirmed — production and development runtime.** Production ECR is mutable/unscanned and deploys `latest`. Development `command-center` and `plexus-ecw-core` repositories are mutable and unscanned; active ECW tasks are digest-pinned, which is positive. | Enable immutable tags or digest-only deployment, scanning, lifecycle, provenance/SBOM/signing as approved, and severity-based gates. | M | Partial | Preserve active development digest pinning and extend it to all environments. |
| GAP-031 | AWS Infrastructure | High | 1 | **Confirmed — production and development runtime.** Secrets Manager rotation is disabled for listed secrets. Development has four RDS credential secrets without rotation while active tasks/Lambdas bypass Secrets Manager for AWS keys/private keys. | Inventory consumers, remove duplicates, migrate all credentials to approved role/secret mechanisms, implement tested rotation, alert on failures/age, and document emergency rotation. | L | Partial | Secret metadata only; values were not retrieved. Coordinate with GAP-018. |
| GAP-032 | AWS Infrastructure | Medium | 1 | **Confirmed — production and development runtime.** Production lacks Performance Insights/log exports. Development/QA Aurora lacks Performance Insights and deletion protection but exports PostgreSQL logs; auto-minor upgrades are disabled. | Enable approved PHI-safe DB observability, tune retention/encryption, protect deletion, monitor capacity/connections, and document maintenance/upgrade policy. | M | Partial | Development averaged three DB connections and QA one over 30 days; `rds.force_ssl=1`; do not log statements containing PHI. |
| GAP-033 | AWS Infrastructure | Medium | 2 | **Confirmed — production and development runtime.** Neither account has VPC endpoints. Production has VPC Flow Logs; development has no Flow Logs in `us-east-1` or `us-east-2`. | Add justified endpoints with restrictive policies, egress controls, DNS, Flow Logs, and dependency-failure tests. | L | Partial | Validate cost and service requirements before adding endpoints. |
| GAP-034 | AWS Infrastructure | Medium | 2 | **Confirmed — production and development runtime.** Production July cost was about `$1,090.13`; development July cost was `$1,133.28` and August 1-24 was `$859.89`. Development QA ALB recorded zero requests over 30 days, while OpenSearch, Valkey, EKS/EC2, and ECS showed activity. Several services are lightly utilized but not proven idle. | Assign owner/purpose, tag resources, set budgets, verify dependencies/traffic/backups, right-size, and delete only after explicit approval and rollback planning. | L | Partial | Development largest July categories: RDS `$274.90`, EC2 compute `$239.27`, EC2 Other `$103.29`, ELB `$102.32`, ElastiCache `$80.95`, EKS `$74.40`, OpenSearch `$65.82`, MongoDB Atlas `$60`, ECS `$55.10`. No resource is classified safe to delete. |

### 4.3 Operations and Delivery

| Gap | Dimension | Severity | Sprint | Current State | Target State | Effort | Automated Fix? | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|
| GAP-035 | Operations and Delivery | Critical | 0 | **Confirmed — source.** Container startup runs `npx drizzle-kit push --force`, permitting implicit/destructive schema reconciliation on every production task start. | Remove schema mutation from runtime startup; use reviewed, versioned, backward-compatible migrations in a controlled one-shot step with backup, lock, verification, and rollback/roll-forward plan. | L | Partial | `Dockerfile`. No schema push was run; `migrations/` was not modified. |
| GAP-036 | Operations and Delivery | Medium | 1 | **Confirmed — source.** Dockerfile copies `/app/scripts`, but the repository directory is `script/`. | Align build paths; fail CI if required runtime assets are absent; minimize final image and verify contents in a smoke test. | S | Yes | `Dockerfile`; repository tree. Determine whether runtime silently depends on the missing directory. |
| GAP-037 | Operations and Delivery | High | 0 | **Confirmed — source and AWS runtime.** Merge to `main` builds/deploys mutable `latest` directly to production without mandatory typecheck/tests/scans, staging promotion, digest pinning, stability wait, smoke test, or automatic rollback. Production ECS rollback is disabled. Development ECS uses canary deployment and rollback alarms, but is a separate ECW service and does not close the production pipeline gap. | Build once; run mandatory gates; sign/pin an immutable digest; promote through isolation; wait for stability; run PHI-safe smoke tests; automatically roll back on health/SLO failure. | XL | Partial | `.github/workflows/deploy.yml`; production ECS. Preserve useful development rollback patterns. |
| GAP-038 | Operations and Delivery | High | 1 | **Confirmed — source.** `npm run build` does not typecheck or run tests, `test:unit` omits service tests, and no tenant-isolation security suite was found. | Require typecheck, unit/integration, tenant-boundary, migration, dependency/secret/image scans, and reproducible build before release. | L | Partial | `package.json`, test configuration, test inventory. Prioritize negative tenant/privilege cases. |
| GAP-039 | Operations and Delivery | Medium | 2 | **Confirmed — source.** Playwright covers desktop Chromium only; canonical route smoke checks verify route presence rather than functional workflows. | Add role/tenant workflows, failure cases, accessibility, supported mobile/browser coverage, and post-deploy smoke checks using synthetic data. | L | Partial | Never use real PHI in CI or synthetic smoke environments. |

### 4.4 Product and Clinical Readiness

| Gap | Dimension | Severity | Sprint | Current State | Target State | Effort | Automated Fix? | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|
| GAP-040 | Product and Clinical Readiness | High | 1 | **Confirmed — source/product inventory.** No safe canonical patient merge workflow was found. | Provide permissioned merge/review with survivor rules, conflict handling, reference rewrites, reversible lineage, duplicate queues, and immutable audit. | XL | No | Depends on GAP-009/GAP-010. Never merge across clinics silently. |
| GAP-041 | Product and Clinical Readiness | High | 2 | **Confirmed — source/product inventory.** No complete longitudinal export spanning canonical identity, screening, scheduling, billing, documents, provenance, and amendments was found. | Implement authorized minimum-necessary export with version/provenance, tenant checks, audit, and asynchronous large-export controls. | L | Partial | Export scope/legal-record definition require product/compliance decisions. |
| GAP-042 | Product and Clinical Readiness | High | 1 | **Confirmed — source/product inventory.** Whole-record amendment/versioning and correction lineage are not modeled consistently. | Preserve append-only history or equivalent lineage, correction reason, author, timestamps, approval, and downstream propagation without destructive overwrite. | XL | No | Exact retention/signature requirements depend on regulatory classification. |
| GAP-043 | Product and Clinical Readiness | Medium | 2 | **Confirmed — source/product inventory.** Inbound FHIR exists, but no supported outbound FHIR writeback/export workflow was found. | Define supported profiles/destinations; validate resources; enforce consent/authorization; record provenance/delivery receipts; make retries idempotent. | XL | Partial | Stabilize canonical identity and data lifecycle before generic writeback. |
| GAP-044 | Product and Clinical Readiness | High | 1 | **Confirmed — source/product inventory.** No complete canonical patient audit UI was found for identity changes, access, imports, approvals, amendments, merges, and exports. | Provide permissioned tenant-scoped audit views with filters, correlation IDs, export controls, reasons, and break-glass oversight. | L | Partial | Depends on GAP-014 event model. |
| GAP-045 | Product and Clinical Readiness | High | 0 | **Confirmed — source/product inventory.** Imaging Central, Clinic Analytics, Clinic Onboarding, Plexus Bank, Clinical Intelligence, Portal Assistant, and Plexus IQ surfaces contain production-visible mocks/prototypes. | Hide unfinished capabilities with disabled server-side flags/remove routes; label demos; define acceptance, security, and data-source criteria before enablement. | M | Yes | Users must not mistake synthetic analytics/prototype AI for validated clinical/financial functionality. |
| GAP-046 | Product and Clinical Readiness | Low | 3 | **Confirmed — source/product inventory.** No offline/PWA capability and limited cross-browser/mobile assurance were found. | Define supported devices/connectivity; if offline is required, implement encrypted local storage, synchronization/conflict handling, remote revocation, and PHI-safe caches. | XL | No | Do not add offline PHI storage without a documented clinical need/threat model. |
| GAP-047 | Product and Clinical Readiness | High | 0 | **Governance-unverified.** Plexus AI influences ancillary-test qualification, but intended use, user reliance, human oversight, FDA/SaMD applicability, GxP applicability, and required quality-system controls are unresolved. | Obtain qualified classification; document intended use/claims; define human oversight, validation/change control, complaint/incident handling, and required QMS/SDLC controls. | L | No | This assessment does not make a legal/regulatory classification. |

### 4.5 Development Account-Specific Gaps

| Gap | Dimension | Severity | Sprint | Current State | Target State | Effort | Automated Fix? | Notes / Evidence |
|---|---|---|---|---|---|---|---|---|
| GAP-048 | AWS Infrastructure | High | 0 | **Confirmed — development runtime.** EKS `duploinfra-nonprod` exposes its API publicly to `0.0.0.0/0`, has private endpoint access disabled, all control-plane logging disabled, legacy `CONFIG_MAP` authentication, no secrets-envelope encryption configuration, and no deletion protection. | Restrict public CIDRs or use private access; enable API/audit/authenticator/controller/scheduler logs with PHI-safe retention; migrate to EKS access entries; configure approved KMS envelope encryption and deletion protection; review cluster-admin mappings. | M | Partial | Kubernetes workload specs/secrets were deliberately not queried. The cluster is active on Kubernetes 1.34 and hosts dev/QA target groups. |
| GAP-049 | AWS Infrastructure | High | 1 | **Confirmed — development runtime.** Dev and QA OpenSearch domains are single `t3.small.search` nodes in one AZ, with node-to-node encryption disabled, advanced security/fine-grained access control disabled, no log publishing, and wildcard-principal resource policies constrained only by VPC reachability. | Enable node-to-node encryption and fine-grained access control; replace wildcard principals; enable PHI-safe audit/application logs; use multi-AZ topology according to RTO; test recovery. | L | Partial | At-rest KMS encryption and HTTPS are enabled. Both domains had real search/index activity, so neither is a deletion candidate. |
| GAP-050 | AWS Infrastructure | High | 0 | **Governance-unverified; development metadata confirmed.** The non-production account contains patient-, clinician-, clinic-, facility-, FHIR-, raw-EMR-, AI-, and document-named storage and active clinical databases, but no evidence established that data is synthetic, de-identified, or explicitly approved PHI. Detection/audit controls are materially weaker than production. | Prohibit production PHI in non-production by default; inventory/classify datasets; document approved exceptions and de-identification; separate credentials/keys/storage; implement access/data auditing, retention, and periodic attestations. | M | No | No bucket objects, DB rows, logs, or PHI were accessed. Bucket names and control-plane metadata establish plausible sensitivity, not actual content. |

## 5. Existing Positive Controls

The following controls reduce risk but do not close the gaps:

- Both requested AWS identities were verified through `OrganizationAccountAccessRole`: production `374604322534` and development `107554921331`.
- Production ECS was healthy at `1/1`; inspected development/QA application target groups were healthy.
- Production RDS and development/QA Aurora are private/encrypted, enforce `rds.force_ssl=1`, and have encrypted automated snapshots.
- Relevant production/development buckets block public access; audited development buckets use bucket-owner-enforced ownership.
- Production CloudTrail is multi-region, KMS-encrypted, and log-validation-enabled.
- Production VPC Flow Logs are enabled.
- Development EBS encryption by default is enabled; inspected KMS keys have annual rotation enabled.
- Development Aurora, OpenSearch, Valkey, and the VPN volume are encrypted at rest; Valkey transit encryption is enabled.
- Development EKS ALBs redirect HTTP and use current TLS 1.2/1.3 policies; certificates are issued and renewal-eligible.
- Active development ECS images are digest-pinned and ECS canary/rollback controls are enabled.
- Development FHIR SQS uses SQS-managed encryption, and inspected Lambda functions have no public URL or wildcard resource policy.
- AWS root-account MFA is enabled in development.

## 6. Audit Limitations and Remaining Blockers

### Resolved — Development AWS identity

The previously blocked profile now resolves successfully:

```text
Account: 107554921331
Role: OrganizationAccountAccessRole
```

The development and QA control-plane audit is complete. The earlier MFA ARN discrepancy no longer affects account identity.

### BLOCKER-001 — AI and regulatory governance evidence

No external-model BAA/configuration package or formal intended-use/regulatory classification was available. Product, legal, security, privacy, and qualified regulatory counsel must resolve GAP-015 and GAP-047. No external AI call was made.

### BLOCKER-002 — Non-production data classification

The control plane shows PHI-likely resource names and active clinical services, but no approved data-classification/de-identification attestation was available. An authorized owner must determine whether development/QA contains PHI and initiate incident/compliance review if policy prohibits it.

### Runtime limitations

- Deployed database table parity was not queried; schema findings are based on source definitions/references.
- Kubernetes workload manifests, Kubernetes secrets, database rows, S3 objects, log events, secret values, private-key values, and PHI were not accessed.
- Organization SCPs, centralized tooling outside the inspected accounts, contracts/BAAs, policies, incident records, penetration tests, restore tests, and staff procedures were unavailable unless reflected in the account/repository.
- Historical logs were not searched because they may contain PHI; GAP-004/GAP-016 require controlled incident/privacy review.
- Metrics show utilization, not business ownership or deletion safety. Zero ALB requests do not prove a resource has no internal dependency.

## 7. Evidence Index

### Source evidence

- Tenant/API controls: `server/repositories/screening.repo.ts`, `server/routes/patients.ts`, `server/routes/batches.ts`, `server/routes/billing.ts`, `server/routes/documentLibrary.ts`, `server/routes/patientDatabase.ts`, `server/routes.ts`.
- Logging/errors: `server/index.ts`, `server/middleware/errorHandler.ts`, route catch blocks.
- Canonical identity/schema: `shared/schema/index.ts`, `shared/schema/patientDirectory.ts`, `shared/schema/screening.ts`.
- FHIR/import: `server/services/fhirImport/fhirImportOrchestrator.ts` and related services.
- Clinical AI: `server/services/screening.ts` and result schemas.
- Container/release: `Dockerfile`, `package.json`, Playwright/test configuration, `.github/workflows/deploy.yml`.
- Deployment source: `infrastructure/lib/plexus-stack.ts` was inspected but not modified.

### AWS evidence categories

Read-only AWS CLI calls covered both accounts where applicable:

- STS identity; ECS clusters/services/tasks/task definitions/deployments/autoscaling/logs
- EKS endpoint, authentication, encryption, logging, add-ons, and worker autoscaling metadata
- RDS/Aurora instances/clusters/parameters/snapshots/metrics and deleted-stack ownership
- S3 encryption, public block, versioning, policies/TLS, logging, Object Lock, lifecycle, tags, ownership, and account-level public block
- OpenSearch topology, access policy, encryption, security, logging, and usage metrics
- Valkey encryption/topology/snapshots and usage metrics
- Lambda configuration with environment-variable **names only**, policies, URLs, event sources, logging, tracing, DLQ, and roles
- SQS encryption, retention, redrive, policy, and queue-depth metadata
- CloudTrail, CloudWatch logs/alarms/metrics, WAFv2, ALB listeners/attributes/target health, ACM
- IAM attached/inline policies, role trust, user/access-key metadata without values, ECR, Secrets Manager rotation, KMS rotation
- Config, GuardDuty, Macie, Security Hub, Inspector, AWS Backup, IAM Access Analyzer
- VPCs, security groups, Flow Logs, endpoints, EC2/volume/IMDS metadata
- Cost Explorer, budgets, service totals, and 30-day utilization

Expected absence responses such as `NoSuchBucketPolicy`, `ObjectLockConfigurationNotFoundError`, `NoSuchLifecycleConfiguration`, `NoSuchTagSet`, disabled-service responses, and missing function URLs were treated as evidence that controls were not configured. No mutating CLI command was executed.

## 8. Approval Gate

Do **not** begin Sprint 0 remediation, deploy, delete resources, rotate credentials, alter schemas, or mutate either AWS account based solely on this document. Required next steps are:

1. Product, engineering, security, privacy, and operations review and approve or reprioritize the register.
2. Immediately decide authorized containment for GAP-018 without exposing credential values; rotation remains blocked until explicit approval and dependency planning.
3. Classify non-production datasets and resolve whether PHI use is authorized, synthetic, or de-identified.
4. Resolve tenant-isolation architecture, AI provider governance, regulatory classification, retention, RPO/RTO, immutable audit, and resource ownership.
5. Create a reviewed Sprint 0 plan with rollback and verification criteria.
6. Show code/infrastructure diffs before commit; do not push or deploy without explicit approval.

# Plexus Command Center Build Log

This log records completed assessment and implementation increments. It must be updated after every remediation sprint.

## 2026-08-25 — Production-Readiness Gap Analysis

- **Status:** Assessment complete with one external audit blocker; remediation not started.
- **Release verdict:** **NOT DEPLOY READY**
- **Change type:** Documentation only

### Scope completed

- Applied healthcare SaaS guidance for PHI isolation, tenancy, audit logging, interoperability, clinical AI, HIPAA/HITRUST foundations, and possible GxP/SaMD scope.
- Reviewed application code across authentication, authorization, tenant scoping, schema, imports, logging, auditability, AI, tests, and product workflows.
- Performed read-only production AWS inspection in account `374604322534` across ECS, RDS, S3, CloudTrail, CloudWatch, WAF/ALB, IAM, ECR, Secrets Manager, security services, backups, networking, and cost inventory.
- Created `docs/GAP_ANALYSIS.md` with 47 evidence-backed gaps and required ownership fields.

### Risk register baseline

| Severity | Count |
|---|---:|
| Critical | 10 |
| High | 28 |
| Medium | 8 |
| Low | 1 |
| **Total** | **47** |

Sprint allocation: 21 gaps in Sprint 0, 19 in Sprint 1, 6 in Sprint 2, and 1 in Sprint 3.

### Files changed

- Added `docs/GAP_ANALYSIS.md`.
- Added `BUILD_LOG.md`.

No application, schema, deployment, infrastructure, migration, environment, or secret files were changed.

### Validation

- Parsed the detailed gap register and confirmed sequential IDs `GAP-001` through `GAP-047`.
- Confirmed that every gap row contains all nine required fields: gap ID, dimension, severity, sprint, current state, target state, effort, automated-fix classification, and notes/evidence.
- Confirmed severity totals and sprint totals match the executive summary.
- No application build or test run was required because this increment changes Markdown documentation only.

### Blockers and unresolved decisions

1. **Development AWS audit:** `aws sts get-caller-identity --profile dev --region us-east-1 --output json` requires interactive MFA and timed out. The MFA prompt referenced account `052808603738`, while the requested development account is `107554921331`. The profile must be authenticated and its returned account verified before the development audit can resume.
2. **External clinical AI:** The applicable provider BAA, approved PHI configuration, retention/training controls, and subprocessor review were not available as evidence.
3. **Regulatory classification:** Plexus AI influences ancillary-test qualification; intended use and possible FDA/SaMD/GxP applicability require qualified regulatory review.
4. **Architecture decisions:** Tenant-isolation tier, retention periods, RPO/RTO, immutable audit strategy, and legacy-resource ownership require owner approval.

### Safety record

- No AWS mutation, deployment, deletion, resource cleanup, database query, schema push, credential rotation, secret retrieval, production API call, or external AI call was performed.
- Secret values and PHI were not accessed or reproduced.
- Protected `infrastructure/`, `.env`, and `migrations/` paths were not modified.
- Pre-existing untracked `r53_change_batch.json` was left untouched.
- No commit or push was created.

### Next approval gate

The owner must review the prioritized summary and approve or reprioritize the gap register before any Sprint 0 fix begins. Development AWS evidence must be appended after successful MFA/account verification. All future code and infrastructure diffs must be shown before commit, and deployment remains out of scope without explicit approval.
## 2026-08-25 — Development AWS Audit Completion

- **Status:** Previously blocked development/QA audit completed; remediation not started.
- **Verified account:** `107554921331` via `OrganizationAccountAccessRole`
- **Release verdict:** **NOT DEPLOY READY**
- **Change type:** Documentation only

### Scope completed

- Completed read-only development/QA inspection across ECS, EKS, Lambda, SQS, Aurora, S3, OpenSearch, Valkey, CloudTrail, CloudWatch, WAF/ALB, IAM, ECR, Secrets Manager, KMS, networking, security services, backups, and cost/utilization.
- Inspected environment-variable names and secret-reference metadata only; no environment values, secret values, private-key values, objects, rows, log events, or PHI were retrieved.
- Updated `docs/GAP_ANALYSIS.md` to incorporate development evidence and add three distinct gaps for EKS management-plane exposure, OpenSearch security/availability, and non-production PHI governance.

### Material findings

- Active ECS tasks declare `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` as ordinary environment variables despite having a task role.
- Three ECW/FHIR Lambdas declare `ECW_PRIVATE_KEY_B64` as an ordinary environment variable and have no customer KMS environment key; FHIR functions have no DLQ and use `$LATEST`.
- No CloudTrail was found in `us-east-1` or `us-east-2`; Config, GuardDuty, Macie, Security Hub, Inspector, Access Analyzer, AWS Backup, VPC Flow Logs, VPC endpoints, regional WAF, and budgets are absent/disabled.
- EKS exposes its API to `0.0.0.0/0`, has private endpoint access off, all control-plane logs off, legacy `CONFIG_MAP` authentication, no envelope-encryption configuration, and no deletion protection.
- Dev and QA OpenSearch are active single-node/single-AZ domains with node-to-node encryption and advanced security disabled, no log publishing, and wildcard-principal resource policies constrained only by VPC reachability.
- Audited Plexus/FHIR/AI/patient-named buckets block public access and use bucket-owner enforcement, but use SSE-S3, lack access logging/Object Lock/lifecycle, and often lack versioning and TLS-enforcing policies.
- Development/QA Aurora is private/encrypted with `rds.force_ssl=1` and encrypted snapshots, but each cluster has one member, one-day retention, no deletion protection, no Performance Insights, and no AWS Backup plan.
- July development-account cost was `$1,133.28`; August 1-24 was `$859.89`. Workloads show activity, so no resource was declared safe to delete.

### Positive controls retained

- Development identity is now verified against the requested account.
- Relevant buckets block public access; EBS encryption by default and KMS annual rotation are enabled.
- Aurora, OpenSearch, Valkey, and the inspected VPN volume are encrypted at rest; Valkey transit encryption is enabled.
- Development ALBs use current TLS policies; inspected application targets were healthy.
- Active ECS images are digest-pinned and ECS canary/rollback controls are enabled.
- FHIR SQS uses SQS-managed encryption; inspected Lambda functions have no public URL or wildcard resource policy.
- AWS root-account MFA is enabled.

### Risk register revision

| Measure | Initial | After development audit |
|---|---:|---:|
| Critical | 10 | 10 |
| High | 28 | 31 |
| Medium | 8 | 8 |
| Low | 1 | 1 |
| **Total** | **47** | **50** |

Sprint allocation is now 23 gaps in Sprint 0, 20 in Sprint 1, 6 in Sprint 2, and 1 in Sprint 3.

### Validation and safety

- Confirmed sequential IDs `GAP-001` through `GAP-050`, all nine required fields, all four dimensions, and matching severity/sprint totals.
- No AWS mutation, deployment, deletion, schema push, credential rotation, data-plane access, external AI call, commit, or push occurred.
- Protected `infrastructure/`, `.env`, and `migrations/` paths remain unchanged.
- Pre-existing `r53_change_batch.json` remains untouched.

### Remaining approval gates

- Authorize a dependency-aware containment and rotation plan for runtime credentials/private keys without exposing values.
- Classify development/QA datasets as synthetic, de-identified, approved PHI, or prohibited PHI.
- Resolve external-AI BAA/configuration and FDA/SaMD/GxP classification.
- Review and approve the revised Sprint 0 priorities before any implementation or infrastructure change.

## 2026-08-25 — WP1 PHI-Safe Observability Source Remediation

- **Status:** Source-remediated and locally validated; deployment and historical containment remain pending approval.
- **Release verdict:** **NOT DEPLOY READY**
- **Change type:** Application source, regression tests, and assessment documentation

### Scope completed

- Replaced API response-body capture with runtime-projected, PHI-safe structured logging limited to server-generated request ID, opaque route template, method, status, duration, and outcome.
- Added request correlation before parsers, sessions, and clinic context; `X-Request-Id` is server-generated, and `/api` boundary detection is case-insensitive.
- Added centralized JSON 5xx egress protection and hardened shared error handling to return stable generic public envelopes while preserving predefined or sanitized 4xx contracts and explicitly approved PHI-free operational 501/503 responses.
- Marked and aborted unknown post-header stream failures rather than ending them as clean HTTP 200 responses; scheduler SSE failures now use protocol-safe generic events with correlation IDs.
- Removed patient/test names, model-output excerpts, dynamic labels, and raw provider diagnostics from reviewed active AI, parser, route, and service logs, including Google OCR and Admin Review AI paths.
- Split domain-neutral and provider-boundary failure classification so local/database failures are not mislabeled as provider incidents.
- Replaced persisted batch-analysis failure diagnostics and HTTP-200 job-status/admin projections with stable generic categories while retaining client-compatible field names.
- Preserved the pre-existing AI retry policy; no unrelated retry expansion was included.

### Gap status outcomes

- **GAP-004:** Primary API response-body logging path is source-remediated and locally validated. Deployment, broader non-AI legacy `console.*` exception cleanup, and historical CloudWatch review remain open.
- **GAP-005:** Generic correlated API JSON 5xx handling, legacy route-level 5xx guarding, and scheduler SSE source mitigation are locally validated. Deployment remains open.
- **GAP-016:** Active AI logging, persisted failure, and job-status projection paths are source-remediated and locally validated. Deployment plus historical log/database review and containment remain open.

These statuses do not represent operational closure because the working-tree changes have not been deployed.

### Adversarial findings fixed

- Closed the mixed-case `/API/...` boundary bypass.
- Replaced readable route values with process-local keyed opaque tokens, so concrete request segments cannot enter telemetry even through fabricated request-shaped objects.
- Moved request correlation ahead of malformed-body and session failure points.
- Prevented unknown streamed failures from producing misleading clean HTTP 200 EOFs and marked client-disconnected responses as failed transport outcomes.
- Preserved safe unknown thrown-4xx status codes while replacing arbitrary messages and codes.
- Restored the original AI retry policy after identifying and removing an unintended expansion.

### Validation

- `npm run test:unit` — passed; all 33 standalone unit scripts passed.
- `npm run check` — passed.
- `npm run build` — passed.
- `node scripts/qa-phi-safe-logger.mjs` — passed.
- `git diff --cached --check` — passed for the complete staged WP1 change set.
- Targeted regression coverage is in `tests/unit/phiSafeObservability.test.ts` and `tests/unit/aiPhiLogging.test.ts`, including runtime assertions for 501–504 handling, opaque route-token projection, client disconnects, domain/provider taxonomy, and AI operation/failure classification; source checks cover reviewed active AI diagnostic projections.

The production build emitted only non-blocking warnings: Browserslist data is 10 months old, a PostCSS plugin omitted `from`, and Vite reported large chunks.

### Remaining limitations and approval gates

- Historical CloudWatch logs may retain pre-remediation response or AI diagnostics. No log events were inspected or deleted during WP1.
- Existing database values may retain old diagnostics in `analysis_jobs.errorMessage`, patient `reasoning.__analysisFailure.reason`, and patient `reasoning.__analysisError.message`. No rows were queried or modified.
- Non-AI legacy raw `console.*` exception sites remain elsewhere in the application; WP1 does not claim system-wide logging closure.
- Historical log/database inspection or cleanup requires a separately approved, controlled privacy and data-remediation action.
- Deployment remains subject to explicit owner approval and post-deployment verification.

### Files changed by concern

- **Observability boundary:** `server/index.ts`, `server/lib/phiSafeLogger.ts`, `server/middleware/requestObservability.ts`, `server/middleware/errorHandler.ts`.
- **Approved operational 5xx contracts:** `server/routes.ts`, `server/routes/portalAssistant.ts`, `server/routes/directMessages.ts`, `server/routes/google.ts`, `server/routes/emrScheduleSync.ts`.
- **AI and diagnostic cleanup:** `server/lib/aiObservability.ts` plus affected parser, route, and service files under `server/parsers/`, `server/routes/`, and `server/services/`.
- **Regression coverage:** `tests/unit/phiSafeObservability.test.ts`, `tests/unit/aiPhiLogging.test.ts`.
- **Assessment evidence:** `docs/GAP_ANALYSIS.md`, `BUILD_LOG.md`.

### Safety record

- No commit, push, deployment, AWS mutation, database query or mutation, schema push, credential rotation, secret retrieval, data-plane object access, production API mutation, or external AI call was performed.
- Protected `infrastructure/`, `.env`, and `migrations/` paths were not modified.
- Pre-existing untracked `r53_change_batch.json` was left untouched.

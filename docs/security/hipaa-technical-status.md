# Plexus OS - Ancillaries — HIPAA Technical Status & Hardening Plan

Companion to `hipaa-service-inventory.md` and `disaster-recovery.md`. Captures
verified findings + the staged remediation plan for controls that are code/
config changes (not one-shot infra). **No legal compliance is asserted.**

Legend: ✅ verified done · 🟡 prepared/partial · 🔴 blocker/not started ·
🔎 inspected (finding recorded).

---

## 5. KMS (design — 🟡 prepared)
- **Current (🔎):** only AWS-managed default keys (`alias/aws/rds`, `.../s3`,
  `.../secretsmanager`, …). No customer-managed keys (CMKs).
- **Plan (prod):** create dedicated CMKs — `plexus-prod-rds`, `plexus-prod-s3`,
  optionally `plexus-prod-logs`/`plexus-prod-secrets` — with least-privilege key
  policies, key rotation ON, separated from staging/dev. Wire into the prod
  RDS/S3 in a follow-up (not applied to live staging — no destructive re-encrypt).
- **Do NOT** rotate/migrate the live staging encryption keys destructively.

## 6. IAM (🔎 findings + 🟡 hardening plan)
Verified findings:
- User `aimran`: **AdministratorAccess, NO MFA**, static access keys in use.
- User `replit-noorhan`: no attached managed policies (check inline/group).
- Roles present: `plexus-staging-ecs-execution-role`, `-ecs-task-role`,
  `-github-deploy-role` (scoped, least-priv per stack), plus legacy
  `plexus-apprunner-role`, `plexus-ssm-role` (candidates for removal).

Findings → remediation (do NOT break current deploy path until replacements proven):
1. **Enforce MFA** for all human privileged users; deny sensitive actions without MFA.
2. Replace broad `AdministratorAccess` on humans with scoped roles assumed via
   MFA: `PlatformAdmin`, `DevOps`, `Developer`, `QAReadOnly`, `SecurityAudit`.
3. Keep machine roles least-privilege (ECS task/exec, staging/prod deploy already scoped).
4. Rotate/limit static access keys; prefer role assumption / OIDC.
5. Broader dev team must NOT receive `AdministratorAccess`.
Status: 🟡 documented; role definitions to be added as an IAM CDK/policy module
without disrupting the current authenticated path.

## 7. CloudTrail (🔴 not enabled → 🟡 prepared)
- **Current:** no trails. **Plan:** account/multi-region trail → dedicated,
  access-restricted, encrypted (CMK) S3 log bucket with Object Lock/retention;
  management events + targeted S3 data events for the documents bucket; log file
  validation ON. Enablement flagged for owner confirmation (account-wide + cost).

## 8. PHI-safe CloudWatch logging (🟡 in progress)
- ✅ Done: surgical PHI-safe port for `admin.ts` + `absenceWatcher.ts`
  (structural logging via `phiSafeLogger`, no raw `error.message`).
- 🔎 Remaining unsafe sites (verified): `server/routes/plexusEhrAddPatient.ts`
  (~5), `server/routes/plexusIqClinicalImport.ts` (~3), plus the broader set in
  old-main `9289ec50` (patients.ts, batches.ts, screening.ts, batchAnalysisRunner.ts,
  aiClient.ts, google.ts) that log `error.message`/raw errors.
- Plan: expand `phiSafeLogger` (request/correlation IDs, safe error
  classification), replace unsafe sites group-by-group with tests, keep generic
  client-facing errors. No clinical logic change.

## 9. Tenant/clinic isolation — ADR-002 (🟡 staged plan; foundation pending)
- Current model: `clinicContext`/`accessControl`/`accessDecision` (legacy
  `req.clinicId`, fail-OPEN on null). Not weakened.
- Stage A (foundation): `TenantContext` = clinic|platform|denied + resolver +
  request-lifecycle wiring + fail-closed tests. Non-admin w/o clinic ⇒ denied;
  null ⇒ never "all clinics".
- Stage B (high-risk reads first): patients, documents, scheduling, engagement,
  billing, orders/procedures. Stage C: remainder.
- Add IDOR/BOLA regression tests: changing a resource ID must never reveal
  another clinic's PHI. Migrate incrementally; verify after each group.

## 10. Audit logging (🔎 inventory)
- **Exists:** `audit_log` table (username, action, entityType, entityId,
  `changes` jsonb, createdAt) via `auditRepository` (create + list only — no
  update/delete method → append-only at the app layer; ✅ good). Additional
  domain event trails: `adminReviewEvents`, journey/story events.
- Gaps: ensure coverage for the required event set (USER_LOGIN, LOGIN_FAILURE,
  PATIENT_VIEWED/UPDATED, DOCUMENT_VIEWED/DOWNLOADED/UPLOADED/SIGNED,
  ORDER_CREATED/SIGNED, PROCEDURE_NOTE_CREATED, BILLING_DOCUMENT_CREATED,
  ROLE_CHANGED, PERMISSION_CHANGED, USER_CREATED/DISABLED, EXPORT_CREATED,
  ADMIN_ACTION). **Risk:** `changes` jsonb may carry PHI — must store diffs of
  non-PHI fields / field-name+id only, never full clinical content. Tamper
  resistance: app is append-only; add DB-level protection (restricted role /
  no UPDATE/DELETE grant / export to CloudTrail-protected store) so normal
  admins cannot silently alter history.

## 12. GuardDuty / Config / Security Hub / Macie (🔴 none → 🟡 evaluate)
- Verified none enabled / Security Hub not subscribed. Plan: enable GuardDuty
  detector, Config recorder + conformance pack (HIPAA/FSBP), Security Hub with
  CIS + AWS FSBP standards. Macie: **targeted** scan of the documents bucket
  only (cost-aware) — no broad account scan without an impact estimate. All
  enablement flagged for owner confirmation (account-wide + cost); no
  auto-remediation of production.

## 13. WAF (🟡 prepared design)
- No WAF today. Plan: WAFv2 web ACL on the public ALB, starting in COUNT mode:
  AWS managed common rule set, SQLi rule set, known-bad-inputs, rate-based rule.
  Validate against real clinical workflows before switching to BLOCK.

## 14. Third-party / AI PHI inventory (🔎)
| Provider | Used by | PHI transmitted? | BAA required | BAA confirmed | Prod-approved? |
|---|---|---|---|---|---|
| OpenAI (AI_INTEGRATIONS_OPENAI_API_KEY) | Plexus IQ qualification, note gen, ICD search, absence AI | **YES** (clinical context in prompts) | **YES** | ❓ unverified | **NO — blocked until BAA + zero-retention/enterprise terms confirmed** |
| Google (Sheets/Drive) | billing/patient sync, doc provider (legacy) | Possibly (patient rows/docs) | YES if enabled | ❓ | disable in prod unless BAA + justified |
| Nodemailer/SMTP (SES in infra) | email delivery | Possibly (patient-addressed) | SES covered under AWS BAA | tied to AWS BAA | gate on BAA |
| Replit integrations (chat/image/audio/batch) | dev/prototype surfaces | Possibly | YES | ❓ | **exclude from prod** unless reviewed |
| Telephony / VOIP / SMS | (not confirmed present) | — | — | — | Twilio SMS permanently excluded per code policy |
| Error monitoring / analytics | none detected | — | — | — | if added, must be BAA-covered + PHI-safe |
- **Rule:** do NOT send PHI to any provider without a confirmed contractual +
  technical path. OpenAI is the primary live PHI-egress risk today.

## 15. Web security (🔎 findings + plan)
- Present: sessions (`httpOnly`, `sameSite=lax`, `secure` gated by COOKIE_SECURE),
  rate limiters (`middleware/rateLimiter.ts`, `aiRateLimiter.ts`,
  `callListShareRateLimit.ts`), server-side access control.
- Gaps: **no security-header middleware** (no helmet/CSP/HSTS/X-Frame-Options in
  `server/index.ts`); confirm CSRF strategy for cookie-auth mutations; confirm
  login-failure rate limiting + lockout; session expiration/rotation; password
  reset flow. HSTS only after HTTPS. Authorization must remain server-side
  (never frontend-enforced).

---

## FINAL HIPAA TECHNICAL STATUS
- **AWS BAA:** CANNOT VERIFY (owner action in AWS Artifact) → **real PHI blocked**.
- **HTTPS:** staging HTTP-only; **DOMAIN REQUIRED**; prod stack HTTPS-ready.
- **RDS:** private + encrypted (AWS-managed KMS) + TLS + backups ✅ (prod: Multi-AZ+CMK+21d 🟡).
- **S3:** private + SSE + versioned + TLS-only ✅ (prod: CMK 🟡).
- **KMS:** no CMKs 🔴 (prod CMKs planned 🟡).
- **IAM:** admin-no-MFA + static keys 🔴 (scoped-roles+MFA plan 🟡).
- **CloudTrail/Config/GuardDuty/SecurityHub/Macie:** none 🔴 (evaluate/prepare 🟡; owner confirm to enable).
- **PHI-safe logging:** admin+absenceWatcher ✅; broader sweep 🟡.
- **Tenant isolation:** legacy in force; ADR-002 staged plan 🟡.
- **Audit logging:** append-only table ✅; PHI-in-changes + tamper-hardening 🟡.
- **Backups:** on + PITR + S3 versioning ✅; **restore UNVALIDATED** 🟡.
- **WAF / security headers:** none 🔴 (prepared 🟡).
- **Third-party/AI PHI:** OpenAI is live PHI-egress risk; BAA unverified 🔴.

**STAGING TECHNICALLY READY FOR PHI: NO.**
**PRODUCTION ARCHITECTURE (code) TRENDING READY; not deployed; multiple blockers.**
**LEGAL / COMPLIANCE REVIEW STILL REQUIRED: YES.**

# AWS readiness — pre-cutover checklist

**Date:** 2026-06-09
**Scope:** READ-ONLY operational checklist. No infrastructure provisioned by this doc. No production cutover. No Docker or ECS deploy.
**Purpose:** Centralize every gate that must be green before the production-cutover PR is opened. Each row is a hard gate — the cutover PR cannot ship until all gates are GREEN. The cutover PR itself ships in a separate, explicitly-approved batch.

> Cross-reference: `aws-readiness-design.md` (the design), `documents-storage-design.md` §2 (storage providers), `background-jobs-design.md` (job migration plan), `protected-flows.md` (what cannot break), `do-not-touch.md`.

---

## 0. How to use this checklist

- Every row has an **owner**, a **status check** (how to verify GREEN), and a **rollback** plan.
- Status is GREEN / YELLOW / RED. A row is YELLOW until verified; RED if a check has failed.
- This file is updated by the operator as gates flip. **PRs that flip a row to GREEN must cite the verification artifact** (log line, CI run, screenshot id, etc.) in the commit message.
- The cutover-day PR itself touches `STORAGE_PROVIDER`, `NODE_ENV`, ALB target group, and the systemd / ECS task definition. Until every row below is GREEN, those touches do not ship.

---

## 1. Configuration gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| `.env.example` lists every prod-required env var | platform | `grep -c '^[A-Z]' .env.example` matches the env-var inventory in `aws-readiness-design.md` §2 | revert the .env.example PR | YELLOW |
| `validateEnv.ts` rejects boot when `STORAGE_PROVIDER` is unset in production | platform | `NODE_ENV=production node -e "require('./dist/index.cjs')"` exits non-zero with a clear error | revert validateEnv.ts | YELLOW |
| `SESSION_SECRET` rotation runbook exists | platform | doc link in `aws-readiness-design.md` §3 | n/a (runbook only) | YELLOW |
| `DATABASE_URL` uses IAM-auth or rotated credential | platform + DBA | password is not present in any committed file (`git grep` for known prefixes) | rotate the credential | YELLOW |
| `AWS_REGION` matches the S3 bucket region (no cross-region writes at boot) | platform | `aws s3api get-bucket-location` matches `AWS_REGION` | n/a (configuration only) | YELLOW |

---

## 2. Storage gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Production `STORAGE_PROVIDER=s3` | platform | env-var dump on the prod task | flip back to `google_drive` (legacy provider still functional) | RED (not set yet) |
| S3 bucket exists with versioning ON | platform | `aws s3api get-bucket-versioning` returns `Status: Enabled` | n/a (additive) | YELLOW |
| S3 bucket has server-side encryption (`AES256` minimum) | platform | `aws s3api get-bucket-encryption` returns a valid rule | n/a (additive) | YELLOW |
| IAM role has `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` ONLY on the prod bucket prefix | platform | IAM policy review | revoke the IAM role | YELLOW |
| `assertLocalBlobsAllowed` is on the latest main and not removed | platform | `node scripts/qa-docs-architecture-integrity.mjs` confirms `documents-storage-design.md` still references the guard | revert the offending PR | YELLOW |

---

## 3. Database gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Production PG instance is provisioned with the documented `max_connections` headroom | DBA | `SHOW max_connections;` vs the documented per-app pool size (20) × concurrency factor | n/a (configuration only) | YELLOW |
| Backups: automated snapshots enabled + retention ≥ 30 days | DBA | RDS / managed-PG console screenshot | restore from snapshot | YELLOW |
| Point-in-time recovery window covers ≥ 7 days | DBA | RDS / console screenshot | n/a (advisory only) | YELLOW |
| Migration parity verified: `npm run db:push` runs against a clean snapshot of prod and reports zero divergence | DBA | log artifact attached to the cutover ticket | revert the offending migration | YELLOW |
| No `migrations/*.sql` references the local filesystem path | platform | `grep -rln storage/documents migrations/` returns nothing | revert the migration | YELLOW |

---

## 4. Background-job gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Morning rebuild advisory-lock survives a fresh-boot race | platform | log line `[morningRebuildScheduler] lock_held` observed when 2 instances boot within 5s | n/a (lock is in-process today; multi-instance lands behind 18a) | YELLOW |
| Absence watcher does not fire during a maintenance window | platform | env-var `ABSENCE_WATCHER_ENABLED=0` honored | flip env var | YELLOW |
| AI batch runner cancellation observed within 1 iteration | platform | manual cancel + log line ≤ 30s after cancel | n/a (observation only) | YELLOW |
| In-process outbox drain runs without leaks | platform | log line `[outbox] flushed N` observed each minute | restart the task | YELLOW |

---

## 5. Observability gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Application logs are shipped to CloudWatch (or equivalent) | platform | log group exists + most recent event ≤ 5 min | n/a (cutover prerequisite) | YELLOW |
| PHI-safe logging contract is the documented source-of-truth (no patient names, DOBs, summary text, metadata bodies, raw payloads in logs) | platform | `node scripts/qa-phi-safe-logger.mjs` passes | revert the offending PR | GREEN (PR #89 merged) |
| Liveness `GET /healthz` and readiness `GET /readyz` both return 200 against the prod task | platform | curl from inside the VPC | revert deploy | YELLOW |
| ALB health check uses `/readyz` (not `/healthz`) so a degraded DB pulls the task | platform | ALB target group settings | flip target group config | YELLOW |
| Error-rate alarm fires within 5 min when synthetic 500s exceed 1% of requests | platform | synthetic test in staging | tune the alarm | YELLOW |

---

## 6. Security gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Public ingress restricted to ALB only (no direct task IP exposure) | platform | security-group review | tighten the SG | YELLOW |
| All inbound TLS terminates on ALB; no port 80 listener in prod | platform | ALB listener review | delete the http listener | YELLOW |
| HSTS header is set on the ALB (max-age ≥ 6 months) | platform | curl response header | flip ALB setting | YELLOW |
| Session cookie has `Secure; HttpOnly; SameSite=Lax` in production | app | curl response set-cookie | revert the offending PR | YELLOW |
| No secret value ever lands in CloudWatch logs | platform + SecOps | logs sample review for known-secret prefixes | rotate the secret | YELLOW |

---

## 7. Rollback gates

| Gate | Owner | Verification | Rollback | Status |
| --- | --- | --- | --- | --- |
| Cutover PR can be reverted in ≤ 10 min | platform | dry-run in staging | n/a (the gate) | YELLOW |
| Storage provider can flip from `s3` back to `google_drive` without data loss | platform | `STORAGE_PROVIDER=google_drive` works in staging on the same code | n/a (the gate) | YELLOW |
| DB write traffic can be paused gracefully (read-only mode) | DBA + platform | runbook exists; tested in staging | n/a (the gate) | YELLOW |

---

## 8. Stop conditions for the cutover-day PR

The cutover-day PR MUST stop and ask if:

1. Any row above is RED.
2. Any GREEN row was flipped GREEN without a verification artifact cited.
3. The cutover would touch `runtime`, `route`, `schema`, or `UI` code paths beyond `STORAGE_PROVIDER` + boot-time configuration.
4. Production traffic cannot be drained from the previous deploy in ≤ 5 min.
5. The on-call rotation is unstaffed for the cutover window.

End of checklist.

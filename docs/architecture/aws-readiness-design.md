# AWS deployment readiness design (Batch 19 design-first foundation)

**Branch:** `architecture/batch-18-19-infrastructure-design`
**Scope:** Design doc only. No Dockerfile shipped. No ECS task definition shipped. No production cutover. No deployment substrate change.

> Cross-reference: `DEPLOY_AWS.md`, `.replit`, `server/lib/validateEnv.ts`, `server/integrations/fileStorage.ts`, `server/integrations/s3FileStorage.ts`, `docs/architecture/background-jobs-design.md` (Batch 18), `docs/architecture/full-21-batch-orchestrator-review.md` Batch 19.

---

## 1. Why this needs to happen

Today the platform:

- Has **no Dockerfile**.
- Has **no ECS task definitions**.
- Reads secrets from **plain env vars** (no Secrets Manager wiring).
- Has **no CloudWatch hooks**.
- Has **no SQS / managed queue** (in-process outbox only — see `background-jobs-design.md`).
- Already integrates with **S3** for blob storage when `STORAGE_PROVIDER=s3` (`server/integrations/s3FileStorage.ts`). `validateEnv.ts` enforces this in production.
- Documents the target in `DEPLOY_AWS.md`.

Batch 19 is the orchestrator's "AWS deployment readiness" batch. This **design-first** PR enumerates the scaffolding that will ship in future infrastructure batches (19a–19f), but ships **zero infrastructure** itself.

---

## 2. Target architecture

```
                       ┌──────────────────────────────────┐
                       │            CloudFront            │
                       │     (Vite-built static SPA)      │
                       └─────────────────┬────────────────┘
                                         │
                                         │ /api/*
                                         ▼
            ┌────────────────────────────────────────────────────────┐
            │              ALB (Application Load Balancer)           │
            │     Target group → ECS Fargate service (Express API)   │
            └─────────────────┬──────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │   ECS Fargate task                  │   ← Container per task
            │   Image: ECR repo                   │   ← Built from Dockerfile
            │   Secrets: from Secrets Manager     │
            │   Logs: → CloudWatch Logs           │
            │   Healthcheck: GET /readyz          │
            └─────┬───────────────────────────────┘
                  │
       ┌──────────┴──────────┐──────────┬──────────────┐
       ▼                     ▼          ▼              ▼
  ┌─────────┐         ┌──────────┐  ┌───────┐  ┌──────────────┐
  │  RDS    │         │   S3     │  │ SQS   │  │  CloudWatch  │
  │ Postgres│         │ documents│  │ outbox│  │   metrics    │
  └─────────┘         └──────────┘  └───────┘  └──────────────┘
```

**Three independent stores** (RDS, S3, SQS), plus CloudWatch for observability. CloudFront fronts the SPA build; ALB routes API traffic to a single Fargate service.

---

## 3. Container layout

Single multi-stage Dockerfile, Node 20-alpine base. Three stages:

1. **deps** — `npm ci` only.
2. **build** — copy source + run `npm run build`. Emits `dist/index.cjs` (bundled server) + `dist/public/` (Vite static).
3. **runtime** — copy `dist/`, install only runtime deps. Non-root user. `CMD ["node", "dist/index.cjs"]`.

`.dockerignore` excludes: `node_modules`, `.git`, `*.tar.gz`, `storage/documents/`, `tmp_recovery/`, `artifacts/`, `migrations/` (mounted from CI/CD, not baked in).

---

## 4. ECS Fargate task definition

```jsonc
// Conceptual sketch; not shipped in this batch.
//
// {
//   "family": "tertiary-command-center",
//   "cpu": "1024",
//   "memory": "2048",
//   "networkMode": "awsvpc",
//   "containerDefinitions": [
//     {
//       "name": "api",
//       "image": "${ECR_IMAGE_URI}",
//       "portMappings": [{ "containerPort": 5000 }],
//       "environment": [
//         { "name": "NODE_ENV", "value": "production" },
//         { "name": "STORAGE_PROVIDER", "value": "s3" }
//       ],
//       "secrets": [
//         { "name": "DATABASE_URL",                "valueFrom": "${SM_DATABASE_URL_ARN}" },
//         { "name": "SESSION_SECRET",              "valueFrom": "${SM_SESSION_SECRET_ARN}" },
//         { "name": "AI_INTEGRATIONS_OPENAI_API_KEY", "valueFrom": "${SM_OPENAI_API_KEY_ARN}" },
//         { "name": "ANTHROPIC_API_KEY",           "valueFrom": "${SM_ANTHROPIC_API_KEY_ARN}" },
//         { "name": "AWS_REGION",                  "valueFrom": "${SM_AWS_REGION_ARN}" },
//         { "name": "S3_BUCKET_NAME",              "valueFrom": "${SM_S3_BUCKET_ARN}" }
//       ],
//       "logConfiguration": {
//         "logDriver": "awslogs",
//         "options": {
//           "awslogs-group": "/ecs/tertiary-command-center",
//           "awslogs-region": "${AWS_REGION}",
//           "awslogs-stream-prefix": "api"
//         }
//       },
//       "healthCheck": {
//         "command": ["CMD-SHELL", "node scripts/healthcheck.mjs || exit 1"],
//         "interval": 30,
//         "timeout": 5,
//         "retries": 3
//       }
//     }
//   ]
// }
```

---

## 5. Env var inventory

| Env | Required in prod? | Source |
| --- | --- | --- |
| `DATABASE_URL` | yes | Secrets Manager → RDS endpoint |
| `SESSION_SECRET` | yes | Secrets Manager (rotated quarterly) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | yes (for ICD search + AI features) | Secrets Manager |
| `ANTHROPIC_API_KEY` | yes (for Plexus IQ AI screening) | Secrets Manager |
| `STORAGE_PROVIDER` | yes (must be `s3` per `validateEnv.ts`) | task definition env |
| `AWS_REGION` | yes | task definition env or container metadata |
| `S3_BUCKET_NAME` | yes | task definition env (per-environment bucket) |
| `AWS_ACCESS_KEY_ID` | no (use IAM task role instead) | — |
| `AWS_SECRET_ACCESS_KEY` | no | — |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | when Google Drive fallback enabled | Secrets Manager |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | when Google Drive fallback enabled | task definition env |
| `NODE_ENV` | yes (`production`) | task definition env |
| `PORT` | optional (default 5000) | task definition env |
| Feature flags (e.g., `EXECUTION_CASE_TX`, `ENGAGEMENT_TO_CALL_LIST_BRIDGE`, `BILLING_STATE_ALIGNMENT`, `SYNC_VIA_OUTBOX`, `OUTBOX_TRANSPORT`) | optional, all default OFF | task definition env |

**Production secrets MUST come from Secrets Manager** with the task's IAM role granting `secretsmanager:GetSecretValue` on the specific ARNs. Plain-env secrets are a 19-stage stop condition.

---

## 6. RDS Postgres sizing

Initial: `db.t4g.small` (2 vCPU, 2 GB RAM) in single-AZ for staging; `db.r6g.large` (2 vCPU, 16 GB RAM) Multi-AZ for production. Engine: Postgres 16. Backup retention 7 days; PITR enabled.

`pg_stat_statements` extension required for the orchestrator's Batch 20 observability work.

Connection pool: the app pool is `max=20, min=2` (`server/db.ts`). With 4 Fargate tasks running, peak open connections = 80 — well under RDS small/medium connection limits.

---

## 7. S3 bucket policy

- Bucket per environment: `tertiary-command-center-<env>-documents`.
- TLS-only (`"aws:SecureTransport": "true"`).
- Block all public access.
- Lifecycle: transition to Standard-IA after 30 days; Glacier after 180 days; expire at 7 years (HIPAA-compliant retention).
- Versioning: ON.
- Server-side encryption: SSE-S3 (or SSE-KMS for higher-tier deployments).

---

## 8. SQS

Initial deployment uses **in-process outbox polling** (Batch 18 design). SQS migration is Phase 18g and is a separate gate. When it ships:

- One queue per logical kind (`documents-sync`, `invoice-reminders`, `batch-analysis-patient`, `billing-sync`).
- Dead-letter queue per main queue.
- Visibility timeout sized to longest expected handler run + 50%.
- Messages carry the same `kind` discriminator + payload shape as today's `outbox_items` rows, so the cutover is "switch the consumer's poll source" — not a re-design.

---

## 9. CloudWatch

- Log group per service. Structured JSON logs (after Batch 20 ships the structured logger).
- **PHI-aware log filters.** The Batch 20 logger redacts `reasoning`, `notes`, and full request bodies for patient routes. CloudWatch metric filters MUST NOT extract those fields.
- Custom metrics: AI request counts, queue depth, invoice email failures, scheduler-rebuild duration.
- Alarms: ECS task restart count, ALB 5xx rate, RDS CPU > 80%, RDS storage > 80%, S3 4xx error rate.

---

## 10. Phased rollout

| Phase | Ships |
| --- | --- |
| **19 (this batch)** | Design doc only. |
| **19a** | Dockerfile + `.dockerignore` + `scripts/healthcheck.mjs`. Buildable locally with `docker build`. Not used by CI. |
| **19b** | CI workflow that builds + pushes the image to ECR (no deploy yet). |
| **19c** | Terraform/CDK for VPC, ALB, ECS cluster, Fargate service, RDS, S3 bucket. No traffic yet. |
| **19d** | First staging deploy. DNS pointed at staging ALB. |
| **19e** | Secrets-Manager wiring. Remove plain-env secrets. |
| **19f** | Production deploy. CloudFront DNS cutover. PRODUCTION CUTOVER. |
| **19g** | CloudWatch alarms + on-call runbook. |

**No production cutover ships in this batch.** Phase 19f is gated by clinical sign-off and a separate runbook PR.

---

## 11. Hard protected areas

| Area | Touched this batch? | Touched future phases? | Mitigation |
| --- | --- | --- | --- |
| Patient qualification logic | no | no | — |
| Plexus IQ qualification flow | no | no | — |
| Admin Review | no | no | — |
| Scheduler assignment correctness | no | no | — |
| Billing money / claims | no | no | — |
| **AWS production cutover** | **no** | yes (phase 19f only) | Separate runbook PR; clinical sign-off; rollback plan documented. |
| Migrations | no | yes (none required; existing migrations carry over) | — |

---

## 12. Rollback

`git rm docs/architecture/aws-readiness-design.md`. Zero runtime state. No infrastructure was introduced.

---

## 13. Stop conditions for follow-up phases

A future phase MUST stop and ask if:

1. Plain-env secrets are deployed to production (Phase 19e MUST close before 19f).
2. The healthcheck script (`scripts/healthcheck.mjs`) returns OK on a misconfigured app (e.g., when DB is unreachable).
3. CloudWatch log group lacks PHI-aware filters or metric filters.
4. Any environment uses the same S3 bucket as another environment.
5. Production cutover (19f) ships before staging soak >= 2 weeks.
6. SQS migration (Batch 18g) ships before the in-process outbox has handled production traffic for >= 1 week.

End of design.

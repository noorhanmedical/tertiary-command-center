# Deploying to AWS

This is the runbook for deploying Plexus Ancillary Screening to AWS. It is
intentionally a checklist, not infrastructure-as-code — adapt to your account's
conventions (Terraform, CDK, ClickOps).

> **Scope.** This document covers the *first deploy* and the *day-2 operator
> view*. It does not cover IaC, CI/CD, or migration of existing data.

## 1. Target architecture

```
                     ┌───────────────────────────────────┐
   Users ── HTTPS ──▶│  Application Load Balancer (ALB) │
                     │  • TLS termination               │
                     │  • WebSocket upgrade enabled     │
                     └──────────┬────────────────────────┘
                                │  HTTP (port 5000)
                  ┌─────────────┴─────────────┐
                  │                           │
          ┌───────▼────────┐         ┌────────▼───────┐
          │ ECS Fargate    │  ...    │ ECS Fargate    │
          │ task #1        │         │ task #N        │
          │ (this app)     │         │ (this app)     │
          └───────┬────────┘         └────────┬───────┘
                  │                           │
                  ├──── pg ──────┬────────────┤
                  │              ▼            │
                  │      ┌───────────────┐    │
                  │      │ RDS Postgres  │    │
                  │      └───────────────┘    │
                  │                           │
                  └────── S3 (documents) ─────┘
```

- **Compute:** ECS Fargate service, desired count ≥ 2 for HA. The app is
  stateless on disk — sessions live in Postgres, documents in S3, background
  job locks in Postgres advisory locks. You can scale horizontally.
- **Database:** RDS Postgres (single multi-AZ instance is fine to start).
- **Object storage:** A single S3 bucket for generated notes and uploaded
  documents. Server-side encryption (SSE-S3 or SSE-KMS) on by default; block
  public access.
- **Load balancer:** Application Load Balancer with HTTPS listener and
  WebSocket upgrade allowed (default behaviour — just don't disable it).
- **Secrets:** AWS Secrets Manager (or SSM Parameter Store) for everything in
  `.env.example`. Wired into the ECS task definition via `secrets:`.

## 2. Required AWS resources

### 2.1 RDS Postgres
- Engine: Postgres 15+.
- Storage: encrypted (default).
- Security group: ingress from the ECS service SG on 5432 only.
- Initial DB and user — capture the connection string for `DATABASE_URL` (use
  `?sslmode=require`).

### 2.2 S3 bucket
- Name: e.g. `plexus-documents-prod-<account-id>`.
- Block all public access: **on**.
- Default encryption: SSE-S3 (or SSE-KMS with a CMK).
- Versioning: optional but recommended.
- Lifecycle: optional — transition to IA after 90 days.

Minimal IAM policy attached to the ECS **task role** (preferred over static
keys):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PlexusDocs",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::plexus-documents-prod-<account-id>",
        "arn:aws:s3:::plexus-documents-prod-<account-id>/*"
      ]
    }
  ]
}
```

When the task role is attached, leave `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` **unset** — the AWS SDK will use the task role
automatically and the app's startup validator allows this.

### 2.3 ALB
- HTTPS listener on 443 (ACM certificate).
- Optional HTTP→HTTPS redirect on 80.
- Target group:
  - Protocol: HTTP, port 5000.
  - **Health check path: `/healthz`** (200, no DB write — safe at high frequency).
  - Healthy threshold 2, unhealthy 3, interval 15s, timeout 5s.
  - Deregistration delay: 30s (matches in-app graceful shutdown).
- WebSockets work out of the box; no idle-timeout tuning required unless you
  add long-lived WS streams later. (Today only Vite HMR uses WS, dev-only.)

### 2.4 ECS Fargate service
- Task definition:
  - CPU/memory: start with 1 vCPU / 2 GB.
  - Task role: the policy above.
  - Container port: 5000.
  - `essential: true`.
  - **stopTimeout: 30** (matches the in-app SIGTERM drain budget of 25 s).
  - Logging: `awslogs` driver to a CloudWatch log group.
- Service:
  - Desired count: ≥ 2.
  - Deployment type: Rolling, minimum healthy 100%, maximum 200%.
  - Circuit breaker: enabled with rollback.
  - Attach to the ALB target group above.

### 2.5 Secrets Manager entries
Create one secret per value (or one JSON secret with all keys). Reference them
from the task definition's `secrets` array. Required values are in
`.env.example`; in summary:

- `DATABASE_URL`
- `SESSION_SECRET`
- `STORAGE_PROVIDER` = `s3`
- `AWS_REGION`
- `S3_BUCKET_NAME`
- `AI_INTEGRATIONS_OPENAI_API_KEY` (and optionally `AI_INTEGRATIONS_OPENAI_BASE_URL`)
- (Optional) `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`,
  `GOOGLE_SHEETS_PATIENTS_ID`, `GOOGLE_SHEETS_BILLING_ID` if Sheets sync is on.

`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` should be **omitted** when using
the task role.

## 3. Environment variables

The full list, grouped by concern, lives in `.env.example`. The app validates
required variables at startup and refuses to boot with a clear error listing
anything missing. In production it additionally requires `STORAGE_PROVIDER=s3`.

## 4. First deploy — runbook

1. **Provision** RDS, the S3 bucket, the ALB, and create Secrets Manager
   entries (sections 2.1 – 2.5).
2. **Build** the container image and push to ECR:
   ```
   docker build -t plexus-app .
   docker tag  plexus-app:latest <acct>.dkr.ecr.<region>.amazonaws.com/plexus-app:latest
   docker push <acct>.dkr.ecr.<region>.amazonaws.com/plexus-app:latest
   ```
3. **Apply migrations** (one-shot task or run locally against the new RDS):
   ```
   DATABASE_URL=... npm run db:push
   ```
4. **Register** the task definition referencing the image and the secrets.
5. **Create** the ECS service (desired count 2) attached to the ALB target
   group.
6. **Watch** the target group: tasks should become healthy on `/healthz` within
   ~30 s. The first request to `/readyz` confirms the DB is reachable.
7. **Smoke test** `https://<your-domain>/healthz` and log in.
8. **Default admin.** On first boot with an empty users table the app seeds an
   `admin / admin` account and logs a loud warning. Log in, change the
   password, then create real users.

## 5. Day-2 operations

- **Health endpoints**
  - `GET /healthz` — liveness, no DB, returns `ok`. Used by ALB.
  - `GET /readyz` — readiness, runs `SELECT 1` against the pool. Use for
    blue/green cutovers.
  - `GET /api/healthz` — authenticated-bypass debug endpoint that also returns
    PG pool counts. Useful when triaging connection-pool exhaustion.
- **Graceful shutdown.** SIGTERM drains the HTTP server, detaches WS upgrade
  listeners, and ends the PG pool, with a hard 25 s budget (under ECS's
  default 30 s `stopTimeout`). Each phase logs to CloudWatch.
- **Background jobs.** Patient sync, billing sync, and notes export use
  Postgres advisory locks (`pg_try_advisory_lock`) so only one task in the
  service runs each job at a time. If a second task tries while a job is
  running it logs `[sync] ... already running on another instance — skipping`
  and returns immediately — the request is **not** queued.
- **Sessions.** Stored in the `session` table in Postgres via
  `connect-pg-simple`. Restarting tasks does not log users out.
- **Documents.** Always written to S3 in production (`STORAGE_PROVIDER=s3`).
  The local-disk blob store throws on write in production — there is no silent
  fallback to ephemeral container disk.
- **Reverse proxy.** The app sets `trust proxy: 1` so `req.ip`,
  `X-Forwarded-Proto`, and the `secure` cookie flag work correctly behind the
  ALB's TLS termination.

## 6. Future work (intentionally out of scope here)

- **Separate worker service.** Patient/billing sync and notes export currently
  run in-process on web tasks. Splitting them into a dedicated ECS service
  would isolate latency and let the web tier scale independently.
- **Static assets to CloudFront + S3.** Express serves the built SPA today.
  Moving `dist/public` behind CloudFront would offload bandwidth and improve
  TTFB for distant users.
- **Terraform / CDK.** This runbook is manual. Codifying it is the obvious
  next step once the architecture stabilizes.
- **Redis for cross-instance pub/sub.** Not needed today (Postgres advisory
  locks cover the current need); revisit if real-time fan-out is added.

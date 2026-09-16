# Plexus Staging — Deploy Runbook & Rollback

Target: AWS account **668778694522**, region **us-east-1**, environment **staging only**.
Stack: `PlexusStaging` (CDK) → all resources prefixed `plexus-staging-`.

This runbook is written for the fresh staging environment. It does **not** touch
the old account `374604322534`, and it does **not** create production.

---

## 1. One-time prerequisites (manual, before first deploy)

1. **CDK bootstrap** the account/region (creates the `cdk-hnb659fds` toolkit
   stack the synth references via `/cdk-bootstrap/hnb659fds/version`):
   ```
   cd infrastructure
   npx cdk bootstrap aws://668778694522/us-east-1
   ```
2. **Deploy the stack** (creates VPC/ALB/ECS/ECR/RDS/S3/Secrets/IAM/OIDC):
   ```
   npx cdk deploy PlexusStaging -c account=668778694522 -c region=us-east-1
   ```
   > NOT part of this pre-deployment package. Run only when authorized.
3. **Populate secret values** that CDK creates empty (never stored in code):
   - `plexus-staging/openai-api-key` → real OpenAI key
     ```
     aws secretsmanager put-secret-value \
       --secret-id plexus-staging/openai-api-key \
       --secret-string 'sk-...'
     ```
   - `plexus-staging/rds-credentials` and `plexus-staging/database-url` are
     auto-generated/composed by CDK — no manual entry needed.
   - `plexus-staging/session-secret` is auto-generated — no manual entry needed.
   - SMTP / Google / telephony secrets: only if those integrations are enabled
     for staging. The app treats them as OPTIONAL (see env matrix); add secrets
     and wire them into the task def when needed.
4. **GitHub repo secret**: set `AWS_STAGING_DEPLOY_ROLE_ARN` to the
   `GitHubActionsRoleArn` stack output (the `plexus-staging-github-deploy-role`).

## 2. Normal deploy (via CI)

Triggered by `workflow_dispatch` or push to `deploy/plexus-staging-current`
(`.github/workflows/deploy-staging.yml`). Sequence:

1. checkout exact commit → `npm ci` → `npm run check` → `npm run build`
2. OIDC auth → ECR login
3. build + push image tagged with the **Git SHA** (and `:latest` convenience)
4. register a **migration** task def revision pinned to the SHA image
5. **run the one-shot migration task and block on its exit code** — non-zero
   aborts the deploy (schema never touched by the app itself)
6. register an **app** task def revision pinned to the SHA image
7. `update-service` → `wait services-stable`
8. verify `/healthz` and `/readyz` via the ALB DNS
9. print a sanitized summary (SHA, task-def ARNs, cluster/service)

The exact deployed image is always traceable to a Git SHA. `:latest` is a
convenience tag only; the ECS service runs the SHA-pinned revision.

## 3. Health model

- **`/healthz`** — process liveness, no DB. Used by the **ALB target group** and
  the container `HEALTHCHECK`. A brief RDS hiccup will not drain every task and
  cause a deploy death-loop.
- **`/readyz`** — DB readiness (`SELECT 1`), returns 503 when the DB is not
  reachable. Used by CI post-deploy verification and operators, not by the ALB
  target check.

## 4. Rollback

### Application rollback (fast, safe)
ECS keeps every previous task-definition revision, and ECR keeps prior SHA
images (lifecycle keeps the last 20). To roll back:

1. Find the previous good revision:
   ```
   aws ecs describe-services --cluster plexus-staging-cluster \
     --services plexus-staging-service \
     --query 'services[0].deployments'
   aws ecs list-task-definitions --family-prefix plexus-staging-app --sort DESC
   ```
2. Point the service back at the prior revision:
   ```
   aws ecs update-service --cluster plexus-staging-cluster \
     --service plexus-staging-service \
     --task-definition plexus-staging-app:<PREVIOUS_REVISION>
   aws ecs wait services-stable --cluster plexus-staging-cluster \
     --services plexus-staging-service
   ```
3. Verify `/healthz` and `/readyz` against the ALB DNS.

The service has `circuitBreaker: { enable: true, rollback: true }`, so a failed
rolling deploy auto-rolls-back to the last stable task set without manual action.

### Do NOT auto-delete rollback images
ECR lifecycle retains the last 20 images. Do not prune below the set needed to
roll back to a known-good SHA.

### Database rollback (NOT automatic)
`drizzle-kit push` reconciles the live schema toward `shared/schema.ts`; there is
**no automatic schema rollback**. Safe practice:

- Prefer backward-compatible schema changes (additive columns/tables) so an app
  rollback works against the already-migrated schema.
- **Before any risky/destructive migration**, take a manual RDS snapshot:
  ```
  aws rds create-db-snapshot \
    --db-instance-identifier plexus-staging-postgres \
    --db-snapshot-identifier plexus-staging-pre-migrate-<SHA>
  ```
- Recovery from a bad migration = restore that snapshot to a new instance and
  repoint `DATABASE_URL`, or apply a corrective forward migration. Document the
  chosen path per incident.

### If migration fails during deploy
The CI migration step blocks on the task exit code; a non-zero exit **aborts the
deploy before the service is updated**. The currently running app revision keeps
serving. Fix the schema/migration and re-run the workflow.

### If health checks fail after deploy
The circuit breaker rolls the service back automatically. If it doesn't recover,
perform the manual application rollback above and investigate via CloudWatch
logs (`/ecs/plexus-staging-command-center`).

## 5. Source-of-truth / deployable commit

- Staging deploys the current Plexus platform snapshot on branch
  **`deploy/plexus-staging-current`**, NOT `main` (main is behind by design).
- The image built by CI is pinned to that branch's commit SHA.

## 6. Cost / NAT note

The single NAT gateway is the dominant fixed monthly cost of this staging stack
(see the pre-deployment report). It is required so private ECS tasks can reach
ECR, OpenAI, and other external APIs. Cheaper alternatives (VPC endpoints in
place of NAT, or `nat-instance`) exist but are not recommended for staging
parity with production; do not remove NAT egress in a way that breaks image
pulls or external API calls.

---

## 7. Known test-environment gap (NOT an application regression)

Three tests in `tests/unit/plexusIdentity.test.ts` fail when run against a
developer's working `plexus` database:

- `feature flags default off`
- `(3) flag OFF orchestrator is a no-op`
- `(13) missing table with flags OFF is swallowed (preview safe)`

**Classification: TEST HARNESS / DATABASE FIXTURE GAP — not an application
regression.**

Evidence:
- Reproduced identically (same 3 tests, same count) against the pre-snapshot
  implementation at commit `9f25d7a4` using the same local database. Swapping in
  the old `server/services/plexusIdentity/screeningIntegration.ts` produced the
  exact same failures, so the staging snapshot did not introduce them.
- Root cause is local DB state, not code:
  - test (3) inserts a `patient_clinic_memberships` row referencing
    `clinicId: 7`, which does not exist in the dev DB (only 3 clinic rows) →
    FK violation on `patient_clinic_memberships_clinic_id_clinics_id_fk`.
  - test (13) expects the `plexus_identity` table to be ABSENT to exercise the
    "missing table swallowed" path, but the dev DB has it.

These tests mutate real tables and assume specific seeded fixtures; they need an
isolated test database, not the developer DB.

### Follow-up (do NOT implement in the staging session unless it blocks staging)
Build an isolated Plexus test-DB harness that:
- creates a disposable test database (e.g. `plexus_test_<runid>`),
- applies the current schema (`drizzle-kit push` against the empty test DB),
- seeds deterministic clinic fixtures including the IDs the tests require
  (e.g. clinic id 7, 8, 10, 42),
- can exercise missing-table behavior without touching the developer DB
  (e.g. a schema variant or a dropped-table fixture DB),
- is destroyed/reset between runs,
- never contains PHI.

Until then, `npm run test:unit` is reported honestly as
**PARTIAL / BLOCKED BY 3 PRE-EXISTING TEST-ENVIRONMENT FAILURES**, with all other
tests green and no regressions introduced by the snapshot.

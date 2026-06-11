# Phase 1 AWS deploy runbook

**Status:** Docs-only (Batch H3 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-aws-deploy-runbook.mjs`.

Manual runbook for cutting a staging deploy of the existing build
artifact (`dist/index.cjs` + `dist/public/`) to an AWS EC2 instance.
No IaC code is committed in Phase 1 — every step is a CLI command
the operator runs by hand and records.

This runbook does NOT cover production cut-over. Production cut-over
is a separate, explicitly-approved batch.

## Prerequisites

- AWS CLI v2 installed and configured with a deploy profile.
- Operator has IAM permission to:
  - Launch an EC2 instance,
  - Manage an RDS Postgres instance (or has connection to an existing
    one),
  - Use AWS Secrets Manager.
- The repo is on `main` at the commit being deployed.
- All 156 QA scripts green on the deploying machine.
- `npm run build` produces:
  - `dist/index.cjs` (≈3.4 MB)
  - `dist/public/index.html` + assets

## Steps

### 1. Build locally

```bash
npm ci
npm run check
npm run build
for s in scripts/qa-*.mjs; do node "$s" >/dev/null 2>&1 || { echo "FAIL: $s"; exit 1; }; done
```

If any QA fails, STOP. Do not deploy.

### 2. Provision (first time only)

- Launch one t3.small EC2 in the staging VPC.
- Open inbound 443 (Cloudflare or LB) and 22 from the operator's
  bastion CIDR.
- Provision an RDS Postgres instance (or connect to the existing
  staging DB).
- In AWS Secrets Manager, create:
  - `tertiary/staging/DATABASE_URL`
  - `tertiary/staging/SESSION_SECRET`
  - `tertiary/staging/OPENAI_API_KEY`
  - `tertiary/staging/SMTP_*`
  - `tertiary/staging/GOOGLE_SERVICE_ACCOUNT_JSON`

### 3. Bundle and ship

```bash
tar -czf bundle.tgz dist package.json package-lock.json
scp bundle.tgz ec2-staging:/srv/tertiary/
ssh ec2-staging
cd /srv/tertiary
tar -xzf bundle.tgz
npm ci --omit=dev
```

### 4. Inject secrets at process start

The systemd unit (provisioned out-of-band) pulls all required vars
from Secrets Manager into the env. NEVER write secrets to a
`/srv/tertiary/.env` file.

Per the H1 contract, the staging flag posture is:

```
USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE=0
USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE=0
USE_PORTAL_CALL_HISTORY_READ=0    # flip to 1 only during E7/E10 smoke
USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT=0
USE_ANCILLARY_READ_MODEL=0
USE_ANCILLARY_REPORT_UPLOAD=0
USE_ANCILLARY_SIGNING_SERVICE=0
USE_BILLING_READINESS_AGGREGATOR_V2=0
USE_INVOICING_SCAFFOLD_V2=0
USE_RINGCENTRAL_ADAPTER=0
```

VITE flags must already have been compiled into the client bundle at
build time. Do NOT attempt runtime overrides.

### 5. Restart

```bash
sudo systemctl restart tertiary
sudo systemctl status tertiary
```

### 6. Smoke

Follow the H5 smoke-test runbook before declaring the deploy good.

### 7. Roll back

```bash
ssh ec2-staging
cd /srv/tertiary
# Previous bundle.tgz is kept under /srv/tertiary/prev/bundle.tgz.
tar -xzf prev/bundle.tgz
npm ci --omit=dev
sudo systemctl restart tertiary
```

If a database migration is involved, ABORT the rollback and call Ali
— Phase 1 does not auto-roll migrations.

## What this runbook does NOT do

- Provision IaC (Terraform / CloudFormation / CDK) — none committed.
- Run a production deploy.
- Flip any production flag truthy.
- Touch claims / remittance / payment posting / PDF generation
  behavior.
- Modify Plexus IQ or Admin Review surfaces.

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[phase-1-env-var-inventory]]
- [[phase-1-aws-backup-runbook]]
- [[phase-1-aws-smoke-test-runbook]]

End of runbook.

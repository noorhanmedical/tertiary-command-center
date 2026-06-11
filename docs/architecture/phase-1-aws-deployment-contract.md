# Phase 1 AWS deployment contract

**Status:** Docs-only (Batch H1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-aws-deployment-contract.mjs`.

Pins the deployment posture for Phase 1: staging first, prod gated
behind explicit approval, no production flag flips without explicit
approval, no secrets in the repo, no IaC merged without explicit
approval.

## Environments

| Environment | Purpose | Approval |
|---|---|---|
| local | Developer workstation. Vite dev + node server. | n/a |
| staging | Pre-production smoke surface. Mirrors prod schema. | Ali pre-approves staging deploys per release. |
| production | Live traffic. | Each prod deploy requires explicit Ali approval. |

Replit's existing hosting remains the canonical "main" deploy target
until an approved AWS cut-over batch lands. AWS in Phase 1 means
"staging surface that can run our build artifact" — NOT cut-over.

## What Phase 1 deploys to AWS

- The Express bundle (`dist/index.cjs`) + Vite client bundle
  (`dist/public/`) as a single Node service.
- A Postgres connection via `DATABASE_URL` (env-injected; AWS RDS or
  equivalent; never committed).
- Outbound HTTPS to RingCentral when `USE_RINGCENTRAL_ADAPTER` is
  truthy (Phase 1 stays OFF).
- No queue, no Lambda, no S3 sidecar in Phase 1. Documents continue
  through the existing `document_blobs` Postgres path.

## What Phase 1 does NOT deploy

- No production cut-over.
- No new domain. Staging may live at a temporary AWS-owned URL.
- No autoscaling group; a single right-sized instance is sufficient
  for staging smoke.
- No Lambda / SQS / S3 buckets.
- No CloudFront in front of the app.

## Flag posture at deploy time

| Flag | Staging | Production |
|---|---|---|
| `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` | OFF | OFF |
| `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` | OFF | OFF |
| `USE_PORTAL_CALL_HISTORY_READ` | ON in staging when smoke-testing E7/E10 | OFF until E1 manual smoke completes |
| `USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT` | OFF | OFF |
| `USE_ANCILLARY_*` | OFF | OFF |
| `USE_BILLING_READINESS_AGGREGATOR_V2` | OFF | OFF |
| `USE_INVOICING_SCAFFOLD_V2` | OFF | OFF |
| `USE_RINGCENTRAL_ADAPTER` | OFF | OFF |
| `VITE_USE_*` (all) | OFF | OFF |

All VITE flags MUST be passed at build time, not runtime, and MUST
stay OFF unless Ali explicitly approves a specific flip for a
specific environment.

## Secrets

- All secrets MUST come from AWS environment / Secrets Manager
  injection at process start. No `.env` committed. No keys in
  `infra/`.
- The git-ignore pattern protects `.env*` already.
- A secret found in the repo halts deploy; the prior secret must be
  rotated.

## Out of scope for Phase 1

- Production cut-over.
- Multi-region.
- Blue/green or canary rollouts.
- Performance hardening beyond the static build flags.
- Database migrations (managed manually with Ali's approval).
- Backup automation (covered by H4 docs only).

## Related contracts

- [[phase-1-batch-flow-handoff-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]
- [[team-portal-panel-playground-protection]]

End of contract.

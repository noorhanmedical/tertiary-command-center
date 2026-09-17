# Plexus OS - Ancillaries — HIPAA Service Inventory & Technical Posture

**Status:** Technical hardening in progress. This document does NOT assert legal
HIPAA compliance. The phrase "TECHNICALLY HIPAA-READY" is used only where the
listed technical prerequisites are verified — legal/compliance review and a
signed AWS BAA remain REQUIRED before any real PHI.

**AWS account:** 668778694522 · **Region:** us-east-1 · **Env inspected:** staging
**Inspection date:** captured live via AWS CLI during hardening.

---

## 0. AWS Business Associate Addendum (BAA)

- **Status: CANNOT VERIFY via CLI.** BAA acceptance is an account/organization
  contractual action (AWS Artifact console / AWS Organizations management
  account). The CLI `artifact` surface does not expose agreement acceptance
  state for this principal, and `artifact get-account-settings` shows
  `notificationSubscriptionStatus: NOT_SUBSCRIBED`.
- **Consequence: REAL PHI REMAINS BLOCKED** until the BAA is confirmed ACTIVE by
  an account owner in AWS Artifact and only HIPAA-eligible services are used.

---

## 1. Service inventory (verified live state)

| Service | Purpose | Holds PHI? | HIPAA-eligible* | Encryption (current) | Public/Private | Logging | Backup | Issue | Remediation |
|---|---|---|---|---|---|---|---|---|---|
| ECS Fargate | App + one-shot migration tasks | In transit (memory) | Yes | N/A (compute) | Private subnets, no public IP | CloudWatch Logs | N/A | none | keep private; min 2 tasks in prod |
| ECR | Container images | No | Yes | AES256 (AWS-managed) | Private | API via CloudTrail (not yet on) | image retention | CloudTrail off | enable CloudTrail |
| RDS PostgreSQL | Canonical clinical data store | **Yes** | Yes | **Encrypted (alias/aws/rds — AWS-managed KMS)** | Private, `PubliclyAccessible=false` | CloudWatch (prod exports pg logs) | 7d (staging) | AWS-managed key; single-AZ staging; 7d retention | prod: CMK + Multi-AZ + 14–30d (done in prod stack) |
| S3 (documents) | Clinical documents | **Yes** | Yes | **AES256 (SSE-S3, AWS-managed)** | **Block Public Access ON (all 4)**, versioned, TLS-enforced | server access / CloudTrail data events (not on) | versioning | AWS-managed key; no data-event logging | prod: CMK (SSE-KMS) + S3 data events |
| Secrets Manager | DB creds, session secret, OpenAI key, composed DATABASE_URL | Indirect (credentials) | Yes | AWS-managed KMS (alias/aws/secretsmanager) | Private (VPC access via exec role) | CloudTrail (not on) | N/A | AWS-managed key | prod: consider CMK; rotation policy |
| CloudWatch / Logs | App + infra logs | **RISK: PHI if unsafe logging** | Yes | AES (AWS-managed) | Private | self | retention set | log-group PHI risk (see §8) | PHI-safe logging sweep |
| ALB (ELB v2) | Public ingress | In transit | Yes | TLS at edge (prod, when cert supplied) | Internet-facing | access logs (not enabled) | N/A | **staging is HTTP-only** | HTTPS gate (see §4); enable ALB access logs to a private bucket in prod |
| IAM | AuthZ | No | Yes (always available) | N/A | N/A | CloudTrail (not on) | N/A | Admin user w/o MFA; static keys | §6 remediation |
| KMS | Key management | No | Yes | N/A | N/A | CloudTrail (not on) | N/A | **No customer-managed keys** | create prod CMKs (§5) |
| Route53 | DNS | No | Yes | N/A | Public DNS | query logging optional | N/A | **no hosted zone / domain found** | DOMAIN REQUIRED (§4) |
| ACM | TLS certs | No | Yes | N/A | N/A | N/A | N/A | no cert (needs domain) | issue after domain |
| CloudTrail | Audit of API calls | Metadata | Yes | — | — | — | — | **NOT ENABLED** | enable org/account trail (§7) |
| AWS Config | Resource compliance | No | Yes | — | — | — | — | **NOT ENABLED** | enable recorder + conformance pack |
| GuardDuty | Threat detection | Findings metadata | Yes | — | — | — | — | **NOT ENABLED** | enable detector |
| Security Hub | Posture aggregation | Findings metadata | Yes | — | — | — | — | **NOT SUBSCRIBED** | enable + CIS/FSBP standards |
| Macie | S3 PHI discovery | Scans PHI | Yes | — | — | — | — | not enabled | targeted scan of documents bucket only (cost-aware) |
| Lambda | CDK custom resource (OIDC provider) only | No | Yes | — | Private | CloudWatch | N/A | none | none |

\* HIPAA eligibility must be re-confirmed against the current authoritative AWS
list (https://aws.amazon.com/compliance/hipaa-eligible-services-reference/) at
review time. All services above are on the AWS HIPAA-eligible list as of the
platform's design; this table is a working record, not a compliance attestation.

---

## 2. Detective controls — current state (VERIFIED)

| Control | State |
|---|---|
| CloudTrail | **None** (`describe-trails` empty) |
| GuardDuty | **None** (`list-detectors` empty) |
| AWS Config | **None** (no recorders) |
| Security Hub | **Not subscribed** |
| Macie | Not enabled |
| Customer-managed KMS keys | **None** (only AWS-managed default aliases) |

These are all **prepare/evaluate** items in this phase. Enabling them is
account-wide and cost-bearing, so enablement is flagged for owner confirmation
rather than done autonomously.

---

## 3. Encryption posture (VERIFIED)

- **RDS staging:** encrypted at rest with `alias/aws/rds` (AWS-managed). TLS CA
  `rds-ca-rsa2048-g1`; app trusts the RDS CA bundle via `NODE_EXTRA_CA_CERTS`
  (verified TLS, not `no-verify`).
- **S3 staging:** SSE-S3 (AES256, AWS-managed). Block Public Access all true.
  Versioning enabled. TLS-only bucket policy.
- **Secrets Manager:** AWS-managed KMS.
- **Gap for production:** move clinical stores (RDS, documents S3) to
  **customer-managed KMS keys (CMK)** with least-privilege key policies and
  separation from staging — see §5 / production stack follow-up.

---

## 4. HTTPS is a PHI gate (VERIFIED)

- **Staging is HTTP-only** (ALB HTTP:80). `COOKIE_SECURE=false` is set on the
  staging task ONLY to permit non-PHI browser testing.
- **No Route53 hosted zone or approved domain was found** in the account/repo.
- **DOMAIN REQUIRED FOR HTTPS.** Until a domain + ACM cert exist:
  - staging remains **NON-PHI ONLY**,
  - the production stack renders HTTP-only in synth and switches to HTTPS
    (443 + 80→443 redirect, `COOKIE_SECURE=true`) automatically when
    `-c prodCertArn`/`-c prodDomainName` are supplied.
- HSTS to be enabled only after HTTPS is verified end-to-end.

---

## Bottom line
- **Staging technically ready for PHI: NO** (HTTP-only + BAA unverified + no CMK/
  CloudTrail/audit-at-rest hardening).
- **Production architecture (code) technically trending ready:** the
  `PlexusProduction` CDK stack encodes HTTPS-only, Multi-AZ encrypted RDS,
  private networking, deletion protection, backups, and alarms — but is NOT
  deployed and still needs CMKs, CloudTrail/Config/GuardDuty, a domain, and a
  signed BAA before real PHI.
- **Legal/compliance review + signed AWS BAA remain REQUIRED.**

# HIPAA Service Eligibility Matrix

**Generated:** 2026-08-25
**Product:** Plexus Command Center (Plexus Ancillary application)
**Parent:** [High-Level Design](./high-level-design.md) §6

Every AWS service in the current and target architecture is listed with its
HIPAA-eligibility status and the encryption/logging conditions required to use it
for PHI. **An active AWS BAA is in place** (owner-confirmed); HIPAA eligibility is
only meaningful under that BAA.

> **Verify current eligibility** at the authoritative AWS list, as it changes:
> https://aws.amazon.com/compliance/hipaa-eligible-services-reference/
> This matrix reflects general, well-established eligibility as of 2026-08-25 and
> is architecture guidance, not a compliance attestation.

---

## 1. Services in the architecture

| AWS Service | Role in Plexus | HIPAA-eligible? | Handles PHI? | Required conditions for PHI use |
|---|---|---|---|---|
| ECS (Fargate) | Runs the Express/React container | Yes | Yes (in memory) | Encryption in transit; no PHI in plaintext logs; run in production mode |
| RDS PostgreSQL | Primary clinical datastore | Yes | **Yes** | Encryption at rest (KMS); **TLS with certificate verification** (fix GAP-019); Multi-AZ; automated encrypted backups |
| S3 | Document storage; audit logs; build artifacts | Yes | **Yes** (documents, invocation logs) | SSE-KMS; block public access; TLS-only bucket policy; versioning; Object Lock for audit logs |
| Amazon Bedrock | Clinical AI inference (target — ADR-004) | Yes | **Yes** (prompts) | Model invocation logging to encrypted S3; VPC endpoints; use HIPAA-eligible model; verify model provider covered |
| KMS | Encryption keys | Yes | No (key mgmt) | Key policies least-privilege; rotation enabled |
| CloudTrail | Management + data-event audit | Yes | Indirect (data events reference PHI resources) | Multi-region; log to Object-Lock S3 in Log Archive; KMS-encrypted |
| CloudWatch Logs | Application/infra logs | Yes | Must **not** contain PHI | PHI-safe logging (WP1); KMS encryption; finite retention |
| ALB | Ingress | Yes | In transit | TLS 1.2+; access logging to protected bucket; drop invalid headers |
| WAF | Edge protection | Yes | No | Associate to the app ALB; move to Block mode; add rate rules (GAP-027) |
| VPC / VPC Endpoints | Networking / private egress | Yes | In transit | Private endpoints for Bedrock/S3/etc. to keep PHI off public internet |
| Secrets Manager | Credentials/secrets | Yes | No (secrets) | Per-account; rotation; no secrets in env/source (GAP-018/031) |
| ECR | Container images | Yes | No | Immutable tags; image scanning; deploy by digest (ADR-001) |
| AWS Backup | Backup orchestration | Yes | Yes (backups of PHI) | Encrypted; retention per policy; deletion protection; restore test (GAP-024) |
| GuardDuty / Security Hub / Config | Security detection baseline | Yes | No | Enable org-wide (GAP-023) |
| Organizations | Multi-account governance | N/A (mgmt) | No | SCPs on Workload OU (ADR-001) |

---

## 2. Non-AWS processors (subprocessors)

| Processor | Role | PHI? | BAA/eligibility | Action |
|---|---|---|---|---|
| OpenAI (current) | AI inference | **Yes** | **Not** under AWS BAA; separate OpenAI BAA required | Interim: signed OpenAI BAA + minimum-necessary payload. **Target: replace with Bedrock** (ADR-004) |
| Google | — | No | Removed from architecture | No action (integration removed) |

---

## 3. Configuration gaps blocking compliant PHI use

These are HIPAA-eligible services that are **currently misconfigured** for PHI
(from the gap register):

| Service | Gap | Fix |
|---|---|---|
| RDS | TLS verification disabled (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `PGSSLMODE=no-verify`); prod runs `NODE_ENV=development` (GAP-019) | Enforce TLS cert verification; run production mode; fail closed if insecure |
| S3 (documents/dev) | SSE-S3 not KMS; versioning off; no access logging/Object Lock; some patient buckets lack TLS policy (GAP-021) | KMS, versioning, access logging, Object Lock for audit, TLS-only policy |
| CloudTrail | Prod management-events-only; **no CloudTrail in dev** (GAP-022) | Central multi-region trail; PHI-relevant data events; Object Lock |
| CloudWatch/logs | Largely unbounded, unencrypted; historical logs may contain PHI (GAP-004/016) | KMS, retention, PHI-safe logging (WP1), controlled historical review |
| Secrets | DB/session/AWS keys as env/source values (GAP-018) | Move to Secrets Manager / task roles; rotate |
| ECR | Mutable, unscanned, `latest` deploys (GAP-030/037) | Immutable + scanning + digest deploys (ADR-001) |

---

## 4. Summary

- Every service in the **target** architecture is HIPAA-eligible and usable for
  PHI **under the AWS BAA**, provided the encryption/logging conditions in §1 are
  met.
- The material compliance work is **configuration and the OpenAI→Bedrock
  migration**, not swapping to different services.
- The one non-AWS PHI processor (OpenAI) is the clearest exception; ADR-004
  removes it by moving inference under the AWS BAA via Bedrock.

---

## 5. Related Artifacts

- [High-Level Design](./high-level-design.md) — §6 (HIPAA/BAA posture)
- [ADR-004: OpenAI → Bedrock](./adr/ADR-004-openai-to-bedrock-phi-inference.md)
- [ADR-001: Multi-Account & Pipeline](./adr/ADR-001-multi-account-structure-and-promotion-pipeline.md) — accounts, ECR, networking
- BAA Inventory (planned) — full processor list and BAA status
- [Gap Register](../GAP_ANALYSIS.md) — GAP-018/019/021/022/023/024/027/030/031

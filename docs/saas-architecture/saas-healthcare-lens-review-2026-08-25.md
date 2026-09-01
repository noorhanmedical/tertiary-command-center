# SaaS + Healthcare Lens Architecture Review

**Product:** Plexus Command Center (Plexus Ancillary application)
**Date:** 2026-08-25
**Reviewer:** Architecture review (Kiro-assisted), using AWS Well-Architected SaaS Lens + Healthcare Industry Lens
**Review scope:** Whole platform — application security, tenant isolation, AWS environment/operations, clinical AI, and release process. Grounded in `docs/GAP_ANALYSIS.md` (50 gaps), the codebase, and the owner discovery captured in the HLD.

---

## Executive Summary

Plexus Command Center is a functionally rich, HIPAA, pool-model clinical SaaS that
is **not yet production-ready** for unrestricted PHI operation. The product and
workflows are largely built; the readiness gap is in tenant isolation, release
safety, AWS environment structure, and governance evidence. The single most
urgent item is not on the roadmap timeline at all: **dev/QA currently hold real
PHI** in weakly-controlled environments — that is a containment priority now.

**Overall SaaS maturity:** Developing (strong application plane; missing control
plane, isolation rigor, and release discipline).
**Overall production posture:** **NOT DEPLOY READY** (consistent with the gap register).

---

## Findings Summary (by pillar)

| # | Pillar | Finding | Risk | Priority |
|---|---|---|---|---|
| 1 | Security | Fail-open tenant isolation; ID-only reads across many repositories (GAP-001/002/003) | Critical | P1 |
| 2 | Security | Real PHI in dev/QA; public EKS mgmt plane; no dev CloudTrail (GAP-048/050) | Critical | P1 |
| 3 | Security | PHI to external AI (OpenAI) outside AWS BAA (GAP-015) | Critical | P1 |
| 4 | Security | Prod runs dev mode; DB TLS verification off (GAP-019) | Critical | P1 |
| 5 | Security | Secrets/keys as env/source values (GAP-018/031) | Critical | P1 |
| 6 | Security | Session fixation, no revocation, weak passwords, no MFA/CSRF/rate limit (GAP-006/008) | High | P1 |
| 7 | Reliability | Runtime `drizzle-kit push --force` on every boot (GAP-035) | Critical | P1 |
| 8 | Operational Excellence | Direct-to-prod pipeline: mutable `latest`, no gates/staging/rollback (GAP-037) | High | P1 |
| 9 | Operational Excellence | `build` doesn't typecheck/test; no tenant-isolation suite (GAP-038) | High | P1 |
| 10 | Reliability | Single ECS task, Single-AZ RDS; no restore test (GAP-024/025) | High | P2 |
| 11 | Security | Audit coverage incomplete; logs unbounded/unencrypted; historical PHI in logs (GAP-004/014/016/022/026) | High | P2 |
| 12 | Security | WAF not enforcing; no rate rules (GAP-027) | High | P2 |
| 13 | Operational Excellence | No security-detection baseline (GuardDuty/Config/Security Hub) (GAP-023) | High | P2 |
| 14 | Reliability | FHIR import can report success after DB failure (GAP-011/012) | High | P2 |
| 15 | Cost/Ops | No per-tenant cost attribution; lightly-used resources unowned (GAP-034) | Medium | P3 |
| 16 | Reliability/Product | Production-visible prototypes; canonical patient/merge/export gaps (GAP-040–045) | High/Med | P2/P3 |

Full detail, evidence, and effort per gap: `docs/GAP_ANALYSIS.md`.

---

## Findings by Well-Architected pillar

### Security (the dominant pillar here)
- **Tenant isolation is fail-open** and unevenly enforced (see Tenant Isolation
  Matrix). This is the primary PHI risk. Fix per ADR-002.
- **Identity** is local sessions with fixation/revocation/credential gaps
  (ADR-005). No SSO needed, but hardening is mandatory.
- **PHI + AI:** external OpenAI is outside the AWS BAA; move to Bedrock (ADR-004).
- **Encryption/config:** production runs dev mode with DB TLS verification off;
  secrets in env; S3 not KMS. All must be corrected.
- **Non-production PHI + exposed dev management plane** is a containment issue.

### Reliability
- **Schema safety:** runtime `push --force` is destructive-by-design; move to
  gated one-shot migrations (ADR-003).
- **Availability:** single task / Single-AZ, no proven restore. Define RPO/RTO
  (proposed ≤1h/≤4h clinical), enable Multi-AZ, backups, deletion protection, and
  a documented restore test.
- **Data integrity:** FHIR import success accounting is unreliable.

### Operational Excellence
- **Release process** is the biggest operational risk: direct-to-prod, mutable
  `latest`, no gates/staging/rollback. Replace with the ADR-001 build-once
  promotion pipeline.
- **Testing** doesn't gate on typecheck/tests or tenant isolation; add gates.
- **Monitoring/alarms** are largely absent in prod.

### Performance Efficiency
- Pool model is appropriate for ~20→~80 clinics; no re-architecture needed.
  Main watch item is ensuring tenant-scoped queries remain indexed
  (`clinic_id` indexes) as data grows.

### Cost Optimization
- No per-tenant cost attribution yet (fine at this scale, needed later for
  tiering). Some lightly-used dev/QA resources are unowned; tag and review after
  the PHI-containment and account-restructure work.

---

## Quick Wins (low effort, high impact)

1. **Remove `drizzle-kit push --force` from container startup** (GAP-035) — stops
   destructive schema change on every boot.
2. **Set production to `NODE_ENV=production` and enable DB TLS verification**
   (GAP-019).
3. **Enforce a real password policy** (remove `min(1)`) and **regenerate sessions
   on login** (GAP-006/008).
4. **Restrict the audit endpoints to admin** (GAP-003).
5. **Contain dev/QA PHI access** immediately while the classification decision is
   made (GAP-050).

---

## Recommended Roadmap

### Phase 0 — Containment (now, before feature work)
- Privacy-owner decision on **real PHI in dev/QA**; restrict access; plan synthetic
  rebuild (GAP-050/048).
- Interim OpenAI BAA + minimum-necessary payload until Bedrock cutover (GAP-015).

### Phase 1 — Sprint 0 release blockers (the "safe to deploy" gate)
- **Fail-closed tenant isolation** + cross-tenant tests (ADR-002; GAP-001/002/003).
- **Remove runtime schema push; one-shot migrations** (ADR-003; GAP-035).
- **Build-once promotion pipeline** with gates, staging, canary, rollback
  (ADR-001; GAP-037/038).
- **Multi-account structure**; move prod into the Org; **PHI only in prod**
  (ADR-001; GAP-020).
- **Production hardening:** production mode, DB TLS, secrets to Secrets Manager,
  S3 KMS (GAP-018/019/021/031).
- **Identity hardening:** sessions, passwords, MFA for admin, CSRF, rate limit,
  WAF enforcing (ADR-005; GAP-006/008/027).
- **Bedrock migration** for PHI inference (ADR-004; GAP-015/016).
- **Availability + DR:** Multi-AZ, backups, deletion protection, **restore test**,
  contingency plan (GAP-024/025).
- **Audit + detection baseline:** central CloudTrail w/ data events + Object Lock,
  encrypted finite-retention logs, GuardDuty/Config/Security Hub (GAP-014/022/023/026).

### Phase 2 — Durable hardening (Sprint 1)
- Canonical patient identity/model integrity (GAP-009/010).
- Complete application audit UI + coverage (GAP-014/044).
- FHIR import durability/idempotency (GAP-012).
- Feature-gate/remove production-visible prototypes (GAP-045).

### Phase 3 — Data lifecycle, interoperability, cost (Sprint 2+)
- Merge/export/amendment workflows (GAP-040/041/042/043).
- Cost attribution + resource ownership (GAP-034).
- Broad EMR interoperability workstream (eCW/athenahealth + general).

### Parallel — Compliance program
- **SOC 2** (Type I → II): most controls are Phase 1/2 byproducts.
- **HITRUST CSF** after SOC 2, inheriting AWS control coverage.
- Regulatory confirmation that clinician-in-the-loop keeps the product within the
  **FDA CDS exemption**.

---

## Strengths Observed

- Clean modular route/repository/schema structure; AI already behind a service
  abstraction (eases the Bedrock migration).
- Pool model is the right fit for the tenant scale — no costly re-architecture.
- **WP1 PHI-safe logging** and **WP2 fail-closed bootstrap** are already done and
  materially reduce risk.
- AWS BAA in place; production RDS/Aurora private and encrypted; production
  CloudTrail multi-region/encrypted; root MFA enabled.
- The clinician-in-the-loop control that likely secures the FDA CDS exemption is
  already the intended workflow.

---

## Related Artifacts

- [High-Level Design](./high-level-design.md)
- [Tenant Isolation Matrix](./tenant-isolation-matrix.md)
- [HIPAA Service Eligibility Matrix](./hipaa-service-eligibility-matrix.md)
- [PHI Data Flow Map](./phi-data-flow-map.md)
- ADRs [001](./adr/ADR-001-multi-account-structure-and-promotion-pipeline.md) ·
  [002](./adr/ADR-002-fail-closed-pool-tenancy.md) ·
  [003](./adr/ADR-003-migrations-as-gated-one-shot-task.md) ·
  [004](./adr/ADR-004-openai-to-bedrock-phi-inference.md) ·
  [005](./adr/ADR-005-local-auth-and-session-hardening.md)
- [Production-Readiness Gap Register](../GAP_ANALYSIS.md)

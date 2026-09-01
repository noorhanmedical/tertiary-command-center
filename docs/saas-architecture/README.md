# Plexus Command Center — Architecture & Production-Readiness Space

This is the documentation space for **Plexus Command Center**, the platform that
houses the **Plexus Ancillary** application. It records the architecture,
compliance posture, AWS environment design, and the path to a safe production
deployment.

It is written to read like a Confluence space: a landing page (this file) that
links out to living documents, each of which owns one topic and is cross-linked
to the others. The **High-Level Design (HLD)** is the master document; every
other artifact deepens one section of it.

> **Scope & disclaimer.** These documents provide architecture and
> compliance-*posture* guidance grounded in AWS Well-Architected (SaaS Lens,
> Healthcare Industry Lens) and HIPAA guidance. They are **not** legal,
> regulatory, or medical advice. BAAs, FDA/SaMD classification, and formal HIPAA
> determinations require qualified counsel and the organization's compliance
> function.

---

## 1. What Plexus Command Center is

Plexus Command Center is a multi-tenant, web-based clinical operations platform
for ancillary-service screening, scheduling, billing, and document management.
Its clinical core — **Plexus Ancillary** — ingests patient screening batches,
determines qualifying ancillary tests (with AI assistance), and drives the
downstream engagement, scheduling, and billing workflow. Tenants are clinics.

- **Segment:** EHR-adjacent / clinical workflow SaaS
- **Regulatory floor:** HIPAA (PHI throughout)
- **Runtime:** React + TypeScript SPA, Express + TypeScript API, PostgreSQL via
  Drizzle ORM, deployed as a container on AWS ECS Fargate
- **Tenancy model:** Pool (single shared application + database, row-level
  `clinic_id` tenant scoping, `admin` role bypass)

---

## 2. Document index

| Doc | Purpose | Status |
|---|---|---|
| [High-Level Design (HLD)](./high-level-design.md) | Master system view: context, architecture, AWS environment, security posture, decisions, risks | **Draft v0.1** |
| [Production-Readiness Gap Register](../GAP_ANALYSIS.md) | The 50-gap audit (10 Critical / 31 High / 8 Medium / 1 Low; 23 Sprint 0 blockers) | Baseline (2026-08-25) |
| [ADR-001: Multi-Account & Promotion Pipeline](./adr/ADR-001-multi-account-structure-and-promotion-pipeline.md) | Dev / Staging / Prod account structure and build-once promotion | **Proposed** |
| [ADR-002: Fail-Closed Pool Tenancy](./adr/ADR-002-fail-closed-pool-tenancy.md) | Keep pool model; make `clinic_id` isolation fail-closed | **Proposed** |
| [ADR-003: Migrations as Gated One-Shot Task](./adr/ADR-003-migrations-as-gated-one-shot-task.md) | Remove runtime `drizzle-kit push --force`; reviewed migrations in the pipeline | **Proposed** |
| [ADR-004: OpenAI → Bedrock for PHI Inference](./adr/ADR-004-openai-to-bedrock-phi-inference.md) | Move AI inference under the AWS BAA; dual-zone pattern | **Proposed** |
| [ADR-005: Local Auth + Session Hardening](./adr/ADR-005-local-auth-and-session-hardening.md) | No SSO for launch; fix session fixation, revocation, passwords, MFA | **Proposed** |
| [ADR-006: Tenant-Scope Enforcement Pattern](./adr/ADR-006-tenant-scope-enforcement-pattern.md) | Guarded boundary (async tenant scope) instead of threading `clinicId` everywhere | **Proposed** |
| [Tenant Isolation Matrix](./tenant-isolation-matrix.md) | Per-component tenancy model and isolation mechanism (current vs. target) | **Draft** |
| [HIPAA Service Eligibility Matrix](./hipaa-service-eligibility-matrix.md) | Every AWS service checked against the HIPAA-eligible list + BAA coverage | **Draft** |
| [PHI Data Flow Map](./phi-data-flow-map.md) | PHI ingress → processing → storage → egress with encryption/audit per hop | **Draft** |
| [SaaS + Healthcare Lens Review Report](./saas-healthcare-lens-review-2026-08-25.md) | Combined Well-Architected review with findings and phased roadmap | **Draft** |
| [Phase 1 Execution Plan](./phase-1-execution-plan.md) | Sequenced, owner-assigned tasks from NOT DEPLOY READY to safe launch | **Draft** |
| [Test-DB Harness Plan](./test-db-harness-plan.md) | Safe harness design for proving SQL-level cross-tenant isolation (C.6) | **Draft** |
| Change Log | Running record of what changed in this space and why | [Change Log](./CHANGELOG.md) |

---

## 3. How to use this space

1. Start with the **HLD** for the system view.
2. Follow the links from any HLD section into its detail artifact.
3. Every architecturally significant decision gets an **ADR** under `./adr/`;
   the HLD's decision index links to each one.
4. Nothing is deployed, merged, or changed in AWS from these documents — they
   are design and audit artifacts. Production actions remain gated on explicit
   owner approval.

---

## 4. Provenance of current content

The technical facts in these documents are grounded in the repository as of the
dates recorded in each file:

- Application components: `server/routes/*`, `shared/schema/*`
- Tenancy model: `shared/schema/clinics.ts`, `shared/schema/users.ts`,
  `server/middleware/clinicContext.ts`, `server/repositories/screening.repo.ts`
- Runtime/deploy: `Dockerfile`, `.github/workflows/deploy.yml`
- Audit findings: `docs/GAP_ANALYSIS.md`, `BUILD_LOG.md`

See the [Change Log](./CHANGELOG.md) for the running history of this space.

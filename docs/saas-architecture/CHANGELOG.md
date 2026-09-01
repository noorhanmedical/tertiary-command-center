# Change Log — Architecture Space

All notable changes to the Plexus Command Center architecture documentation
space are recorded here, newest first. Each entry states what changed and why.

## 2026-08-25

- **Scoped and built the test-DB harness (C.6).** Added
  `docs/saas-architecture/test-db-harness-plan.md` (design + safety model),
  `tests/integration/setup/testDb.ts` (guarded connect: requires a dedicated
  `TEST_DATABASE_URL`, refuses if equal to `DATABASE_URL` or if the DB name lacks
  "test", dynamically imports app modules only after repointing the singleton
  pool), `tests/integration/tenantIsolation.screening.test.ts` (real-SQL
  cross-tenant assertions: Clinic A cannot read/update/delete Clinic B rows;
  platform sees all; denied throws), and a `test:integration` npm script.
  Verified: `tsc` clean, unit suite green, integration test **skips cleanly**
  with no DB, and the **safety guards refuse non-test and same-as-app databases**
  (tested directly). Discovered the repo has **no docker-compose / `.env.local.example`**
  despite dev docs referencing them, so a test DB must be supplied (CI service or
  an added local compose).
  - **Honest limitation:** the harness is built and safe, but the SQL-level
    cross-tenant assertions have **not been executed** here — no PostgreSQL is
    available in this environment. They run once a `TEST_DATABASE_URL` is
    provided. Until then, screening isolation remains proven only at the
    guard/scope level, with a fail-closed posture.
- **Created ADR-006 (tenant-scope enforcement pattern)** and implemented the
  reference — code changes, verified, **not committed or deployed**:
  - Chose **Option B (single guarded boundary)** over threading `clinicId` through
    40+ call sites, after a call-graph trace showed the screening repo is reached
    via `storage.ts` from dozens of services/routes. Reuses the existing
    request-scoped `AsyncLocalStorage`.
  - Extended `tenantContext.ts`: async tenant store, `getTenantScope()`,
    `withSystemScope()` (the only sanctioned unscoped path, greppable),
    `resolveScopedClinicId()` (fail-closed guard: clinic→id, platform→null,
    denied/no-store→throws). `tenantContext` middleware now runs the request under
    the store.
  - Applied the guard to the **screening repository** by-id methods (`getBatch`,
    `updateBatch`, `deleteBatch`, `listScreeningsByBatch`, `getScreening`,
    `getScreeningIncludingDeleted`, `updateScreening`, `deleteScreening`,
    `restoreScreening`) — each now adds `AND clinic_id = ?` under clinic scope,
    runs unscoped only under platform/system scope, and cannot run at all under
    denied scope.
  - Wrapped the boot-time startup recovery in `routes.ts` with `withSystemScope`.
  - Extended `tests/unit/tenantContext.test.ts` to prove the async guard:
    no-store→throws, system scope→unscoped and persists across `await`.
  - Verified: new test passes, `tsc` clean, full unit suite green.
  - **Known follow-up (not yet done):** other domains (billing, documents, patient
    history, cooldown, notes, appointments) still to migrate to the guard.

- **Hardened the screening migration for detached background work.** Traced the
  call graph: `startBatchAnalysis` is `await`ed in routes but internally does
  `void runAnalysisLoop(...)` (detached, outlives the request); recurring
  boot-started jobs (absence watcher, morning rebuild, invoice reminders, live
  activity) do NOT call scoped screening methods. Rather than rely on implicit
  AsyncLocalStorage propagation into the detached loop, added
  `runWithScope(scope, fn)` and changed the runner to **capture the request scope
  at kickoff and re-establish it** around the loop (ADR-006 §2a). Extended
  `tenantContext.test.ts` to prove: scope persists across awaits, captured clinic
  scope re-establishes correctly, a different clinic's scope does not leak,
  undefined→fail-closed, platform→unscoped, denied→throws. Verified: test passes,
  `tsc` clean, full unit suite green.
  - **Honest limitation:** the guard-level and scope-propagation behavior is
    proven by runnable tests, but **DB-level cross-tenant denial (real SQL,
    Clinic A vs Clinic B rows) is NOT yet tested** — the repo has only in-memory
    fixture tests and no test-DB infrastructure. This was not faked. Note the
    fail-closed posture: any unmigrated/undiscovered detached path that hits a
    guarded method without scope now THROWS rather than leaking.
- **Implemented B.2 (schema-safety) and C.1 (tenant-context foundation)** — code
  changes, verified, **not committed or deployed**:
  - **B.2:** removed `npx drizzle-kit push --force` from the `Dockerfile` startup;
    container now starts with `node dist/index.cjs` only. Added `db:migrate`
    (`drizzle-kit migrate`, versioned) to `package.json` for the ADR-003 one-shot
    migration task. Updated the Dockerfile header comment. (GAP-035)
  - **C.1:** added `server/middleware/tenantContext.ts` — a fail-closed
    discriminated-union tenant scope (`clinic` / `platform` / `denied`) with a
    pure `resolveTenantContext` resolver, narrowing helpers, and `req.tenant`.
    `clinicContext.ts` now also populates `req.tenant` and its legacy `clinicId`
    field is marked deprecated (retained for the ADR-002 migration). Added
    `tests/unit/tenantContext.test.ts` proving admin→platform, valid clinic→
    clinic, and every null/invalid/unauthenticated case→denied (never widened).
  - Verified: new test passes, `tsc` clean, full unit suite (all scripts incl.
    the new one) green.
- **Owner removed PHI from dev/QA.** Recorded across the space: Phase 1 plan task
  0.2 marked DONE; added 0.2a (verify snapshots/backups also clean) and 0.2b (fix
  the recurrence path / synthetic-only seeding). HLD risk register and open
  questions updated — this risk downgraded from Critical to High/Medium: live-data
  exposure materially reduced, but the reportability determination and
  recurrence-prevention remain open, and snapshot/backup coverage must be
  confirmed.
- **Created the Phase 1 Execution Plan** (`phase-1-execution-plan.md`). Turned the
  Lens Review roadmap into sequenced, owner-assigned tasks across Phase 0
  (containment) and Phase 1 (Sprint 0 blockers): eight workstreams (accounts &
  pipeline, schema safety, fail-closed tenancy, prod hardening/secrets, identity,
  Bedrock AI, availability/DR/monitoring, release gates), each with owner type
  (CODE/AWS/DATA/REG/MIX), dependencies, and definition of done. Added a critical-
  path diagram, a "what can start today" low-risk code list, and the explicit list
  of owner actions that gate launch.
- **Created the PHI Data Flow Map** (`phi-data-flow-map.md`). Traced PHI from
  ingress (import / EMR sync / FHIR / manual) → RDS → dual-zone AI (Bedrock) →
  clinician review → egress, with a Mermaid diagram, a per-hop
  encryption/scoping/audit table, target invariants (PHI stays in the AWS BAA
  boundary, AI layer holds no PHI at rest, AI output always a draft until signed
  clinician approval, fail-closed `clinic_id` per hop, two log classes), and the
  out-of-band historical-log containment note.
- **Created the SaaS + Healthcare Lens Review Report**
  (`saas-healthcare-lens-review-2026-08-25.md`). Combined SaaS Lens + Healthcare
  Industry Lens review: findings mapped to the five pillars, quick wins, and a
  phased roadmap (Phase 0 containment → Phase 1 Sprint 0 blockers → Phase 2/3 →
  parallel SOC 2/HITRUST program). Overall posture NOT DEPLOY READY; flagged
  real-PHI-in-dev/QA as the immediate containment priority. Recorded strengths
  (WP1/WP2 done, AWS BAA in place, pool model fit, clinician-in-the-loop).
- **Initial architecture space complete:** HLD, 5 ADRs, Tenant Isolation Matrix,
  HIPAA Service Eligibility Matrix, PHI Data Flow Map, and the Lens Review Report
  are all in place and cross-linked.
- **Created the Tenant Isolation Matrix** (`tenant-isolation-matrix.md`). Grounded
  in a repository review of `clinicContext.ts` and the `server/repositories/*`
  layer: documented that clinic filtering is applied in some domains (screening,
  appointments, billing lists, homeStats, invoices) but absent — ID-only — in
  many others (billing update/remove, contacts, cooldown, generated/procedure
  notes, patient history, uploaded documents). Recorded current-vs-target
  isolation per component against the ADR-002 fail-closed contract, plus S3
  tenant-prefix and admin-path items.
- **Created the HIPAA Service Eligibility Matrix** (`hipaa-service-eligibility-matrix.md`).
  Listed every AWS service in the current/target architecture with eligibility and
  the encryption/logging conditions for PHI use, the OpenAI subprocessor exception
  (removed by ADR-004), and the specific misconfigurations blocking compliant PHI
  use (RDS TLS/dev-mode, S3 KMS/versioning, CloudTrail coverage, logs, secrets,
  ECR). Noted the authoritative AWS eligibility list must be re-verified.
- **Created ADR-002 through ADR-005** (all Proposed), each grounded in the actual
  code and linked from the HLD decision index (§8) and README:
  - **ADR-002 — Fail-Closed Pool Tenancy.** Keep pool at ~20→~80 clinics; fix the
    root cause of GAP-001: stop overloading `null` in
    `clinicContext.ts`, enforce record-ID-plus-`clinic_id` predicates in the
    repository layer, backfill and `NOT NULL` the `clinic_id` column, add
    cross-tenant negative tests. RLS noted as defense-in-depth stretch goal.
  - **ADR-003 — Migrations as a Gated One-Shot Task.** Remove `drizzle-kit push
    --force` from `Dockerfile` startup (GAP-035); run reviewed, versioned,
    expand/contract migrations as a pipeline step with backup checkpoint and
    verification; delivers ADR-002's backfill safely. Flags that prod schema
    parity must be verified by an authorized operator.
  - **ADR-004 — OpenAI → Bedrock for PHI Inference.** Move inference to Bedrock
    (HIPAA-eligible, under existing AWS BAA), target Claude (Nova as low-cost
    alt), dual-zone PHI boundary, invocation logging, VPC endpoints; parallel-run
    behind a flag on synthetic data before cutover; interim OpenAI BAA required
    (GAP-015).
  - **ADR-005 — Local Auth + Session Hardening.** No SSO for launch; fix session
    regeneration/fixation, revocation on role/password/status change, strong
    password policy, MFA for admins, throttling, CSRF, security headers
    (GAP-006/008); keep WP2 fail-closed bootstrap.
- **Created ADR-001: Multi-Account Structure and Build-Once Promotion Pipeline**
  (`adr/ADR-001-...md`), status Proposed. Documents the AWS Organizations
  structure (Management / Security / Infrastructure / Workload OUs with separate
  Dev, Staging, Production accounts), the build-once/promote-by-digest pipeline
  with gates, one-shot migrations, manual approval, and canary + auto-rollback,
  plus alternatives, consequences, migration risks, and an implementation
  outline. Linked from the HLD decision index (§8) and the README index.
- **HLD v0.1 → v0.2** after an owner discovery round. Resolved six open
  questions and recorded the decisions:
  - **No SSO/SAML for launch** — local auth only (ADR-005 planned).
  - **FDA/SaMD:** CDS exemption expected because a licensed clinician reviews and
    approves every AI recommendation before it drives action; regulatory
    confirmation still required. Added the software-enforced draft→review→approve
    control as the exemption-preserving requirement.
  - **AWS BAA is in place.** Recommended migrating clinical AI inference from
    OpenAI to **Amazon Bedrock** (HIPAA-eligible, under the AWS BAA) with the
    dual-zone pattern (ADR-004 planned).
  - **Removed Google** from architecture and BAA scope (no integration).
  - **42 CFR Part 2 out of scope** (no substance-use-disorder data).
  - **EMR targets:** eClinicalWorks + athenahealth, plus a general
    EMR-integration goal (tracked as a future interoperability workstream).
  - **Scale:** ~20 clinics Year 1, ~80 Year 3 → **pool model confirmed**.
  - Added a **HIPAA → SOC 2 → HITRUST compliance roadmap** to §7.
  - Added **proposed RPO/RTO defaults** (≤1h/≤4h clinical) and the HIPAA
    contingency-plan action list; DR region left for owner selection.
  - **Elevated confirmed real PHI in dev/QA to a Critical, ASAP containment
    item** (owner confirmed dev/QA hold real PHI).
- **Created the architecture documentation space** (`docs/saas-architecture/`)
  with a landing page (`README.md`) and this change log. Rationale: the team
  requested that the AWS production-readiness work and all established
  architecture knowledge be documented at every step, Confluence-style.
- **Generated High-Level Design v0.1** (`high-level-design.md`) as the master
  document. Content is grounded in the repository (routes, schema, Dockerfile,
  deploy workflow) and the existing gap analysis. Tenancy model, segment, AWS
  runtime, and the multi-account target were established from code and prior
  audit evidence; open questions are recorded rather than guessed.
- **Recorded the target multi-account structure** (Management / Security /
  Infrastructure / Workload OUs with separate Dev, Staging, Production accounts)
  and the build-once promotion pipeline in the HLD's deployment and decision
  sections, pending a full ADR-001.

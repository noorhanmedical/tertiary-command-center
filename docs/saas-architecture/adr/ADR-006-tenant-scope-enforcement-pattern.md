# ADR-006: Tenant-Scope Enforcement Pattern (Guarded Boundary)

**Date:** 2026-08-25
**Status:** Proposed
**Deciders:** Platform owner (approval pending), Architecture review (Kiro-assisted)
**Parent:** [ADR-002](./ADR-002-fail-closed-pool-tenancy.md) · [High-Level Design](../high-level-design.md) §6

## Context

ADR-002 decided that tenant isolation must be **fail-closed** and enforced in the
**repository layer** so an individual route cannot forget it. ADR-002 C.1 is done:
`server/middleware/tenantContext.ts` provides an explicit `TenantContext`
(`clinic` / `platform` / `denied`) and a pure resolver, populated on `req.tenant`.

C.2 is the actual enforcement. A call-graph trace showed the ID-based screening
methods (`getScreening`, `updateScreening`, `deleteScreening`, `getBatch`, etc.)
are reached through the `server/storage.ts` facade from **dozens** of services and
routes. This shapes *how* we enforce:

- **Threading `clinicId` through every method signature** (repo → storage → every
  caller) is a large, mechanical change across 40+ call sites. Its dominant risk
  is that any caller passing `null`/`undefined` **silently re-creates the
  fail-open bug** — the exact failure mode ADR-002 exists to remove.
- The codebase **already has a request-scoped `AsyncLocalStorage`**
  (`server/middleware/requestObservability.ts`, `getRequestId()`), proving a
  clean way to make request state available deep in the service/repository layer
  **without** changing signatures.

## Decision

Adopt **Option B: a single guarded enforcement boundary** driven by the
request-scoped tenant context, rather than threading `clinicId` through every
signature.

### 1. Carry tenant scope in the request-scoped async context

Store the resolved `TenantContext` in an `AsyncLocalStorage` (the same mechanism
already used for request id). A helper `getTenantScope()` returns it anywhere in
the request lifecycle. Set it in the tenant/clinic-context middleware.

- Outside a request (background jobs, seeds, migrations) there is no store; the
  repository guard treats "no store" as **system scope** only for code paths that
  explicitly opt in (e.g., background services), and as **denied** for anything
  that expects a request. This is explicit, not implicit.

### 2. Enforce in the repository layer via a scope guard

Tenant-scoped repository methods call a small guard that resolves the effective
`clinic_id` predicate from the async context:

- `clinic` scope → **must** apply `eq(table.clinicId, clinicId)`.
- `platform` scope → may run unscoped (the only unscoped path; admin only).
- `denied` scope → **throw `TENANT_SCOPE_DENIED`**; the query never runs.

For **by-id reads**, the query adds the `clinic_id` predicate directly
(`WHERE id = ? AND clinic_id = ?`) so a row from another clinic simply is not
found. For **by-id writes/deletes**, the same predicate is added to the
`WHERE` clause so a cross-tenant mutation affects zero rows.

### 2a. Detached background work captures scope explicitly

Some work is kicked off from a request but runs **detached** (e.g., the batch
analysis runner does `void runAnalysisLoop(...)` and returns before the loop
finishes). Such work MUST NOT rely on implicit `AsyncLocalStorage` propagation
surviving the request — that behavior exists but is fragile to future refactors
(moving to a queue/worker/timer would silently lose scope).

The pattern is: **capture the scope at kickoff (inside the request) and
re-establish it around the detached work.** A `runWithScope(capturedScope, fn)`
helper does this. If the captured scope is absent, `fn` runs with no store so any
scoped repository access **fails closed** rather than running unscoped. Genuine
system jobs (boot recovery, cron) instead enter `withSystemScope` explicitly.

### 3. Fail closed, centrally

- The guard denies on missing/`denied` scope; a caller cannot pass `null` to opt
  out (there is no `clinicId` parameter to pass).
- A route that must run as platform/admin does so because the authenticated admin
  produced `platform` scope — an explicit, tested path (ADR-002 C.3).
- Background/system code that legitimately runs unscoped must **explicitly** enter
  a system scope (a named helper), making unscoped access auditable rather than
  the default.

### 4. Prove it with negative tests (pipeline gate)

- Unit tests on the guard: `clinic` scopes, `platform` bypasses, `denied` throws.
- Repository/integration tests: Clinic A context cannot read/update/delete a
  Clinic B row by id; unassigned non-admin sees nothing; admin sees all.
- Wire these as a CI gate (ADR-001 / plan H.1).

### 5. Roll out per domain

Implement the guard once, apply it to the **screening repository first**
(clinical core) as the reference, then replicate to billing, documents, patient
history, cooldown, notes, appointments, and the rest — each as its own reviewable
change. The `clinic_id` `NOT NULL` backfill (ADR-002 C.4 via ADR-003) lands
alongside so the DB cannot hold an unscoped row.

## Rationale

- **Enforces in one layer** exactly as ADR-002 requires; a caller physically
  cannot forget because there is no scope parameter to omit.
- **Reuses an existing, proven mechanism** (request async context) — low novelty,
  low risk.
- **Avoids the 40+-call-site edit** whose main risk is silently reintroducing
  fail-open.
- **Makes unscoped access explicit** (platform admin or a named system scope),
  which is auditable and testable.

## Alternatives Considered

### Option A: Thread `clinicId` through every signature
- **Pros:** Fully explicit at each call; no reliance on async context.
- **Cons:** Large mechanical change; every caller is a chance to pass `null` and
  re-open the hole; high review burden; easy to miss a site.
- **Why rejected:** Highest risk of reintroducing the exact bug we are closing.

### Option C: PostgreSQL Row-Level Security as the sole mechanism
- **Pros:** Database-enforced; very hard to bypass.
- **Cons:** Requires per-request session GUCs, role management, and careful admin
  bypass; large change to adopt as the *only* control under time pressure.
- **Why rejected as sole mechanism:** Kept as defense-in-depth (ADR-002); the
  application guard is the launch control.

## Consequences

### Positive
- Central, fail-closed enforcement; no per-call-site footgun.
- Minimal signature churn; faster, safer rollout.
- Unscoped access is explicit and auditable.
- Negative tests lock the behavior in CI.

### Negative (accepted trade-offs)
- Relies on the tenant scope being set in the async context for every request
  path; a missed middleware registration would deny (fail-closed) rather than
  leak, but must be covered by tests.
- Background/system jobs must explicitly declare system scope; any that currently
  rely on implicit unscoped access must be updated deliberately.

### Risks
- **Async-context gaps** in unusual call paths (e.g., event emitters that break
  the async chain). Mitigation: guard defaults to denied when no store is present
  for request-expecting paths; add tests for background paths.
- **Over-broad system scope.** Mitigation: a single named `withSystemScope()`
  helper, used sparingly and greppable for review.

## References
- Code: `server/middleware/tenantContext.ts`, `server/middleware/requestObservability.ts`
  (existing `AsyncLocalStorage`), `server/repositories/screening.repo.ts`, `server/storage.ts`
- AWS: [SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/)
- Power steering: `tenant-isolation.md`

## Related Artifacts
- [ADR-002: Fail-Closed Pool Tenancy](./ADR-002-fail-closed-pool-tenancy.md) — the decision this implements
- [Tenant Isolation Matrix](../tenant-isolation-matrix.md) — per-component target
- [Phase 1 Execution Plan](../phase-1-execution-plan.md) — Workstream C

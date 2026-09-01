# ADR-002: Keep Pool Tenancy, Make Clinic Isolation Fail-Closed

**Date:** 2026-08-25
**Status:** Proposed
**Deciders:** Platform owner (approval pending), Architecture review (Kiro-assisted)
**Parent:** [High-Level Design](../high-level-design.md) §3, §6

## Context

Plexus Command Center is a **pool**-model SaaS: one shared application and one
shared PostgreSQL database, with each tenant (clinic) identified by a `clinic_id`
column on data rows. The `admin` role is intended to see all clinics. Expected
scale is ~20 clinics Year 1, ~80 by Year 3.

The current isolation implementation is **fail-open**, which is the platform's
top application-security risk (GAP-001). Two concrete problems, confirmed in code:

1. **`null` is overloaded** (`server/middleware/clinicContext.ts`). Both an
   `admin` (should see everything) and a **non-admin with no clinic assigned**
   resolve to `req.clinicId = null`. Downstream, `null` is treated as "no filter."
   A misconfigured or unassigned non-admin can therefore fall into the
   see-everything path.

2. **Filters are dropped on `null` and reads use ID alone**
   (`server/repositories/screening.repo.ts`). Helpers such as
   `clinicFilter(clinicId)` return `undefined` when `clinicId == null`, so the
   query runs unscoped. Point reads/updates like `getScreening(id)` and
   `updateScreening(id, ...)` constrain by record ID only, with no tenant
   predicate — so knowing an ID can be enough to read or mutate another clinic's
   record (broken object-level authorization / BOLA).

The schema also allows this: `clinic_id` is **nullable** on tenant tables
(`screening.ts`, `users.ts`) as a backfill accommodation, so the database does
not itself enforce that every row has a tenant.

At ~80 tenants, the question "should we move to per-tenant databases or accounts
(silo)?" arises. This ADR settles both the model and the isolation contract.

## Decision

**Keep the pool tenancy model** for launch and the foreseeable roadmap, and
**make tenant isolation fail-closed** so the absence of a resolved tenant denies
access rather than widening it.

### 1. Tenancy model: pool (confirmed)

At ~20→~80 clinics, a single well-isolated shared stack is the right design.
Account-per-tenant or per-tenant databases add operational overhead that this
scale does not justify (see ADR-001 Option B).

### 2. Isolation contract: fail-closed

- **Separate "admin/platform scope" from "no scope."** Stop overloading `null`.
  Derive an explicit, immutable tenant context from the authenticated session:
  a resolved `clinicId`, or an explicit `platformAdmin` marker for the admin
  role. A request that is neither a valid clinic nor an explicit platform-admin
  is **denied**, not run unscoped.
- **Every tenant-scoped read and write carries a tenant predicate.** Point reads,
  updates, and deletes must constrain by **record ID *and* `clinic_id`**, not ID
  alone. The admin/platform path is the *only* place the tenant predicate may be
  intentionally omitted, and that path is explicit and separately typed.
- **Repository layer enforces it, not call sites.** The tenant predicate is
  applied centrally so an individual route cannot forget it.
- **Database backstop.** Backfill `clinic_id` on all existing rows, then make it
  `NOT NULL` on tenant tables so an unscoped row cannot exist. (Row-Level
  Security in PostgreSQL is a stretch-goal defense-in-depth layer; the
  application-layer contract is the launch requirement.)
- **Negative tests are mandatory.** Automated cross-clinic and wrong-role tests
  that assert a user from Clinic A cannot read or mutate Clinic B's records, and
  that an unassigned non-admin sees nothing. These become part of the pipeline
  gates in ADR-001.

## Rationale

- Fail-closed is the correct default for PHI: an isolation bug should **deny**,
  never **expose**. Overloading `null` makes the dangerous case (see everything)
  the fallback, which is backwards for healthcare data.
- Enforcing the predicate in the repository layer removes the per-route footgun
  that caused GAP-001 in the first place.
- `NOT NULL` at the database level converts a class of bugs from "silently
  unscoped" into "impossible to persist."
- Keeping pool avoids a costly re-architecture the tenant count does not warrant,
  and aligns with ADR-001 (single shared stack).

## Alternatives Considered

### Option A: Move to silo (per-tenant DB or account)
- **Pros:** Physical isolation; a tenant bug cannot leak across databases.
- **Cons:** High operational overhead at ~80 tenants; migration cost; contradicts
  the pool decision in ADR-001.
- **Why rejected:** Over-engineered for this scale; fail-closed pool provides
  sufficient isolation for the risk and size.

### Option B: Keep pool but only fix the specific ID-only reads
- **Pros:** Smallest change.
- **Cons:** Leaves the overloaded-`null` root cause and the per-call-site pattern
  intact; the next new route can reintroduce the bug.
- **Why rejected:** Treats symptoms, not the root cause.

### Option C: Rely on PostgreSQL Row-Level Security alone
- **Pros:** Database-enforced; hard to bypass.
- **Cons:** Requires per-request session GUCs and careful role management; a large
  change to introduce as the *sole* mechanism under time pressure; admin bypass
  needs careful handling.
- **Why rejected as the launch mechanism:** Valuable as defense-in-depth later,
  but the application-layer fail-closed contract is the faster, well-understood
  launch control. RLS is recorded as a stretch goal.

## Consequences

### Positive
- Isolation failures deny instead of expose.
- Root cause (overloaded `null`, per-call-site filtering) removed.
- Database can no longer hold an unscoped tenant row.
- Cross-tenant regression tests prevent reintroduction and build SOC 2 evidence.

### Negative (accepted trade-offs)
- Backfilling `clinic_id` and flipping to `NOT NULL` is a data migration that must
  be sequenced carefully (see ADR-003 one-shot migrations).
- Every tenant-scoped repository method must be reviewed and updated; some
  currently ID-only queries gain a tenant parameter.
- The explicit admin/platform path must be implemented and tested so admins still
  see all clinics.

### Risks
- **Backfill correctness:** an incorrectly assigned `clinic_id` misroutes data.
  Mitigation: verify against source-of-truth per row; rehearse in staging on
  synthetic data.
- **Admin path regression:** over-tightening could break legitimate all-clinic
  admin views. Mitigation: explicit `platformAdmin` type + admin-path tests.

## References
- Code: `server/middleware/clinicContext.ts`, `server/repositories/screening.repo.ts`,
  `shared/schema/screening.ts`, `shared/schema/users.ts`, `shared/schema/clinics.ts`
- AWS: [SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/)
- Power steering: `tenant-isolation.md`, `phi-data-handling.md`
- Gap register: `docs/GAP_ANALYSIS.md` (GAP-001, GAP-002, GAP-003)

## Related Artifacts
- [High-Level Design](../high-level-design.md) — §3, §6
- [ADR-001](./ADR-001-multi-account-structure-and-promotion-pipeline.md) — pool model, pipeline gates
- ADR-003 (this batch) — one-shot migrations (delivers the `NOT NULL` backfill safely)
- Tenant Isolation Matrix (planned) — per-component detail

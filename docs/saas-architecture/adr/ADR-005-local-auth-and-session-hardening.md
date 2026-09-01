# ADR-005: Local Authentication for Launch, with Session and Credential Hardening

**Date:** 2026-08-25
**Status:** Proposed
**Deciders:** Platform owner (approval pending), Architecture review (Kiro-assisted)
**Parent:** [High-Level Design](../high-level-design.md) §2, §6

## Context

Authentication today is **session-based, local username/password** via Passport,
with PostgreSQL-backed sessions (connect-pg-simple). Roles are defined in
`shared/schema/users.ts` (`admin`, `clinician`, `scheduler`, `biller`,
`technician`, `liaison`).

The owner confirmed **no SSO/SAML federation is needed for launch**. That settles
the identity provider question, but the current implementation has security gaps
that must be closed before a PHI production launch (GAP-006, GAP-008):

- **No session regeneration on login** — session-fixation risk.
- **No session revocation** when a user's role, password, or active status
  changes — stale-privilege risk (a demoted or deactivated user keeps their live
  session).
- **One-character passwords accepted** — login, user creation, and change-password
  schemas enforce only `min(1)`.
- **No MFA, no login throttling, no CSRF protection, no security-header baseline
  (Helmet), no general request-rate limiting.**
- Default `admin/admin` seeding was already removed and startup now fails closed
  without a provisioned user (WP2) — that part is done.

## Decision

**Keep local authentication for launch (no SSO/SAML)** and harden it to a
PHI-appropriate baseline before production.

### 1. Identity provider: local (confirmed)

Passport local strategy with PostgreSQL-backed sessions remains the launch
mechanism. SSO/SAML federation is explicitly **out of scope** for launch and can
be revisited if an enterprise tenant later requires it.

### 2. Session security (fail-closed)

- **Regenerate the session on login** (new session id) to prevent fixation.
- **Revoke active sessions** when a user's password, role, or `active` status
  changes. A deactivated or demoted user's existing sessions must stop working.
- Enforce **idle and absolute session expiration**.
- Confirm secure cookie flags in production (`Secure`, `HttpOnly`, `SameSite`),
  consistent with running behind the ALB in production mode (see ADR/HLD §6
  encryption note — production must not run in dev mode).

### 3. Credential and abuse controls

- **Strong password policy** (meaningful minimum length + complexity/breach
  checks) on create and change-password paths; remove `min(1)`.
- **MFA for privileged roles** (at minimum `admin`).
- **Login throttling / lockout** and **general API rate limiting** for sensitive
  endpoints.
- **CSRF protection** for cookie-based sessions.
- **Security-header baseline** (Helmet or equivalent).
- Coordinate app-level throttling with the WAF (ADR-001/GAP-027); do not rely on
  WAF alone.

### 4. Provisioning

Keep the fail-closed bootstrap (WP2). Initial administrator is provisioned out of
band via a one-time, verified process (no deterministic default credentials).

## Rationale

- No SSO keeps the launch identity design simple and matches the owner's decision.
- The hardening items are not optional polish for a PHI system — session fixation,
  stale privilege, and weak passwords are direct patient-data exposure risks.
- These controls are also core SOC 2 / HITRUST access-control evidence, so the
  work advances the compliance roadmap (HLD §7).

## Alternatives Considered

### Option A: Add SSO/SAML now
- **Pros:** Enterprise-friendly; centralizes identity for large tenants.
- **Cons:** Not required by any current tenant; adds scope and delay.
- **Why rejected:** Explicitly out of scope per owner; revisit on real demand.

### Option B: Launch on local auth without the hardening
- **Pros:** Fastest.
- **Cons:** Ships known session-fixation, stale-privilege, and weak-credential
  risks into a PHI system.
- **Why rejected:** Unacceptable risk; also fails SOC 2/HITRUST access controls.

### Option C: Replace sessions with stateless JWT
- **Pros:** No server session store.
- **Cons:** Revocation (a key requirement here) is harder with stateless tokens;
  larger change than needed.
- **Why rejected:** The revocation requirement favors server-side sessions, which
  already exist.

## Consequences

### Positive
- Simple, owner-approved launch identity model.
- Session fixation and stale-privilege risks closed; strong credentials and abuse
  controls in place.
- Advances SOC 2 / HITRUST access-control evidence.

### Negative (accepted trade-offs)
- MFA, throttling, CSRF, and header baselines are net-new work to implement and
  test.
- Stronger password policy and forced revocation may add friction for existing
  users (communicate and stage the rollout).

### Risks
- **Revocation gaps** if not applied to every privilege-change path. Mitigation:
  centralize revocation on password/role/status change; test each path.
- **MFA rollout friction.** Mitigation: start with privileged roles; provide
  recovery procedure.

## References
- Code: `server/routes.ts` (auth, user management, change-password),
  `shared/schema/users.ts`, session/Passport setup, `server/middleware/clinicContext.ts`
- Power steering: `identity-and-onboarding.md`, `audit-logging-and-access.md`
- Gap register: `docs/GAP_ANALYSIS.md` (GAP-006, GAP-007, GAP-008)

## Related Artifacts
- [High-Level Design](../high-level-design.md) — §2 (personas), §6 (identity and access)
- [ADR-002](./ADR-002-fail-closed-pool-tenancy.md) — role-aware, fail-closed tenant scoping pairs with role/session integrity

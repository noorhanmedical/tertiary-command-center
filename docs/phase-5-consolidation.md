# Phase 5 — Consolidation notes

## Legacy route refactoring

**10 files audited.** Of those, **4 files had raw drizzle-orm / db.* calls in route handlers**; the other 6 already delegate through the storage facade or existing services/repositories.

### Refactored (raw db → repo)

| Route file | Before | After |
|------------|--------|-------|
| `server/routes/invoiceDelivery.ts` | 4 raw `db.select().from(…)` calls, drizzle-orm imports | 0 raw db calls; all reads via `server/repositories/invoiceDelivery.repo.ts` |
| `server/routes/invoiceFinancialEvents.ts` | 4 raw `db.select().from(…)` calls in a `Promise.all` block | 0 raw db calls; `loadFinancialEventsForInvoice(id)` bundles the four reads |
| `server/routes/documentLibrary.ts` | 4 raw db calls (legacy migration + search + screening lookup) | 0 raw db calls; `documentLibraryLegacy.repo.ts` owns the migration query set + search + screening name/dob lookup |
| `server/routes/portal.ts` | 10 raw db surfaces (2 large `db.execute` SQL, 6 select/insert/delete, 1 selectDistinct) | 0 raw db calls; `portal.repo.ts` owns ancillary-appointment reads, facility list, active-worker lookup, chart-assignment, rollback insert, and both scoped patient-search queries |

**Locked by** `tests/unit/phase5ArchitectureHardening.test.ts` §1–§4.

### Already clean by facade (no changes required)

| Route file | Existing pattern |
|------------|------------------|
| `server/routes/engagementAssignmentBoard.ts` | Uses `storage` (1 import, 9 calls) + 2 services + 1 repository |
| `server/routes/engagementBaskets.ts` | Uses `storage` (1 call) + 2 services |
| `server/routes/plexusIqClinicalImport.ts` | Uses `storage` (9 calls) + 3 services |
| `server/routes/completedBillingPackages.ts` | 5 repository imports; no storage; no raw db |
| `server/routes/callListAudit.ts` | 1 service import; no storage; no raw db |
| `server/routes/billing.ts` | `storage` (5 calls) + 2 services |

**Locked against regression by** `tests/unit/phase5ArchitectureHardening.test.ts` §5.

## Playwright execution

- `@playwright/test@1.61.1` installed as a devDependency (already in package.json since Phase 1; the sandbox now has the runtime).
- `npx playwright test --list` compiles and enumerates **39 tests across 4 spec files** (canonical-route-smoke, team-portal, home-and-engagement, plexus-iq-and-physician).
- Actual test execution requires a running dev server + seeded test users (`admin`, `clinician`, `scheduler`, `biller`) + `LOGIN_URL`, `E2E_ADMIN_USERNAME/PASSWORD`, etc. env vars (see `tests/e2e/fixtures/auth.ts`).
- **Not executed in this branch** — the run requires bringing up the dev server + database + browser binaries against real fixtures. All specs compile; **CI hookup is the follow-up step**.

## Google Drive keep/remove recommendation

**Recommendation: KEEP.** Detailed rationale in `docs/phase-5-google-drive-audit.md` — production already runs on S3 (enforced by `validateEnv.ts`), Drive is dev/Replit-only, and legacy `driveWebViewLink` fallbacks in `documentLibrary.ts` and `patientDatabase.ts` are load-bearing until a documented S3 backfill completes.

## Architecture rule locked by static test

`tests/unit/phase5ArchitectureHardening.test.ts` — runs in `< 1 s`, no DB required. Blocks:
- §1 refactored route files calling `db.select/insert/update/delete/execute(`
- §2 refactored route files importing `drizzle-orm`
- §3 refactored route files importing `../db`
- §4 each required repo file exists and imports both `../db` and `drizzle-orm`
- §5 the 6 clean-by-facade routes regressing to raw db use
- §6 any `client/src/**` file importing `drizzle-orm` or `../../server`

Client scan covers **438 files** on this branch.

## Not delivered in this branch (documented follow-ups)

- **Live E2E execution.** Playwright specs compile; a CI job needs to
  spin up the dev server + seeded users + browser binaries. This is a
  CI-config change, not a code change.
- **Additional cross-cutting integration tests** (cross-clinic isolation,
  cross-role authorization, mutation idempotency, cache invalidation)
  — the static hardening test covers the architectural claim; live
  integration coverage requires a live DB fixture. The design of the
  test matrix is documented in `docs/PLATFORM_HARDENING_BACKLOG.md`.
- **Twilio / SMS.** Still absent. All Phase 4 guards remain.

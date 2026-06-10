# Team Portal runtime wiring — readiness checklist

**Status:** Docs-only (Bundle 54). No runtime code. No new endpoint. No UI change.
**Date:** 2026-06-10.
**Purpose:** Pre-flight checklist a future "first real Team Portal runtime wiring" PR MUST satisfy before it is opened. Captures every gate the prior bundles erected so reviewers can verify them in one place.
**Cross-references:**
- `team-portal-playground-wiring-contract.md` (Bundle 11) — visual + wiring + RBAC + §22 forbidden data.
- `playground-design-system-implementation-plan.md` (Bundle 32) — 8-step sequence (Step D first wires the canvas root).
- `patient-directory-readonly-envelope-readiness.md` (Bundle 49) — envelope contract + flag.
- `portal-cutover-readiness-checklist.md` (Bundle 18) — the operational-queue cutover checklist this complements.
- `operational-queue-staging-runbook.md` (Bundle 17).
- `qa-index-regression-map.md` (Bundle 36).
- `do-not-touch.md`, `protected-flows.md`.

This checklist is the operational complement to Bundle 49. Bundle 49 said "what the envelope may surface". Bundle 54 says "what the future endpoint+UI PR must do to ship it safely". The endpoint+UI PR ships only after every box below is checked.

---

## 0. Scope

The "first real Team Portal runtime wiring" PR adopts ONE of:

- A new flag-gated read endpoint that delegates to the existing dormant Patient Directory + Operational Queue + Team Task helpers and returns the Bundle 49 §1 envelope.
- A new flag-gated read endpoint that delegates to the existing dormant Engagement Center v2 helpers (Bundle 51) and returns the v2 envelope.

The PR may NOT adopt both in one change; each is its own gated PR.

Out of scope here: ANY UI source change (that's Bundle 32's Step D-H), ANY assignment write, ANY scheduler write, ANY billing surface, ANY admin-review approval change.

---

## 1. Pre-PR module gates

- [ ] All dormant modules referenced by the envelope are on main and pure (no DB / schema / drizzle imports in the public pure surface):
  - `server/modules/patient-directory/contracts.ts` (PR #65 + Bundle 21 fixture).
  - `server/modules/operational-queue/contracts.ts` (Batch 11a) + `service.ts` exposes only `getOperationalQueueForUser` / `getOperationalQueueForFacility`.
  - `server/modules/team-tasks/contracts.ts` + `service.ts` exposes only `getTeamTaskView` / `getTeamTaskViewByPatient`.
  - `server/modules/engagement-board/service.ts` exposes `composeEngagementBoardV2Response` + `encodeV2Cursor` + `decodeV2Cursor` (Bundle 51).
- [ ] All dormancy invariants are green:
  - `qa-scheduler-assignment-projection-dormancy.mjs` (Bundle 19).
  - `qa-engagement-board-dormant-service.mjs` (Bundle 23).
  - `qa-documents-dormant-module.mjs` (Bundle 27).
  - `qa-background-jobs-dormant-module.mjs` (Bundle 34).
  - `qa-operational-queue-readonly-invariant.mjs` (Bundle 46).
  - `qa-team-tasks-readonly-invariant.mjs` (Bundle 47).
- [ ] All fixture+parity tests are green:
  - `qa-patient-directory-parity-fixture.mjs` (Bundle 21).
  - `qa-patient-directory-emr-source-link-fixture.mjs` (Bundle 42).
  - `qa-patient-directory-shadow-read-fixture.mjs` (Bundle 48).
  - `qa-engagement-board-v2-parity-fixture.mjs` (Bundle 22).
  - `qa-engagement-board-v2-composition.mjs` (Bundle 51).
  - `qa-operational-queue-team-task-parity.mjs` (Bundle 45).
  - `qa-plexus-iq-aggregate-read-forwarding.mjs` (Bundle 52).
  - `qa-engagement-center-cancel-many-invariant.mjs` (Bundle 50).

---

## 2. Endpoint / read-model allowed

The endpoint exposed by the PR MUST:

1. Be **read-only**. Zero `db.insert` / `db.update` / `db.delete` calls anywhere in the route file.
2. Delegate to ONE of the dormant module surfaces above. No parallel computation.
3. Be **additive**. The PR adds a route at a new path (e.g. `/api/team-portal/patient/:canonicalId/directory-envelope` for the PD envelope, or `/api/engagement-board/v2` for the v2 envelope). The PR MUST NOT change any existing endpoint's response shape.
4. Be gated by a feature flag with **default OFF**. Suggested names:
   - `USE_PATIENT_DIRECTORY_ENVELOPE_READ` (Bundle 49 §3).
   - `USE_ENGAGEMENT_BOARD_V2_READ`.
   Each flag accessor lives in its module's own `*-flag.ts` file (mirroring `operational-queue/call-list-flag.ts` from PR #80) — no DB / schema import.
5. Return 404 when its flag is OFF. The route is effectively dormant in production by default.
6. Reuse the existing auth surface: `/api/auth/me` + `/api/portal/my-facilities`. No new auth header. No new session shape.
7. Scope every response by tenant + facility per the viewer's RBAC envelope (Bundle 11 §21).
8. Append a counts-only `patient_journey_events` row per successful read via the typed `appendJourneyEvent` writer (Bundle 12c / PR #78). No raw payload in the audit metadata.
9. Use the Bundle 8 PHI-safe logger for every info/warn/error log. Counts only.

---

## 3. Data allowed in the response

The response body may contain ONLY the fields enumerated in Bundle 49 §1 (for the PD envelope) or in `shared/contracts/engagementBoard.ts` + Bundle 51's `EngagementBoardResponse` (for the v2 envelope). Concretely:

- `canonicalPatientId`, `primaryScreeningId`, `screeningIds[]`.
- Demographic snapshot fields: `name`, `dob`, `phoneNumber`, `email`, `facility`.
- `totalScreenings`, `hasDeletedScreening`.
- `emrSourceLinks[]` per Bundle 42.
- Optional `shadowReadVerdict` per Bundle 48.
- (v2 envelope only) `rows[]` — `EngagementBoardRow` slice; `summary` — `EngagementBoardSummary`; `nextCursor: string | null`.

---

## 4. Data hidden — must NOT appear in the response

- Anything from `billing-invoice-hard-stop-map.md` §3 + §4 (money fields, claim, remittance, invoice, revenue share).
- Anything from `team-portal-playground-wiring-contract.md` §22 (PTO of other employees, payroll, performance reviews, admin announcement edit history).
- Anything from `patient-directory-readonly-envelope-readiness.md` §2 (Admin Review internals, raw EMR notes, company financials, cross-team employee data).
- Raw ICD codes (preserves the existing PDF rule).
- Cross-tenant rows.

The Bundle 53 `qa-playground-data-envelope.mjs` catches these at the Playground source-text level. The endpoint PR must ALSO add a `qa-team-portal-envelope-route.mjs` that catches them at the route source-text level (see §6).

---

## 5. Feature flag requirements

- Flag **default OFF** in every environment.
- Flag accessor MUST be pure (no DB / schema import) — same purity bar `qa-operational-queue-call-list-flag.mjs` enforces for `USE_OPERATIONAL_QUEUE_CALL_LIST`.
- Flag flip in staging is a separate operational action; the runtime-wiring PR does NOT flip it.
- Flag flip in production is a SEPARATE explicitly approved PR (mirroring the cutover-readiness pattern from Bundle 18).

---

## 6. Rollback plan

If the route ships and a regression appears post-deploy:

1. Flip the flag to OFF in production (no code change needed).
2. The route returns 404; clients fall back to legacy paths.
3. Investigate via the audit + log trail. The runtime-wiring PR's PR description names the on-call who owns the rollback.

This rollback is reversible at any time. The flag is the kill switch.

---

## 7. QA requirements for the wiring PR

The PR MUST add or update:

- `scripts/qa-team-portal-envelope-route.mjs` — asserts:
  - The route file delegates to the documented dormant helpers only.
  - No `db.insert` / `db.update` / `db.delete` in the route file.
  - The route returns 404 (or fails the flag check) when the flag accessor returns false.
  - No PHI identifier appears in any info/warn/error log statement inside the route.
  - The route emits a journey event on success via `appendJourneyEvent`.
  - Forbidden fields from §4 are absent.
- All 35+ existing `scripts/qa-*.mjs` scripts continue to pass.
- `npm run check` clean.
- `npm run build` clean.

---

## 8. Visual regression requirements (when the UI Step D-H PRs follow)

These apply to the future Bundle 32 Step D-H UI PRs, NOT to the endpoint PR itself. Captured here so the wiring PR's reviewers know the UI follow-on must hold:

- A pre-merge screenshot diff of the Team Portal panel and the Playground canvas against a known baseline.
- All `data-testid` attributes on the existing Team Portal surfaces are preserved.
- The Playground canvas root passes `qa-playground-data-envelope.mjs` (Bundle 53).
- The visual rules from Bundle 11 §6-§11 (blank white, no grid, pencil objects, black-pencil lettering) are honoured.

---

## 9. Role access requirements

- The endpoint MUST scope by tenant + facility per `/api/portal/my-facilities`.
- The endpoint MUST reject requests from a user whose tenant does not match the resolved canonical patient's tenant — return 404 (NOT 403) to avoid revealing existence.
- The endpoint MUST NOT expose a different patient's data even on a malformed canonicalId query — the patient resolver must verify tenant + facility match before returning any field.
- The endpoint MUST emit an audit row even on 404 / 403 returns. The audit row uses `eventSource: "team_portal_envelope_read"` and `eventType: "envelope_read_rejected"` for the negative cases.

---

## 10. Stop conditions for the runtime-wiring PR

The PR MUST stop and ask if:

1. It would write to ANY table.
2. It would modify any existing endpoint's response shape.
3. It would add a UI source change. (Bundle 32 Step D-H are separate PRs.)
4. It would flip a feature flag default.
5. It would surface any field in §4.
6. It would call any billing / invoice / Admin Review / scheduler-write surface.
7. It would add a migration.
8. It would change `/api/auth/me`, `/api/portal/my-facilities`, or the session shape.
9. It would touch `routes/patients.ts`, `routes/patientDatabase.ts`, or any Admin Review route.
10. It would mutate any of the dormant modules' public helpers.

---

## 11. Sign-off

The runtime-wiring PR description MUST cite the §-numbers from this checklist and attach:

- The §1 module-gates pass output.
- The new route's source link.
- The new `qa-team-portal-envelope-route.mjs` script source link.
- The 35+ qa scripts pass output (or a CI link).
- A staging-environment-only flag-flip date proposal (no commitment).

Without these artifacts the PR is non-compliant and MUST be paused.

End of checklist.

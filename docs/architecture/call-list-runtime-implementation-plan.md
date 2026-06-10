# Call-list runtime implementation plan

**Status:** Docs-only (Batch H). No runtime code. Sequences the future runtime work that ships under the Batch A-G + Bundle 54 gates.
**Date:** 2026-06-10.
**Scope:** Concrete sequencing for the future runtime PRs that canonicalise the engagement-center / call-list / call-result write surfaces. Each step lands as its own approved PR.
**Cross-references:**
- `engagement-call-list-canonicalization-contract.md` (Batch A).
- Call-result parity fixture (Batch B) and source invariant (Batch C).
- `team-member-assignment-terminology-contract.md` (Batch D).
- `engagement-call-list-bridge-contract.md` (Batch E).
- `team-portal-call-list-consumption-readiness.md` (Batch F).
- `call-history-readonly-envelope-contract.md` (Batch G).
- `team-portal-runtime-wiring-readiness-checklist.md` (Bundle 54).
- `qa-index-regression-map.md` (Bundle 36).

This document ships zero code. It specifies which PR ships first, what gates it must satisfy, and what each subsequent PR depends on.

---

## 1. Step 1 — `recordCallResult` service extraction (preview-only)

Path reserved: `server/services/callResult/recordCallResult.ts`.

The service is the single write path for every call-result side effect (Batch A §9). It accepts the union of the two existing route bodies and returns a canonical `RecordCallResultOutcome`. It performs every side effect:

- Insert `outreach_calls`.
- Update `patient_screenings.appointmentStatus`.
- Update `patient_execution_cases.engagementStatus` + `nextActionAt`.
- Mark `scheduler_assignments.status = "completed"` on terminal outcomes.
- Conditionally create `plexus_tasks` (per `CALL_RESULTS_NEEDING_TASK`).
- Conditionally open `scheduling_triage_cases`.
- Append `call_result_logged` `patient_journey_events` row via the typed `appendJourneyEvent` writer.

In Step 1 the service is added but NO route is wired to it. It is dormant. The Batch C source invariant continues to assert both legacy routes carry their existing behaviors.

**Gates**:
- Batch A + B + C green.
- A new `scripts/qa-record-call-result-dormancy.mjs` asserts no non-test file imports the service.
- The service file is pure relative to its inputs — it has no UI imports, no client code, no PDF / billing / qualification calls.

---

## 2. Step 2 — both existing endpoints delegate to the service

In Step 2 the two legacy routes delegate to `recordCallResult`:

- `POST /api/outreach/calls` wraps its body into the service input, calls `recordCallResult`, returns the existing response shape.
- `POST /api/engagement-center/call-result` does the same.

Response shapes stay byte-stable. Audit emissions stay byte-stable. The Batch B parity fixture is exercised against the canonical service.

**Gates**:
- Step 1 has merged and the dormancy script is green.
- A new `scripts/qa-record-call-result-parity-runtime.mjs` invokes the canonical service in a no-DB mode (dep-injected fetchers) and asserts the Batch B fixture envelope for every outcome.
- Response-shape parity: both routes' responses byte-stable against a captured baseline.

---

## 3. Step 3 — call-result parity tests against live behavior

A staging environment exercise:

- For each outcome in the Batch B fixture, run a canned legacy-shape request against `POST /api/outreach/calls` and `POST /api/engagement-center/call-result` and capture every side-effect mutation.
- The captured mutations MUST match the Batch B envelope per outcome.
- The capture lives in `tests/fixtures/recordCallResult-staging-capture.json` (path reserved); it documents the parity proof.

**Gates**:
- Step 2 has merged.
- Staging has been on the canonical service for at least 7 consecutive UTC days.
- No PHI in the captured fixture (counts + ids only).

---

## 4. Step 4 — Portal call-history read route

Path: `GET /api/portal/calls?patientScreeningId=<id>` (per Batch I + Bundle 49 §3 + Batch G).

Delegates to the existing `storage.getOutreachCallsByPatient` helper. Applies the Batch G envelope (allowed fields only; notes redaction; tenant + facility scope; 404 not 403 on cross-tenant). Default flag OFF — endpoint returns 404 when `USE_PORTAL_CALL_HISTORY_READ=0`.

**Gates**:
- Steps 1-3 have merged.
- A new `scripts/qa-portal-call-history-read-route.mjs` asserts:
  - The route delegates to the existing storage helper (no parallel write path).
  - The Batch G envelope is enforced at the route layer (allowed-field allow-list + forbidden-field denylist).
  - The flag accessor is pure.
- Audit row emitted on success AND on rejection (per Bundle 54 §9).

---

## 5. Step 5 — Portal call-list v2 read route

Path: `GET /api/portal/call-list/v2` (additive; legacy `/api/portal/outreach-call-list` stays). Returns the v2 envelope (canonical product field names with `legacy*` mapping fields, per Batch D §2).

Default flag OFF: `USE_PORTAL_CALL_LIST_V2=0`. The endpoint returns 404 when OFF.

**Gates**:
- Step 4 has merged.
- A new `scripts/qa-portal-call-list-v2-route.mjs` asserts:
  - Route delegates to existing storage helpers / call-list engine.
  - No parallel rebuild logic.
  - The product field names per Batch D + the `legacy*` mapping fields are both present in the response.
  - Tenant + facility RBAC honoured.

---

## 6. Step 6 — Portal call-result write route behind flag

Path: `POST /api/portal/call-result`. Delegates to `recordCallResult` (Step 1). Default flag OFF: `USE_PORTAL_CALL_RESULT_WRITE=0`. The endpoint returns 404 when OFF.

UI does NOT consume the route until Step 7.

**Gates**:
- Steps 1-5 have merged.
- A new `scripts/qa-portal-call-result-write-route.mjs` asserts:
  - The route does NOT duplicate the canonical service's side-effect logic — it only adapts the request body and forwards to `recordCallResult`.
  - The route is gated by `USE_PORTAL_CALL_RESULT_WRITE` (default OFF).
  - The route emits the Bundle 8 PHI-safe logger envelope on all paths.

---

## 7. Step 7 — Playground call-history display

Bundle 32 Step E ships the patient tab. This step extends it with a pencil-tile list of prior calls per Bundle 11 §10 + Batch G §6. The display data comes from Step 4's `/api/portal/calls` endpoint.

No new server route. No UI change to PortalShell / TeamPortalShell. Playground only.

**Gates**:
- Steps 1-6 have merged.
- The Bundle 32 Step E PR series has reached the patient-tab milestone.
- The Playground data-envelope QA (Bundle 53) is green.
- A new playground-call-history fixture (`tests/fixtures/playgroundCallHistory.fixture.ts`) covers redacted vs visible notes per Batch G §3.

---

## 8. Step 8 — Legacy endpoint deprecation (if safe)

After at least 30 days of clean canonical-service operation across Steps 2-6:

- `POST /api/outreach/calls` becomes a thin shim that logs a deprecation notice and continues to delegate to `recordCallResult`. The legacy response shape stays.
- The Scheduler Portal's UI is updated to call `/api/portal/call-result` (or its own canonical path) in a separate UI PR.
- After at least 60 days post-deprecation-shim, a SEPARATE retirement PR removes `POST /api/outreach/calls`. This step is optional and not committed by this plan.

**Gates**:
- Production traffic to `POST /api/outreach/calls` has been observed for at least 30 days post-Step 2.
- Zero parity-difference incidents reported.
- Per-call audit-trail completeness at least 99.99% on the canonical service.

---

## 9. Hard stops across every step

Every step's PR MUST stop and ask if it would:

1. Change either existing call-result endpoint's response shape.
2. Skip the journey-event append on any call-result path.
3. Skip the `markSchedulerAssignmentCompleted` write on a terminal outcome.
4. Add a parallel writer for call-result side effects outside `recordCallResult`.
5. Flip `USE_PORTAL_CALL_RESULT_WRITE`, `USE_PORTAL_CALL_LIST_V2`, `USE_PORTAL_CALL_HISTORY_READ`, or `ENGAGEMENT_TO_CALL_LIST_BRIDGE` default in production.
6. Touch any of: Admin Review approval / commit (Bundle 30), qualification logic, supporting buttons, canonical reasoning writes, ICD commit, PDF / packet generation, billing money math, AWS production cutover, migrations.
7. Expose a forbidden field from Batch G §2.
8. Cross tenants.
9. Emit PHI on a non-audit log.
10. Rename `scheduler_assignments`, `outreach_schedulers`, `schedulerId`, or `originalSchedulerId` without the Batch D §6 migration plan.

---

## 10. Rollback plan per step

Every step is independently revertable.

- **Step 1 rollback** — `git rm` the service file. No consumer exists; revert is byte-clean.
- **Step 2 rollback** — revert the route delegation commits. Both routes return to their pre-delegation implementations. The service file stays as dormant code.
- **Step 3 rollback** — N/A (test artefact only).
- **Steps 4-6 rollback** — flip the flag OFF in production via the deploy-platform env-var surface. The route returns 404; clients fall back to legacy paths.
- **Step 7 rollback** — revert the Playground PR. Backend untouched.
- **Step 8 rollback** — revert the deprecation-shim commit. `POST /api/outreach/calls` returns to its non-shim implementation. The retirement PR (if it ever ships) requires its own rollback plan in a separate document.

---

## 11. Verification checklist for every step's PR

- `npm run check` clean.
- `npm run build` clean.
- All existing `scripts/qa-*.mjs` pass.
- The step's new QA script passes.
- The step's manual click-through (where applicable) covers the protected flows enumerated in `protected-flows.md`.
- PR description cites this plan + the contracts (Batch A-G + Bundle 11 + Bundle 54).

---

## 12. Non-promises

- No commitment that any step ships in a specific timeframe.
- No commitment that all eight steps ship — Step 8 is optional and may never run.
- No commitment to specific flag names beyond the ones listed (they are reserved, not promised).
- No commitment to a specific UI layout for Step 7.
- No commitment that the legacy `POST /api/outreach/calls` is ever removed.

End of plan.

# Engagement call-list canonicalization — summary

**Status:** Docs-only (Batch K). No runtime change. No UI change.
**Date:** 2026-06-10.
**Purpose:** Index everything Batches A-J shipped, what is now protected, what remains split-brain, and the exact first runtime PR a future maintainer should write.

---

## 1. Current state — what shipped

| Batch | PR | Artefact | Kind |
|---|---|---|---|
| Audit (preceding turn) | n/a | Read-only audit (conversation history) | Inspection only |
| A | #144 | `docs/architecture/engagement-call-list-canonicalization-contract.md` + `scripts/qa-engagement-call-list-canonicalization.mjs` | Docs + QA |
| B | #145 | `tests/fixtures/callResultCanonicalization.fixture.ts` + `server/services/__tests__/callResultCanonicalization-parity.test.ts` + `scripts/qa-call-result-canonicalization-parity.mjs` | Fixture + test + QA |
| C | #146 | `scripts/qa-call-result-source-invariant.mjs` | QA |
| D | #147 | `docs/architecture/team-member-assignment-terminology-contract.md` | Docs |
| E | #148 | `docs/architecture/engagement-call-list-bridge-contract.md` + `scripts/qa-engagement-call-list-bridge.mjs` | Docs + QA |
| F | #149 | `docs/architecture/team-portal-call-list-consumption-readiness.md` + `scripts/qa-team-portal-call-list-consumption.mjs` | Docs + QA |
| G | #150 | `docs/architecture/call-history-readonly-envelope-contract.md` | Docs |
| H | #151 | `docs/architecture/call-list-runtime-implementation-plan.md` | Docs |
| I | #152 | `server/modules/portal/call-history-read-flag.ts` + new `GET /api/portal/calls` route in `server/routes/portal.ts` + `scripts/qa-portal-call-history-route.mjs` | Runtime (flag-gated default OFF) |
| J | #153 | `shared/contracts/teamPortalCallList.ts` + `scripts/qa-team-portal-call-list-contract.mjs` | Type-only contract |

Eleven PRs total (10 new contracts/QA + 1 minimal flag-gated route).

---

## 2. Canonical target — what the future runtime PR series will achieve

Once Batch H Steps 1-7 ship, the surface looks like this:

- **Engagement Center board** — unchanged read shape; still reads from `patient_execution_cases`.
- **Day-of CallListAssignment queue** — still stored in `scheduler_assignments` (the legacy table name remains until a deliberate migration PR ships per Batch D §6).
- **`recordCallResult` service** — single write path for every call-result side effect. Both legacy routes delegate to it. Per-outcome side-effect envelope is pinned by the Batch B fixture.
- **Team Portal call-history read** — `GET /api/portal/calls?patientScreeningId=<id>`, ALREADY shipped behind `USE_PORTAL_CALL_HISTORY_READ` (default OFF).
- **Team Portal call-list v2 read** — future `GET /api/portal/call-list/v2` behind `USE_PORTAL_CALL_LIST_V2` (default OFF), returns the `TeamPortalCallListResponse` envelope from `shared/contracts/teamPortalCallList.ts`.
- **Team Portal call-result write** — future `POST /api/portal/call-result` behind `USE_PORTAL_CALL_RESULT_WRITE` (default OFF), delegates to `recordCallResult`.
- **Playground call-history display** — patient-tab tiles per Bundle 32 Step E + Batch G §6.
- **Engagement → call-list bridge** — still flag-gated by `ENGAGEMENT_TO_CALL_LIST_BRIDGE` (default OFF); a future approved PR may flip the default after the §7 staging gate in the bridge contract.

---

## 3. What QA now protects

The strict validation loop (`for s in scripts/qa-*.mjs; do node "$s" || exit 1; done`) catches drift on:

- **Engagement call-list canonicalization** (Batch A) — contract present + load-bearing concepts + the three live route paths still carry their side effects.
- **Call-result canonicalization parity** (Batch B) — every outcome in the canonical set has a complete side-effect envelope; terminal ↔ assignmentCompleted consistency; callback/no-answer/voicemail require nextActionAt; needs_records/insurance/manager_review/facility_specific_issue require follow-up tasks; callback/no-answer/voicemail/wrong-number open triage cases.
- **Call-result source invariant** (Batch C) — both existing routes still write outreach_calls + journey events + assignment-completion + execution-case state; Team Portal owns no call-list generation; Operational Queue + Team Tasks remain read-only.
- **Engagement → call-list bridge contract** (Batch E) — bridge module pure-flag accessor; bridge writes only to scheduler_assignments; no UI imports; legacy route invocation under the flag.
- **Team Portal call-list consumption** (Batch F) — contract names PCS / ACS / Team Member / recordCallResult; portal route stays free of direct writes.
- **Portal call-history route** (Batch I) — flag accessor pure; route gated by flag; route delegates to `storage.listOutreachCallsForPatient`; response envelope projects ONLY Batch G §1 allowed fields; route returns 404 (not 403) on cross-facility; no writes anywhere in the route file.
- **Team Portal call-list contract** (Batch J) — contract pure (no runtime imports); product field names used; legacy mapping fields only as `legacy*`; dormancy invariant — no non-test file imports the contract.

Plus all 47+ pre-existing `scripts/qa-*.mjs` continue to enforce their prior surfaces.

---

## 4. What remains split-brain

Even after Batches A-J, these structural splits remain — they are the work the future Batch H runtime PRs eliminate:

1. **Two call-result write paths** still exist — `/api/outreach/calls` (writes outreach_calls + appointmentStatus + scheduler_assignments completion + spine sync) and `/api/engagement-center/call-result` (appends journey event + updates execution case + creates plexus tasks + opens triage cases). Each carries a different subset of the canonical side-effect set. Batch H Step 1 + Step 2 remove this split by extracting `recordCallResult` and delegating both routes.
2. **Engagement board assignment vs day-of queue mirror** is still flag-gated. The bridge defaults OFF; an engagement-board manual assign does NOT show up on the day's call list unless the flag is ON. Batch E pins the safety rules; the flag default flip is a separate future PR.
3. **Patient identity** is still resolved via `patient_screenings` directly in most surfaces; the Patient Directory canonical view (Bundle 5 / Bundle 49) is not yet adopted at runtime. Cross-table drift on names / DOBs / facility remains possible.
4. **Capacity math** for Team Portal's outreach list is still per-request and per-route (`portal.ts:391-407`). A mid-day change to `outreach_schedulers.capacityPercent` shifts the partition without a re-query.
5. **PTO redistribution** is transactional within `releaseAndRedistribute` but callers do not re-read the engagement board afterwards.
6. **Legacy column names** (`scheduler_assignments`, `schedulerId`, `originalSchedulerId`, `outreach_schedulers`, `/api/scheduler-assignments`, `/scheduler-portal`) remain in the database, in route paths, and in UI page titles. Batch D §6 pins the migration safety rules; the rename itself is out of scope.
7. **Team Portal UI** still consumes the legacy `/api/portal/outreach-call-list`. Adoption of `/api/portal/call-list/v2` (Batch H Step 5) is not yet shipped. Until then, the Bundle 32 Step D-H Playground UIs reference only the legacy shape.

---

## 5. First runtime PR recommendation

**Batch H Step 1 — `recordCallResult` service extraction (preview-only, dormant).**

Concretely:

- Add `server/services/callResult/recordCallResult.ts` as a pure service that accepts the union of the two existing route bodies and returns a canonical `RecordCallResultOutcome` object describing every side effect it would perform.
- The service performs the side effects (insert `outreach_calls`, update `patient_screenings.appointmentStatus`, update `patient_execution_cases.engagementStatus` + `nextActionAt`, conditionally mark `scheduler_assignments.status = "completed"`, conditionally insert `plexus_tasks` + `scheduling_triage_cases`, append `call_result_logged` journey event) via the existing storage helpers + the Bundle 12c typed `appendJourneyEvent`.
- NO route is wired to the service in this PR. Both legacy routes continue to carry their own implementations. The service is dormant.
- Add `scripts/qa-record-call-result-dormancy.mjs` asserting no non-test file imports the service.
- Add a no-DB parity test under `server/services/callResult/__tests__/recordCallResult-parity.test.ts` that exercises the service against the Batch B fixture using dep-injected fetchers and asserts the per-outcome envelope is produced.

This is the minimum runtime PR that unblocks Batch H Step 2 (route delegation) and Batch H Step 6 (Team Portal call-result write). All hard-stops in Batch H §9 are honoured: no response shape change, no flag flip, no UI change.

---

## 6. What Team Portal can consume today

- `GET /api/portal/outreach-call-list` — the existing day-of call list. Unchanged.
- `GET /api/portal/calls?patientScreeningId=<id>` — prior call history (Batch I); behind `USE_PORTAL_CALL_HISTORY_READ` default OFF.
- `GET /api/portal/my-facilities` — facility scope for the viewer.
- `GET /api/auth/me` — viewer identity + role.

No Team Portal write path yet routes through the canonical `recordCallResult` service — that ships in Batch H Step 6.

---

## 7. What Team Portal must not own

Re-stated from Batch F §2 + Batch C QA invariant + Batch I QA assertions:

- Call-list generation (`buildDailyAssignments`, `releaseAndRedistribute`).
- Assignment / disbursement (`schedulerAutoAssign`, engagement-board manual assigns, bridge).
- Cancel-many writes (Bundle 50).
- Assignment-completion logic (only `recordCallResult` may mark assignments completed).
- Capacity math (stays in `portal.ts:391-407` route-side).
- Direct writes to `scheduler_assignments`, `patient_execution_cases`, `outreach_calls`, or `patient_journey_events` from anywhere in `routes/portal.ts`.
- Billing money math, qualification logic, PDF / packet generation, Admin Review approval flows.

---

## 8. Scheduler terminology migration rule

Per Batch D:

- **Do not rename** `scheduler_assignments`, `outreach_schedulers`, `schedulerId`, or `originalSchedulerId` without the §6 migration plan (dedicated PR, Drizzle migration, byte-identical data, backward-compatible read layer, flag-gated cutover default OFF, rollback migration, QA green before AND after).
- **Do not project-wide find-and-replace** "scheduler" → "team member" in source.
- **Do** use the product terms in any new contract / module / type definition (`assignedTeamMemberId`, `callListAssignment`, `workAssignment`).
- **Do** use `legacy*` mapping fields when a product contract surface needs to reference the legacy IDs.
- **Do not** label any PCS or ACS as "Scheduler" in UI.

The Drizzle table identifier `schedulerAssignments` (from `shared/schema/outreach.ts:75-103`) is unchanged.

---

## 9. Final main state

- **HEAD** at the end of this series (after Batch K merges): one commit past `985187e` (Batch J).
- **QA scripts**: 47+ pass (40 baseline + 7 added across Batches A, B, C, E, F, I, J).
- **`npm run check`**: clean.
- **`npm run build`**: clean.
- **Hard-stops touched**: none. Admin Review approval/commit, qualification, supporting buttons, canonical reasoning writes, ICD commit, PDFs, billing money, AWS production cutover, migrations, feature-flag default flips — all preserved.

---

## 10. Non-promises

- No commitment that any of the runtime steps from Batch H ships in any timeframe.
- No commitment that the legacy `POST /api/outreach/calls` is ever removed.
- No commitment to rename `scheduler_assignments` or any other legacy table.
- No commitment that `USE_PORTAL_CALL_HISTORY_READ`, `USE_PORTAL_CALL_LIST_V2`, `USE_PORTAL_CALL_RESULT_WRITE`, or `ENGAGEMENT_TO_CALL_LIST_BRIDGE` is ever default-ON in production.
- No commitment to a specific UI layout for Team Portal's call-list surfaces.

End of summary.

# No-split-brain architecture — summary

**Status:** Docs-only (Batch 25 of platform split-brain run — FINAL).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-no-split-brain-architecture-summary.mjs`.

## 1. Index of PRs shipped in this run

| Batch | PR | Title |
|---|---|---|
| 1 | #160 | Platform-wide split-brain audit |
| 2 | #161 | Canonical workflow ownership registry |
| 3 | #162 | Platform split-brain source scanner (baseline) |
| 4 | #163 | Engagement/Outreach ownership audit |
| 5 | #164 | Engagement call-list UI wiring audit |
| 6 | #165 | Engagement canonical call-result endpoint contract |
| 7 | #166 | Dormant recordCallResult engagement executor |
| 8 | #167 | Engagement call-result response-shape fixture |
| 9 | #168 | Engagement call-result side-effect matrix |
| 10 | #169 | Engagement delegate flag + contract |
| 11 | #170 | Engagement delegate dry-run harness |
| 12 | #171 | Engagement delegation BLOCKERS (STOP) |
| 13 | #172 | Outreach-as-Engagement-subworkflow contract |
| 14 | #173 | Dormant recordCallResult outreach executor |
| 15 | #174 | Outreach call-result response-shape fixture |
| 16 | #175 | Outreach call-result side-effect matrix |
| 17 | #176 | Outreach delegate flag + contract |
| 18 | #177 | Outreach delegate dry-run harness |
| 19 | #178 | Outreach delegation BLOCKERS (STOP) |
| 20 | #179 | Team Portal canonical call-result write contract |
| 21 | #180 | Team Portal source wiring readiness |
| 22 | #181 | Engagement UI terminology contract |
| 23 | #182 | Plexus IQ split-brain audit |
| 24 | #183 | Platform split-brain risk register |
| 25 | (this PR) | Final no-split-brain architecture summary |

## 2. Split-brain areas found

22 platform areas surveyed (Batch 1 audit). 12 split-brain risks indexed in the risk register (Batch 24). Zero at the `critical` level. Major findings:

- Engagement-center vs Outreach: non-overlapping call-result side-effect sets.
- DispositionSheet UI dual-write.
- Two parallel journey-event writers outside `appendJourneyEvent`.
- Six writers to `patient_execution_cases`.
- Two callback-hours fallback formulas.
- engagementStatus semantics divergence between route and canonical planner.
- Two terminal-set definitions for call results.

## 3. What was fixed

Runtime (delivered in this run + prior preview-flag PRs):
- Canonical `recordCallResult` planner (Batch H Step 1) — dormant.
- Canonical execution adapter (Batch H Step 5A) — dormant.
- Engagement-center call-result preview flag (Batch H Step 2) — runtime, default OFF.
- Outreach call-result preview flag (Batch H Step 3) — runtime, default OFF.

This run added:
- Engagement + outreach DI executors (Batches 7 + 14) — dormant.
- Engagement + outreach delegation flag accessors (Batches 10 + 17) — dormant.
- Engagement + outreach dry-run harnesses (Batches 11 + 18) — test-only.

Source invariants (load-bearing QAs):
- Source scanner enforces one canonical writer per canonical table (Batch 3) with hard-failure invariants on Plexus IQ purity + Team Portal purity.
- 24 new architecture docs pin ownership / contracts / risks.
- 27 new QA scripts enforce structure.

## 4. What was only documented (not changed)

- Engagement-center route delegation: blocked on B1-B8 (Batch 12 blockers).
- Outreach route delegation: blocked on B1-B7 (Batch 19 blockers).
- DispositionSheet UI consolidation: blocked on server delegation + Ali approval.
- Patient Directory canonical façade: documented designs only (Bundles 5/20/49).
- Execution Case service: documented; not built.
- Engagement-status semantics + canonical-set extension: Ali decisions pending.

## 5. What remains unsafe

- Flipping any flag default ON.
- Modifying `services/plexusIq/*` runtime.
- Modifying Admin Review approval / commit behavior.
- Modifying qualification final-decision behavior.
- Modifying PDF / document generation behavior.
- Touching any billing money / claim / remittance field.
- Renaming any legacy table / column / route / page without an approved migration plan.

## 6. What requires Ali approval

- Engagement-status semantics decision (Batch 12 B1).
- Outreach journey-event-on-call-result decision (Batch 19 B5).
- Canonical fixture extension to cover outreach-only outcomes (Batch 19 B4).
- ALL flag default flips (engagement preview, outreach preview, engagement delegate, outreach delegate, engagement→call-list bridge, portal call-history read, portal call-list v2).
- ALL UI changes (DispositionSheet collapse, `components/outreach/*` directory rename, "Scheduler" → "Team Member" string renames, `/scheduler-portal` page route rename).
- Patient Directory canonical façade rollout.
- Execution Case service rollout.
- Any new operational writer on Plexus IQ.

## 7. Canonical ownership model

Re-stated for the final summary (full version in Batch 2):

- **Engagement Center owns** the patient engagement workflow end-to-end (call list, call attempts, call results, next action, follow-up task, triage, assignment completion).
- **Team Portal CONSUMES** assigned work; does not own work generation.
- **Patient Directory owns** canonical patient identity (façade pending).
- **Execution Case owns** patient engagement lifecycle state.
- **Journey Events own** audit timeline via `appendJourneyEvent`.
- **Team Tasks own** actionable user work.
- **Operational Queue owns** read-only operational projection.
- **Admin Review owns** approval / commit flow.
- **Qualification Engine owns** qualification logic.
- **Billing Readiness owns** readiness state.
- **Billing owns** all money math.
- **Plexus IQ owns** intelligence / read-model / aggregation (reasoning regeneration on `patient_screenings.reasoning` only).
- **Clinical Evidence Store owns** normalized evidence (dormant).
- **EMR adapters own** EMR import / sync only.

## 8. Engagement / Outreach consolidation status

| Layer | Status |
|---|---|
| Planner + adapter + executors | Built, dormant. |
| Preview flags | Live, default OFF. |
| Delegation flags | Built, default OFF, no route reads them. |
| Engagement route delegation | BLOCKED (Batch 12 blockers) — needs adapter extension + Ali decisions. |
| Outreach route delegation | BLOCKED (Batch 19 blockers) — needs adapter per-surface step suppression + Ali decisions. |
| Team Portal UI consolidation | BLOCKED on server delegations + Ali approval. |
| Legacy endpoint removal | NOT planned in any current PR. |
| Renames (table/column/route/page) | NOT planned in any current PR. |

## 9. Plexus IQ split-brain status

- Plexus IQ is the **intelligence / read-model / aggregation layer** — verified by source inspection (Batch 23) and enforced by source scanner (Batch 3).
- Plexus IQ writes only `patient_screenings.reasoning` (5 admin-review services) — by design per canonical ownership registry.
- Plexus IQ does NOT write `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, `scheduling_triage_cases`.
- The source scanner fails the build if any Plexus IQ service is changed to write those tables.
- No Plexus IQ runtime behavior was modified in this run.

## 10. Exact next PR recommendation

**Adapter extension for per-surface step suppression** (no route wiring).

Concretely:
- Add to `recordCallResultExecutionAdapter.ts` an option `suppressedSteps: ReadonlyArray<CallResultExecutionStep>` on `RecordCallResultExecutionOptions`. When supplied, the adapter marks listed steps as `skipped` with reason `"surface does not own"` and does NOT invoke the corresponding dep.
- Update the engagement executor (Batch 7) to pass `suppressedSteps = ["outreachCallCreated", "assignmentCompleted"]` (or the inverse of `ENGAGEMENT_OWNED_STEPS`).
- Update the outreach executor (Batch 14) to pass `suppressedSteps = ["journeyEventAppended", "executionCaseUpdated", "triageCaseUpserted", "followUpTaskCreated"]` (or the inverse of `OUTREACH_OWNED_STEPS`).
- Extend the two dry-run harness tests (Batches 11 + 18) to assert that suppressed steps appear in the result with `status: "skipped", reason: "surface does not own"`.
- Add `scripts/qa-record-call-result-execution-adapter-step-suppression.mjs` that runs the harness and enforces the suppression contract.
- NO route wiring. NO flag flip. NO migration.

This is the smallest safe runtime PR that unblocks Batch 12 B7 (outreach call insert on engagement route — addressed by engagement-side suppression of `outreachCallCreated`) and Batch 19 B5/B7 (journey event + exec-case writes from outreach surface — addressed by outreach-side suppression). It does NOT resolve B1 (engagement-status semantics) or B4 (outreach-only outcomes) — those still need Ali decisions.

## 11. No-BS-patch policy

This run did NOT:
- Silence any QA to "hide" split-brain.
- Add parallel writers to "match" existing ones.
- Patch UI to paper over server-side splits.
- Skip pre-coding inspection for delegation batches.
- Modify Plexus IQ runtime.
- Touch hard-stop areas (billing, qualification, PDF, Admin Review approval, scheduler-assignment writes, AWS production cutover).

If any future PR is tempted to patch around split-brain, the rule is: STOP, document the blocker, ship the blocker doc + QA, get Ali sign-off on the architecture fix, then return to the work.

## 12. Rollback plan

Every runtime change in this run is gated by a default-OFF flag. Rollback for any preview-or-delegation behavior:

1. Flip the relevant flag OFF in the affected environment.
2. Verify the legacy code-path resumes byte-equivalent responses (helpful: source-invariant QAs assert byte-equivalence at compile time).
3. Open an incident ticket.
4. Fix forward in a new PR; never amend production under fire.

Specifically:
- `USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW` → OFF (preview parity logging stops).
- `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` → OFF (same).
- `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` → OFF (engagement route resumes legacy code path — currently always-OFF).
- `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` → OFF (same — currently always-OFF).
- `ENGAGEMENT_TO_CALL_LIST_BRIDGE` → OFF (bridge stops mirroring).
- `USE_PORTAL_CALL_HISTORY_READ` → OFF (portal calls endpoint returns 404).

## 13. Stop conditions

The run stops automatically if any of these fires:
- Any Plexus IQ service is modified by a PR in this run.
- Any QA hard-failure invariant goes red (source scanner Plexus IQ purity or Team Portal purity).
- Any delegation attempt cannot rebuild a byte-equivalent response (Batch 12 + Batch 19 already triggered this — both shipped blockers docs instead of code).
- Any new flag is added without a default-OFF accessor module structure.
- Any UI source file is edited.
- Any migration is proposed.
- Any billing / qualification / PDF / Admin Review behavior is modified.

End of summary.

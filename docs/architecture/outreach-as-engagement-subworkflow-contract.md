# Outreach as Engagement sub-workflow contract

**Status:** Docs-only (Batch 13 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-outreach-as-engagement-subworkflow-contract.mjs`.

## 1. Pin

- **Outreach is NOT a standalone product owner.**
- **Outreach / call attempts are a SUB-WORKFLOW inside Engagement Center.**
- `POST /api/outreach/calls` remains a compatibility adapter route for legacy callers — it does not get a new product-brain identity.
- Future canonical call-result writes go through the Engagement Center call-result service (`recordCallResult` + executor + future delegation behind `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE`).
- Team Portal MUST NOT treat outreach as a separate brain — its disposition flow eventually consolidates onto the canonical engagement endpoint.
- Plexus IQ MUST NOT own operational call-result writes. Plexus IQ may continue to READ outreach_calls for intelligence/aggregation; it does not write them.

## 2. Why outreach is a sub-workflow, not a brain

- A patient has ONE engagement workflow. The split of "outreach" (call attempts) and "engagement-center" (call results) is a product fiction that creates the data drift documented in the Batch 4 ownership audit.
- The Batch 1 audit classified outreach as **medium-to-high** split-brain risk specifically because it owns its own terminal set, role label, dashboard, and endpoint — the markers of a parallel brain.
- The Batch 5 UI audit documented DispositionSheet's dual-write to outreach + engagement-center as the visible UI workaround for the server-side split-brain.

## 3. What stays in the outreach surface today

- **`POST /api/outreach/calls`** — compatibility adapter. Still owns:
  - `outreach_calls` insert via `storage.createOutreachCallAtomic`.
  - `patient_screenings.appointmentStatus` update (atomic).
  - Terminal-outcome `scheduler_assignments` completion via `storage.markSchedulerAssignmentCompleted`.
  - Fire-and-forget `ensureCanonicalSpineForScreening`.
- **`GET /api/outreach/calls/*`** — read endpoints for the outreach call log.
- **`GET /api/outreach/dashboard`** — the day-of dashboard, retained while UI consolidation is sequenced (Ali-approved).
- **`outreach_schedulers`** roster — preserved per the team-member-assignment terminology contract (Batch D §6); rename is a separate migration plan.

## 4. What outreach must NOT own going forward

- **Standalone product identity.** "Outreach" is a sub-workflow label, not a product brain.
- **Independent terminal-outcome semantics.** The outreach route's local `TERMINAL` set must align with the canonical engagement terminal set after the Batch H Step 5+ executor extension lands.
- **Journey-event scope drift.** The route currently writes NO journey event on call result; the canonical service writes one. Once delegation ships, the outreach route's journey-event semantics conform to the canonical contract.
- **Engagement-case state.** The outreach route must never write `patient_execution_cases` directly. Engagement-case lifecycle stays with Engagement Center.

## 5. What changes (and what does not)

| Concern | Today | After delegation |
|---|---|---|
| Route path `/api/outreach/calls` | exists | exists — compatibility adapter |
| Outreach dashboard endpoint | exists | exists (until UI consolidation) |
| Outreach call log read endpoints | exist | exist |
| `outreach_calls` table | written by outreach route | written via the canonical engagement service through DI |
| Journey event on outreach call result | NOT appended | appended via canonical service (after extension lands) |
| Engagement-case update on outreach call result | NOT performed | performed via canonical service (after extension) |
| Terminal scheduler-assignment completion | performed by outreach route | performed via canonical service (Batch 14 outreach executor) |
| Response shape `res.status(201).json(call)` | unchanged | unchanged (Batch 15 fixture pins it) |

## 6. Team Portal posture

- Team Portal stays a **consumer**, not an owner.
- Team Portal does NOT call `/api/outreach/calls` directly in its terminal future state; UI consolidation reroutes disposition through the canonical engagement endpoint.
- Until UI consolidation ships, DispositionSheet's dual-write (Batch 5 audit) remains; the contract neither blesses nor patches it.

## 7. Plexus IQ posture

- **Untouched.** Plexus IQ remains the intelligence / read-model / aggregation surface (canonical ownership registry, Batch 2).
- Plexus IQ may READ `outreach_calls`, `patient_journey_events`, and the engagement-case tables for reasoning regeneration and aggregation.
- Plexus IQ MUST NOT write `outreach_calls`, `scheduler_assignments`, or any operational workflow table. Source scanner (Batch 3) enforces this as a hard-failure invariant.

## 8. Order of operations (what ships, when)

1. Outreach executor (Batch 14) — DORMANT.
2. Outreach response-shape fixture (Batch 15).
3. Outreach side-effect matrix (Batch 16).
4. Outreach delegate flag + contract (Batch 17).
5. Outreach delegate dry-run harness (Batch 18).
6. Outreach delegation attempt (Batch 19) — inspect-before-coding; STOP and ship blockers if not byte-equivalent (same protocol as Batch 12).
7. Future PRs (out of scope for this run): Team Portal canonical write contract (Batch 20), Team Portal source wiring readiness (Batch 21), Engagement UI terminology contract (Batch 22), Plexus IQ split-brain audit (Batch 23), risk register (Batch 24), final summary (Batch 25).

## 9. Hard-stops

- No flag default flip.
- No `/api/outreach/calls` route removal.
- No outreach dashboard removal.
- No `outreach_schedulers` rename.
- No `scheduler` → `team_member` find-and-replace.
- No UI change in this run.
- No billing / qualification / PDF / Admin Review / Plexus IQ runtime touched.
- No migrations.

End of contract.

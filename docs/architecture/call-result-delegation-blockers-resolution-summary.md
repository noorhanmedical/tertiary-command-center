# Call-result delegation blockers — resolution summary

**Status:** Docs-only (Batch H of adapter-blockers run — FINAL).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-call-result-delegation-blockers-resolution-summary.mjs`.

## 1. What this run delivered

8 PRs (one per batch) ALL merged.

| Batch | PR | What shipped |
|---|---|---|
| A | #185 | Adapter `suppressedSteps` option + `SUPPRESSED_STEP_REASON = "surface does not own"`. |
| B | #186 | Engagement executor `ENGAGEMENT_SUPPRESSED_STEPS = [outreachCallCreated, assignmentCompleted]`. |
| C | #187 | Outreach executor `OUTREACH_SUPPRESSED_STEPS = [journeyEventAppended, executionCaseUpdated, triageCaseUpserted, followUpTaskCreated]`. |
| D | #188 | Journey-event metadata DI contract (design only). |
| E | #189 | engagementStatus semantics decision doc (Ali decision: Option 1 / 2 / 3 hybrid recommended). |
| F | #190 | Outreach-only outcome extension design (Path A / Path B with proposed envelopes). |
| G | #191 | Canonical side-effect ownership matrix v2 (3 surfaces × 8 side effects). |
| H | this PR | Resolution summary. |

## 2. What adapter suppression resolved

Per-surface step suppression on the canonical adapter (Batch A) + per-surface suppression lists on the engagement (Batch B) and outreach (Batch C) executors resolved the following Batch 12 and Batch 19 blockers AT THE ADAPTER LAYER:

- **Batch 12 B7** (outreach call insert on engagement route) — RESOLVED. Engagement executor suppresses `outreachCallCreated`. Under future delegation, the engagement route would NOT trigger outreach_calls insertion.
- **Batch 19 B5** (journey-event divergence on outreach route) — RESOLVED at the adapter layer. Outreach executor suppresses `journeyEventAppended`. Under future delegation, the outreach route's no-append behavior is preserved. (Ali decision required to FLIP this — Batch D Option B — and start appending; until then suppression matches legacy.)
- **Batch 19 B7** (execution-case state writes from outreach surface) — RESOLVED. Outreach executor suppresses `executionCaseUpdated`, `triageCaseUpserted`, `followUpTaskCreated`. Outreach surface no longer would trigger engagement-only writes.

The matrix v2 (Batch G) cross-validates the executor suppression lists so they cannot drift.

## 3. What remains unresolved

Even after Batches A-G, these blockers REMAIN before route delegation can ship:

### Engagement-route delegation
- **B1** (engagementStatus semantics): Ali decision required per Batch E.
- **B2** (assignedTeamMemberId / assignedRole ownership writes): adapter needs `updateExecutionCaseEngagement` dep extension to carry ownership fields, OR route pre-computes them.
- **B3** (`ownershipUpdated` response field): executor's response envelope must surface this, OR route computes it from local state.
- **B4** (computedNextActionAt fallback divergence): planner needs configurable callback-hours injection per Batch E Option 3.
- **B5** (triage case metadata loss): `UpsertTriageCaseArgs` needs extension to carry `mainType`/`subtype`/`priority`/`assignedUserId`/`dueAt`/`note`/`metadata`.
- **B6** (follow-up task metadata loss): `CreateFollowUpTaskArgs` needs extension to carry `title`/`description`/`priority`/`urgency`/`assignee`.
- **B8** (journey-event metadata loss): per Batch D — extend `AppendJourneyEventArgs` with non-PHI metadata bag; PHI captured by route closure.

### Outreach-route delegation
- **B1** (atomic createOutreachCallAtomic): `CreateOutreachCallArgs` dep needs to allow the route to pass `storage.createOutreachCallAtomic` as a single transactional callback.
- **B2** (attemptNumber computation): can be route-pre-computed (no adapter change needed).
- **B3** (auth flow): stays in route (no adapter change needed).
- **B4** (TERMINAL set superset): Ali decision required per Batch F — Path A (extend canonical fixture) or Path B (in-route branching).
- **B5** (journey-event append on outreach): Ali decision required per Batch D Option B.
- **B6** (canonical-spine sync): out_of_band per matrix v2; can stay route-side or get a new adapter step.

### Team Portal delegation (future)
- Blocked on both server-side delegations first per Batch 20 / Batch 21 sequence.

## 4. Is engagement delegation now closer?

**Yes — 1 of 8 engagement blockers resolved (B7 via Batch B suppression).**

Still requires:
- 1 Ali decision (B1 engagementStatus semantics).
- 5 adapter extensions (B2 ownership, B3 ownershipUpdated, B4 callback-hours, B5 triage payload, B6 task payload, B8 journey-event metadata).

Closer, but not deployable. Estimated 5 more dormant adapter-extension PRs after Ali B1 decision.

## 5. Is outreach delegation now closer?

**Yes — 3 of 7 outreach blockers resolved (B5/B7 partially via Batch C suppression; B6 partially via matrix v2's out_of_band classification).**

Still requires:
- 1 Ali decision (B4 outcome extension Path A vs Path B).
- 1 Ali decision (B5 final: open journey events on outreach — Path A keeps suppression, Path B removes it).
- 1 adapter extension (B1 atomic helper passthrough).
- Route-side pre-computation work (B2 attemptNumber, B6 spine sync stays out_of_band).

Closer, but not deployable. Estimated 2-3 more dormant PRs after Ali B4 + B5 decisions.

## 6. What still needs Ali decision

1. **Engagement engagementStatus semantics** (Batch 12 B1) — Option 1 / 2 / 3? Recommendation: Option 3 hybrid with `ENGAGEMENT_STATUS_SEMANTICS` flag.
2. **Outreach journey-event ownership** (Batch 19 B5) — Path A keep suppression vs Path B start appending? Recommendation: Path A (preserve current behavior) until operator comms can land.
3. **Outreach-only canonical outcome extension** (Batch 19 B4) — Path A (extend canonical fixture with 16 outcomes) vs Path B (in-route branching)? Recommendation: Path A for unambiguous terminal outcomes; Path B fallback for ambiguous callback-style outcomes.
4. **Adapter argument extensions** (B5 triage, B6 task, B8 journey metadata) — confirm the proposed type extensions in Batch D don't conflict with any existing consumer.
5. **Production flag flips** — engagement + outreach preview, engagement + outreach delegate, bridge, portal flags. All currently default OFF.

## 7. Exact next PR

**Adapter argument extensions — engagement-side, dormant.**

Concretely:
- Extend `UpdateExecutionCaseEngagementArgs` to carry optional `assignedTeamMemberId`, `assignedRole`, `forceReassign` (per Batch 12 B2).
- Extend `RecordCallResultExecutionResult` (or wrap in engagement-executor response envelope) with an `ownershipUpdated: boolean` derived from a new dep that returns the result (per Batch 12 B3).
- Extend `AppendJourneyEventArgs` with non-PHI typed metadata bag per Batch D.
- Extend `UpsertTriageCaseArgs` to carry triage payload extension per Batch 12 B5.
- Extend `CreateFollowUpTaskArgs` to carry task payload extension per Batch 12 B6.
- Add `RecordCallResultExecutionOptions.callbackHours?: number` so the planner can use a route-supplied hours fallback per Batch 12 B4.
- Update executor tests + dry-run harness.
- NO route wiring. NO flag flip. NO migration.

This is one logical PR (or split per arg extension if Ali prefers smaller). It unblocks the remaining 5 engagement blockers without touching the engagementStatus semantics decision — that stays gated on Batch E Ali decision.

## 8. Plexus IQ

**No Plexus IQ runtime touched.** Verified by:
- Source scanner (Batch 3 of split-brain run) hard-failure invariant.
- Plexus IQ split-brain audit (Batch 23) source inspection.
- Each batch in this run's QA explicitly pinned no-Plexus-IQ-import invariants.

Plexus IQ remains the intelligence / read-model / aggregation layer.

## 9. Hard-stops respected

- No route delegation wired.
- No flag default flipped.
- No response shape change (engagement-center route still returns `{ ok, executionCase, journeyEvent, triageCase, task, ownershipUpdated }`; outreach route still returns `res.status(201).json(call)`).
- No UI change.
- No billing / qualification / PDF / Admin Review approval / scheduler-assignment write logic touched.
- No migration.
- No Plexus IQ runtime touched.
- No new side effects (the adapter's suppression behavior is testable but not invoked by any route).

End of summary.

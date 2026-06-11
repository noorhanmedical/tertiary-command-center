# Platform split-brain risk register

**Status:** Docs-only (Batch 24 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-platform-split-brain-risk-register.mjs`.

Central register of every split-brain risk found during the run. Each risk gets an ID, ownership data, severity, current mitigation, required fix, the safe next PR (if any), and whether Ali approval is required.

## Risk entries

### R-01 — Engagement-center / Outreach dual call-result paths
- **Area:** call-result write
- **Current duplicate owner:** `routes/executionCases.ts` (engagement-center path) AND `routes/outreach.ts` (outreach path) — non-overlapping side-effect sets per Batch 4.
- **Target owner:** Engagement Center canonical service (recordCallResult planner + execution adapter + executors) per Batch 6 contract.
- **Severity:** medium
- **Current mitigation:** preview parity flags (Batch H Steps 2 + 3) + delegation flags scaffolded (Batches 10 + 17) but not yet wired — blocked by Batch 12 + Batch 19 blockers docs.
- **Required fix:** per-surface step suppression on the canonical adapter + Ali decisions on engagement-status semantics (B1 in Batch 12) and journey-event/outreach behavior (B5 in Batch 19).
- **Safe next PR:** adapter extension for per-surface step suppression (no route wiring).
- **Ali approval required:** yes (for B1 + B5 decisions and any flag flip).
- **Plexus IQ involved:** no.

### R-02 — DispositionSheet UI dual-write
- **Area:** Team Portal call-result write
- **Current duplicate owner:** `client/src/components/outreach/DispositionSheet.tsx` POSTs to BOTH `/api/outreach/calls` and `/api/engagement-center/call-result` per Batch 5.
- **Target owner:** single canonical Engagement Center endpoint per Batch 20 contract.
- **Severity:** medium
- **Current mitigation:** Batch 20 contract + Batch 21 source wiring readiness pin the intent.
- **Required fix:** UI consolidation AFTER both server-side delegations ship.
- **Safe next PR:** none until R-01 resolves.
- **Ali approval required:** yes (UI changes).
- **Plexus IQ involved:** no.

### R-03 — Journey-event parallel writers (patient_journey_events)
- **Area:** Journey Events (`patient_journey_events`)
- **Current duplicate owner:** `services/journey/appendJourneyEvent.ts` (canonical) PLUS `repositories/executionCase.repo.ts:219` PLUS `routes/patients.ts:681`.
- **Target owner:** `appendJourneyEvent` ONLY.
- **Severity:** low-medium
- **Current mitigation:** Batch 3 source scanner reports both baseline findings via `console.info`; new offenders fail the build.
- **Required fix:** route/repo refactors to delegate through `appendJourneyEvent`.
- **Safe next PR:** swap `routes/patients.ts:681` to use `appendJourneyEvent` (single file, narrow scope).
- **Ali approval required:** no (small refactor) — but the refactor touches qualification reasoning, so flag for review.
- **Plexus IQ involved:** no.

### R-04 — patient_execution_cases multi-writer
- **Area:** Execution Case lifecycle
- **Current duplicate owner:** SIX files write `patient_execution_cases` (Batch 1 audit §7).
- **Target owner:** Execution Case service (future).
- **Severity:** medium-high
- **Current mitigation:** Batch 3 source scanner allow-lists current writers; new writers fail.
- **Required fix:** Execution Case service façade + writer funneling, sequenced.
- **Safe next PR:** none in this run (multi-PR series).
- **Ali approval required:** yes.
- **Plexus IQ involved:** no.

### R-05 — Engagement → Call-list bridge (flag-gated dual writer)
- **Area:** Scheduler assignments
- **Current duplicate owner:** legacy assignment service + `modules/operational-queue/bridge.ts` (Batch E flag-gated).
- **Target owner:** Engagement Center assignment surface; bridge stays flag-gated until Ali approves default-flip after staging gate.
- **Severity:** medium (flag-gated, default OFF).
- **Current mitigation:** Batch E bridge contract + QA + flag.
- **Required fix:** staging verification window then approved flag flip.
- **Safe next PR:** none in this run.
- **Ali approval required:** yes (flag default flip).
- **Plexus IQ involved:** no.

### R-06 — Patient Directory identity multi-writer
- **Area:** Patient identity
- **Current duplicate owner:** many surfaces call `storage.updatePatientScreening` (Batch 1 audit §6).
- **Target owner:** Patient Directory canonical façade (Bundle 5 / Bundle 20 designs).
- **Severity:** high
- **Current mitigation:** shadow-read contract (Bundle 20) + parity fixture.
- **Required fix:** Patient Directory façade + multi-PR rollout.
- **Safe next PR:** none in this run.
- **Ali approval required:** yes.
- **Plexus IQ involved:** partial — Plexus IQ writes `patient_screenings.reasoning` (see R-07).

### R-07 — Plexus IQ writes patient_screenings.reasoning alongside admin.ts
- **Area:** Admin Review reasoning
- **Current duplicate owner:** Plexus IQ services (5 admin-review services) + `routes/admin.ts`.
- **Target owner:** Plexus IQ (intentional per canonical ownership registry §"Plexus IQ").
- **Severity:** low-medium
- **Current mitigation:** Batch 23 audit confirms this is the documented design; Plexus IQ writes are scoped to reasoning only.
- **Required fix:** Patient Directory façade subsumes the multi-writer concern (overlaps with R-06).
- **Safe next PR:** none in this run.
- **Ali approval required:** no (preserved as designed).
- **Plexus IQ involved:** yes (audit-only this run).

### R-08 — Outreach as standalone product brain
- **Area:** Outreach surface vs Engagement Center
- **Current duplicate owner:** outreach dashboard + outreach roster + outreach role label + outreach endpoint = standalone product feel.
- **Target owner:** Engagement Center; outreach is a sub-workflow.
- **Severity:** medium-high (product-level).
- **Current mitigation:** Batch 13 contract + Batches 14-19 sequence + Batch 22 terminology contract.
- **Required fix:** server delegation (blocked by R-01) + UI consolidation (blocked by R-02).
- **Safe next PR:** server-side adapter extension per R-01.
- **Ali approval required:** yes (UI + flag flips).
- **Plexus IQ involved:** no.

### R-09 — Two terminal-set definitions for call results
- **Area:** Call result outcome semantics
- **Current duplicate owner:** outreach route's local `TERMINAL` set vs engagement-center's `TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT` vs canonical planner's `terminal` flag.
- **Target owner:** canonical planner (single fixture-pinned definition).
- **Severity:** medium
- **Current mitigation:** Batch B parity fixture pins the canonical set; outreach Batch 19 blockers doc identifies the divergence.
- **Required fix:** canonical fixture extension to cover outreach-only outcomes OR explicit "delegation accepts canonical set only" Ali decision.
- **Safe next PR:** docs-only fixture extension proposal.
- **Ali approval required:** yes.
- **Plexus IQ involved:** no.

### R-10 — patient_screenings row mixes identity + status + reasoning
- **Area:** Patient Directory shape
- **Current duplicate owner:** one row, multiple logical concerns, multiple writers.
- **Target owner:** Patient Directory canonical façade splits concerns server-side.
- **Severity:** medium (architectural, not data-corruption).
- **Current mitigation:** none beyond R-06.
- **Required fix:** subsumed by R-06.
- **Safe next PR:** none.
- **Ali approval required:** yes.
- **Plexus IQ involved:** partial (writes reasoning).

### R-11 — Engagement-status semantics differ between route and planner
- **Area:** engagementStatus values
- **Current duplicate owner:** route writes coarse "in_progress" for all non-terminal; planner writes per-outcome transitions.
- **Target owner:** canonical planner (per fixture).
- **Severity:** medium (visible behavior on flag flip).
- **Current mitigation:** Batch 12 blockers doc (B1) flags this for Ali decision.
- **Required fix:** Ali decision on product behavior + (a) fixture rollback to coarse semantics OR (b) communicated upgrade.
- **Safe next PR:** none until Ali decides.
- **Ali approval required:** yes.
- **Plexus IQ involved:** no.

### R-12 — Two callback-hours fallback formulas
- **Area:** nextActionAt fallback
- **Current duplicate owner:** route reads admin setting (24h default, callback only); planner uses fixed 4h on callback/no_answer/voicemail.
- **Target owner:** canonical planner with dep-injected hours from admin settings.
- **Severity:** low-medium
- **Current mitigation:** Batch 12 blockers (B4).
- **Required fix:** planner extension for hours injection.
- **Safe next PR:** docs-only planner extension proposal.
- **Ali approval required:** no (mechanical) — flag for review.
- **Plexus IQ involved:** no.

## Summary

12 risks identified. 0 are at the `critical` level. 0 require runtime patches in this run. All risks have either:
- Existing mitigation (preview/delegation flags, QA scanners).
- A documented blocker doc explaining why runtime change is unsafe.
- A separately-sequenced PR series outside this run's scope.

## Plexus IQ summary

Plexus IQ is involved in R-06, R-07, R-10 at the patient-screenings-row level. NONE of those involve Plexus IQ writing operational workflow tables — Plexus IQ's writes are confined to `patient_screenings.reasoning` (intentional per canonical ownership registry). No Plexus IQ runtime change required by any of the 12 risks.

End of risk register.

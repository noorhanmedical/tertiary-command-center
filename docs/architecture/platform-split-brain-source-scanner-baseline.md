# Platform split-brain source scanner — baseline

**Status:** Docs-only (Batch 3 of platform split-brain run).
**Date:** 2026-06-10.
**Companion script:** `scripts/qa-platform-split-brain-source-scanner.mjs`.
**Posture:** baseline-only — known findings are reported via `console.info` and DO NOT fail the build. Any new duplicate writer introduced after this baseline WILL fail the scanner.

The scanner enforces the "one canonical writer per canonical table" rule from the canonical ownership registry (Batch 2 §"Cross-cutting invariants").

---

## 1. Known baseline findings (info-only, not failing)

Two duplicate writers exist on `main` at the time of this baseline. Each is acceptable today only because:
- it predates the registry and a future PR will consolidate it through `appendJourneyEvent`, and
- the scanner now tracks the count, so any new duplicate writer fails.

| # | File | Table | Note |
|---|---|---|---|
| 1 | `server/repositories/executionCase.repo.ts:219` | `patient_journey_events` | Direct `db.insert(patientJourneyEvents)` inside the execution-case repo. Bypasses `appendJourneyEvent` (Bundle 12c). |
| 2 | `server/routes/patients.ts:681` | `patient_journey_events` | Direct `(db as any).insert(patientJourneyEvents)` for a best-effort timeline append on a legacy patient mutation path. Bypasses `appendJourneyEvent`. |

Both are eventually-consistent best-effort writes that the canonical `appendJourneyEvent` writer was designed to subsume. The consolidation is sequenced separately (it touches the Admin Review / qualification surfaces and is out of scope for this run's hard-stops).

## 2. Hard-failure invariants (already enforced — non-baseline)

The scanner fails the build immediately on either of:

- **Plexus IQ writes operational workflow tables.** Any file under `server/services/plexusIq/` that contains a write verb against `patient_execution_cases`, `outreach_calls`, `scheduler_assignments`, `plexus_tasks`, `patient_journey_events`, or `scheduling_triage_cases` trips this. Plexus IQ is the intelligence / read-model / aggregation layer per the canonical ownership registry.
- **Team Portal writes core workflow tables directly.** `server/routes/portal.ts` containing `db.insert/update/delete` against any of the six canonical workflow tables trips this. Team Portal is a consumer, not an owner.

At baseline time, BOTH invariants pass with zero violations.

## 3. Allow-list rationale

For each canonical table, the allow-list names the files the registry recognizes as the canonical writer surface:

| Table | Canonical writer surface |
|---|---|
| `patient_execution_cases` | `executionCase.repo.ts`, `routes/executionCases.ts`. **Today** also: `engagementAssignmentBoard.ts`, `routes/patients.ts`, `routes/globalSchedule.ts`, `services/patientCommitService.ts`, `services/schedulerAutoAssign.ts` — these are documented in the Batch 1 audit as legitimate but pending consolidation through an Execution Case service. The scanner allow-lists them today; a future PR removes them once funneled. |
| `outreach_calls` | `storage.ts` (façade), `repositories/outreach.repo.ts` (implementation). |
| `scheduler_assignments` | `storage.ts`, `repositories/schedulerAssignments.repo.ts`, `services/schedulerAssignmentService.ts`, `services/schedulerAutoAssign.ts`, `routes/schedulerAssignments.ts`, `modules/operational-queue/bridge.ts` (flag-gated engagement→call-list bridge, Batch E). |
| `plexus_tasks` | `storage.ts`, `repositories/plexus.repo.ts`, `routes/plexusTasks.ts`. |
| `patient_journey_events` | `services/journey/appendJourneyEvent.ts` ONLY. The two repo/route writers above are the baseline split-brain. |
| `scheduling_triage_cases` | `repositories/schedulingTriage.repo.ts`. |

## 4. What changes after baseline

- The scanner is now load-bearing. Any PR that introduces a new writer to a canonical table without adding it to the allow-list (with documented rationale + ownership-registry update) will fail the QA loop.
- The baseline finding count (2) is a regression alarm — the next PR that touches journey-event writers should reduce it, not increase it.
- The hard-failure invariants (Plexus IQ purity, Team Portal purity) stay GREEN. If they ever go red, the run stops.

## 5. Non-promises

- No promise to consolidate the two baseline journey-event writers in this run. The consolidation is sequenced through a separate PR series that touches Admin Review reasoning regeneration and qualification reasoning.
- No promise to shrink the `patient_execution_cases` writer allow-list before the Execution Case service exists.
- No promise to enforce critical-status escalation automatically — the scanner reports; humans escalate.

End of baseline.

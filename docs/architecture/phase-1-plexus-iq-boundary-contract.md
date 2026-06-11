# Phase 1 — Plexus IQ boundary contract

**Status:** Docs-only (Batch D1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-plexus-iq-boundary-contract.mjs`.

Pins the Plexus IQ scope in Phase 1. Hard guardrails to prevent Plexus IQ from absorbing Mission Control / billing dashboards / productivity dashboards / operational workflow ownership.

## 1. Plexus IQ scope in Phase 1

Plexus IQ remains:

- **Batch Flow** intelligence — ingestion analytics, batch progress, duplicate-screening signal aggregation.
- **Visit vs Outreach** derivation support — informs the bucket assignment Engagement Center reads.
- **Qualification reasoning** generation — generates `patient_screenings.reasoning` via the `services/plexusIq/adminReview*` services.
- **Admin Review support** — surfaces reasoning + evidence to the human reviewer; ICD suggestions; ancillary regeneration.

## 2. Plexus IQ is NOT Mission Control

Plexus IQ is the **intelligence / read-model / aggregation layer**. It is NOT:

- A billing dashboard.
- A productivity dashboard.
- An invoice dashboard.
- An operational metrics dashboard.
- An executive metrics dashboard.
- A claims dashboard.
- A revenue dashboard.

Mission Control comes LATER as a separate product surface. Plexus IQ MUST NOT absorb Mission Control responsibilities in Phase 1.

## 3. What Plexus IQ does NOT own

- **Assignment ownership** — scheduler-assignment / engagement-board work assignment is the scheduler-assignment service + Engagement Center's territory. Plexus IQ READS assignment state for aggregation; never writes.
- **Call-result ownership** — `outreach_calls`, `patient_journey_events` (`call_result_logged`), `scheduling_triage_cases`, `plexus_tasks` writes are owned by the canonical recordCallResult service. Plexus IQ READS for reasoning aggregation; never writes call-result rows.
- **Operational workflow truth** — `patient_execution_cases.engagementStatus` / `lifecycleStatus` are Engagement Center's territory. Plexus IQ READS for aggregation.
- **Billing dashboards** — Phase 1 billing readiness + invoicing live in their own modules (Segment G). Plexus IQ may READ billing readiness state for aggregation; never writes.
- **Productivity metrics** — Phase 1 has no productivity dashboards. Plexus IQ MUST NOT add one.
- **Financial metrics** — claims / remittance / denials / payments are NOT Phase 1 at all.

## 4. Plexus IQ UI behavior protection

Existing Plexus IQ UI surfaces (`client/src/components/plexus-iq/*`) are PROTECTED in Phase 1:

- No file under `client/src/components/plexus-iq/` may be removed, renamed, or restructured.
- No file under `client/src/components/plexus-iq/` may be edited unless Ali explicitly approves.
- Plexus IQ patient surfaces (`PlexusIQBulkImportModal`, `PlexusIQRecentQualificationCards`, `PlexusIQAddPatientHub`, `PlexusIQWorkspace`) must continue to render with current behavior.

## 5. Plexus IQ runtime behavior protection

Existing Plexus IQ runtime (`server/services/plexusIq/*`, `server/routes/plexusIqClinicalImport.ts`, `server/routes/plexusTasks.ts`) is PROTECTED in Phase 1:

- No file under `server/services/plexusIq/` may be modified unless Ali explicitly approves.
- The 5 admin-review services that write `patient_screenings.reasoning` continue to do so by design.
- The 6 hard-failure invariants from #162 Batch 3 source scanner remain GREEN:
  - No Plexus IQ writes to `patient_execution_cases`.
  - No Plexus IQ writes to `outreach_calls`.
  - No Plexus IQ writes to `scheduler_assignments`.
  - No Plexus IQ writes to `plexus_tasks`.
  - No Plexus IQ writes to `patient_journey_events`.
  - No Plexus IQ writes to `scheduling_triage_cases`.

## 6. What requires Ali explicit approval to change in Plexus IQ

- Any Plexus IQ UI string change.
- Any Plexus IQ UI layout change.
- Any Plexus IQ runtime service modification.
- Any new Plexus IQ write target.
- Any Plexus IQ flag flip.

## 7. Phase 1 rules

- Plexus IQ stays read-model / intelligence layer.
- Plexus IQ does NOT become Mission Control.
- Plexus IQ runtime + UI are protected unless Ali explicitly approves.
- The intelligence layer aggregates operational state; it does not own it.

End of contract.

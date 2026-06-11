# Engagement call-list ownership — FINAL contract

**Status:** Docs-only (Batch 13 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-call-list-ownership-final-contract.mjs`.

After Batches 1-12 of this run shipped the canonical engagement call-result write path, this contract pins ownership of the **read** side — who owns generating the engagement call list, who consumes it, and who is forbidden from owning it.

## 1. Pins

- **Engagement Center owns call-list generation.** The engagement-case + scheduler-assignment tables produce the canonical call list; the future Engagement call-list service module (Batch 15) is the canonical surface.
- **Team Portal CONSUMES assigned work.** It does not own the work list. The current `/api/portal/outreach-call-list` is the Team Portal read endpoint.
- **Operational Queue is a read-only projection.** It derives its view from `patient_execution_cases` + `scheduler_assignments`; QA invariant `qa-operational-queue-readonly-invariant.mjs` enforces no writes.
- **Team Tasks own actionable user work.** Tasks are an OUTPUT of the engagement workflow (created when a call result requires follow-up), not a substitute for the call list.
- **Outreach is a sub-workflow inside Engagement Center.** The outreach roster (`outreach_schedulers`) and the outreach dashboard remain as compatibility surfaces; they do not own the canonical call list.
- **Plexus IQ is a read-model / intelligence layer only.** It may READ the call list for aggregation; it MUST NOT own the call list or generate one.

## 2. No split-brain rule

- The call list MUST be generated from ONE canonical source (the future Engagement call-list service, Batch 15).
- ANY new surface that needs to render a call list MUST consume the canonical service, not duplicate generation logic.
- Plexus IQ aggregations MAY derive new views from the canonical call list (read-only), but MUST NOT introduce a parallel generator.

## 3. Today's state

- Engagement-board call list: rendered via `GET /api/engagement-center/cases` (read-only over `patient_execution_cases`).
- Team Portal call list: rendered via `GET /api/portal/outreach-call-list` (read-only over `scheduler_assignments` + `patient_screenings`).
- Operational Queue: `/api/operational-queue/*` (read-only projection over the same sources).
- No canonical Engagement call-list service module exists yet — Batches 14 + 15 create the design + dormant scaffold.

## 4. Target state

- Engagement call-list service module (`server/services/engagement/engagementCallListService.ts`) is the canonical READ surface.
- `GET /api/engagement-center/call-list` (future, behind `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` default OFF) calls the service.
- Team Portal eventually consumes a projection of the canonical service (via `/api/portal/...`), not a parallel generator.
- Operational Queue continues to project off the same underlying tables — no change.

## 5. Hard-stops

- No new writer is added under the call-list service.
- No Team Portal change in this contract or its companion batches.
- No `/api/outreach/calls` change.
- No Plexus IQ runtime touched.
- No migration.

## 6. Plexus IQ posture

- Plexus IQ MAY read the canonical call list (via the future read route or the service-internal projection function).
- Plexus IQ MUST NOT write `patient_execution_cases`, `scheduler_assignments`, `outreach_calls`, `plexus_tasks`, `patient_journey_events`, `scheduling_triage_cases`.
- Source scanner (Batch 3 of split-brain run) enforces this as a hard-failure invariant.

End of contract.

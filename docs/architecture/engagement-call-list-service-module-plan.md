# Engagement call-list service module — plan

**Status:** Docs-only (Batch 14 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-call-list-service-module-plan.mjs`.

## 1. Goal

Define the canonical Engagement call-list service module (`server/services/engagement/engagementCallListService.ts`, dormant in Batch 15) — the single read-model surface that every Engagement-call-list consumer eventually goes through.

## 2. Source tables

- `patient_execution_cases` — engagement-case lifecycle state (engagementStatus, nextActionAt, assignedTeamMemberId).
- `scheduler_assignments` — day-of CallListAssignment queue (assignmentDate, status, schedulerId).
- `patient_screenings` — patient identity + appointmentStatus.
- (Optional, for downstream consumers) `outreach_calls` — call attempt log.

## 3. Owner

Engagement Center. The service module lives under `server/services/engagement/` and is the only canonical surface that reads-and-derives the call list.

## 4. Read-model fields (proposed)

Each canonical call-list item carries:

- `patientScreeningId: string`
- `patientExecutionCaseId: string | null`
- `engagementStatus: "contacted" | "in_progress" | "not_reached" | "needs_followup" | null`
- `lifecycleStatus: string | null`
- `assignedTeamMemberId: string | null`
- `assignedRole: "scheduler" | "liaison" | null` (legacy role names preserved per Batch D §6)
- `appointmentStatus: string | null`
- `nextActionAt: string | null` (ISO)
- `facilityId: string | null`
- `callListAssignmentDate: string | null` (when present in scheduler_assignments)

No PHI in the read model envelope (patient name / DOB stay route-side).

## 5. Route consumers (target)

- `GET /api/engagement-center/call-list` (canonical, Batch 17, behind `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` default OFF).
- Eventually: a Team Portal projection consumer (out of scope here).

The existing `GET /api/engagement-center/cases` and `GET /api/portal/outreach-call-list` continue to serve their existing surfaces — they are NOT removed.

## 6. Team Portal projection relationship

Team Portal today reads `/api/portal/outreach-call-list` which queries `scheduler_assignments` directly. The canonical call-list service is engagement-board-shaped; a Team Portal projection would map its records onto the existing portal envelope (which carries call-attempt count + capacity info that Team Portal renders).

The Team Portal projection is a separate future PR — NOT Batch 15 or 17.

## 7. Operational Queue projection relationship

Operational Queue already projects over `patient_execution_cases` + `scheduler_assignments` (Bundle 11a design). The canonical call-list service derives from the SAME tables. The two surfaces remain independent projections — neither owns the other.

## 8. No writes from read model

The service module is READ-ONLY. Strict invariants:
- NO `db.insert(...)` / `db.update(...)` / `db.delete(...)` inside the service module.
- NO calls to `storage.create*` / `storage.update*` / `storage.delete*`.
- NO calls to `appendJourneyEvent` (which would be a write).
- NO calls to assignment writers.

## 9. No Plexus IQ ownership

The service module MUST NOT import any Plexus IQ surface. Plexus IQ may LATER read the canonical call list (for aggregation), but Plexus IQ does not own or extend it.

## 10. Hard-stops

- No service module shipped in this batch (Batch 15 ships the dormant scaffold).
- No route shipped in this batch (Batch 17 ships the route).
- No write logic added.
- No Plexus IQ touched.
- No migration.

End of plan.

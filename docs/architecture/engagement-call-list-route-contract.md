# Engagement call-list route — contract

**Status:** Docs-only (Batch 16 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-call-list-route-contract.mjs`.

## 1. Target

`GET /api/engagement-center/call-list` — canonical read endpoint for the Engagement call list. Implementation lands in Batch 17, default OFF.

## 2. Flag

`USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ`:
- Default: OFF.
- Truthy: `"1"`, `"true"`, `"yes"`.
- Accessor module: `server/services/engagement/engagementCanonicalCallListReadFlag.ts` (added in Batch 17).

When OFF: the route returns `404 Not Found` so callers fail loudly.
When ON: the route calls `getEngagementCallList` from the scaffold (Batch 15) with deps wired to real repositories.

## 3. Posture

- Canonical READ endpoint for the engagement call list.
- Team Portal MUST NOT generate the call list. Team Portal continues to consume `/api/portal/outreach-call-list` for now; a separate future PR will wire a Team Portal projection through the canonical service.
- Operational Queue remains read-only; no change.
- No write side effects on the call-list route.
- No `/api/outreach/calls` change.
- No Plexus IQ runtime touched.

## 4. Response envelope

```
{
  items: EngagementCallListItem[],
  count: number
}
```

Where `EngagementCallListItem` carries the fields pinned in the Batch 14 plan (patientScreeningId, patientExecutionCaseId, engagementStatus, lifecycleStatus, assignedTeamMemberId, assignedRole, appointmentStatus, nextActionAt, facilityId, callListAssignmentDate). No PHI.

## 5. Query parameters

Mapped onto `EngagementCallListFilters`:
- `facilityId?`
- `assignedTeamMemberId?`
- `assignedRole?`
- `engagementStatus?`
- `callListAssignmentDate?` (YYYY-MM-DD)
- `limit?` (default 100, max 500 — clamped by the service)

## 6. No split-brain

The route is THE canonical consumer of the engagement call list. Any future surface (Team Portal projection, Operational Queue extension, Plexus IQ aggregation) reads through the SAME service module (Batch 15) — not by re-deriving from raw tables.

## 7. Rollback

Flip `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` OFF. The route returns 404. Operational Queue + Team Portal + Engagement Center board continue serving their existing read endpoints.

## 8. Plexus IQ

Untouched. Plexus IQ MAY consume the call-list endpoint READ-ONLY for aggregation in a future PR; it MUST NOT own the read model.

## 9. Hard-stops

- No route shipped in this batch (Batch 17 ships it).
- No service-side write logic added.
- No Team Portal change.
- No /api/outreach/calls change.
- No Plexus IQ runtime touched.

End of contract.

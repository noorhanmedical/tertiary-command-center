---
name: Clinician Portal persistence
description: How the Clinician Portal (Orders & Notes, Plexus Engagement) demo prototype persists actions over its seed mock data.
---

The Clinician Portal pages (`client/src/components/physician/orders/OrdersNotesPage.tsx`,
`.../engagement/PlexusEngagementPage.tsx`) render from a shared seed mock file
(`client/src/components/physician/mockData.ts`, stable string ids like NOTE-9001,
CALL-1, SCH-1). User actions are persisted as **overlays keyed by the mock id**,
GLOBALLY (not per logged-in user), merged onto the seed in `useMemo` at render.

**Why global, not per-user:** more realistic for a shared clinic demo and simpler
than threading session userId into every overlay row; the actor is still captured
in the audit_log event (username from session).

**How to apply:** persistence tables live in `shared/schema/clinicianPortal.ts`
(note_states unique on noteId, call_states unique on callId, schedule_items
unique on patientId+service). Repo `server/repositories/clinicianPortal.repo.ts`
upserts via onConflictDoUpdate. Routes `server/routes/clinicianPortal.ts` are the
authority on note version (amend = existing+1) and call status (outcome→status:
Scheduled→Scheduled, "Reached*"→Reached, Declined→Do Not Contact, else Attempted).
The immutable audit trail reuses `audit_log` via `logAudit` with entityType
`clinician_portal_note` / `clinician_portal_call`; the notes page timeline = seed
AUDIT_EVENTS + persisted events, and KPI callsLoggedToday = count of today's call
audit events. Persisted call history is only the NEW entries, appended on top of
the seed baseline history client-side.

# Team Portal Patient Directory wiring contract

**Status:** Docs-only (Batch E2 of Phase 1 run).
**Companion:** `scripts/qa-team-portal-patient-directory-wiring-contract.mjs`.

Patient Directory is the read surface the Team Portal cockpit uses to
look up patient context (demographics, qualification reasoning summary,
current engagement status, ancillary blockers, call history pointer) for
a single patient. This contract pins the SHAPE and BOUNDARIES of that
wiring before any UI runtime change.

## Wiring is read-only and additive

Patient Directory wiring in Phase 1:

- Adds NO new visible UI surface — it renders inside existing protected
  Team Portal panels (PatientCommandCanvas / SchedulePatientPlayground /
  PortalShell). See `team-portal-panel-playground-protection-contract`.
- Adds NO write endpoint. All writes still flow through the existing
  Engagement / Outreach / canonical call-result endpoints.
- Is fed by a single canonical detail read endpoint owned by Engagement
  (NOT Plexus IQ, NOT Admin Review).
- Is feature-flagged default-OFF until UI is explicitly approved by Ali.

## Canonical detail endpoint shape

`GET /api/engagement/patient-directory/:patientId`

Response (canonical, additive — fields may be null but must not change shape):

```jsonc
{
  "patientId": "string",
  "demographics": {
    "displayName": "string",
    "dob": "string|null",
    "phoneE164": "string|null",
    "facility": "string|null"
  },
  "qualification": {
    "reasoningSummary": "string|null",
    "lastReviewedAt": "string|null"
  },
  "engagement": {
    "currentStatus": "string|null",
    "assignedTo": "string|null",
    "lastCallOutcome": "string|null",
    "callbackAt": "string|null"
  },
  "ancillaryBlockers": [
    { "kind": "string", "since": "string", "severity": "info|warn|block" }
  ],
  "callHistoryRef": {
    "endpoint": "string",
    "count": 0
  }
}
```

The endpoint is OPTIONAL in Phase 1 — its absence MUST NOT break the
Team Portal. UI consumers must treat its absence as "no directory data
available" without erroring.

## Source of truth boundaries

| Field group | Backed by |
|---|---|
| demographics | patients table read model |
| qualification | `patient_screenings.reasoning` (read) |
| engagement | engagement assignment + last call result |
| ancillaryBlockers | ancillary read model (Segment F) — empty array until F lands |
| callHistoryRef | pointer to canonical call-result read endpoint |

Patient Directory MUST NOT:
- Write to `patient_screenings` (Admin Review territory).
- Trigger qualification regeneration (Admin Review territory).
- Compute billing readiness (Segment G territory).
- Render or compute financial / operational dashboards (Mission Control territory).

## Feature flags

| Flag | Default | Purpose |
|---|---|---|
| `VITE_USE_PATIENT_DIRECTORY_WIRING` | OFF | Client-side fetch + render gate inside existing panels |
| `USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT` | OFF | Server-side endpoint registration gate |

Both flags MUST be default-OFF in Phase 1. Production flip requires
explicit Ali approval — see [[team-portal-panel-playground-protection]]
for the protected-flow stance.

## What Phase 1 does NOT include

- No NEW route file in `server/routes/` — the endpoint MUST be added
  inside `server/routes/engagement.ts` or `executionCases.ts` if/when E2
  implementation lands. (E2 is docs+QA only; no endpoint exists yet.)
- No NEW client component file — wiring lives inside existing
  PatientCommandCanvas / SchedulePatientPlayground.
- No migration.
- No Mission Control / financial / productivity dashboard.

## Related contracts

- [[team-portal-panel-playground-protection]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of contract.

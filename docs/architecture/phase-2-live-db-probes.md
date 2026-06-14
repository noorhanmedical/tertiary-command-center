# Phase 2 — DB-backed live probes (PR 2.10)

Five read-only probes verify the Phase 2 contract against a real
database. They honestly skip with exit code 0 when `DATABASE_URL`
is unavailable, so CI on a sandboxed environment continues to pass.

## Probes

| Probe | npm script | What it checks |
|---|---|---|
| Operations baseline | `npm run probe:phase2-ops` | Required tables exist + 9 PR 2.1 admin_settings seed rows present at global scope |
| Call runtime | `npm run probe:phase2-call-runtime` | `patient_execution_cases.assigned_team_member_id` is `integer`; `patient_journey_events.event_type` exists; call-runtime settings seeded |
| Scheduling | `npm run probe:phase2-scheduling` | `global_schedule_events` has `id` + `status` (text) + `starts_at` + `event_type` + `execution_case_id` columns |
| Document readiness | `npm run probe:phase2-documents` | `case_document_readiness`, `billing_readiness_checks`, `procedure_events`, `documents`, `document_requirements` tables exist with the canonical column shape |
| Notes + Contacts | `npm run probe:phase2-notes-contacts` | PR 2.6 (`patient_notes`) + PR 2.7 (`contacts`) tables exist with the expected columns |

## Honest skip

Each probe begins with:

```ts
if (!process.env.DATABASE_URL) {
  console.log("[probe:<name>] DATABASE_URL unavailable — skipped live DB probe.");
  return;
}
```

No mutations are performed. The probes are safe to run against
production.

## Run order

Recommended order (matches the Phase 2 PR sequence):

```
npm run probe:phase2-ops
npm run probe:phase2-call-runtime
npm run probe:phase2-scheduling
npm run probe:phase2-documents
npm run probe:phase2-notes-contacts
```

A failing probe exits non-zero with the failing assertion logged. On
Replit (where `DATABASE_URL` is set), all 5 must pass for Phase 2
to be considered live-validated.

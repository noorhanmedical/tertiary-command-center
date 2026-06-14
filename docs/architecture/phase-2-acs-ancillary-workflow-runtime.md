# Phase 2 — ACS ancillary workflow runtime (PR 2.5)

## Goal

Make ACS ancillary work operational click-by-click. Each status is
derived honestly from canonical sources. No fake completion.

## Snapshot route

`GET /api/acs-workflow/:executionCaseId` — read-only. Requires the
portal-role session gate.

Returns:

```ts
{
  executionCaseId, patientName, facilityId, engagementStatus,
  statuses: AcsWorkflowStatus[],
  documentReadiness: [...],
  billingChecks: [...],
  nextScheduleEvent: { id, status, startsAt, serviceType } | null,
}
```

## Status derivation (honest)

| Status | Source | Honest rule |
|---|---|---|
| `assigned` | `patient_execution_cases.assignedTeamMemberId` | Present + not null |
| `scheduled` | next `global_schedule_events` row of type `ancillary_appointment` | row exists, status = `scheduled` / `rescheduled` |
| `confirmed` | same | row status = `confirmed` |
| `consent_needed` / `consent_signed` | `case_document_readiness[informed_consent].documentStatus` | "needed" when row missing OR status is not in the present set; "signed" only when status is in the present set |
| `screening_needed` / `screening_completed` | same logic, documentType = `screening_form` | |
| `report_needed` / `report_uploaded` | same logic, documentType = `report` | |
| `order_note_needed` / `order_note_present` | same logic, documentType = `order_note` | |
| `procedure_note_needed` / `procedure_note_present` | same logic, documentType = `post_procedure_note` | |
| `physician_signature_pending` | `order_note_present` AND no `physician_signed_order` row with present-status | Documented Phase 2 gap — no writer for `physician_signed_order` yet, so this status is the honest pending signal |
| `billing_readiness_pending` / `billing_ready` | `billing_readiness_checks.readinessStatus` | "ready" only when ALL rows have readinessStatus = `ready`; otherwise pending |
| `completed` | `procedure_events.procedureStatus = "completed"` AND billing_ready | Both must be true |

## What is honestly NOT yet wired

- **Physician order signing**: no `/api/portal/sign-order` endpoint
  exists. The ACS panel surfaces `physician_signature_pending`
  when the order note is present but no signed-order row exists —
  it does NOT fake a signed state. Deferred to Phase 2 follow-up
  or Phase 6 integrations.
- **Procedure complete writer**: `procedure_events` rows are written
  by the existing procedure events route (`server/routes/procedureEvents.ts`).
  The ACS panel reads them as-is; no fake completion.
- **Billing readiness writer**: existing
  `server/routes/billingReadiness.ts` is the canonical writer; the
  panel reads it. No fake "ready" state.

These gaps are NOT silently masked. The panel renders the pending
status visibly so an operator sees the truth.

## UI mount point

`PatientCommandCanvas` mounts `AcsWorkflowPanel` only when:

1. The workspace is ACS (`workspaceRole === "ancillaryCareSpecialist" || workspaceRole === "technician"`).
2. The patient has a linked `executionCaseId`.

The panel lives in the center canvas, not the left rail or right
rail.

## QA contract

- `qa-phase-2-acs-no-fake-completion.mjs` forbids any client-side
  fake "consent signed" / "report uploaded" / "completed" state in
  the panel or its wiring.
- `smoke-phase-2-acs-workflow-runtime.mjs` walks the chain.

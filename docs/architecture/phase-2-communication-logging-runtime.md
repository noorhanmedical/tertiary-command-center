# Phase 2 — Communication logging runtime (PR 2.8)

## Goal

Every outbound communication (email, marketing material, future SMS)
emits a journey event so it shows up in the patient timeline
without operators having to remember to log it.

## Server side

New service: `server/services/communication/communicationLogService.ts`.

`logPatientCommunicationEvent({ patientScreeningId, kind, …})`:

- Appends a `document_sent` row to `patient_journey_events`.
- `metadata.communication_kind` is one of `email`, `marketing_material`,
  `sms_scaffold`.
- Subject + recipient are recorded; email body is NOT (PHI hygiene
  — the timeline is an audit trail, not a content store).

## Wired writers

| Writer | What it logs |
|---|---|
| `POST /api/outreach/send-email` | kind `email`, subject, recipient, messageId |
| `POST /api/outreach/send-material` | kind `marketing_material`, materialId, materialTitle, subject, recipient |
| Call result (PR C + PR 2.2) | `call_result_logged` event — already wired |

SMS sending is still scaffolded — the Phase 2 plan keeps SMS dormant
(scaffold-only). When a real SMS sender lands, it will call
`logPatientCommunicationEvent({ kind: "sms_scaffold" | "sms" })`.

## Client side

`CommunicationTimeline` component reads from
`/api/patient-journey-events?patientScreeningId=:id` and filters to:

- `call_result_logged` events
- `document_sent` events whose `metadata.communication_kind` is set

Mounted in `PatientCommandCanvas` (center canvas only). Read-only.

## Anti-patterns guarded by QA

- No client-side "I just sent" toast that fires before the server
  has appended the journey event (the wiring is on the server
  side; the toast is fired from `onSuccess` which only fires on a
  2xx from the route).
- No journey event without a `communication_kind` (the writer
  guarantees it).

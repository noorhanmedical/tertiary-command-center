# Phase 2 — Document workflow expansion (PR 2.9)

## Goal

Wire upload → readiness → billing handoff in a single operator
action without inventing a new writer. Both halves use existing
canonical routes.

## Canonical writers preserved

- `POST /api/portal/uploads` — blob storage + `documents` row.
- `POST /api/case-document-readiness/complete` — readiness upsert +
  journey event + billing-readiness re-evaluation.

PR 2.9 does NOT add a parallel writer. It orchestrates the two.

## Server helpers (advisory)

- `server/services/documents/patientTestAttachmentService.ts` —
  pure `getNextAttachmentState(documentType)` returns the deterministic
  next state for a (patient, test, document type) attachment.
- `server/services/documents/documentWorkflowRuntime.ts` —
  `evaluatePatientTestAttachment(...)` reads current readiness rows
  and reports whether the attachment exists, which statuses are
  present, and whether it blocks billing.

These services are not yet bound to a route — they are reusable
helpers for future inline UIs.

## Client surface

`ReportUploadPanel` (in `client/src/components/portal/ReportUploadPanel.tsx`):

1. Operator picks a file.
2. POST to `/api/portal/uploads`.
3. On success, POST to `/api/case-document-readiness/complete` with
   `documentType: "report"`, `documentStatus: "uploaded"`.
4. Toast success + invalidate ACS workflow snapshot + command-center
   query.

Mounted in `PatientCommandCanvas` when:

- Workspace is ACS.
- The patient has both an `executionCaseId` AND a facility.

The panel reports honest stage labels (`uploading…`, `marking
readiness…`, `done`, `error`). No fake "Uploaded" toast when the
readiness write fails.

## Honest deferrals

- Per-test-attached upload: the panel currently uses `serviceType:
  "general"` because the PatientCommandCanvas does not yet thread the
  active test type into the canvas. A future PR can pass the test
  type per row when the operator picks a specific patient + test.
- Physician signing: still Phase 6 (`/api/portal/sign-order` not
  added).
- Versioning / supersede beyond what the existing readiness writer
  supports: out of scope for PR 2.9.

# Phase 1 AWS smoke-test runbook

**Status:** Docs-only (Batch H5 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-aws-smoke-test-runbook.mjs`.

Manual smoke-test pass after a staging deploy (per H3 runbook). Every
step is operator-run and check-mark recorded. The smoke is the gate
between "deployed" and "ready for use."

## Pre-conditions

- H3 deploy completed without errors.
- `sudo systemctl status tertiary` reports active (running).
- Operator has a staging Team Portal user account.

## Smoke sequence

### 1. Service health

- [ ] HTTP `GET /api/health` returns 200 within 2 seconds.
- [ ] No 5xx errors in the last minute of the app log
      (`sudo journalctl -u tertiary --since '1 minute ago'`).

### 2. Auth + facility scoping

- [ ] Log in as the test user.
- [ ] `/api/portal/my-facilities` returns the expected facility set.
- [ ] Hitting a patient outside the operator's facility returns 404,
      not 403 (Batch G §4 invariant).

### 3. Plexus IQ (protected — no behavior change expected)

- [ ] Open Plexus IQ workspace. Verify it loads.
- [ ] Confirm the qualification list shape matches the prior
      production behavior. ANY visual change halts smoke and is a
      regression.

### 4. Admin Review (protected — no behavior change expected)

- [ ] Open an Admin Review dialog. Verify it renders.
- [ ] Confirm reasoning, evidence, approve, regenerate, and reject
      controls all still present. ANY missing control halts smoke.

### 5. Team Portal cockpit

- [ ] Today's schedule loads at `/api/portal/today-schedule`.
- [ ] Outreach call list loads at `/api/portal/outreach-call-list`.
- [ ] My tasks load at `/api/portal/my-tasks`.

### 6. Disposition flow (E9 invariant)

- [ ] Open DispositionSheet for a real patient.
- [ ] Pick `scheduled`. Verify Logging completes (toast appears).
- [ ] Confirm the row updates in the patient call list within 5
      seconds (E10 invalidation).
- [ ] Confirm `/api/engagement-center/cases` reflects the change.
- [ ] Repeat for `callback` (with a callbackAt) and `no_answer`.

### 7. Optional: structured selector

When `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR=1` was set at build:

- [ ] DispositionSheet shows the structured-selector card below the
      legacy grid.
- [ ] Pick each of the 15 canonical outcomes; verify conditional
      inputs render for `scheduled`, `callback`, and the 5 outreach
      terminals.
- [ ] Submit a `callback`; verify call-list refresh.

### 8. Optional: call history (E7)

When `USE_PORTAL_CALL_HISTORY_READ=1` AND
`VITE_USE_PATIENT_CALL_HISTORY_READ=1`:

- [ ] Open a patient surface. Verify the call-history card appears.
- [ ] Verify previously logged attempts render with outcome, attempt
      number, started timestamp, callback (if any), notes.

### 9. Engagement → outreach delegation flags (default OFF)

- [ ] Confirm `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE=0` in the
      live env.
- [ ] Confirm `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE=0` in the
      live env.

### 10. Rollback escape valve

- [ ] Set `VITE_USE_LEGACY_DISPOSITION_WRITE=1` on a rebuild.
- [ ] Re-run §6 and verify the response shape matches the pre-E9
      legacy shape byte-for-byte (toast text, call-list refresh).

## Recording the smoke

- Save a `smoke-$(date -u +%Y%m%dT%H%M%SZ).md` checklist under your
  operator notes (NOT in the repo) with each box ticked or marked
  FAIL.
- Any FAIL halts the smoke. Roll back per the H3 runbook.

## What this runbook does NOT do

- Test claims / remittance / ERA / denial / payment-posting flows.
  Those are not in Phase 1.
- Test PDF generation behavior (protected; no change in Phase 1).
- Test Plexus IQ runtime behavior beyond rendering.
- Test Admin Review runtime behavior beyond rendering.

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[phase-1-aws-deploy-runbook]]
- [[phase-1-aws-backup-runbook]]
- [[team-portal-canonical-call-result-write-switch-plan]]
- [[team-portal-assigned-work-refresh]]

End of runbook.

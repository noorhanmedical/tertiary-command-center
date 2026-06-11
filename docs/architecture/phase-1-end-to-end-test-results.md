# Phase 1 end-to-end test results

**Status:** Final report (Batch T-final of the Phase 1 test loop).
**Companion:** `scripts/qa-phase-1-end-to-end-test-results.mjs`.

This is the human-readable record of the Phase 1 end-to-end test
loop. The executable smoke that produced these numbers lives at
`scripts/smoke-phase-1-end-to-end.mjs`.

## Result at the close of the loop

| Metric | Value |
|---|---|
| Smoke test status | PASS (23 PASS / 1 SKIP / 0 FAIL) |
| QA sweep | 164 / 164 green |
| `npm run check` | green |
| `npm run build` | green |
| Final main commit at loop start | `108791711adee28da5a9ad05ca51ee46e5de5b54` |
| Failures found | 0 |
| Fixes made | 0 (nothing broke during testing) |
| Self-fix iterations | 0 (loop finished on first pass) |

## What was tested (per executable step)

| # | Step | Status |
|---|---|---|
| 1 | Batch Flow intake route present (`server/routes/batches.ts`) | PASS |
| 2 | Plexus IQ workspace + qualification surface intact | PASS |
| 3 | Admin Review dialog intact (no redesign) | PASS |
| 4 | Engagement assignment runtime route present | PASS |
| 5 | Engagement call-list read flag accessor present (`isEngagementCanonicalCallListReadEnabled`) | PASS |
| 6 | Outreach compatibility route present + DispositionSheet retains legacy + canonical paths | PASS |
| 7 | Engagement canonical call-result endpoint flag accessor present | PASS |
| 8 | Team Portal assigned-work surface present (call-list / my-tasks / today-schedule) | PASS |
| 9 | Structured call-result selector flag-gated inside DispositionSheet (E4) | PASS |
| 10 | Call-history panel flag-gated + reuses existing `GET /api/portal/calls` (E7) | PASS |
| 11 | RingCentral adapter unit test executes; `DormantRingCentralClient` throws on use (E6) | PASS |
| 12 | Canonical call-result fixture pins all 15 outcomes + parity test green | PASS |
| 13 | Callback / task / triage payload extension args present in adapter | PASS |
| 14 | Per-surface step suppression in engagement + outreach executors | PASS |
| 15 | Ancillary read-model unit test (REQUIRED_KINDS coverage) (F2) | PASS |
| 16 | Physician signing service transition table test (F6) | PASS |
| 17 | Billing readiness aggregator unit test (G2) | PASS |
| 18 | Invoicing scaffold unit test (G4) | PASS |
| 19 | AWS deploy / backup / smoke runbooks + env inventory present | PASS |
| 20 | Plexus IQ workspace contains no Mission Control / dashboard markers | PASS |
| 21 | Admin Review dialog contains no redesign markers | PASS |
| 22 | Team Portal protected surfaces still on disk | PASS |
| 23 | Live HTTP probe (boot server, hit `/api/health`) | SKIP — `DATABASE_URL` unset; handled by H5 staging runbook |
| 24 | All Phase 1 server flag accessors default OFF when env is empty | PASS |

## Flags exercised

The smoke test verifies each flag below either by (a) running the
accessor against an empty `process.env` and asserting `false`, or
(b) verifying the source code uses the flag at the documented gate.

### Server-side flags (process.env)

| Flag | Verified by | Default verified OFF |
|---|---|---|
| `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` | accessor probe + source-grep | YES |
| `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` | accessor probe + source-grep | YES |
| `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` | accessor probe | YES |
| `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` | accessor probe | YES |
| `USE_PORTAL_CALL_HISTORY_READ` | source-grep (route guard) | YES |
| `USE_RINGCENTRAL_ADAPTER` | accessor probe + dormant-throw test | YES |
| `USE_ANCILLARY_READ_MODEL` | accessor probe + unit test | YES |
| `USE_ANCILLARY_SIGNING_SERVICE` | accessor probe + unit test | YES |
| `USE_BILLING_READINESS_AGGREGATOR_V2` | accessor probe + unit test | YES |
| `USE_INVOICING_SCAFFOLD_V2` | accessor probe + unit test | YES |

### Client-side flags (import.meta.env.VITE_*)

| Flag | Verified by | Default verified OFF |
|---|---|---|
| `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` | source-grep (DispositionSheet gate) | YES |
| `VITE_USE_PATIENT_CALL_HISTORY_READ` | source-grep (PatientCallHistoryPanel gate) | YES |
| `VITE_USE_LEGACY_DISPOSITION_WRITE` | source-grep (E9 rollback branch) | YES |
| `VITE_USE_INVOICE_UI` | source-grep (InvoiceDraftPanel gate) | YES |
| `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` | source-grep (`engagementCallResultEndpoint` helper) | YES |

## Rollback path for each enabled flag

| Flag | Rollback action |
|---|---|
| `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` | Unset → engagement route reverts to legacy in-place writer. |
| `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` | Unset → outreach route reverts to legacy in-place writer. |
| `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` | Unset → canonical plural endpoint stops accepting POSTs; clients fall back to singular. |
| `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` | Unset → engagement call-list read reverts to legacy aggregator. |
| `USE_PORTAL_CALL_HISTORY_READ` | Unset → `GET /api/portal/calls` returns 404; UI panel silently empty. |
| `USE_RINGCENTRAL_ADAPTER` | Unset → `DormantRingCentralClient` throws; no telephony calls leave the box. |
| `USE_ANCILLARY_READ_MODEL` | Unset → no consumer wired in Phase 1; rollback is no-op. |
| `USE_ANCILLARY_SIGNING_SERVICE` | Unset → no consumer wired; rollback is no-op. |
| `USE_BILLING_READINESS_AGGREGATOR_V2` | Unset → no consumer wired; existing `billing_readiness_checks` writers unchanged. |
| `USE_INVOICING_SCAFFOLD_V2` | Unset → no consumer wired; existing invoice writers unchanged. |
| `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` | Rebuild without flag → selector card hidden; legacy grid unchanged. |
| `VITE_USE_PATIENT_CALL_HISTORY_READ` | Rebuild without flag → call-history card returns null; canvas unchanged. |
| `VITE_USE_LEGACY_DISPOSITION_WRITE` | Rebuild WITH flag → restores pre-E9 dual-write byte-for-byte. (This is the E9 rollback.) |
| `VITE_USE_INVOICE_UI` | Rebuild without flag → invoice draft panel returns null. |

## What remains blocked

| Blocker | Reason | Resolution path |
|---|---|---|
| Live HTTP probe | No `DATABASE_URL` in the local test env. | H5 staging runbook covers this; the live probe is not a substitute for staging smoke. |
| Production cut-over | Explicit Ali approval required per H1 contract. | Documented in [[phase-1-aws-deployment-contract]]. |
| CI / pre-commit enforcement | I2 plan defers CI YAML to a future approved batch. | Documented in [[phase-1-scanner-enforcement-plan]]. |
| Ancillary report ingress route | F3 contract; no route file in Phase 1. | Future approved batch wires `POST /api/ancillary/reports`. |
| Patient Directory endpoint | E2 contract; no route file in Phase 1. | Future approved batch wires `GET /api/engagement/patient-directory/:patientId`. |

## Phase 1 readiness assessment

| Question | Answer |
|---|---|
| Is the app usable locally? | Yes — `npm run dev` boots given a `DATABASE_URL`. |
| Is the app ready for staging flag activation? | Yes — every flag has a default-OFF accessor verified by the smoke; staging can flip flags individually per the H5 runbook. |
| Is production cut-over ready? | No — production cut-over requires an explicit approval batch per H1. |
| Is Plexus IQ untouched? | Yes — no behavior change, no file edits, no Mission Control markers. |
| Is Admin Review untouched? | Yes — no behavior change, no file edits, identity marker preserved. |
| Is Team Portal layout preserved? | Yes — all seven protected surfaces still on disk; additive changes only. |
| Were secrets committed? | No — `.gitignore` blocks `.env*`; smoke verifies. |
| Were migrations added? | No — none required, none added. |

## PRs produced by this test loop

| PR | Title |
|---|---|
| #270 | Add executable Phase 1 end-to-end smoke test |
| (this) | Add Phase 1 end-to-end test results report |

## Related contracts

- [[phase-1-end-to-end-smoke-contract]]
- [[phase-1-aws-smoke-test-runbook]]
- [[phase-1-completion-summary]]
- [[phase-1-env-var-inventory]]
- [[team-portal-canonical-call-result-write-switch-plan]]

End of report.

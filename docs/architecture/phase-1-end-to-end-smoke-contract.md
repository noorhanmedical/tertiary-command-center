# Phase 1 end-to-end smoke contract

**Status:** Docs-only (Batch I1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-end-to-end-smoke-contract.mjs`.

Defines the single source of truth for "what does a Phase 1 release
need to demonstrate, end-to-end, before we declare Phase 1 done." The
H5 staging smoke is a step inside this contract; this contract pins
the full Phase 1 user journey from batch flow to invoice readiness.

## End-to-end journey scope (Phase 1)

1. **Batch Flow** — a new batch is ingested through the existing
   Plexus IQ batch flow. NO behavior change.
2. **Plexus IQ qualification + reasoning** — patients are
   qualified. Plexus IQ stays a read-model from Phase 1's view (no
   runtime change shipped by this program).
3. **Admin Review** — reviewer approves a qualified patient using
   the existing Admin Review surface. NO runtime change.
4. **Engagement Center handoff** — approved patient flows into the
   engagement assignment runtime (the prior `engagement_assignment_runtime`
   restoration is already in place).
5. **Team Portal cockpit** — a Team Portal user sees the patient in
   their assigned-work list (covered by E10 query invalidations after
   any disposition).
6. **RingCentral / call results** — disposition logged via
   DispositionSheet. E9 routes the primary write through the
   canonical Engagement endpoint. Legacy fallback (`VITE_USE_LEGACY_DISPOSITION_WRITE`)
   is the documented rollback.
7. **Ancillary workflow** — the patient's procedure runs, reports
   land in `documents`. F2 read-model surfaces blockers; F3 ingress
   contract and F5/F6 signing contract are dormant scaffolds.
8. **Documents** — uploaded reports / order notes / post-procedure
   notes follow the F3 + F4 contracts; the existing `documents` table
   stays the source of truth.
9. **Physician signing** — F6 signing scaffold encodes the
   state machine; no behavior change until a future approved batch
   wires it.
10. **Billing readiness** — G2 aggregator (V2, scaffold) computes a
    snapshot. G1 contract pins what readiness is and is not.
11. **Invoicing** — G4 scaffold projects a draft invoice from a
    ready snapshot + cash pricing. G5 panel scaffold is the UI slot
    placeholder.
12. **AWS staging deploy** — per H3 runbook, dist artifact shipped
    to staging EC2; H4 runbook for backup; H5 runbook for smoke.
13. **Smoke validation** — H5 checklist completed.

## What is NOT in the Phase 1 end-to-end

- Production cut-over.
- Live claims submission.
- ERA / remittance ingestion.
- Denial routing.
- Payment posting.
- Mission Control.
- New PDF output behavior.

## Invariants the smoke MUST preserve

- All 159+ QA scripts green on the deployed commit.
- All Phase 1 server flags default OFF in production.
- All Phase 1 VITE flags default OFF in production.
- Plexus IQ UI / runtime untouched.
- Admin Review UI / runtime untouched.
- Protected Team Portal surfaces (TeamPortalShell, PortalShell,
  PatientCommandCanvas, SchedulePatientPlayground, CallListPanel,
  DispositionSheet, CanonicalRowActions) still on disk and rendering.
- DispositionSheet still references `/api/outreach/calls` for the E9
  rollback path.
- engagementCallResultEndpoint() remains the canonical write helper.

## Smoke deliverables

- [ ] H5 staging smoke run logged (operator notes, OUTSIDE the
      repo).
- [ ] One end-to-end patient walked through steps 1 → 11.
- [ ] No regressions detected.

## Related contracts

- [[phase-1-aws-deployment-contract]]
- [[phase-1-aws-smoke-test-runbook]]
- [[phase-1-batch-flow-handoff-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]
- [[team-portal-canonical-call-result-write-switch-plan]]
- [[phase-1-ancillary-boundary-contract]]
- [[phase-1-billing-readiness-boundary-contract]]
- [[phase-1-invoicing-boundary-contract]]

End of contract.

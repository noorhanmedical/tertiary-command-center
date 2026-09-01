# Phase 9 — Billing Canonical Chain: Decisions and Validation

**Date:** 2026-08-25
**Status:** COMPLETE — validated locally

---

## Summary

Phase 9 enables the canonical billing readiness chain. Like Phases 2 and 6, this required zero new code — the entire billing readiness infrastructure was already implemented and flag-gated. Phase 9 scope: enable the full upstream dependency chain of flags + validate that Procedure Note signature triggers billing readiness evaluation.

---

## Files Modified

| File | Change |
|------|--------|
| `.env` | Added 7 upstream canonical flags required for `billingReadinessRuntimeEnabled()` |

No source code changes.

---

## Dependency Chain (from featureFlags.ts)

```
billingReadinessRuntimeEnabled() requires ALL of:
├── procedureNoteRuntimeEnabled() requires ALL of:
│   ├── FEATURE_CANONICAL_PROCEDURE_LIFECYCLE = true
│   ├── FEATURE_CANONICAL_PROCEDURE_NOTE = true
│   └── FEATURE_UNIFIED_ANCILLARY_DOCUMENTS = true
├── FEATURE_ANCILLARY_CASE_WRITE = true          (Phase 2 — already ON)
├── FEATURE_CANONICAL_APPOINTMENT = true          (Phase 9 — enabled)
├── FEATURE_CANONICAL_ORDER_NOTE = true           (Phase 9 — enabled)
└── FEATURE_CANONICAL_BILLING_READINESS = true    (Phase 9 — enabled)
```

All flags confirmed `true` via runtime check (`billingReadinessRuntimeEnabled() → true`).

---

## Flags Enabled in Phase 9

| Flag | Migration | Purpose |
|------|-----------|---------|
| `FEATURE_CANONICAL_APPOINTMENT` | 0052 | Canonical appointment linkage in global_schedule_events |
| `FEATURE_UNIFIED_ANCILLARY_DOCUMENTS` | 0053 | Ancillary document reference index |
| `FEATURE_CANONICAL_ORDER_NOTE` | 0053 | Canonical Order Note flow |
| `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE` | 0054 | Procedure event → ancillary case linkage |
| `FEATURE_CANONICAL_PROCEDURE_NOTE` | 0054 | Canonical Procedure Note eligibility + create |
| `FEATURE_PROCEDURE_NOTE_GENERATOR` | 0054 | Procedure Note body generation |
| `FEATURE_CANONICAL_BILLING_READINESS` | 0055 | Case-scoped billing readiness evaluator |

All migrations (0052–0055) were already applied to the local database.

---

## Design Decisions

### Decision 1: Enable entire upstream chain at once

The billing readiness gate requires every upstream canonical phase to be ON. Enabling them piecemeal would serve no purpose — partial enablement still results in `billingReadinessRuntimeEnabled() → false`. Since all migrations are applied and Phases 2–8 validated the data flow, enabling the full chain at once is safe.

### Decision 2: Not enabling FEATURE_CANONICAL_BILLING_DOCUMENT yet

The billing document generator (`FEATURE_CANONICAL_BILLING_DOCUMENT` + `FEATURE_BILLING_DOCUMENT_GENERATOR`) is the next layer beyond readiness. It requires readiness to be stable first. Keeping it OFF means billing readiness is evaluated but no billing documents are auto-generated yet. Manual billing workflows continue unchanged.

### Decision 3: Not enabling Phase 2J canonical claims/invoices/payments

`FEATURE_CANONICAL_CLAIMS`, `FEATURE_CANONICAL_INVOICES`, `FEATURE_CANONICAL_PAYMENTS` remain OFF. These are the financial lifecycle flags (migration 0056) and require the full billing document runtime to be validated first. Phase 10 will address these.

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with all billing chain flags ON | PASS |
| `billingReadinessRuntimeEnabled()` returns true | PASS |
| `procedureNoteRuntimeEnabled()` returns true | PASS |
| Sign Procedure Note (id=2) via physician portal | PASS — signature_status=signed |
| Billing readiness evaluation triggered on signature | PASS — billing_readiness_checks row created |
| Readiness status = `missing_requirements` (correct — consent etc. not done) | PASS |
| Existing billing UI/routes unaffected | PASS — legacy billing_records unchanged |

---

## How the Chain Fires

```
Clinician signs Procedure Note
  (POST /api/physician-portal/signature-items/:id/sign)
        ↓
signatureWorkflow.ts → signProcedureNote()
        ↓
syncNoteReference(updated, "signed")
        ↓
triggerBillingReadinessForCommittedCase({
  clinicId, ancillaryCaseId, source: "procedure_note_signed"
})
        ↓
billingReadinessRuntimeEnabled() === true?
        ↓ YES
Evaluate document requirements for the case:
  - informed_consent: required? status?
  - screening_form: required? status?
  - report: required? status?
  - order_note: required? status?
  - post_procedure_note: required? status?
        ↓
Write billing_readiness_checks row:
  - readiness_status = "missing_requirements" (if any doc incomplete)
  - readiness_status = "ready_to_generate" (if all docs pass)
  - missing_requirements = JSON array of what's missing
```

---

## Current State of Complete Chain (local dev)

| Phase | Flag(s) | Status |
|-------|---------|--------|
| 2A Identity | `PLEXUS_IDENTITY_WRITE` | ON ✓ |
| 2B Ancillary Cases | `ANCILLARY_CASE_WRITE` | ON ✓ |
| 2C Engagement | `ENGAGEMENT_MULTI_LIST_REPOSITORY` + 3 others | ON ✓ |
| 2D Appointments | `CANONICAL_APPOINTMENT` | ON ✓ |
| 2E Documents | `UNIFIED_ANCILLARY_DOCUMENTS` + `CANONICAL_ORDER_NOTE` | ON ✓ |
| 2F Procedure | `CANONICAL_PROCEDURE_LIFECYCLE` + `CANONICAL_PROCEDURE_NOTE` + `PROCEDURE_NOTE_GENERATOR` | ON ✓ |
| 2G Billing Readiness | `CANONICAL_BILLING_READINESS` | ON ✓ |
| 2G Billing Document | `CANONICAL_BILLING_DOCUMENT` | OFF (Phase 10) |
| 2J Claims/Invoices/Payments | `CANONICAL_CLAIMS` + `CANONICAL_INVOICES` + `CANONICAL_PAYMENTS` | OFF (Phase 10) |

---

## Next Phase

Phase 10 — Invoicing / Facility Timezone / Plexus Bank: Add timezone to clinics table, enable canonical billing document + claim/invoice/payment flags, define the Plexus Bank ledger model. The existing canonical financial schema (`canonicalInvoices.ts`, `canonicalFinancialTransitions.ts`) and Phase 2J flags exist — scope is assessment, enablement, and ledger model definition.

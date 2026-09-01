# Phase 10 — Invoicing / Facility Timezone / Plexus Bank: Decisions and Validation

**Date:** 2026-08-25
**Status:** COMPLETE — validated locally

---

## Summary

Phase 10 establishes three things:
1. Facility timezone support (clinics table extended)
2. Full canonical financial chain enabled (billing document + claims + invoices + payments)
3. Plexus Bank operational reconciliation ledger (new table + repository + routes)

---

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0060_add_clinic_timezone_and_plexus_bank.sql` | Created | DDL: add timezone/address/phone/active to clinics + create plexus_bank_events |
| `shared/schema/plexusBankEvents.ts` | Created | Drizzle table definition, enums, types |
| `server/repositories/plexusBank.repo.ts` | Created | Repository: CRUD + aggregation + reconciliation |
| `server/routes/plexusBank.ts` | Created | Route file with 5 endpoints |
| `server/routes.ts` | Modified | Import + registration |
| `shared/schema/index.ts` | Modified | Barrel export |
| `.env` | Modified | Added Phase 2G billing document + Phase 2J financial flags |

---

## Design Decisions

### Decision 1: Operational reconciliation ledger, not double-entry accounting

Per spec: "Do not implement formal double-entry accounting unless that requirement is explicitly introduced later." The Plexus Bank is an append-only financial event log where:
- Positive amounts = money received (payer payments, patient payments)
- Negative amounts = money paid out (facility obligations, vendor payments, refunds)
- Net balance = sum of all events for a scope
- Corrections = new events (recoupment, adjustment), never historical rewrites

### Decision 2: Append-only — no `updated_at` column

The `plexus_bank_events` table has `created_at` but deliberately no `updated_at`. Financial events are immutable records. The only mutable field is `reconciliation_status` (pending → reconciled), which stamps `reconciled_at` and `reconciled_by_user_id`.

### Decision 3: Separate event types for spec's four-way financial distinction

| Event Type | Meaning |
|-----------|---------|
| `payer_claim_payment` | Insurance pays the underlying claim |
| `patient_payment` | Patient pays their responsibility |
| `facility_obligation` | What Plexus owes the facility per contract |
| `plexus_allocation` | Plexus's share of collected revenue |
| `facility_payment` | Plexus actually pays the facility |
| `vendor_payment` | Plexus pays a third-party vendor |
| `adjustment` | Contractual adjustment |
| `refund` | Money returned |
| `write_off` | Uncollectable amount written off |
| `recoupment` | Payer claws back previously paid amount |
| `transfer` | Internal transfer between accounts |

This satisfies the spec's requirement: "Do not treat payer claim payment, facility obligation, and facility payment as the same financial event."

### Decision 4: Full lineage per event

Every bank event carries optional foreign keys to: `patient_screening_id`, `ancillary_case_id`, `service_type`, `invoice_id`, `invoice_payment_id`, `billing_record_id`. This enables the spec-required lineage: Bank Entry → Invoice → Claim → Service Episode → Patient.

### Decision 5: Facility timezone on clinics

Added `timezone TEXT DEFAULT 'America/Chicago'` to the `clinics` table. This is used for facility-local invoice cutoff calculations. Default is America/Chicago (matching the current production facility). Also added `address`, `phone`, and `active` columns for facility configuration foundations.

### Decision 6: All Phase 2J canonical financial flags enabled

The canonical claims/invoices/payments infrastructure (migration 0056) was already applied. All three flags (`FEATURE_CANONICAL_CLAIMS`, `FEATURE_CANONICAL_INVOICES`, `FEATURE_CANONICAL_PAYMENTS`) are now ON alongside the billing document flags. These gates are READ-ONLY read model endpoints — they don't execute external financial operations.

---

## Plexus Bank API Endpoints

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/api/plexus-bank/events` | Admin/Biller | List events with filters |
| GET | `/api/plexus-bank/events/:id` | Admin/Biller | Get single event |
| GET | `/api/plexus-bank/summary/:clinicId` | Admin/Biller | Facility balance summary |
| POST | `/api/plexus-bank/events` | Admin | Create event |
| POST | `/api/plexus-bank/events/:id/reconcile` | Admin | Mark event reconciled |

---

## Flags Enabled in Phase 10

| Flag | Purpose |
|------|---------|
| `FEATURE_CANONICAL_BILLING_DOCUMENT` | Case-scoped billing document lifecycle |
| `FEATURE_BILLING_DOCUMENT_GENERATOR` | Deterministic billing document generator |
| `FEATURE_CANONICAL_CLAIMS` | Canonical claim lifecycle from billing document |
| `FEATURE_CANONICAL_INVOICES` | Canonical invoice lifecycle from claims |
| `FEATURE_CANONICAL_PAYMENTS` | Canonical append-only payment ledger |

---

## Validation Results

| Test | Result |
|------|--------|
| Server starts with all financial flags ON | PASS |
| clinics.timezone = 'America/Chicago' | PASS |
| POST create payer_claim_payment event ($500) | PASS — id=1 |
| POST create facility_obligation event (-$250) | PASS — id=2 |
| GET summary for clinic 1 | PASS — totalReceived=500, totalPaidOut=250, netBalance=250, pending=2 |
| Reconciliation status tracking | PASS — default "pending" |
| Financial event lineage (ancillaryCaseId, serviceType) | PASS — linked to BrainWave case |

---

## Full Flag State (all phases)

| Category | Flags | Status |
|----------|-------|--------|
| Phase 2A Identity | `PLEXUS_IDENTITY_WRITE` | ON |
| Phase 2B Cases | `ANCILLARY_CASE_WRITE` | ON |
| Phase 2C Engagement | 4 engagement flags | ON |
| Phase 2D Appointments | `CANONICAL_APPOINTMENT` | ON |
| Phase 2E Documents | `UNIFIED_ANCILLARY_DOCUMENTS` + `CANONICAL_ORDER_NOTE` | ON |
| Phase 2F Procedure | `CANONICAL_PROCEDURE_LIFECYCLE` + `CANONICAL_PROCEDURE_NOTE` + `PROCEDURE_NOTE_GENERATOR` | ON |
| Phase 2G Billing | `CANONICAL_BILLING_READINESS` + `CANONICAL_BILLING_DOCUMENT` + `BILLING_DOCUMENT_GENERATOR` | ON |
| Phase 2J Financial | `CANONICAL_CLAIMS` + `CANONICAL_INVOICES` + `CANONICAL_PAYMENTS` | ON |

All runtime gate functions return `true`:
- `procedureNoteRuntimeEnabled()` → true
- `billingReadinessRuntimeEnabled()` → true
- `billingDocumentRuntimeEnabled()` → true
- `canonicalClaimsRuntimeEnabled()` → true
- `canonicalInvoicesRuntimeEnabled()` → true
- `canonicalPaymentsRuntimeEnabled()` → true

---

## Next Phase

Phase 11 — EMR Integration: Design the EMR connector layer. This is a BUILD phase with no existing code. Per the spec, this phase only begins after core canonical workflow is stable (Phases 1-10 complete). Phase 11 connects external EMR systems (starting with eClinicalWorks) to the Plexus EHR, which feeds into Plexus Findings and automatic qualification/requalification.

Phase 12 — Reporting + Legacy Retirement: Build reporting against the canonical model. Retire legacy components only after all callers are migrated and validated.

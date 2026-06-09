# Billing / invoice architecture cleanup — design (Batch 17a)

**Branch:** `architecture/batch-17a-billing-cleanup-design`
**Date:** 2026-06-09
**Scope:** Review + design only. No billing/invoice runtime change. No schema change. No migration. No new endpoint.

> Cross-reference: `docs/architecture/canonical-spine.md` §11, `docs/architecture/backend-route-parity-inventory.md` §9 (billing + invoice routes), `docs/architecture/full-21-batch-orchestrator-review.md` Batch 17.

---

## 1. Why this needs to happen

Today's billing architecture has four documented fragilities:

1. **Two parallel state machines exist with no DB-level alignment.** A `completed_billing_packages` row can be in `"invoiced"` while its `invoices` row is in `"Draft"`. There is no FK or trigger that ties the two state machines together.
2. **`GET /api/billing-records` is a read-as-write auto-create scan.** O(batches × patients × tests) on every read. Created billing records auto-default to `billingStatus: "Not Billed"`, `paidStatus: "Unpaid"`. Already wrapped by Batch 3c (PR #62) into `server/services/billing/billingRecordsService.ts`, but the underlying O(n³) cost is preserved verbatim.
3. **Several billing-domain concepts have no table:** **claims**, **remittances**, **denials**, **denial appeals**. `billing_records` carries denormalized charges + insurance response inline. Adjustment history, payer responsibility splits, and EOB tracking are lost.
4. **Revenue-share is a single percent column.** `projected_invoice_rows.projectedOurPortionPercentage` defaults to 50%. There is no per-payer, per-service, or per-clinic split rule. Conversion path from projected → real invoice line items is manual today.

The orchestrator's Batch 17 entry classifies this as **review-only first** — implementation requires a separate, gated batch (Batch 17b+) after the state-machine alignment plan has been reviewed by a second engineer.

---

## 2. The two state machines

### 2.1 `completed_billing_packages.packageStatus`

Declared at `shared/schema/completedBillingPackages.ts:12–19`:

```ts
export const PACKAGE_STATUSES = [
  "pending_payment",
  "payment_updated",
  "completed_package",
  "added_to_invoice",
  "invoiced",
  "closed",
] as const;
```

**Lifecycle (illustrative; no enforcement today):**

```
pending_payment
   │
   ▼
payment_updated   ←─── PaymentStatus changes
   │
   ▼
completed_package
   │
   ▼
added_to_invoice  ←─── added to a draft invoice's line items
   │
   ▼
invoiced          ←─── invoice marked sent
   │
   ▼
closed            ←─── invoice fully paid / closed
```

A SEPARATE `PAYMENT_STATUSES` enum (`not_received | pending | updated | disputed | reversed`) lives on the same table. It tracks the payment side, independent of the package's lifecycle. **Both enums are `text` columns** — there is no CHECK constraint enforcing the values; a typo writes silently.

### 2.2 `invoices.status`

Declared at `shared/schema/invoices.ts:8`:

```ts
export const INVOICE_STATUSES = ["Draft", "Sent", "Partially Paid", "Paid"] as const;
```

**Lifecycle:**

```
Draft                ←─── created via POST /api/invoices
   │
   ▼
Sent                 ←─── markInvoiceSent after email send
   │
   ▼
Partially Paid       ←─── invoice payment recorded, totalBalance > 0
   │
   ▼
Paid                 ←─── totalBalance reaches 0
```

The status transitions are computed by `storage.createInvoicePayment()` / `markInvoiceSent()` based on `totalBalance`.

### 2.3 How they drift

There is **no FK** between `completed_billing_packages` and `invoices`. The link is logical, via `projected_invoice_rows.realInvoiceLineItemId` → `invoice_line_items.id`. The two state machines can drift in these patterns:

- A billing package is marked `added_to_invoice` but the operator deletes the draft invoice. `packageStatus` stays `added_to_invoice` indefinitely.
- An invoice is marked `Sent` but the underlying packages are still `completed_package` (operator forgot to advance them). The invoice "exists" but the report says the patient is still pre-invoice.
- A payment is recorded on an invoice, but the package's `paymentStatus` doesn't get updated (separate manual write).

**Today's mitigation:** none. The drift is invisible until an operator notices a conflicting report.

---

## 3. Missing billing-domain tables

| Concept | Today | What's missing |
| --- | --- | --- |
| Claim | `billing_records.billingStatus` text field. | A `claims` table with payer, submitted_at, claim_id, original_charge_amount, version (for resubmissions). |
| Remittance | `billing_records.paidAmount / insurancePaidAmount / secondaryPaidAmount` flat columns. | A `remittances` table with EOB id, payer, paid_amount, adjustment_amount, denial_code, allowed_amount, posted_at. |
| Denial | none. | A `denials` table with denial_reason_code, payer-specific reason text, appeal status, appeal_due_at. |
| Appeal | none. | An `appeals` table tied to `denials.id`, with submitted_at, decision, decision_at. |
| Revenue share | `projected_invoice_rows.projectedOurPortionPercentage` (default 50%). | A `revenue_share_rules` table keyed on (facility_id, payer_id, service) with effective_from / effective_to dates. |

**None of these ship in this batch.** The design doc captures what they would look like.

### 3.1 Future table DDL (commented; NOT shipped as SQL)

```sql
-- Future: claims
-- CREATE TABLE claims (
--   id                  SERIAL PRIMARY KEY,
--   billing_record_id   INTEGER NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
--   payer_id            INTEGER REFERENCES payers(id) ON DELETE SET NULL,
--   claim_number        TEXT,                    -- external id from clearinghouse
--   version             INTEGER NOT NULL DEFAULT 1, -- 2,3,… for resubmissions
--   submitted_at        TIMESTAMP NOT NULL,
--   original_charge_amount NUMERIC(10,2) NOT NULL,
--   status              TEXT NOT NULL,           -- 'submitted' | 'accepted' | 'denied' | 'paid' | 'closed'
--   notes               TEXT,
--   created_at          TIMESTAMP NOT NULL DEFAULT now(),
--   updated_at          TIMESTAMP NOT NULL DEFAULT now()
-- );

-- Future: remittances
-- CREATE TABLE remittances (
--   id              SERIAL PRIMARY KEY,
--   claim_id        INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
--   eob_number      TEXT,
--   payer_id        INTEGER REFERENCES payers(id) ON DELETE SET NULL,
--   paid_amount     NUMERIC(10,2) NOT NULL,
--   adjustment_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
--   denial_code     TEXT,
--   allowed_amount  NUMERIC(10,2),
--   posted_at       TIMESTAMP NOT NULL DEFAULT now()
-- );

-- Future: denials
-- CREATE TABLE denials (
--   id              SERIAL PRIMARY KEY,
--   claim_id        INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
--   denial_reason_code TEXT NOT NULL,
--   payer_reason_text TEXT,
--   appeal_status   TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'appealed' | 'won' | 'lost' | 'expired'
--   appeal_due_at   TIMESTAMP,
--   created_at      TIMESTAMP NOT NULL DEFAULT now()
-- );
```

`payers` is itself a future master table (out of this batch's scope; analogous to the facility canonicalization in Batch 6).

---

## 4. State-machine alignment proposal

Two options, evaluated:

### Option A: typed transition writer (recommended)

A new `server/modules/billing/stateMachine.ts` exposes one function per legal transition. Existing code that writes `packageStatus` or `invoices.status` directly is migrated to call the transition functions. The functions enforce:

- The transition is legal (e.g., `"completed_package" → "added_to_invoice"` only when an invoice line item exists).
- The cross-machine constraint is satisfied (e.g., transitioning a package to `"invoiced"` only when its linked invoice's status is `"Sent"` or later).
- A `billing_state_transitions` audit row is written (append-only; new table).

**Pros:** Minimal schema change. Reversible by un-routing the transition calls. Catches drift at write time.
**Cons:** Requires migrating every write site (10+). The first batch that migrates a write site MUST include parity tests for the migrated call site.

### Option B: DB-level CHECK constraint

A constraint on `completed_billing_packages` that requires `(packageStatus, linked invoice status)` to obey a finite table of legal pairs.

**Pros:** Last-line-of-defense; impossible to drift while constraint holds.
**Cons:** Migration risk (ANY historical row violating the constraint blocks the migration). PostgreSQL CHECK constraints can't easily encode cross-table rules without triggers; triggers are expensive and surprising.

**Recommendation:** Option A. Ship the typed writer; defer the CHECK constraint until after every write site is migrated.

---

## 5. The `billing_records` auto-create scan

Batch 3c (PR #62) already wrapped the scan into `server/services/billing/billingRecordsService.ts`. The O(n³) cost is preserved verbatim. The cleanup path is:

### Phase 17b — move the scan to a write-only path

1. On every `commitPatient` → `qualifyingTests.length > 0` → enqueue a `billing_record_create_request` to the outbox.
2. A background worker drains the outbox and creates missing `billing_records` rows. Idempotent: a request for an already-existing `(patient_screening_id, service)` is a no-op.
3. `GET /api/billing-records` becomes a pure read: `storage.getAllBillingRecords()`.

### Phase 17c — purge the on-read fallback

Once 17b is stable for ≥ 30 days and metrics show the outbox handles the steady state, remove the scan logic from `billingRecordsService.ts`. The function becomes a simple `getAllBillingRecords()` passthrough.

**Rollback for 17b:** disable the outbox-write step; the on-read scan is still in place (it was preserved verbatim).

**Why deferred (not in 17a):** the outbox infrastructure (Batch 18) is a prerequisite. Until that ships, the read-as-write scan is the least-bad option.

---

## 6. Revenue-share rule expansion

Today: `projected_invoice_rows.projectedOurPortionPercentage` is a single column with 50% default. Future:

```sql
-- Future: revenue_share_rules
-- CREATE TABLE revenue_share_rules (
--   id            SERIAL PRIMARY KEY,
--   facility_id   INTEGER REFERENCES facilities(id) ON DELETE CASCADE,
--   payer_id      INTEGER REFERENCES payers(id)     ON DELETE CASCADE,
--   service       TEXT,                          -- nullable: applies to all services if NULL
--   our_share_percent NUMERIC(5,2) NOT NULL,     -- 0 to 100
--   effective_from DATE NOT NULL,
--   effective_to   DATE,                          -- nullable = ongoing
--   created_at    TIMESTAMP NOT NULL DEFAULT now()
-- );
```

The default 50% remains the fallback when no rule matches.

**Out of this batch's scope to implement.** Documented for completeness.

---

## 7. Feature flag

`BILLING_STATE_ALIGNMENT` (env var; default OFF).

- **OFF (today):** existing write paths run as-is. No transition writer. No audit row.
- **ON shadow:** transition writer is loaded; route handlers may call it OPTIONALLY. The audit row is written. The cross-machine constraint is checked and logged as a warning, but the write IS NOT rejected. Lets us calibrate.
- **ON enforced:** the cross-machine constraint REJECTS illegal transitions. Used in staging only until a soak period proves no false positives.

Three states; two phases. Implementation batches MUST ship the flag as OFF; turning it on is a separate ops decision.

---

## 8. Phased rollout

| Phase | Ships |
| --- | --- |
| **17a (this batch)** | Design + DDL (commented). |
| **17b** | Outbox-based billing-record auto-create. Requires Batch 18 (background jobs / outbox) as a prerequisite. |
| **17c** | Purge on-read scan from `billingRecordsService.ts`. |
| **17d** | Add `claims`, `remittances`, `denials` tables. No code yet — schema + types only. |
| **17e** | Implement `server/modules/billing/stateMachine.ts`. Shadow mode under `BILLING_STATE_ALIGNMENT`. |
| **17f** | Migrate write sites one at a time. Parity test per migrated site. |
| **17g** | Flip flag to enforced in staging; soak; flip in production. |
| **17h** | Add `payers` + `revenue_share_rules` tables; revenue-share UI.

Each phase is a separate PR with its own approval.

---

## 9. Compatibility rules

- **No invoice / billing-record endpoint changes response shape** in any of phases 17b–17g.
- **No state enum value renamed** until phase 17h (and even then, only if a deprecation period and a backfill plan are documented).
- **Audit log behavior is preserved.** The new `billing_state_transitions` audit table is additive; existing `audit_log` calls in `routes/billing.ts` and `routes/invoices.ts` stay.
- **The 14 MB base64 PDF cap** on invoice email (per `server/routes/invoices.ts:35`) stays — no relaxation.
- **The `requireBillerOrAdmin` middleware** stays. No role-gate change.
- **`storage.createInvoicePayment` and `storage.deleteInvoicePayment`** remain transactional. The state machine wraps them, never replaces them.

---

## 10. Hard protected areas

| Area | Touched by this design batch? | Touched by future implementation batches? | Mitigation |
| --- | --- | --- | --- |
| Patient qualification logic | no | no | Billing is downstream of qualification. |
| Plexus IQ qualification flow | no | no | Unaffected. |
| Plexus IQ import | no | no | Unaffected. |
| Admin Review reasoning behavior | no | no | Unaffected. |
| Supporting button assignment logic | no | no | Unaffected. |
| Canonical reasoning shape | no | no | Unaffected. |
| Plexus packets / Clinician packets / PDFs | no | no | PDFs read patient.reasoning; billing doesn't affect that. |
| Selected patient PDF actions | no | no | Unaffected. |
| Scheduler-to-patient assignment correctness | no | no | Billing is downstream of assignment. |
| Patient-to-scheduler assignment persistence | no | no | Unaffected. |
| Report/document source data used by PDFs | no | no | Unaffected. |
| **Billing / invoice correctness** | **no** (review only) | **yes in every phase** | Phase-by-phase parity tests; shadow-mode calibration; OFF flag default. |

---

## 11. Risks acknowledged

- **Cross-machine alignment can silently freeze invoices.** If the cross-machine rule rejects a legitimate transition (false-positive constraint), the operator can't move an invoice forward. Shadow mode (§7) exists exactly to surface false-positives before they block production.
- **Schema changes (17d, 17h) introduce new write paths.** Any new table needs its own audit-row emission contract. The matcher framework from Batch 7 is a useful template.
- **The on-read auto-create scan (today) protects against missed commit-time enqueues.** Removing it (17c) requires Batch 18's outbox to be production-grade. If 18 is not ready, 17c must NOT ship.
- **Revenue-share changes are PHI-adjacent.** A wrong split affects what the patient owes. Implementation must include a test fixture with known totals.
- **Existing data carries duplicate `packageStatus` typos.** The enforced flag will reject ANY value not in `PACKAGE_STATUSES`. A migration to normalize historical typos is required BEFORE flipping to enforced.

---

## 12. Rollback plan (per phase)

| Phase | Rollback |
| --- | --- |
| 17b (outbox scan) | Disable the outbox enqueue from `commitPatient`. The on-read scan still runs (unchanged from 3c). |
| 17c (purge on-read) | Restore the `listBillingRecordsWithAutoCreate` body from the pre-17c commit. |
| 17d (new tables) | Drop the three tables (no FK references from existing code in this phase). |
| 17e (transition writer) | Remove the `stateMachine.ts` invocation from route handlers; the writer file stays dormant. |
| 17f (migrated write sites) | Per-site revert; the writer stays in place. |
| 17g (enforced flag) | Set `BILLING_STATE_ALIGNMENT=0` (or `=shadow`). Existing rows stay; future writes return to shadow. |
| 17h (payers / revenue share) | Drop the new tables; restore the single-percent default. |

---

## 13. Stop conditions for follow-up batches

A future batch MUST stop and ask if:

1. Any phase ships before its named prerequisite is in production (e.g., 17c without 17b's outbox proven; 17d without 17e's transition writer; etc.).
2. A phase introduces a constraint that affects currently-existing data without a backfill / normalization plan.
3. A phase removes a write path before the new path has been parity-tested.
4. A phase changes the invoice email semantics (the email send is followed by `markInvoiceSent`; a race condition handled by the 409 response in the current code — must NOT regress).
5. The `requireBillerOrAdmin` middleware is loosened or removed.
6. The `INVOICE_STATUSES` or `PACKAGE_STATUSES` values are renamed or removed.
7. Revenue-share changes ship without a fixture-based test demonstrating the splits.

---

## 14. Cross-references

- `docs/architecture/backend-route-parity-inventory.md` §9 (full billing + invoice route inventory).
- `docs/architecture/canonical-spine.md` §11 (the two-state-machine drift).
- `docs/architecture/full-21-batch-orchestrator-review.md` Batch 17 + Batch 18 (the outbox prerequisite).
- `server/services/billing/billingRecordsService.ts` (Batch 3c — wrap of the auto-create scan).
- `shared/schema/completedBillingPackages.ts:12–29` (PACKAGE_STATUSES + PAYMENT_STATUSES).
- `shared/schema/invoices.ts:8` (INVOICE_STATUSES).

End of design.

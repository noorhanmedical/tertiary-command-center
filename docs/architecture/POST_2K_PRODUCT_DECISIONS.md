# Post-2K Product Decisions

Phase 2K is a **behavior-preserving** reliability/hardening phase. The items below would
change accepted business/lifecycle semantics (not reliability), so Phase 2K deliberately
did **not** alter them. Each is preserved exactly as accepted in Phases 2A–2J and recorded
here for an explicit product decision in a later phase. None blocks Phase 2K PASS.

For each: **current behavior**, **possible future behavior**, **risk/tradeoff**, **why 2K
did not silently alter it**.

## Financial semantics (preserve 2J)

1. **Refund does not free receipt allocation capacity** (`paymentCommands.receiptApplied`).
   - Current: `receiptApplied` sums all `apply` allocations; refunds/reversals do not add capacity back, so a refunded allocation still consumes the receipt remainder.
   - Future: return refunded capacity to the receipt so it can be re-applied.
   - Tradeoff: current behavior is conservative (can only under-allocate, never over-allocate); returning capacity requires a defined re-application model + audit.
   - Why not 2K: changes accepted allocation-capacity semantics; not a reliability defect.

2. **`adjustment` allocation event type has no command path** (`allocationLineage`).
   - Current: schema allows `adjustment`; the validator fail-closes it (never silently reduces owed).
   - Future: an approved adjustment command (fee waiver / write-off) with provenance + a defined balance sign.
   - Tradeoff: introduces new money-moving semantics needing authorization + accounting rules.
   - Why not 2K: new product semantics; fail-closed today.

3. **Explicit overpayment / credit ledger** (`is_overpayment` flag only).
   - Current: allocation carries `is_overpayment`; no first-class overpayment/credit surface.
   - Future: a first-class overpayment/credit ledger with refund-to-source or credit-forward.
   - Tradeoff: new financial model + reconciliation surface.
   - Why not 2K: new product model.

4. **Imported processor/remittance receipts post directly** (`recordCanonicalPayment`).
   - Current: a validated import command inserts `status:"posted"`.
   - Future: map `IMPORT_TYPES` → `imported` (non-collected, pending reconciliation) before `posted`.
   - Tradeoff: adds a reconciliation lifecycle stage; changes when imported money is considered collected.
   - Why not 2K: changes receipt lifecycle semantics.

5. **Full refund reopens a claim to `submitted`** (`paymentCommands.negateAllocation`).
   - Current: a fully-refunded claim reopens to `submitted` (never creates false `paid`).
   - Future: reopen to the pre-payment status captured at allocation time (e.g. `accepted`).
   - Tradeoff: preserves adjudication state but requires capturing/restoring pre-payment status.
   - Why not 2K: changes reopening semantics; no false money today.

6. **Refunded-then-repaid shows `paid` with no residual-refund stage signal** (`caseStageVector`).
   - Current: `paid` when `netApplied === total` even after a refund+re-pay; the read-model invoice balance still exposes `refundedAmount`.
   - Future: a stage-level residual-refund signal.
   - Tradeoff: matches the accepted "only outstanding matters for completion" rule; no data lost.
   - Why not 2K: truthfulness nuance, not a reliability defect.

## Access / scope

7. **Admin clinic-scope for Clinician Portal / PCS / ACS.**
   - Current: admins have `clinicId=null` → `requireClinicScope` returns 403 (fail-closed; pinned by tests).
   - Future requirement: admin access requires an **explicit authenticated server-controlled clinic selection context** — never `?clinicId=`, `body.clinicId`, or any client-supplied override.
   - Tradeoff: broadening access without a validated server-side selection contract would be a tenant-boundary risk.
   - Why not 2K: 2K must not add client-supplied clinic IDs or broaden admin access silently; current 403 is safe.

## Identity / schema

8. **Report↔case exact identity (schema-limited).**
   - Current: `case_document_readiness` has no `ancillary_case_id`; `validateReportRef` binds a report reference to a case via `executionCaseId` (and clinic/service/documentType/current status), which is the strongest the schema allows.
   - Future: add `ancillary_case_id` (or a deterministic join) for a fully exact report↔case binding.
   - Tradeoff: schema redesign + backfill of the new column.
   - Why not 2K: requires a business/schema redesign (explicitly out of scope).

## Telemetry / backfill scope

9. **Backfill apply re-evaluation of stale-but-existing readiness/documents.**
   - Current: apply only queues no-current-row candidates; stale-but-existing rows are reported as existing and not re-applied (the live orchestration hook supersedes on evidence change).
   - Future: apply always re-evaluates (evaluator is idempotent + supersedes).
   - Tradeoff: changes backfill apply scope; the live path already prevents silent staleness.
   - Why not 2K: 2K does not execute backfill apply and does not broaden apply scope.

10. **Deterministic-link apply outcome granularity.**
    - Current: coarse `apply_deferred` outcome for link-completed-but-report-missing cases.
    - Future: finer per-action telemetry (counts of link-only vs fully-applied).
    - Tradeoff: operator-dashboard design.
    - Why not 2K: telemetry/product-surface design.

---
These rows are `PRODUCT_DECISION_REQUIRED` in `PHASE_2K_EXECUTION_MATRIX.md`. Phase 2K
preserves each exactly; a later product/UX phase decides them.

# Billing / invoice hard-stop map

**Status:** Docs-only (Bundle 29). No code added. No runtime change.
**Date:** 2026-06-09.
**Scope:** Enumerate every file, table, field, calculation, and route that constitutes the money-sensitive surface of the platform so future architecture PRs can:

- prove their changes do not touch the surface, OR
- if they must, route through an explicitly approved money-PR with a different review bar.

**Cross-references:**
- `do-not-touch.md` (general hard-stop file list — this doc is the money-specific complement).
- `protected-flows.md` (billing/invoice flows listed as load-bearing).
- `billing-cleanup-design.md` (Batch 17a, PR #68 — the conceptual cleanup plan).
- `pdf-protection-contract.md` (the billing-document PDF is part of this surface).
- `team-portal-playground-wiring-contract.md` §22 (financial data forbidden in Team Portal / Playground).
- `tests/fixtures/billingPacketArchitecture.fixture.ts` (Bundle 28 — pins the architecture-only surface).

This document does NOT design the cleanup. It is a directory of what must not move without an explicit money-PR.

---

## 1. Money-sensitive route files

Every endpoint in these files is treated as money-sensitive. A safe-bundle PR MUST NOT edit any of these files except to add a comment or to change a code path that is provably non-money (e.g. a render-only helper that the QA loop can prove ignores all money columns). When in doubt: STOP.

- `server/routes/billing.ts` — `billing_records`, `billing_documents` adjuncts; `GET /api/billing-records` read-as-write auto-create scan; bulk send, status transitions.
- `server/routes/invoices.ts` — invoice CRUD, line items, payments, projected → invoiced rollovers.
- `server/routes/projectedInvoices.ts` — projected-invoice generation, reconciliation against `completed_billing_packages`.
- `server/routes/billingDocuments.ts` — billing-document requests, status transitions, AI-generated billing notes.
- `server/routes/completedBillingPackages.ts` — package status transitions, payment status transitions, payment amount updates.
- Future: any new route under `server/routes/billing*.ts` or `server/routes/invoice*.ts`.

---

## 2. Money-sensitive schema files

A safe-bundle PR MUST NOT edit these schema files. Adding columns, changing column types, renaming columns, or adjusting indexes is money-PR territory.

- `shared/schema/billing.ts` — `billing_records`.
- `shared/schema/billingReadiness.ts` — `billing_readiness_checks` (architecture surface only; see §3).
- `shared/schema/billingDocuments.ts` — `billing_document_requests`, generated billing notes.
- `shared/schema/completedBillingPackages.ts` — `completed_billing_packages` (carries `fullAmountPaid`, `paymentStatus`, `paymentDate`).
- `shared/schema/invoices.ts` — `invoices` + line items.
- `shared/schema/projectedInvoices.ts` — `projected_invoices` + projection metadata.

---

## 3. Architecture-surface columns (safe to read, NOT safe to write)

Some columns on the money-bearing tables describe the architecture surface (status, lifecycle, identifiers) and are safe to READ in additive bundles. The Bundle 28 fixture pins these. Writes to ANY column on these tables remain money-PR territory.

Safe-to-read architecture columns:

| Table | Architecture-surface columns | Why they are safe to read |
|---|---|---|
| `billing_readiness_checks` | `id`, `executionCaseId`, `patientScreeningId`, `procedureEventId`, `serviceType`, `readinessStatus`, `missingRequirements`, `metadata.evaluatedDocs` | Readiness lifecycle — already pinned in `tests/fixtures/billingPacketArchitecture.fixture.ts`. |
| `billing_records` | `id`, `executionCaseId`, `serviceType`, `status` | Aggregate counts only. Never read amounts in a safe bundle. |
| `completed_billing_packages` | `id`, `executionCaseId`, `procedureEventId`, `serviceType`, `packageStatus`, `dos` | Status lifecycle. |
| `invoices` | `id`, `facilityId`, `status` | Status lifecycle. |
| `projected_invoices` | `id`, `facilityId`, `status` | Status lifecycle. |

Money-bearing columns (NEVER read by a safe bundle, NEVER written):

- `completed_billing_packages.fullAmountPaid`, `paymentStatus`, `paymentDate`, `paymentUpdatedByUserId`, `paymentUpdatedAt`.
- `invoices.totalAmount`, `taxAmount`, `discountAmount`, `netAmount`, any per-line `amount` / `unitPrice` / `quantity`.
- `projected_invoices.projectedAmount`, `projectedNetAmount`, any projection multipliers.
- `billing_records` columns that contribute to dollar totals (CPT-code unit prices, modifiers that affect reimbursement, etc.).

When unsure whether a column is "architecture" or "money", treat it as money.

---

## 4. Calculations that are out of scope for safe bundles

Any change to the following calculations is money-PR territory and MUST stop a safe bundle:

1. **Billing-readiness verdict** — the rule in `server/repositories/billingReadiness.repo.ts:113-121`. Bundle 26 + Bundle 27 + Bundle 28 LOCK the rule but do not change it. A future PR that touches the rule must justify the change against the locked fixtures.
2. **Claim amount derivation** — any code that turns a procedure + CPT into dollars.
3. **Remittance allocation** — any code that splits an incoming payment across line items, invoices, or packages.
4. **Denial / dispute handling** — any code that changes a package or invoice to `disputed`, `reversed`, or any non-happy-path status that affects revenue.
5. **Invoice / line-item generation** — converting completed packages into invoice rows; computing tax, discounts, or net.
6. **Projected-invoice rollovers** — moving rows from `projected_invoices` to `invoices` and reconciling against `completed_billing_packages`.
7. **Revenue-share calculations** — splitting amounts across organisations / facilities / contractors.
8. **Payment update writes** — `paymentStatus`, `paymentDate`, `fullAmountPaid`, `paymentUpdatedByUserId` on `completed_billing_packages`.

---

## 5. Money-sensitive UI surfaces

These client surfaces render money values. A safe bundle MUST NOT edit them. UI redesigns for these surfaces require a separate UI PR.

- `client/src/pages/billing.tsx` (or equivalent) — billing list.
- `client/src/pages/invoices.tsx` (or equivalent) — invoice list / drill-in.
- `client/src/pages/projected-invoices.tsx` — projected-invoice list / drill-in.
- Any component under `client/src/components/billing/*`.
- Any component under `client/src/components/invoices/*`.
- Any component that imports a money type from `@shared/schema/billing*` or `@shared/schema/invoices*`.
- The Team Portal / Playground envelope from `team-portal-playground-wiring-contract.md` §22 — financial data is FORBIDDEN inside the portal / Playground.

---

## 6. PDF surfaces that touch money

The Plexus PDF and Clinician PDF (`client/src/lib/pdfGeneration.ts`) intentionally omit money information. The **billing document PDF** (the AI-generated billing note flow under `server/routes/billingDocuments.ts`) DOES carry money. Both PDF families are governed by `pdf-protection-contract.md`. A safe bundle MUST NOT touch either family.

---

## 7. Stop conditions for a safe-bundle PR

A safe-bundle PR MUST stop and ask if:

1. It would edit any file listed in §1, §2, or §5.
2. It would write any column listed in §3 (read-only architecture columns are safe; writes are not).
3. It would change any calculation listed in §4.
4. It would alter any money-bearing field in a fixture (the Bundle 28 fixture's runtime guard catches this).
5. It would render a money value on a Team Portal / Playground surface.
6. It would log a money value, payment ID, claim ID, or invoice amount (PHI-safe logger contract, Bundle 8).
7. It would change the billing-document PDF body.
8. It would add a NEW money-bearing table, column, or route.
9. It would remove a money-bearing path under the guise of cleanup. Removal of money paths is its own audit-trail event.

---

## 8. Allowed money-adjacent work for safe bundles

The following IS safe-bundle territory (subject to standard architecture-doc rules):

- Read-only fixtures of the architecture surface (Bundle 28).
- Read-only modules / pure helpers that consume the architecture surface (Bundle 27).
- Docs that map the money surface (this document).
- QA invariants that catch drift on the money surface (any of the existing dormancy / parity QA scripts).
- PHI-safe logger contracts that affect billing log emission shape (Bundle 8 / PR #89).

A safe bundle may CITE money fields by name to enumerate them (this document does so in §3) but MUST NOT read, write, or compute against them at runtime.

---

## 9. Audit trail expectations

Any future money-PR MUST:

1. Cite §1, §2, §3, or §4 in the PR description.
2. Attach test evidence that no field outside the cited scope changed.
3. Include a runtime parity test against a fixed canned input (the Bundle 28 fixture + a money-PR-specific fixture).
4. Pass code review by an explicitly named money-territory reviewer.

This contract does not name reviewers. It pins the audit-trail shape.

End of map.

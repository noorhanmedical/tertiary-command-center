# Phase 2J — Canonical claims, invoices, and payments

Extends the canonical lifecycle from signed Procedure Note → billing readiness →
Billing Document → **claim → invoice → payment**, reusing the exact Phase 2A–2I
canonical identities (clinic, ancillary case, service, Billing Document,
billing-readiness, evidence fingerprint, exact reference ids). Read-only-by-default,
clinic-scoped, behind default-OFF flags. Additive migration 0056 (unapplied).

## Current-state financial audit

- **Claims — none exist.** Claim-adjacent data lives only as `claim_blockers` +
  `claimSubmissionReady` on the Phase 2G `canonical_billing_readiness_checks` and
  `canonical_billing_document_requests`. There is no claims table, no clearinghouse/
  837/x12 integration, and no claim status vocabulary. The Finance page's "claims"
  are MOCK (`client/src/components/physician/mockData.ts` `Claim`).
- **Invoices — Phase 4, operational.** `invoices` (+ `invoice_line_items`,
  `invoice_payments`, `invoice_batches`, `invoice_readiness_snapshots`,
  `invoice_delivery_events`, `invoice_adjustments`, `invoice_denials`,
  `remittance_events`, `projected_invoice_rows`). These are EXECUTION-CASE /
  FACILITY-BATCH anchored (the operational "invoice desk"), created from
  `billing_records`. Statuses: legacy `Draft/Sent/Partially Paid/Paid`, approval
  `draft/pending_review/approved/voided/revised`, delivery `pending/…/sent/failed`.
  Roles: admin|biller. This is a genuinely DIFFERENT entity from a canonical
  ancillary-case, evidence-versioned invoice.
- **Payments — Phase 4, per-invoice manual.** `invoice_payments` (per invoice,
  positive amounts, `method` label only — NO processor integration, NO idempotency
  key, NO external transaction id, NO currency column, NO append-only ledger).
  `remittance_events` is a payer-originated inbound log; `invoice_adjustments` /
  `invoice_denials` are soft events. `invoices.total_paid` is a DENORMALIZED mutable
  column (not summed from the ledger).
- **Money.** Postgres `NUMERIC(12,2)` (invoices) / `NUMERIC(10,2)` (billing_records),
  returned as decimal STRINGS; app uses `num()` = `parseFloat` + epsilon `0.005`
  comparisons; client `formatCurrency` = `parseFloat`. No integer-cents convention.
- **Finance surface.** `client/src/components/physician/finance/FinancePage.tsx`
  (route `/clinician-portal`, role gate `hasFinanceAccess`, protectedUi=true, NOT an
  approvedException) already flag-branches on `VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA`
  → `CanonicalFinancePage` (Phase 2H, operational readiness only, explicitly NO
  claims/invoices/payments) vs `LegacyFinancePage` (renders MOCK claims/invoices/
  payments from `usePortalData`).
- **Auth/tenancy.** `requireBillerOrAdmin` / `requireAdminOrBiller`; clinic scope
  from `req.clinicId` (canonicalBilling) — never body/query.

## Exact existing meanings (never merged)

- **Phase 4 invoice** = an operational, execution-case/facility-batch invoice sent
  from the invoice desk. **Canonical (2J) invoice** = an ancillary-case, evidence-
  versioned invoice derived from a canonical claim. These are DISTINCT and coexist;
  2J never rewrites or reads Phase 4 invoices.
- **Phase 2G Billing Document** = an internal operational packet — NEVER a claim,
  invoice, remittance, or payment. A canonical claim is a NEW downstream entity
  built FROM the exact current Billing Document evidence version.

## Migration decision — 0056 required (additive, unapplied)

No claims table exists, and the canonical invoice/payment differ in identity axis
(ancillary-case + evidence-version) and semantics (attempt versioning, append-only
ledger, idempotency, external txn ids, currency) from the Phase 4 operational
tables. Extending the Phase 4 tables would conflate two different entities, so
`migrations/0056_add_canonical_claim_invoice_payment_lifecycle.sql` adds THREE new
canonical tables + widens the PHI-free retry ledger. It is additive-only, nullable
for transitional ownership, protected by partial-unique current-row indexes, safe
while all Phase 2J flags are OFF, non-destructive, and NOT applied automatically.
Rollback notes are in the SQL header. (If the lifecycle could not be represented
safely additively, this doc would STOP and report the blocker — it can, so it does
not.)

## Canonical financial identity & evidence lineage

Every canonical financial record anchors on: authenticated `clinicId` (server
context), exact `ancillaryCaseId`, exact `serviceType`, the exact current
`billingDocumentId` + `billingReadinessCheckId`, and a NON-EMPTY `evidenceFingerprint`,
plus exact `orderNote/report/procedureNote` reference ids and `procedureEventId`
where persisted. Patient display resolves ONLY through a verified active
`patientClinicMembershipId` (never a bare global id). Repeated same-service
ancillary cases remain separate financial episodes; a claim/invoice/payment from
one `ancillaryCaseId` never satisfies another.

Version agreement is REQUIRED and symmetric: a claim binds to exactly one current
non-superseded readiness + Billing Document with equal non-empty evidence
fingerprint and agreeing reference ids; an invoice binds to exactly one current
claim of the same case/service/evidence version; a payment allocates only to a
claim/invoice of the same clinic + case. More than one supposedly-current record
→ integrity conflict (never first/last/newest).

## Claim-readiness contract

`claimReady=true` only when: exact clinic/case/service ownership; exactly one
current readiness AND one current Billing Document, bound by
`billingReadinessCheckId` + equal non-empty `evidenceFingerprint` + agreeing exact
order-note/report/procedure-note reference ids (symmetric); readiness permits claim
progression; and `claim_submission_blockers` is empty. Billing-ready ≠ claim-ready.
Missing coding/payer/provider/facility/amount data remains a PHI-free blocker code;
no CPT/HCPCS/ICD/modifier/units/POS/NPI/payer/amount is ever invented.

## Claim state machine

`not_ready → ready → draft → queued → submitted → accepted → rejected → denied →
partially_paid → paid → voided → superseded`. One current claim attempt per exact
Billing Document evidence version; submitted claims immutable; corrections create a
new attempt with exact `supersedesClaimId` lineage; evidence change supersedes an
unsubmitted draft (never a submitted historical claim); duplicate create/queue is
idempotent (idempotency key); concurrent create converges on one current draft;
unsupported transitions → 409 conflict; `submitted` requires an exact
source/attestation (no fake clearinghouse ack). No real transmission adapter
exists, so readiness/draft/queued are internal-only and the transmission boundary
is documented (§ external boundary).

## Invoice state machine

`draft → approved → issued → delivered → partially_paid → paid → voided →
superseded / delivery_failed`. Issued invoices immutable; corrections create a new
version/credit; concurrency-safe invoice numbers; exact recipient (never name/email
fallback); no `delivered` without an exact delivery event; no `paid` without exact
allocated payment evidence; patient responsibility never inferred (estimate vs
billed vs allowed vs payer vs patient vs collected vs balance kept distinct;
estimate never shown as a finalized obligation).

## Payment ledger & balance invariants

Append-only ledger of `payment/refund/reversal/adjustment` events (`paymentType`
patient/payer/manual/processor_import/remittance_import — only sources the repo
represents). Requires clinic, currency, amount, received/posted timestamp, source,
external txn id when available, actor/importer, idempotency key, type, status.
Duplicate external txn / idempotency key → idempotent; posted payments immutable
(refund/reversal are NEW events); currency must match the target; allocation
cannot exceed the payment amount or the target outstanding unless explicit
overpayment. Balances are DERIVED from the ledger (original / adjustments / paid /
refunded / reversed / unapplied / outstanding / overpayment), computed in
integer cents (no float drift); conflicting ledger → integrity conflict (never
silently newest, never forced zero/paid). No clinic/Plexus revenue split, partner
commission, or profit distribution.

## Authorization & tenancy

Financial mutations: biller|admin only (payments/refunds not broader than
invoices). Reads: biller|admin (clinician financial visibility only where already
authorized — the 2H Clinician Portal Finance stays operational-readiness-only).
`clinicId` from `req.clinicId` only; missing/unknown role → 403; missing scope →
403; cross-clinic → denied/not-found without disclosure; no financial details or
payment credentials in logs/audit/retry rows.

## Feature flags (all default OFF)

Server: `FEATURE_CANONICAL_CLAIMS`, `FEATURE_CANONICAL_INVOICES`,
`FEATURE_CANONICAL_PAYMENTS`, `FEATURE_CANONICAL_CLAIM_TRANSMISSION` (present but
gates nothing beyond an explicit "no transmission adapter" boundary — it does NOT
imply transmission exists). Client: `VITE_FEATURE_CANONICAL_CLAIMS`,
`VITE_FEATURE_CANONICAL_INVOICES`, `VITE_FEATURE_CANONICAL_PAYMENTS`. No Phase 2J
flag auto-enables an upstream flag; each read model reports `upstream_flag_off`
truthfully.

## External-operation boundary (explicitly EXCLUDED)

No real claim transmission, clearinghouse contact, card charge, ACH, refund
execution, payment posting to a processor, invoice email/statement delivery, or
collections. A `submitted/accepted/rejected/denied/delivered/paid/refunded` status
is persisted ONLY from an exact authorized source event or manual attestation with
source/reference/reason — never from a prototype button click. Any such external
integration requires a separately approved, tested adapter and is out of scope.

## Intentionally changed protected UI files

- `client/src/components/physician/finance/FinancePage.tsx` (protectedUi) — adds a
  Phase 2J flag branch that replaces the LEGACY mock claim/invoice/payment rows with
  the canonical financial view; flag OFF renders the exact prior behavior. Manifest
  blob updated via the sanctioned mechanism.

No homepage / PCS / ACS / Clinician Portal / existing Billing workspace redesign.

## Retries & backfill

PHI-free retry ledger widened with Phase 2J actions
(create_claim_from_billing_document, link_claim_to_billing_document,
record_claim_submission_result, create_invoice_from_exact_source,
link_invoice_to_claim, reconcile_invoice_balance, apply_payment_allocation,
reconcile_payment_reversal); worker bounded, flag-gated, exact-failure-only, never
run in apply mode here. `script/backfillCanonicalClaimsInvoicesPayments.ts` is
dry-run by default (zero writes, bounded, PHI-safe, deterministic); apply requires
`BACKFILL_CANONICAL_FINANCIAL_APPLY=YES` + every flag and is never executed.

## Unresolved integration blockers

External claim transmission, invoice delivery, and payment processing have NO
tenant-safe adapter in the repo; those states are gated behind explicit
authorized-source/attestation entry and the documented boundary. Not a phase
blocker — readiness/draft/queued/internal states are fully implemented.

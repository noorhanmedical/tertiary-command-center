// Phase 2J closeout — canonical financial COMMAND lifecycle behavioral tests.
// Real transactional writes: claim/invoice draft·transition·correction and payment
// receipt·allocation·refund·reversal. Idempotency, concurrency convergence,
// submitted/issued immutability, exact evidence, allocation bounds, refund/reversal
// limits, tenancy, and audit provenance.
//
//   npx tsx tests/unit/canonicalFinancialCommands.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const cs = () => import("../../server/services/canonicalFinancial/commandSupport");
const claimCmd = () => import("../../server/services/canonicalFinancial/claimCommands");
const invoiceCmd = () => import("../../server/services/canonicalFinancial/invoiceCommands");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");

const OLD = new Date("2027-06-10T09:00:00Z");
const ALL = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;

// ── fixtures ──
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, claimBlockers: [], warnings: [], ...o }; }
// Field-specific provenance: each required field carries {value, sourceType} where
// sourceType is approved FOR THAT FIELD (a fee schedule can't prove payer/provider).
function chargeFields() {
  return {
    service_code: { value: "S", sourceType: "approved_fee_schedule" }, units: { value: "1", sourceType: "approved_fee_schedule" },
    place_of_service: { value: "11", sourceType: "facility_registry" }, facility: { value: "F", sourceType: "facility_registry" },
    rendering_provider: { value: "RP", sourceType: "credentialing_registry" }, billing_provider: { value: "BP", sourceType: "credentialing_registry" },
    payer: { value: "P", sourceType: "payer_contract" }, coverage_reference: { value: "C", sourceType: "payer_contract" },
  };
}
function charge(o: Record<string, unknown> = {}) { return { amountSource: "approved_fee_schedule", currency: "USD", chargeAmount: "420.00", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], fields: chargeFields(), ...o }; }
function docRow(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, globalPlexusPatientId: 900, patientClinicMembershipId: 800, sourceData: { claimCharge: charge() }, ...o }; }
const CLAIM_FIELDS = Object.fromEntries(Object.entries(chargeFields()).map(([f, c]) => [f, (c as { value: string }).value]));
const CLAIM_PROV = Object.fromEntries(Object.entries(chargeFields()).map(([f, c]) => [f, { sourceType: (c as { sourceType: string }).sourceType, sourceId: null }]));
function claimRow(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", attemptNumber: 1, supersededAt: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, currency: "USD", chargeAmount: "420.00", amountSource: "approved_fee_schedule", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], claimFields: CLAIM_FIELDS, fieldProvenance: CLAIM_PROV, submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: "REF-1", submissionReason: "attested", globalPlexusPatientId: 900, patientClinicMembershipId: 800, ...o }; }
function invoiceRow(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "issued", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", invoiceNumber: "INV-1-800", issuedAt: OLD, currency: "USD", totalAmount: "420.00", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], supersedesInvoiceId: null, deliveredAt: null, deliveryEventReference: null, supersededAt: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...o }; }
function paymentRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "420.00", reversesPaymentId: null, ...o }; }
function applyAlloc(o: Record<string, unknown> = {}) { return { id: 950, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00", ...o }; }
function negAlloc(o: Record<string, unknown> = {}) { return { id: 951, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "refund", parentAllocationId: 950, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00", ...o }; }

const ins = (id: number) => (v: Record<string, unknown>) => [{ ...v, id }];
function seq<T>(...vals: T[][]) { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; }

function gpp(o: Record<string, unknown> = {}) { return { id: 900, identityStatus: "active", mergedIntoPatientId: null, ...o }; }
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active", ...o }; }

type S = Map<unknown, TableSpec>;
function baseSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}): S {
  const m = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [acase()] }],
    [t.memberships, { select: () => [pcm()] }],
    [t.globalPatients, { select: () => [gpp()] }],
    [t.billingReadinessChecks, { select: () => [readinessRow()] }],
    [t.billingDocumentRequests, { select: () => [docRow()] }],
    [t.canonicalClaims, { select: () => [], onInsert: ins(700), onUpdate: (v) => [{ ...v, id: 700 }] }],
    [t.canonicalInvoices, { select: () => [], onInsert: ins(800), onUpdate: (v) => [{ ...v, id: 800 }] }],
    // Default receipt present so refund/reversal (which reload the receipt) work.
    [t.canonicalPayments, { select: () => [paymentRow()], onInsert: ins(900) }],
    [t.canonicalPaymentAllocations, { select: () => [], onInsert: ins(950) }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: ins(1) }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v);
  return m;
}

// ═══ Claim commands ═══
async function testClaimDraftCreate() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const r = await runWithDb(baseSpec(t), ALL, async (calls: Call[]) => {
    const res = await c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" });
    assert.equal(countOps(calls, "transaction"), 1, "runs inside a transaction");
    assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 1, "writes an audit transition row");
    return res;
  });
  assert.equal(r.status, "created"); assert.ok(r.status === "created" && r.claimId === 700 && r.claimReady === true, "(9) exact complete evidence qualifies → ready draft");
}
async function testClaimDraftIdempotent() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "create_claim_draft", clinicId: 1, ancillaryCaseId: 5 });
  const spec = baseSpec(t, { canonicalFinancialTransitions: { select: () => [{ entityType: "claim", clinicId: 1, idempotencyKey: "k1", entityId: 700, commandFingerprint: fp }] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }); assert.equal(countOps(calls, "insert", t.canonicalClaims), 0, "(10/13) same key + same intent → no second insert"); return res; });
  assert.ok(r.status === "reused" && r.claimId === 700, "(13) idempotency same intent replays");
}
async function testIdempotencyConflict() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  // Same key reused for a DIFFERENT intent (fingerprint mismatch) → conflict, no write.
  const spec = baseSpec(t, { canonicalFinancialTransitions: { select: () => [{ entityType: "claim", clinicId: 1, idempotencyKey: "k1", entityId: 700, commandFingerprint: "DIFFERENT-INTENT" }] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }); assert.equal(countOps(calls, "insert", t.canonicalClaims), 0, "no write on idempotency conflict"); return res; });
  assert.equal(r.status, "idempotency_conflict", "(14/15/16/17) same key + different intent conflicts");
}
async function testClaimDraftConcurrency() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  // First active-draft check → none; insert loses the race (23505); re-select finds the winner.
  const spec = baseSpec(t, { canonicalClaims: { select: seq([], [claimRow({ id: 700, canonicalStatus: "ready" })]), onInsert: () => { throw Object.assign(new Error("dup"), { code: "23505" }); } } });
  const r = await runWithDb(spec, ALL, async () => c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }));
  assert.ok(r.status === "reused" && r.claimId === 700, "(11) concurrent creates converge on one row");
}
async function testClaimIdentityIncomplete() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const r = await runWithDb(baseSpec(t, { ancillaryCases: { select: () => [acase({ globalPlexusPatientId: null })] } }), ALL, async () => c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }));
  assert.equal(r.status, "identity_incomplete", "(8) inactive/mismatched patient identity rejected");
}
async function testClaimWrongClinic() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const r = await runWithDb(baseSpec(t, { ancillaryCases: { select: () => [acase({ clinicId: 2 })] } }), ALL, async () => c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }));
  assert.equal(r.status, "not_found", "cross-clinic case never adopted");
}
async function testClaimEvidenceConflict() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const r = await runWithDb(baseSpec(t, { billingReadinessChecks: { select: () => [readinessRow({ id: 500 }), readinessRow({ id: 501 })] } }), ALL, async () => c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }));
  assert.equal(r.status, "evidence_conflict", "duplicate current readiness → conflict, no draft");
}
async function testClaimTransitionValid() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "ready" })], onUpdate: (v) => [{ ...v, id: 700 }] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "draft", idempotencyKey: "t1" }); assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 1, "(13) transition audit transactional"); return res; });
  assert.ok(r.status === "transitioned" && r.from === "ready" && r.to === "draft");
}
async function testClaimTransitionInvalid() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "draft" })] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "paid", idempotencyKey: "t1" }); assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "(14) invalid transition → no write"); return res; });
  assert.equal(r.status, "invalid_transition");
}
async function testClaimSubmitRequiresSource() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "queued" })] } });
  const noSrc = await runWithDb(spec, ALL, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", idempotencyKey: "t1" }));
  assert.equal(noSrc.status, "submission_source_required", "(15) submitted requires exact source");
  const ok = await runWithDb(baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "queued" })], onUpdate: (v) => [{ ...v, id: 700 }] } }), ALL, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "REF-1", reason: "attested", idempotencyKey: "t1" }));
  assert.equal(ok.status, "transitioned", "submitted with exact provenance succeeds");
}
async function testClaimSubmitClearinghouseNeedsAdapter() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "queued" })] } });
  const r = await runWithDb(spec, { ...ALL, canonicalClaimTransmission: false }, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "clearinghouse_response", sourceReference: "ACK", reason: "ack", idempotencyKey: "t1" }));
  assert.equal(r.status, "transmission_unavailable", "no fake clearinghouse ack without a real adapter");
}
async function testClaimSubmittedImmutable() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "submitted" })] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "draft", idempotencyKey: "t1" }); assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "(16) submitted attempt immutable — no write"); return res; });
  assert.equal(r.status, "invalid_transition");
}
async function testClaimTransitionConflict() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "ready" })], onUpdate: () => [] } });
  const r = await runWithDb(spec, ALL, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "draft", idempotencyKey: "t1" }));
  assert.equal(r.status, "conflict", "affected-row 0 → conflict (concurrent claim)");
}
async function testClaimCorrectionSubmittedRetained() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  // Prior is submitted → NOT superseded (history retained); a new child draft is created.
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ id: 700, canonicalStatus: "submitted", attemptNumber: 1 })], onInsert: ins(701) } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.createCanonicalClaimCorrection({ clinicId: 1, priorClaimId: 700, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr1" }); assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "(18) submitted history NOT rewritten"); return res; });
  assert.ok(r.status === "created" && r.claimId === 701, "(17) correction creates child attempt");
}
async function testClaimCorrectionRaceReplay() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  // §7 a racing identical correction won: entry gate sees none, the audit insert loses
  // the race (23505), the post-catch resolve finds the SAME-intent winner → replay its
  // exact prior success (never a generic conflict).
  const fp = commandFingerprint({ action: "correct_claim", clinicId: 1, priorClaimId: 700, reason: "fix" });
  const replayRow = { entityType: "claim", clinicId: 1, idempotencyKey: "corr-r", entityId: 701, commandFingerprint: fp };
  let n = 0;
  const spec = baseSpec(t, {
    canonicalClaims: { select: () => [claimRow({ id: 700, canonicalStatus: "submitted", attemptNumber: 1 })], onInsert: ins(701) },
    canonicalFinancialTransitions: { select: () => (n++ === 0 ? [] : [replayRow]), onInsert: () => { throw Object.assign(new Error("dup"), { code: "23505" }); } },
  });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await c.createCanonicalClaimCorrection({ clinicId: 1, priorClaimId: 700, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr-r" }); assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "no history rewrite on a lost race"); return res; });
  assert.ok(r.status === "reused" && r.claimId === 701, "identical correction race replays exact prior success");
  // Different-intent winner under the same key → idempotency_conflict, never a false reuse.
  let n2 = 0;
  const spec2 = baseSpec(t, {
    canonicalClaims: { select: () => [claimRow({ id: 700, canonicalStatus: "submitted", attemptNumber: 1 })], onInsert: ins(701) },
    canonicalFinancialTransitions: { select: () => (n2++ === 0 ? [] : [{ ...replayRow, commandFingerprint: "OTHER" }]), onInsert: () => { throw Object.assign(new Error("dup"), { code: "23505" }); } },
  });
  const r2 = await runWithDb(spec2, ALL, async () => c.createCanonicalClaimCorrection({ clinicId: 1, priorClaimId: 700, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr-r" }));
  assert.equal(r2.status, "idempotency_conflict", "different-intent correction race → idempotency_conflict");
}

// ═══ Invoice commands ═══
async function testInvoiceCreate() {
  const t = await loadCanonicalTables(); const inv = await invoiceCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "submitted" })] } });
  const r = await runWithDb(spec, ALL, async () => inv.createOrReuseCanonicalInvoiceDraft({ clinicId: 1, claimId: 700, invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", actorUserId: "u", actorRole: "biller", idempotencyKey: "i1" }));
  assert.ok(r.status === "created" && r.invoiceId === 800, "(20) exact claim lineage qualifies");
}
async function testInvoiceAmountSource() {
  const t = await loadCanonicalTables(); const inv = await invoiceCmd();
  const spec = baseSpec(t, { canonicalClaims: { select: () => [claimRow({ canonicalStatus: "submitted", chargeAmount: null, amountSource: null })] } });
  const r = await runWithDb(spec, ALL, async () => inv.createOrReuseCanonicalInvoiceDraft({ clinicId: 1, claimId: 700, invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", actorUserId: "u", actorRole: "biller", idempotencyKey: "i1" }));
  assert.equal(r.status, "amount_source_missing", "no exact amount source → no invoice");
}
async function testInvoiceIssueAndImmutable() {
  const t = await loadCanonicalTables(); const inv = await invoiceCmd();
  const approved = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ canonicalStatus: "approved", invoiceNumber: null })], onUpdate: (v) => [{ ...v, id: 800 }] } });
  const issued = await runWithDb(approved, ALL, async () => inv.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "issued", actorUserId: "u", actorRole: "biller", idempotencyKey: "iv1" }));
  assert.ok(issued.status === "transitioned" && issued.to === "issued", "(24) invoice issue (approved→issued) assigns number");
  const imm = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ canonicalStatus: "issued" })] } });
  const r = await runWithDb(imm, ALL, async (calls: Call[]) => { const res = await inv.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "draft", actorUserId: "u", actorRole: "biller", idempotencyKey: "iv2" }); assert.equal(countOps(calls, "update", t.canonicalInvoices), 0, "(25) issued invoice immutable"); return res; });
  assert.equal(r.status, "invalid_transition");
}
async function testInvoiceDeliveredRequiresEvent() {
  const t = await loadCanonicalTables(); const inv = await invoiceCmd();
  const spec = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ canonicalStatus: "issued" })] } });
  const r = await runWithDb(spec, ALL, async () => inv.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "delivered", actorUserId: "u", actorRole: "biller", idempotencyKey: "iv1" }));
  assert.equal(r.status, "delivery_event_required", "(27) delivered requires exact event");
}
async function testInvoicePaidDerivedOnly() {
  const t = await loadCanonicalTables(); const inv = await invoiceCmd();
  const spec = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ canonicalStatus: "issued" })] } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await inv.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "paid", actorUserId: "u", actorRole: "biller", idempotencyKey: "iv1" }); assert.equal(countOps(calls, "update", t.canonicalInvoices), 0, "(28) paid never a manual status-only transition"); return res; });
  assert.equal(r.status, "payment_status_derived");
}

// ═══ Payment / allocation / refund / reversal ═══
async function testPaymentRecord() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const r = await runWithDb(baseSpec(t), ALL, async (calls: Call[]) => { const res = await p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", paymentType: "manual", currency: "USD", amount: "420.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }); assert.equal(countOps(calls, "insert", t.canonicalPayments), 1, "append-only receipt"); return res; });
  assert.ok(r.status === "recorded" && r.paymentId === 900, "(29) payment receipt recorded");
}
async function testPaymentUnsupportedCurrencyAndCaseless() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const cur = await runWithDb(baseSpec(t), ALL, async () => p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, paymentType: "manual", currency: "EUR", amount: "5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }));
  assert.equal(cur.status, "unsupported_currency", "(20) unsupported currency rejected");
  // case-less manual money has no approved clinic-level source → rejected.
  const caseless = await runWithDb(baseSpec(t), ALL, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "manual", currency: "USD", amount: "5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }));
  assert.equal(caseless.status, "invalid_source", "case-less money requires an approved clinic-level source");
  // inactive membership → identity rejected, no write.
  const inactive = await runWithDb(baseSpec(t, { memberships: { select: () => [pcm({ membershipStatus: "inactive" })] } }), ALL, async (calls: Call[]) => { const res = await p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, paymentType: "manual", currency: "USD", amount: "5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }); assert.equal(countOps(calls, "insert", t.canonicalPayments), 0, "no receipt on identity failure"); return res; });
  assert.ok(inactive.status === "identity_invalid", "(3) inactive membership rejected");
}
async function testPaymentInvalid() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const neg = await runWithDb(baseSpec(t), ALL, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "manual", currency: "USD", amount: "-5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }));
  assert.equal(neg.status, "invalid_amount", "negative payment rejected");
  const imp = await runWithDb(baseSpec(t), ALL, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "processor_import", currency: "USD", amount: "5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" }));
  assert.equal(imp.status, "invalid_source", "import without external txn rejected");
}
async function testPaymentExternalDedup() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Exact same intent (clinic/type/amount/currency/case/service/source) → reused.
  const dupRow = { id: 900, clinicId: 1, ancillaryCaseId: null, serviceType: null, paymentType: "processor_import", amount: "5.00", currency: "USD", sourceSystem: "x", externalTransactionId: "X-1", eventType: "payment", status: "posted" };
  const spec = baseSpec(t, { canonicalPayments: { select: () => [dupRow], onInsert: ins(901) } });
  const r = await runWithDb(spec, ALL, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "processor_import", currency: "USD", amount: "5.00", externalTransactionId: "X-1", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p2" }));
  assert.ok(r.status === "reused" && r.paymentId === 900, "(26) exact-duplicate external transaction reuses");
  // Different amount for the same external txn → conflict (never reuse a different intent).
  const conf = await runWithDb(spec, ALL, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "processor_import", currency: "USD", amount: "9.99", externalTransactionId: "X-1", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p3" }));
  assert.equal(conf.status, "external_transaction_conflict", "(27) external transaction different amount conflicts");
}
async function testAllocateAndDerivePaid() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Payment 420 fully allocated to a 420 invoice → invoice derived paid.
  const spec = baseSpec(t, {
    canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "420.00" })] },
    canonicalClaims: { select: () => [claimRow()] },
    canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "420.00" })], onUpdate: (v) => [{ ...v, id: 800 }] },
    canonicalPaymentAllocations: { select: () => [], onInsert: ins(950) },
  });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }); assert.equal(countOps(calls, "update", t.canonicalInvoices), 1, "(28) paid derived from allocation"); return res; });
  assert.ok(r.status === "allocated" && r.targetStatus === "paid", "(31) allocation applied + target derived paid");
}
async function testAllocatePartial() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = baseSpec(t, {
    canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "100.00" })] },
    canonicalClaims: { select: () => [claimRow()] },
    canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "420.00" })], onUpdate: (v) => [{ ...v, id: 800 }] },
  });
  const r = await runWithDb(spec, ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "100.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.ok(r.status === "allocated" && r.targetStatus === "partially_paid", "(32) partial allocation → partially_paid");
}
async function testAllocateCrossClinicWrongCaseCurrency() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const mk = (over: Partial<Record<string, TableSpec>>) => baseSpec(t, { canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "420.00" })] }, ...over });
  const wrongCase = await runWithDb(mk({ ancillaryCases: { select: () => [acase(), acase({ id: 6 })] }, canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", ancillaryCaseId: 6 })] } }), ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.ok(wrongCase.status === "allocation_rejected" && wrongCase.code === "allocation_wrong_case", "(35) wrong-case allocation rejected");
  const curr = await runWithDb(mk({ canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", currency: "EUR" })] } }), ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.ok(curr.status === "allocation_rejected" && curr.code === "allocation_currency_mismatch", "(36) currency mismatch rejected");
}
async function testAllocateExceeds() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Allocate 500 from a 420 payment → exceeds receipt.
  const overReceipt = await runWithDb(baseSpec(t, { canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "420.00" })] }, canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "1000.00" })] } }), ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "500.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.ok(overReceipt.status === "allocation_rejected" && overReceipt.code === "allocation_exceeds_payment", "(37) allocation over receipt rejected");
  const overTarget = await runWithDb(baseSpec(t, { canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "1000.00" })] }, canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "420.00" })] } }), ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "500.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.ok(overTarget.status === "allocation_rejected" && overTarget.code === "allocation_exceeds_outstanding", "(38) allocation over target rejected");
}
async function testAllocateBoundsFromCompleteSet() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Receipt 420 already fully allocated (existing 420 alloc from the SAME payment).
  // A second allocation must be rejected using the COMPLETE allocation set re-read
  // under the lock — proving bounds aren't computed from a stale pre-tx snapshot.
  const spec = baseSpec(t, {
    canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "420.00" })] },
    canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "1000.00" })] },
    canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 949, amount: "420.00" })], onInsert: ins(950) },
  });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => { const res = await p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "100.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a2" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "over-allocation not inserted"); return res; });
  assert.ok(r.status === "allocation_rejected" && r.code === "allocation_exceeds_payment", "in-tx bound uses the complete allocation set (no race)");
}
async function testAllocateTargetUpdateFailClosed() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // The derived target update affects ZERO rows (concurrent status change) → the
  // allocation insert + transition roll back → conflict (never a false "allocated").
  const spec = baseSpec(t, {
    canonicalPayments: { select: () => [paymentRow({ id: 900, amount: "420.00" })] },
    canonicalClaims: { select: () => [claimRow()] },
    canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "issued", totalAmount: "420.00" })], onUpdate: () => [] },
  });
  const r = await runWithDb(spec, ALL, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a1" }));
  assert.equal(r.status, "conflict", "(21) zero-row target update rolls back → conflict");
}
async function testRefundLimits() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Parent apply-allocation 420 already fully refunded (a refund alloc of 420 naming it).
  const spec = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "partially_paid" })] }, canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 950, amount: "420.00" }), negAlloc({ id: 951, eventType: "refund", parentAllocationId: 950, amount: "420.00" })] } });
  const r = await runWithDb(spec, ALL, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r1" }));
  assert.equal(r.status, "already_reversed", "(41/26) cumulative allocation-negation limit");
  const ok = await runWithDb(baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "partially_paid" })], onUpdate: (v) => [{ ...v, id: 800 }] }, canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 950, amount: "420.00" })], onInsert: ins(952) } }), ALL, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "100.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r1" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 1, "(39) refund append-only allocation row"); return res; });
  assert.ok(ok.status === "refunded" && ok.allocationId === 952, "(23) allocation-specific partial refund appends a new negation row");
}
async function testReverseDouble() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = baseSpec(t, { canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "partially_paid" })] }, canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 950, amount: "420.00" }), negAlloc({ id: 951, eventType: "reversal", parentAllocationId: 950, amount: "420.00" })] } });
  const r = await runWithDb(spec, ALL, async () => p.reverseCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "rv1" }));
  assert.equal(r.status, "already_reversed", "(27/42) no double allocation reversal");
}
async function testRefundLeavesOtherTargetUnchanged() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Receipt split across invoice A(800) and B(801); refunding A's allocation must
  // name A's parent only and never touch B.
  const spec = baseSpec(t, {
    canonicalInvoices: { select: () => [invoiceRow({ id: 800, canonicalStatus: "partially_paid" })], onUpdate: (v) => [{ ...v, id: 800 }] },
    canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 950, targetId: 800, amount: "200.00" }), applyAlloc({ id: 951, targetId: 801, amount: "220.00" })], onInsert: ins(960) },
  });
  const r = await runWithDb(spec, ALL, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "200.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r1" }));
  assert.ok(r.status === "refunded", "(24) invoice A refund leaves invoice B unchanged (names A's parent only)");
}
async function testRefundWrongParent() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = baseSpec(t, { canonicalPaymentAllocations: { select: () => [applyAlloc({ id: 950, amount: "420.00" })] } });
  const r = await runWithDb(spec, ALL, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 999, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r1" }));
  assert.equal(r.status, "parent_allocation_invalid", "refund must name an exact existing apply-allocation");
}
async function testPaymentFlagOffNoWrites() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  await runWithDb(baseSpec(t), { ...ALL, canonicalPayments: false }, async (calls: Call[]) => {
    const r = await p.recordCanonicalPayment({ clinicId: 1, paymentType: "manual", currency: "USD", amount: "5.00", actorUserId: "u", actorRole: "biller", sourceSystem: "x", idempotencyKey: "p1" });
    assert.equal(r.status, "skipped_flag_off"); assert.equal(countOps(calls, "insert"), 0, "(61) flag OFF → zero writes");
  });
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(9) claim draft create + audit + tx", testClaimDraftCreate],
  ["(13) claim draft idempotent same-intent", testClaimDraftIdempotent],
  ["(14-17) idempotency different-intent conflict", testIdempotencyConflict],
  ["(11) claim draft concurrency converges", testClaimDraftConcurrency],
  ["(8) identity incomplete", testClaimIdentityIncomplete],
  ["cross-clinic case not adopted", testClaimWrongClinic],
  ["evidence conflict blocks draft", testClaimEvidenceConflict],
  ["(13) claim transition valid + audit", testClaimTransitionValid],
  ["(14) claim invalid transition no write", testClaimTransitionInvalid],
  ["(15) submitted requires source", testClaimSubmitRequiresSource],
  ["clearinghouse needs adapter", testClaimSubmitClearinghouseNeedsAdapter],
  ["(16) submitted immutable", testClaimSubmittedImmutable],
  ["transition affected-row conflict", testClaimTransitionConflict],
  ["(17/18) correction retains submitted", testClaimCorrectionSubmittedRetained],
  ["correction race replay + different-intent conflict", testClaimCorrectionRaceReplay],
  ["(20) invoice create from claim", testInvoiceCreate],
  ["invoice amount source required", testInvoiceAmountSource],
  ["(24/25) invoice issue + immutable", testInvoiceIssueAndImmutable],
  ["(27) delivered requires event", testInvoiceDeliveredRequiresEvent],
  ["(28) invoice paid derived only", testInvoicePaidDerivedOnly],
  ["(29) payment recorded", testPaymentRecord],
  ["(3/20) currency + case-less + inactive identity", testPaymentUnsupportedCurrencyAndCaseless],
  ["payment invalid amount/source", testPaymentInvalid],
  ["(30) external txn dedup", testPaymentExternalDedup],
  ["(31) allocate + derive paid", testAllocateAndDerivePaid],
  ["(32) partial allocation", testAllocatePartial],
  ["(35/36) cross-case/currency rejected", testAllocateCrossClinicWrongCaseCurrency],
  ["(37/38) allocation exceeds bounds", testAllocateExceeds],
  ["in-tx bound from complete alloc set", testAllocateBoundsFromCompleteSet],
  ["(21) target update fail-closed", testAllocateTargetUpdateFailClosed],
  ["(23/26/39/41) allocation-specific refund limit", testRefundLimits],
  ["(27/42) no double allocation reversal", testReverseDouble],
  ["(24) refund leaves other target unchanged", testRefundLeavesOtherTargetUnchanged],
  ["refund names exact parent allocation", testRefundWrongParent],
  ["(61) payment flag off zero writes", testPaymentFlagOffNoWrites],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();

// Phase 2K (K39) — concurrency hardening: one canonical outcome, never a false success.
//
// Concurrent identical commands converge to ONE outcome via the audit-row race
// resolver (exact replay of the prior success, incl. the K33 from/to), a
// different-fingerprint command under the same key CONFLICTS, and a concurrent
// target-status change (zero-row fail-closed update) rolls back to a conflict — never
// a duplicate active row, orphan audit, or false `paid`.
//
//   npx tsx tests/unit/phase2KConcurrencyHardening.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const claimCmd = () => import("../../server/services/canonicalFinancial/claimCommands");
const invoiceCmd = () => import("../../server/services/canonicalFinancial/invoiceCommands");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");
const cs = () => import("../../server/services/canonicalFinancial/commandSupport");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const dup = () => { throw Object.assign(new Error("dup"), { code: "23505" }); };

// ── claim transition: concurrent identical → exact replay (K33 from/to); diff intent → conflict ──
async function testClaimTransitionRace() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "transition_claim", clinicId: 1, claimId: 700, transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why" });
  const priorRow = { entityType: "claim", clinicId: 1, idempotencyKey: "k", entityId: 700, commandFingerprint: fp, fromStatus: "queued", toStatus: "submitted" };
  const spec = (transitions: () => unknown[]) => new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [{ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "queued", attemptNumber: 1 }], onUpdate: (v) => [{ ...v, id: 700 }] }],
    [t.canonicalFinancialTransitions, { select: transitions, onInsert: dup }],
  ]);
  // The identical racing command already committed → entry-gate resolver replays the
  // EXACT prior success WITH the real from/to (K33), never a fabricated from:"".
  let n = 0;
  const r = await runWithDb(spec(() => (n++ === 0 ? [priorRow] : [priorRow])), CHAIN, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why", idempotencyKey: "k" }));
  assert.ok(r.status === "transitioned" && r.from === "queued" && r.to === "submitted", `identical race replays exact from/to (got ${JSON.stringify(r)})`);
  // Different intent under the same key → idempotency_conflict, never a false replay.
  const r2 = await runWithDb(spec(() => [{ ...priorRow, commandFingerprint: "OTHER" }]), CHAIN, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why", idempotencyKey: "k" }));
  assert.equal(r2.status, "idempotency_conflict", "different-intent race under the same key → idempotency_conflict");
}

// ── claim transition replay is advancement-stable: reflects the ORIGINAL audit row ──
async function testReplayAdvancementStable() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "transition_claim", clinicId: 1, claimId: 700, transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why" });
  // The entity row has ADVANCED to `paid`, but the replay must reflect the original
  // command's audit row (queued→submitted), not the current row.
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [{ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "paid", attemptNumber: 1 }] }],
    [t.canonicalFinancialTransitions, { select: () => [{ entityType: "claim", clinicId: 1, idempotencyKey: "k", entityId: 700, commandFingerprint: fp, fromStatus: "queued", toStatus: "submitted" }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why", idempotencyKey: "k" }));
  assert.ok(r.status === "transitioned" && r.from === "queued" && r.to === "submitted", `replay reflects the ORIGINAL audit row despite the entity advancing (got ${JSON.stringify(r)})`);
}

// ── invoice transition: concurrent identical → exact replay ──
async function testInvoiceTransitionRace() {
  const t = await loadCanonicalTables(); const c = await invoiceCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "transition_invoice", clinicId: 1, invoiceId: 800, transition: "issued", deliveryEventReference: undefined, sourceType: undefined, sourceReference: undefined, reason: undefined });
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalInvoices, { select: () => [{ id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "approved", claimId: 700, invoiceNumber: null }], onUpdate: (v) => [{ ...v, id: 800 }] }],
    [t.canonicalFinancialTransitions, { select: () => [{ entityType: "invoice", clinicId: 1, idempotencyKey: "k", entityId: 800, commandFingerprint: fp, fromStatus: "approved", toStatus: "issued" }], onInsert: dup }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => c.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "issued", actorUserId: "u", actorRole: "biller", idempotencyKey: "k" }));
  assert.ok(r.status === "transitioned" && r.from === "approved" && r.to === "issued", `invoice identical race replays exact from/to (got ${JSON.stringify(r)})`);
}

// ── payment allocation: concurrent target status change (zero-row update) → conflict, no false paid ──
const FIELD_SRC: Record<string, string> = { service_code: "approved_fee_schedule", units: "approved_fee_schedule", place_of_service: "facility_registry", facility: "facility_registry", rendering_provider: "credentialing_registry", billing_provider: "credentialing_registry", payer: "payer_contract", coverage_reference: "payer_contract" };
const PROV = Object.fromEntries(Object.entries(FIELD_SRC).map(([f, s]) => [f, { sourceType: s, sourceId: "s" }]));
const CLAIMFIELDS = Object.fromEntries(Object.keys(FIELD_SRC).map((f) => [f, "v"]));
const REFS = { procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13 };
const RD = { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", ...REFS, globalPlexusPatientId: 900, patientClinicMembershipId: 800, claimBlockers: [], warnings: [] };
// A claim-ready Billing Document (canonical readiness ready + generated doc carrying the
// exact approved claim charge) so the correction's re-evaluation reaches the tx race point.
const CHARGE = { amountSource: "approved_fee_schedule", currency: "USD", chargeAmount: "420.00", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], fields: Object.fromEntries(Object.entries(FIELD_SRC).map(([f, s]) => [f, { value: "v", sourceType: s }])) };
const BD = { ...RD, id: 600, billingReadinessCheckId: 500, canonicalStatus: "generated", sourceData: { claimCharge: CHARGE } };
const claimRow = (o: Record<string, unknown> = {}) => ({ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...REFS, canonicalStatus: "submitted", attemptNumber: 1, supersedesClaimId: null, currency: "USD", chargeAmount: "420.00", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], claimFields: CLAIMFIELDS, fieldProvenance: PROV, submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: "R", submissionReason: "why", ...o });
async function testAllocationTargetRace() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const payment = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "420.00" };
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalPayments, { select: () => [payment] }],
    [t.canonicalClaims, { select: () => [claimRow()], onUpdate: () => [] }], // concurrent status change → 0 rows
    [t.canonicalInvoices, { select: () => [] }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }],
    [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
    [t.billingReadinessChecks, { select: () => [RD] }], [t.billingDocumentRequests, { select: () => [BD] }],
    [t.canonicalPaymentAllocations, { select: () => [], onInsert: (v) => [{ ...v, id: 950 }] }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "claim", targetId: 700, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a" });
    assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 0, "zero-row target update → no orphan audit committed");
    return res;
  });
  assert.equal(r.status, "conflict", "concurrent target status change → conflict, never a false paid");
}

// ── Areas 1/2/3: retry-record convergence. Two concurrent identical unresolved-failure
//    records → ONE canonical row; the loser (23505) converges on the durable winner and
//    returns it (never a false "not recorded"). Exercised per action family. ──
async function retryConvergence(requestedAction: string, sourceTable: string | null, sourceId: number | null, documentKind: string) {
  const t = await loadCanonicalTables(); const repo = await import("../../server/repositories/ancillaryDocuments.repo");
  const winner = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind, sourceTable, sourceId, requestedAction, resolvedAt: null, attemptCount: 1 };
  let n = 0; // dedupe select: none first (both see empty), then the winner after the insert race
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => (n++ === 0 ? [] : [winner]), onInsert: dup, onUpdate: (v) => [{ ...winner, ...v }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => repo.recordAncillaryDocumentFailure({ clinicId: 1, ancillaryCaseId: 5, documentKind, sourceTable: sourceTable ?? undefined, sourceId: sourceId ?? undefined, requestedAction, sourceSystem: "s", errorCode: "e" } as never));
  assert.ok(r && (r as { id?: number }).id === 1, `${requestedAction} concurrent record → converges on the ONE durable winner (got ${JSON.stringify(r)})`);
}
// Bonus: low-level retry-ledger 23505 convergence (kept as evidence, not counted as A1-A3).
const bonusEnsureLedger = () => retryConvergence("link_procedure_note", "procedure_notes", 900, "procedure_note");
const bonusGenLedger = () => retryConvergence("generate_procedure_note", "procedure_notes", 900, "procedure_note");
const bonusSupLedger = () => retryConvergence("supersede_billing_document", "billing_document_requests", 600, "billing_document");

// Minimal note/case fixtures for the production-flow races (A1/A2).
const pnote = (o: Record<string, unknown> = {}) => ({ id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: null, effectiveClinicalDate: OLD, generatedText: null, createdAt: OLD, updatedAt: OLD, globalPlexusPatientId: 10, patientClinicMembershipId: 20, ...o });
const acase = (o: Record<string, unknown> = {}) => ({ id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o });
const GEN = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true, procedureNoteGenerator: true } as const;

// ── A1: PRODUCTION ensureProcedureNoteReferenceForNote under a real create-reference
//    23505 race → getReferenceBySource none → insert loses → reread the exact winner →
//    exactly ONE canonical current reference (resolved). ──
async function testEnsureReferenceRace() {
  const t = await loadCanonicalTables(); const svc = await import("../../server/services/procedureLifecycle/procedureNoteService");
  const winnerRef = { id: 55, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, supersededAt: null, documentStatus: "pending_signature", signedAt: null, serviceType: "BrainWave", metadata: {} };
  let n = 0; // getReferenceBySource(none) → getActiveReference(none) → insert 23505 → getReferenceBySource(winner)
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [pnote()] }],
    [t.ancillaryCases, { select: () => [acase()] }],
    [t.documentReferences, { select: () => (n++ < 2 ? [] : [winnerRef]), onInsert: dup, onUpdate: (v) => [{ ...winnerRef, ...(v as object) }] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => svc.ensureProcedureNoteReferenceForNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, source: "concurrency_test" }));
  assert.equal((r as { status: string }).status, "resolved", `A1 ensureProcedureNoteReferenceForNote create-reference 23505 race → converges on the one winner (got ${JSON.stringify(r)})`);
}

// ── A2: PRODUCTION generateProcedureNote under a retryable deferral where the generate-
//    retry record 23505s and the K5 recovery rereads the winner → not_yet_eligible_retry_recorded. ──
async function testGenerationRetryRace() {
  const t = await loadCanonicalTables(); const g = await import("../../server/services/procedureLifecycle/procedureNoteGenerator");
  const winner = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let n = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [pnote({ generationStatus: "pending" })] }],
    [t.ancillaryCases, { select: () => [acase()] }],
    [t.procedureEvents, { select: () => [] }],        // procedure not yet complete → retryable deferral
    [t.documentReferences, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }],
    [t.documentFailures, { select: () => (n++ === 0 ? [] : [winner]), onInsert: dup, onUpdate: (v) => [{ ...winner, ...(v as object) }] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal((r as { status: string }).status, "not_yet_eligible_retry_recorded", `A2 generateProcedureNote retryable + retry-record 23505 → durable convergence (got ${JSON.stringify(r)})`);
}

// ── A3: PRODUCTION supersedeStaleBillingDocument where the reference cannot be proven
//    durable (residual current ref) and the supersede-retry record 23505s → the K5 recovery
//    rereads the winner → superseded_reference_retry_recorded, never *_not_durable. ──
async function testSupersedeRetryRace() {
  const t = await loadCanonicalTables(); const orch = await import("../../server/services/billingLifecycle/billingLifecycleOrchestration");
  const staleDoc = { id: 600, clinicId: 1, ancillaryCaseId: 5, canonicalStatus: "generated", evidenceFingerprint: "OLD", supersededAt: null };
  const residualRef = { id: 70, clinicId: 1, ancillaryCaseId: 5, sourceTable: "billing_document_requests", sourceId: 600, documentKind: "billing_document", supersededAt: null };
  const winner = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 600, requestedAction: "supersede_billing_document", resolvedAt: null, attemptCount: 1 };
  let n = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [staleDoc], onUpdate: (v) => [{ ...staleDoc, ...(v as object) }] }],
    [t.documentReferences, { select: () => [residualRef], onUpdate: (v) => [{ ...residualRef, ...(v as object) }] }], // residual current ref → not durable
    [t.documentFailures, { select: () => (n++ === 0 ? [] : [winner]), onInsert: dup, onUpdate: (v) => [{ ...winner, ...(v as object) }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => orch.supersedeStaleBillingDocument({ clinicId: 1, ancillaryCaseId: 5 }, "NEW"));
  assert.equal((r as { status: string }).status, "superseded_reference_retry_recorded", `A3 supersedeStaleBillingDocument + retry-record 23505 → durable recovery (got ${JSON.stringify(r)})`);
}

// ── Area 4: claim CORRECTION — POST-START race. The entry-gate resolver sees NONE; the
//    command proceeds through evidence validation; the child claim insert LOSES the race
//    (23505); the catch path calls resolveFinancialCommandRace, the winner audit is now
//    visible, and the command CONVERGES to the exact prior correction child (no duplicate). ──
async function testClaimCorrectionRace() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "correct_claim", clinicId: 1, priorClaimId: 700, reason: "fix" });
  const winner = { entityType: "claim", clinicId: 1, idempotencyKey: "corr", entityId: 701, commandFingerprint: fp, fromStatus: null, toStatus: "ready" };
  let n = 0; // entry-gate resolve → NONE; only after the child-insert 23505 does the winner appear
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [claimRow({ canonicalStatus: "submitted" })], onInsert: dup }], // child insert loses the race
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }], [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
    [t.billingReadinessChecks, { select: () => [RD] }], [t.billingDocumentRequests, { select: () => [BD] }],
    [t.canonicalFinancialTransitions, { select: () => (n++ === 0 ? [] : [winner]), onInsert: (v) => [{ ...v, id: 9 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await c.createCanonicalClaimCorrection({ clinicId: 1, priorClaimId: 700, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr" });
    assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "no duplicate child / history rewrite on a lost correction race");
    return res;
  });
  assert.ok(r.status === "reused" && r.claimId === 701, `claim correction POST-START race → converges on the ONE prior child (got ${JSON.stringify(r)})`);
  // Different fingerprint under the same key still conflicts (never a false reuse).
  let n2 = 0;
  const specDiff = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [claimRow({ canonicalStatus: "submitted" })], onInsert: dup }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }], [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
    [t.billingReadinessChecks, { select: () => [RD] }], [t.billingDocumentRequests, { select: () => [BD] }],
    [t.canonicalFinancialTransitions, { select: () => (n2++ === 0 ? [] : [{ ...winner, commandFingerprint: "OTHER" }]), onInsert: (v) => [{ ...v, id: 9 }] }],
  ]);
  const rd = await runWithDb(specDiff, CHAIN, async () => c.createCanonicalClaimCorrection({ clinicId: 1, priorClaimId: 700, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr" }));
  assert.equal(rd.status, "idempotency_conflict", "different-intent correction race → idempotency_conflict, never false reuse");
}

// ── Area 5: invoice CORRECTION — POST-START race (equivalent to A4). ──
async function testInvoiceCorrectionRace() {
  const t = await loadCanonicalTables(); const c = await invoiceCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "correct_invoice", clinicId: 1, priorInvoiceId: 800, reason: "fix" });
  const winner = { entityType: "invoice", clinicId: 1, idempotencyKey: "corr", entityId: 801, commandFingerprint: fp, fromStatus: null, toStatus: "draft" };
  let n = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalInvoices, { select: () => [{ id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "issued", claimId: 700, invoiceNumber: "INV-1", supersedesInvoiceId: null }], onInsert: dup }], // child insert loses the race
    [t.canonicalClaims, { select: () => [claimRow()] }],
    [t.canonicalFinancialTransitions, { select: () => (n++ === 0 ? [] : [winner]), onInsert: (v) => [{ ...v, id: 9 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => c.createCanonicalInvoiceCorrection({ clinicId: 1, priorInvoiceId: 800, actorUserId: "u", actorRole: "biller", reason: "fix", idempotencyKey: "corr" }));
  assert.ok(r.status === "reused" && r.invoiceId === 801, `invoice correction POST-START race → converges on the ONE prior child (got ${JSON.stringify(r)})`);
}

// ── Area 7: refund/reversal — concurrent target status change (zero-row update) → conflict ──
async function testRefundTargetRace() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const payment = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "420.00" };
  const parent = { id: 950, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00" };
  const inv = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "paid", currency: "USD", totalAmount: "420.00", supersededAt: null, evidenceFingerprint: "fp-1", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M", invoiceNumber: "INV-1", issuedAt: OLD, lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], billingDocumentId: 600, billingReadinessCheckId: 500, supersedesInvoiceId: null };
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalPayments, { select: () => [payment] }],
    [t.canonicalInvoices, { select: () => [inv], onUpdate: () => [] }], // concurrent status change → 0 rows
    [t.canonicalClaims, { select: () => [claimRow()] }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.canonicalPaymentAllocations, { select: () => [parent], onInsert: (v) => [{ ...v, id: 951 }] }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" });
    assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 0, "refund zero-row target update → no orphan audit committed");
    return res;
  });
  assert.equal(r.status, "conflict", "refund concurrent target change → conflict, never a false unwind");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["A1 ensureProcedureNoteReferenceForNote: real create-reference 23505 race → resolved", testEnsureReferenceRace],
  ["A2 generateProcedureNote: retryable + retry-record 23505 → durable convergence", testGenerationRetryRace],
  ["A3 supersedeStaleBillingDocument: reference not durable + retry-record 23505 → recovery", testSupersedeRetryRace],
  ["A4 claim CORRECTION: POST-START race → converges on the exact prior child; diff-intent conflicts", testClaimCorrectionRace],
  ["A5 invoice CORRECTION: POST-START race → converges on the exact prior child", testInvoiceCorrectionRace],
  ["A6 payment allocation: concurrent target change → conflict, no false paid/orphan", testAllocationTargetRace],
  ["A7 refund/reversal: concurrent target change → conflict, no orphan", testRefundTargetRace],
  ["(bonus) retry-ledger 23505 convergence — ensure/generate/supersede", async () => { await bonusEnsureLedger(); await bonusGenLedger(); await bonusSupLedger(); }],
  ["(bonus) claim transition race replays exact from/to; diff intent conflicts", testClaimTransitionRace],
  ["(bonus) claim transition replay advancement-stable", testReplayAdvancementStable],
  ["(bonus) invoice transition race replays exact from/to", testInvoiceTransitionRace],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
  console.log(`K39: 7/7 required concurrency paths proven`);
}
run();

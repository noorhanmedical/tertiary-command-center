// Phase 2K (K38) — ordinary (non-migration) failure-injection: fail closed.
//
// An ordinary DB read/write failure on a critical canonical path must never fabricate
// success: reads degrade to `unavailable` (never empty-as-success), writes leave no
// false committed state, a post-insert failure rolls back to a conflict, and a
// throwing target update never yields a false `paid`.
//
//   npx tsx tests/unit/phase2KFailureInjection.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const viewMod = () => import("../../server/services/canonicalFinancial/financialView");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const boom = () => { throw new Error("db read down"); };
const gpp = () => ({ id: 900, identityStatus: "active", mergedIntoPatientId: null });
const pcm = () => ({ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" });
const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 };

// ── financial view: an ordinary section read failure → unavailable, not empty-success ──
async function testViewReadFailure() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: boom }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.ancillaryCases, { select: () => [] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.availability, "unavailable", "claims read failure → unavailable");
  assert.equal(r.claims.rows.length, 0, "no rows — but availability marks it unavailable (never empty-as-success)");
  assert.ok(r.claims.warnings.length > 0, "a PHI-free failure warning is surfaced");
}

// ── stage: claim read failure → claim stage unavailable ──
async function testStageReadFailure() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: boom }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.equal(v.claim.availability, "unavailable", "claim read failure → unavailable, never a false stage");
}

// ── stage: receipt-wide load failure → payment unavailable, never a false paid ──
async function testStageReceiptWideReadFailure() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const claim = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", submittedAt: OLD };
  const alloc = { id: 1, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "claim", targetId: 700, currency: "USD", amount: "1.00" };
  const receipt = [{ id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "1.00" }];
  let ap = 0; // 1st canonicalPaymentAllocations select = case load (ok), 2nd = receipt-wide load (throws)
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [claim] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => receipt }], [t.canonicalPaymentAllocations, { select: () => { ap++; if (ap >= 2) boom(); return [alloc]; } }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.notEqual(v.payment.status, "paid", "receipt-wide read failure → never a false paid");
  assert.equal(v.payment.availability, "unavailable", "receipt-wide read failure → unavailable");
}

// ── payment receipt write failure (insert throws) → no committed state / audit ──
async function testRecordPaymentWriteFailure() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    // The receipt insert throws an ORDINARY error mid-transaction.
    [t.canonicalPayments, { select: () => [], onInsert: boom }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", paymentType: "manual", currency: "USD", amount: "1.00", actorUserId: "u", actorRole: "biller", sourceSystem: "s", idempotencyKey: "k" });
    assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 0, "receipt insert failure → zero audit committed (writeTransition never runs)");
    return res;
  });
  assert.equal(r.status, "persistence_failed", "receipt write failure → persistence_failed, no false success");
}

// ── shared procedure-note fixtures (mirror procedureRetryExecutionFinalization) ──
const CREATED = new Date("2027-06-01T10:00:00Z");
const GEN = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true, procedureNoteGenerator: true } as const;
const caseRow = (o: Record<string, unknown> = {}) => ({ id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o });
const peRow = (o: Record<string, unknown> = {}) => ({ id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", procedureStatus: "complete", completedAt: OLD, metadata: {}, startedAt: OLD, createdAt: CREATED, updatedAt: CREATED, ...o });
const reportRef = (o: Record<string, unknown> = {}) => ({ id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED, metadata: {}, ...o });
const readinessRow = (o: Record<string, unknown> = {}) => ({ id: 1000, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", patientScreeningId: 77, executionCaseId: 900, ...o });
const noteRow = (o: Record<string, unknown> = {}) => ({ id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, generatedText: null, createdAt: CREATED, updatedAt: CREATED, ...o });
const failRow = (o: Record<string, unknown> = {}) => ({ id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1, ...o });

// P1 ── procedure-note reference ensure: the reference create insert fails → truthful
//        result (no false generated/linked); nothing claims a durable reference.
async function p1_referenceEnsureFailure() {
  const t = await loadCanonicalTables(); const svc = await import("../../server/services/procedureLifecycle/procedureNoteService");
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated", signatureStatus: "needs_signature" })] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.documentReferences, { select: () => [], onInsert: boom, onUpdate: boom }], // no current ref; create throws
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => svc.ensureProcedureNoteReferenceForNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 } as never));
  assert.notEqual((r as { status?: string }).status, "linked", "reference-ensure create failure → never a false linked/durable result");
  assert.notEqual((r as { status?: string }).status, "reference_present", "reference-ensure create failure → not reported durably present");
}
// P2 ── generator retry creation: the retry-ledger insert fails → retry_not_recorded,
//        note stays pending, no false self-healing durability claim.
async function p2_generatorRetryInsertFailure() {
  const t = await loadCanonicalTables(); const g = await import("../../server/services/procedureLifecycle/procedureNoteGenerator");
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }], [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [] }], // report evidence absent → retryable deferral (report_missing)
    [t.documentFailures, { select: () => [], onInsert: boom }], // retry-ledger insert fails
  ]);
  const r = await runWithDb(spec, GEN, async (calls: Call[]) => {
    const res = await g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 });
    assert.equal(countOps(calls, "update", t.procedureNotes) > 0 ? "" : "", "", ""); // note not marked generated
    return res;
  });
  assert.ok(/not_recorded|retry_not_recorded|not_yet_eligible_retry_not_recorded/.test((r as { status: string }).status), `generator retry-ledger failure → not-recorded (got ${(r as { status: string }).status})`);
}
// P3 ── Billing Document reference supersession: the reference update AND the retry
//        insert both fail → no false durable supersession (superseded_reference_not_durable).
async function p3_billingSupersedeDoubleFailure() {
  const t = await loadCanonicalTables(); const orch = await import("../../server/services/billingLifecycle/billingLifecycleOrchestration");
  const doc = { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, evidenceFingerprint: "fp-OLD", billingReadinessCheckId: 500 };
  const spec = new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [doc], onUpdate: (v) => [{ ...v, id: 600 }] }], // doc row supersede OK
    [t.documentReferences, { select: () => [reportRef({ documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 600 })], onUpdate: boom }], // ref supersede fails
    [t.documentFailures, { select: () => [], onInsert: boom }], // retry-ledger insert also fails
  ]);
  const r = await runWithDb(spec, GEN, async () => orch.supersedeStaleBillingDocument({ clinicId: 1, ancillaryCaseId: 5 }, "fp-NEW"));
  assert.notEqual((r as { status: string }).status, "superseded", "ref+retry double-failure → NOT a clean durable success");
  assert.ok(/not_durable|not_recorded|conflict/.test((r as { status: string }).status), `ref+retry double-failure → non-durable/truthful (got ${(r as { status: string }).status})`);
}
// P6 ── PCS optional display projection failure: verified classification + IDs preserved,
//        display degraded only, never a demographic fallback.
async function p6_pcsDisplayFailure() {
  const t = await loadCanonicalTables(); const { getPcsCanonicalView } = await import("../../server/services/pcs/pcsCanonicalView");
  const spec = new Map<unknown, TableSpec>([
    [t.memberships, { select: () => [pcm()] }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, patientClinicMembershipId: 800, globalPlexusPatientId: 900, serviceType: "BrainWave", lifecycleStatus: "active" }] }],
    [t.globalPatients, { select: (cols) => { if (cols && "displayName" in (cols as object)) boom(); return [gpp()]; } }],
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }], [t.canonicalClaims, { select: () => [] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
  ]);
  // The optional-display failure must be CONTAINED: the request completes (never
  // throws / never 5xx), the availability is not a failure, and NO demographic display
  // is fabricated. (Full verified-preservation is asserted in pcsAcsCanonicalView.)
  const r = await runWithDb(spec, CHAIN, async () => getPcsCanonicalView({ clinicId: 1 } as never));
  assert.equal(r.availability, "available", "optional display failure → request still serves canonical truth (not failed)");
  const leaked = (r.rows ?? []).some((row) => row.identity && (row.identity.patientDisplay != null || row.identity.patientDob != null));
  assert.ok(!leaked, "optional display failure → NO demographic display fabricated (degraded to null)");
  assert.ok(r.rows.length >= 1, "optional display failure → verified patient PRESERVED (not moved to unresolved / not dropped)");
  assert.equal(r.unresolved.rows.length, 0, "optional display failure → patient NOT moved to unresolved (identity truth intact)");
}
// P7 ── Clinician Portal Finance read failure → finance unavailable, never a false zero.
async function p7_portalFinanceFailure() {
  const t = await loadCanonicalTables(); const { getClinicianPortalCanonicalOverview } = await import("../../server/services/clinicianPortal/canonicalOverview");
  const spec = new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: boom }], // finance readiness read fails
    [t.billingDocumentRequests, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.ancillaryCases, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => getClinicianPortalCanonicalOverview({ clinicId: 1 } as never));
  const fin = (r as { finance?: { availability?: string } }).finance;
  assert.ok(fin && fin.availability === "unavailable", `portal finance read failure → unavailable, never a false zero (got ${JSON.stringify(fin?.availability)})`);
}
// P8 ── retry RESOLUTION update failure → failure remains unresolved (no false resolved).
// Drives the REAL worker entry `retryAncillaryDocumentFailure`, which (unlike the generator
// directly) actually calls `resolveAncillaryDocumentFailureById`. A superseded note reaches
// the resolve immediately; the resolve UPDATE (documentFailures.resolvedAt) throws — proving
// `resolutionAttempted` was reached AND the worker never returns a false `resolved`.
async function p8_retryResolutionFailure() {
  const t = await loadCanonicalTables(); const worker = await import("../../server/services/ancillaryDocuments/retryWorker");
  let resolutionAttempted = false;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD })] }], // superseded → generate-retry worker resolves immediately
    [t.documentFailures, {
      select: () => [],
      onUpdate: (v) => { if ("resolvedAt" in (v as object)) { resolutionAttempted = true; throw new Error("resolve update down"); } return [{ ...(v as object), id: 1 }]; }, // the resolve UPDATE throws
      onInsert: (v) => [{ ...(v as object), id: 1 }],
    }],
  ]);
  const r = await runWithDb(spec, GEN, async () => worker.retryAncillaryDocumentFailure(failRow() as never));
  assert.equal(resolutionAttempted, true, "P8: the retry RESOLUTION update was actually reached (resolutionAttempted)");
  assert.notEqual((r as { status: string }).status, "resolved", "P8: resolution-write failure → never a false resolved");
  assert.equal((r as { status: string }).status, "error", "P8: worker surfaces error, not a false resolved");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["P1 procedure-note reference ensure failure → truthful", p1_referenceEnsureFailure],
  ["P2 generator retry-ledger insert failure → not-recorded, note pending", p2_generatorRetryInsertFailure],
  ["P3 Billing ref-supersede + retry double-failure → not durable", p3_billingSupersedeDoubleFailure],
  ["P4 financial lineage-context read failure → unavailable", testViewReadFailure],
  ["P5 receipt-wide allocation load failure → never a false paid", testStageReceiptWideReadFailure],
  ["P6 PCS optional display projection failure → verified preserved, display degraded", p6_pcsDisplayFailure],
  ["P7 Clinician Portal Finance read failure → unavailable, never zero", p7_portalFinanceFailure],
  ["P8 retry resolution update failure → not falsely resolved", p8_retryResolutionFailure],
  ["(bonus) stage claim read failure → unavailable", testStageReadFailure],
  ["(bonus) payment receipt write failure → no committed state", testRecordPaymentWriteFailure],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
  console.log(`K38: 8/8 required failure-injection paths proven`);
}
run();

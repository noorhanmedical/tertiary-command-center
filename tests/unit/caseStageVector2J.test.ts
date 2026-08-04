// Phase 2J — canonical financial STAGE extension of the shared PCS/ACS vector.
// Verifies the 3 additive stages (claim/invoice/payment) resolve behind the 2J
// flags, are `upstream_flag_off` (and non-blocking) when OFF, extend currentStage
// after billingDocument when ON, and conflict on >1 current per case.
//
//   npx tsx tests/unit/caseStageVector2J.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const OLD = new Date("2027-06-10T09:00:00Z");

// Full chain (2A–2G) + 2J on. Toggle the 2J trio per test.
const CORE = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  serviceSpecificAdminReview: true, engagementAdminReviewSync: true,
} as const;
const WITH_2J = { ...CORE, canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true };

// ── happy-path fixtures (case complete through billingDocument) ──
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved", globalPlexusPatientId: 900, patientClinicMembershipId: 800, executionCaseId: 70, originatingScreeningId: 77, ...o }; }
function adminEvent(o: Record<string, unknown> = {}) { return { id: 1, ancillaryCaseId: 5, serviceType: "BrainWave", newStatus: "approved", actualReviewedAt: OLD, source: "manual", ...o }; }
function list(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, sourceType: "admin_review", sourceId: "s-100", label: "Batch A", sentToEngagementAt: OLD, ...o }; }
function membership(o: Record<string, unknown> = {}) { return { id: 200, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "active", ...o }; }
function appt(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "ancillary_appointment", status: "scheduled", startsAt: OLD, parentEventId: null, ...o }; }
function orderRef(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", documentStatus: "signed", serviceType: "BrainWave", sourceTable: "procedure_notes", sourceId: 1, executionCaseId: 70, patientScreeningId: 77, signedAt: OLD, effectiveClinicalDate: OLD, actualCreatedAt: OLD, supersededAt: null, ...o }; }
function orderNote(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, generationStatus: "generated", supersededAt: null, ...o }; }
function procRef(o: Record<string, unknown> = {}) { return orderRef({ id: 2, documentKind: "procedure_note", documentStatus: "signed", sourceId: 2, ...o }); }
function procNote(o: Record<string, unknown> = {}) { return orderNote({ id: 2, noteType: "post_procedure_note", ...o }); }
function reportRef(o: Record<string, unknown> = {}) { return orderRef({ id: 3, documentKind: "report", documentStatus: "uploaded", sourceTable: "case_document_readiness", sourceId: 3, ...o }); }
function cdr(o: Record<string, unknown> = {}) { return { id: 3, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", executionCaseId: 70, patientScreeningId: 77, ...o }; }
function proc(o: Record<string, unknown> = {}) { return { id: 400, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", procedureStatus: "complete", completedAt: OLD, lastTransitionAt: OLD, updatedAt: OLD, ...o }; }
function readiness(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evaluatedAt: OLD, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: null, reportDocumentReferenceId: null, procedureNoteDocumentReferenceId: null, billingBlockers: [], claimBlockers: [], ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, generatedAt: OLD, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: null, reportDocumentReferenceId: null, ...o }; }
// 2J
function claim(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, submittedAt: null, updatedAt: OLD, ...o }; }
function invoice(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "issued", supersededAt: null, issuedAt: OLD, ...o }; }
function payment(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", postedAt: OLD, receivedAt: OLD, ...o }; }

type Opts = { claims?: unknown[]; invoices?: unknown[]; payments?: unknown[]; claimsMig?: boolean };
function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts = {}) {
  const mig = () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); };
  return new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [adminEvent()] }],
    [t.engagementLists, { select: () => [list()] }],
    [t.engagementMemberships, { select: () => [membership()] }],
    [t.gse, { select: () => [appt()] }],
    [t.documentReferences, { select: () => [orderRef(), procRef(), reportRef()] }],
    [t.procedureNotes, { select: () => [orderNote(), procNote()] }],
    [t.caseDocumentReadiness, { select: () => [cdr()] }],
    [t.procedureEvents, { select: () => [proc()] }],
    [t.billingReadinessChecks, { select: () => [readiness()] }],
    [t.billingDocumentRequests, { select: () => [billingDoc()] }],
    [t.canonicalClaims, { select: () => { if (o.claimsMig) return mig(); return o.claims ?? []; } }],
    [t.canonicalInvoices, { select: () => o.invoices ?? [] }],
    [t.canonicalPayments, { select: () => o.payments ?? [] }],
  ]);
}
async function build(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts, flags: Record<string, boolean>, calls?: (c: Call[]) => void) {
  const { buildStageVectors } = await stageMod();
  return runWithDb(spec(t, o), flags, async (c: Call[]) => { const v = await buildStageVectors({ clinicId: 1, cases: [acase() as never] }); calls?.(c); return v[0]; });
}

async function testFlagsOffNonBlocking() {
  const t = await loadCanonicalTables();
  const v = await build(t, {}, CORE, (calls) => {
    assert.equal(countOps(calls, "select", t.canonicalClaims), 0, "no claim reads when 2J off");
    assert.equal(countOps(calls, "select", t.canonicalInvoices), 0);
    assert.equal(countOps(calls, "select", t.canonicalPayments), 0);
  });
  assert.equal(v.claim.availability, "upstream_flag_off"); assert.equal(v.invoice.availability, "upstream_flag_off"); assert.equal(v.payment.availability, "upstream_flag_off");
  // All core stages complete + financial stages skipped ⇒ currentStage null, resolved.
  assert.equal(v.currentStage, null, "prior-truth currentStage preserved with 2J OFF");
  assert.equal(v.currentStageIntegrity, "resolved");
}
async function testFlagsOnClaimBecomesCurrent() {
  const t = await loadCanonicalTables();
  const v = await build(t, {}, WITH_2J);
  assert.equal(v.claim.availability, "available"); assert.equal(v.claim.status, null, "no claim yet → missing status");
  assert.equal(v.currentStage, "claim", "financial stage extends currentStage after billingDocument");
}
async function testFlagsOnFullyPaid() {
  const t = await loadCanonicalTables();
  const v = await build(t, { claims: [claim({ canonicalStatus: "paid" })], invoices: [invoice({ canonicalStatus: "paid" })], payments: [payment()] }, WITH_2J);
  assert.equal(v.claim.status, "paid"); assert.equal(v.invoice.status, "paid"); assert.equal(v.payment.status, "posted");
  assert.equal(v.currentStage, null, "fully paid ⇒ lifecycle complete");
}
async function testClaimConflict() {
  const t = await loadCanonicalTables();
  const v = await build(t, { claims: [claim({ id: 700 }), claim({ id: 701 })] }, WITH_2J);
  assert.equal(v.claim.integrity, "conflicting"); assert.equal(v.claim.status, null, "duplicate current claim → conflict, never first/newest");
  assert.equal(v.currentStageIntegrity, "conflicting");
}
async function testPaymentPendingNotPaid() {
  const t = await loadCanonicalTables();
  const v = await build(t, { payments: [payment({ status: "failed" })] }, WITH_2J);
  assert.equal(v.payment.status, "pending", "failed ledger event never reads as posted/paid");
  assert.notEqual(v.payment.status, "posted");
}
async function testClaimMigration503() {
  const t = await loadCanonicalTables();
  await assert.rejects(async () => build(t, { claimsMig: true }, WITH_2J), /migration/i, "missing claim table → MigrationMissingError (→ 503 upstream)");
}
async function testWrongServiceClaimNotUsed() {
  const t = await loadCanonicalTables();
  const v = await build(t, { claims: [claim({ serviceType: "NerveGuard" })] }, WITH_2J);
  assert.equal(v.claim.status, null, "wrong-service claim contributes no status");
  assert.ok(v.claim.warnings.includes("claim_wrong_service"));
}

const tests: Array<[string, () => Promise<void>]> = [
  ["2J OFF → non-blocking, prior truth preserved", testFlagsOffNonBlocking],
  ["2J ON → claim extends currentStage", testFlagsOnClaimBecomesCurrent],
  ["2J ON → fully paid completes lifecycle", testFlagsOnFullyPaid],
  ["duplicate current claim → conflict", testClaimConflict],
  ["failed payment never reads posted", testPaymentPendingNotPaid],
  ["missing claim table → 503", testClaimMigration503],
  ["wrong-service claim not used", testWrongServiceClaimNotUsed],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();

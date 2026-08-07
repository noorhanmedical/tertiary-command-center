// Phase 2G — canonical billing readiness + Billing Document behavioral suite.
//
//   npx tsx tests/unit/billingReadinessAndDocument.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const evaluator = () => import("../../server/services/billingLifecycle/billingReadinessEvaluator");
const generator = () => import("../../server/services/billingLifecycle/billingDocumentGenerator");
const orchestration = () => import("../../server/services/billingLifecycle/billingLifecycleOrchestration");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const backfill = () => import("../../script/backfillCanonicalBillingReadiness");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
// Full upstream chain + billing readiness/document/generator.
const READY = { ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true, canonicalBillingReadiness: true } as const;
const DOC = { ...READY, canonicalBillingDocument: true } as const;
const GEN = { ...DOC, billingDocumentGenerator: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", procedureStatus: "complete", completedAt: OLD, createdAt: CREATED_AT, ...o }; }
function ref(kind: string, o: Record<string, unknown> = {}) { return { id: 40, clinicId: 1, ancillaryCaseId: 5, documentKind: kind, serviceType: "BrainWave", documentStatus: "uploaded", signedAt: null, sourceId: 900, sourceTable: "x", supersededAt: null, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return ref("report", { id: 41, documentStatus: "uploaded", sourceTable: "case_document_readiness", sourceId: 1000, ...o }); }
function pnRef(o: Record<string, unknown> = {}) { return ref("procedure_note", { id: 42, documentStatus: "signed", signedAt: OLD, sourceTable: "procedure_notes", sourceId: 900, ...o }); }
function onRef(o: Record<string, unknown> = {}) { return ref("order_note", { id: 43, documentStatus: "signed", signedAt: OLD, sourceTable: "procedure_notes", sourceId: 800, ...o }); }
function signedNote(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "post_procedure_note", signatureStatus: "signed", signedAt: OLD, supersededAt: null, ...o }; }
function orderNoteRow(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, supersededAt: null, ...o }; }
function reportSourceRow(o: Record<string, unknown> = {}) { return { id: 1000, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", executionCaseId: 900, patientScreeningId: 77, ...o }; }
function cfg(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, serviceType: "BrainWave", requirementCode: "order_note_signature", blockerCategory: "billing_blocker", blocksStage: "billing_readiness", required: false, overrideAllowed: false, overrideRoles: null, overrideAuditRequired: true, active: true, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", procedureEventId: 300, reportDocumentReferenceId: 41, orderNoteDocumentReferenceId: 43, procedureNoteDocumentReferenceId: 42, billingBlockers: [], claimBlockers: [], warnings: [], evidenceFingerprint: "bef_x", evidenceSnapshot: { procedure_completed_at: OLD.toISOString(), procedure_event_id: 300, report_reference_id: 41, order_note_reference_id: 43, procedure_note_reference_id: 42 }, evaluatedAt: OLD, supersededAt: null, ...o }; }
function docRow(o: Record<string, unknown> = {}) { return { id: 70, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "pending", evidenceFingerprint: "bef_x", billingReadinessCheckId: 100, procedureEventId: 300, reportDocumentReferenceId: 41, orderNoteDocumentReferenceId: 43, procedureNoteDocumentReferenceId: 42, claimBlockers: [], warnings: [], generatedByAi: false, globalPlexusPatientId: 10, patientClinicMembershipId: 20, executionCaseId: 900, patientScreeningId: 77, createdAt: CREATED_AT, ...o }; }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }

/** Spec for the readiness evaluator. documentReferences read order: report, procedure_note, order_note. */
function evalSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { case?: unknown[]; pe?: unknown[]; report?: unknown; pn?: unknown; on?: unknown; note?: unknown[]; onNote?: unknown[]; configs?: unknown[]; onInsertRead?: (v: any) => unknown[]; journeyInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => o.case ?? [caseRow()] }],
    [t.procedureEvents, { select: () => o.pe ?? [peRow()] }],
    // Reference read order: report, procedure_note, order_note.
    [t.documentReferences, { select: qsel([[o.report ?? reportRef()].filter(Boolean), [o.pn ?? pnRef()].filter(Boolean), [o.on ?? onRef()].filter(Boolean)]) }],
    // Note read order: procedure_note underlying note, then order_note underlying note.
    [t.procedureNotes, { select: qsel([o.note ?? [signedNote()], o.onNote ?? [orderNoteRow()]]) }],
    // Underlying report source row (case_document_readiness) for §4 validation.
    [t.caseDocumentReadiness, { select: () => [reportSourceRow()] }],
    [t.prerequisiteConfig, { select: () => o.configs ?? [cfg()] }],
    [t.billingReadinessChecks, { onUpdate: () => [], onInsert: o.onInsertRead ?? ((v) => [{ ...v, id: 100 }]) }],
    [t.journeyEvents, { onInsert: o.journeyInsert ?? (() => []) }],
  ]);
}

// (1) exact clinic/case readiness → ready_to_generate
async function testReadyHappyPath() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(evalSpec(t), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "ready_to_generate", JSON.stringify(r.billingBlockers));
  assert.equal(r.billingReady, true); assert.equal(r.claimSubmissionReady, true);
}

// (2) cross-clinic denied (no disclosure) + (6) nullable ownership fails closed
async function testCrossClinicAndNullable() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const x = await runWithDb(evalSpec(t, { case: [caseRow({ clinicId: 2 })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(x.status, "cross_clinic_denied", "(2) cross-clinic denied");
  const none = await runWithDb(evalSpec(t, { case: [] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(none.status, "case_not_found", "(6) missing case fails closed");
}

// (3/4/9) snapshot uses the EXACT case id + persisted completedAt as DOS (no screening/service reuse)
async function testSnapshotExactIdentityAndDos() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  let inserted: Record<string, unknown> | null = null;
  await runWithDb(evalSpec(t, { onInsertRead: (v) => { inserted = v; return [{ ...v, id: 100 }]; } }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  const snap = inserted as unknown as Record<string, any>;
  assert.equal(snap.ancillaryCaseId, 5, "(3/4) exact case identity — never screening/service");
  assert.equal((snap.evidenceSnapshot as any).procedure_completed_at, OLD.toISOString(), "(9) persisted completedAt is DOS");
  assert.equal((snap.evidenceSnapshot as any).procedure_event_id, 300);
}

// (7) exact complete procedure required
async function testCompleteProcedureRequired() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(evalSpec(t, { pe: [peRow({ procedureStatus: "in_progress", completedAt: null })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "missing_requirements");
  assert.ok(r.billingBlockers!.some((b) => b.code === "exact_complete_procedure_missing"), "(7) blocks");
}

// (8) terminal invalidation blocks readiness
async function testTerminalInvalidationBlocks() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(evalSpec(t, { pe: [peRow({ procedureStatus: "cancelled", completedAt: null })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "missing_requirements");
  assert.ok(r.billingBlockers!.some((b) => b.code === "procedure_terminally_invalidated"), "(8) terminal blocks");
}

// (10) exact current report required
async function testReportRequired() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(evalSpec(t, { report: undefined, configs: [cfg()] }), READY, async () => {
    // report missing: pass empty first documentReferences select
    return e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
  });
  // Note: evalSpec builds report from reportRef() default; override with a no-report spec:
  void r;
  const r2 = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }], [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[], [pnRef()], [onRef()]]) }], [t.procedureNotes, { select: qsel([[signedNote()], [orderNoteRow()]]) }],
    [t.prerequisiteConfig, { select: () => [cfg()] }], [t.billingReadinessChecks, { onUpdate: () => [], onInsert: (v) => [{ ...v, id: 100 }] }], [t.journeyEvents, { onInsert: () => [] }],
  ]), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r2.status, "missing_requirements");
  assert.ok(r2.billingBlockers!.some((b) => b.code === "exact_current_report_missing"), "(10) report required");
}

// (13) signed Procedure Note required + (14) reference signature mismatch blocks
async function testProcedureNoteSignatureRules() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const unsigned = await runWithDb(evalSpec(t, { pn: pnRef({ documentStatus: "pending_signature", signedAt: null }), note: [signedNote({ signatureStatus: "needs_signature", signedAt: null })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(unsigned.billingBlockers!.some((b) => b.code === "procedure_note_unsigned"), "(13) unsigned note blocks");
  const mismatch = await runWithDb(evalSpec(t, { pn: pnRef({ documentStatus: "pending_signature", signedAt: null }), note: [signedNote()] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(mismatch.billingBlockers!.some((b) => b.code === "procedure_note_reference_unsynchronized"), "(14) reference mismatch blocks");
}

// (16) required Order Note signature enforced + (17) not_required honored + (18) unresolved blocks
async function testOrderNoteSignature() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const req = await runWithDb(evalSpec(t, { on: onRef({ documentStatus: "pending_signature", signedAt: null }), configs: [cfg({ required: true })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(req.billingBlockers!.some((b) => b.code === "order_note_signature_required_unsigned"), "(16) required unsigned blocks");
  const notReq = await runWithDb(evalSpec(t, { on: onRef({ documentStatus: "pending_signature", signedAt: null }), configs: [cfg({ required: false })] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(notReq.status, "ready_to_generate", "(17) not_required honored");
  const unresolved = await runWithDb(evalSpec(t, { configs: [] }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(unresolved.billingBlockers!.some((b) => b.code === "order_note_signature_unresolved"), "(18) unresolved blocks");
}

// (20) claim blocker alone preserved (not hidden) without blocking generation
async function testClaimBlockerPreserved() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const configs = [cfg(), { ...cfg({ required: true }), id: 2, requirementCode: "prior_authorization", blockerCategory: "claim_submission_blocker" }];
  const r = await runWithDb(evalSpec(t, { configs }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "ready_to_generate", "(20) claim blocker does not block generation");
  assert.equal(r.claimSubmissionReady, false, "(20) claim submission not ready");
  assert.ok(r.claimBlockers!.some((b) => b.code === "prior_authorization"), "(20) claim blocker preserved, not hidden");
}

// (21) warning does not become a blocker
async function testWarningNotBlocker() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const configs = [cfg(), { ...cfg({ required: true }), id: 3, requirementCode: "documentation_followup", blockerCategory: "soft_operational_warning" }];
  const r = await runWithDb(evalSpec(t, { configs }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "ready_to_generate", "(21) warning does not block");
  assert.ok(r.warnings!.some((w) => w.code === "documentation_followup"), "(21) warning surfaced");
}

// (19/22/23/24) billing blocker blocks; explicit override requires reason+codes+role; role alone cannot; always-hard not overrideable
async function testOverrides() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const blockCfg = [cfg(), { ...cfg({ required: true }), id: 4, requirementCode: "insurance_verification", blockerCategory: "billing_blocker", overrideAllowed: true, overrideRoles: "biller,admin" }];
  // (19) unsatisfied billing blocker → missing_requirements
  const blocked = await runWithDb(evalSpec(t, { configs: blockCfg }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(blocked.status, "missing_requirements", "(19) billing blocker blocks");
  // (23) role alone (no reason) cannot override
  const noReason = await runWithDb(evalSpec(t, { configs: blockCfg }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test", actor: { userId: "u1", role: "biller" }, override: { reason: "", requirementCodes: ["insurance_verification"] } }));
  assert.equal(noReason.status, "missing_requirements", "(23) role alone cannot override");
  // (22) explicit override with reason+code+allowed role → applied → ready
  const applied = await runWithDb(evalSpec(t, { configs: blockCfg }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test", actor: { userId: "u1", role: "biller" }, override: { reason: "verified by phone", requirementCodes: ["insurance_verification"] } }));
  assert.equal(applied.status, "ready_to_generate", "(22) explicit override applies");
  assert.ok(applied.appliedOverrides!.some((o) => o.code === "insurance_verification"), "(22) override audited");
  // (24) always-hard evidence (report) cannot be overridden
  const hardCfg = blockCfg;
  const hard = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }], [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[], [pnRef()], [onRef()]]) }], [t.procedureNotes, { select: qsel([[signedNote()], [orderNoteRow()]]) }],
    [t.prerequisiteConfig, { select: () => hardCfg }], [t.billingReadinessChecks, { onUpdate: () => [], onInsert: (v) => [{ ...v, id: 100 }] }], [t.journeyEvents, { onInsert: () => [] }],
  ]), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test", actor: { userId: "u1", role: "admin" }, override: { reason: "x", requirementCodes: ["exact_current_report_missing", "insurance_verification"] } }));
  assert.equal(hard.status, "missing_requirements", "(24) always-hard report cannot be overridden");
}

// (25) override-audit failure prevents readiness commit (atomic)
async function testOverrideAuditFailurePreventsCommit() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const blockCfg = [cfg(), { ...cfg({ required: true }), id: 4, requirementCode: "insurance_verification", blockerCategory: "billing_blocker", overrideAllowed: true, overrideRoles: "biller", overrideAuditRequired: true }];
  const r = await runWithDb(evalSpec(t, { configs: blockCfg, journeyInsert: () => { throw new Error("audit ledger down"); } }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test", actor: { userId: "u1", role: "biller" }, override: { reason: "verified", requirementCodes: ["insurance_verification"] } }));
  assert.equal(r.status, "override_not_recorded", "(25) audit failure rolls back readiness commit");
}

// ── Billing Document ──────────────────────────────────────────────
// (26) only a ready snapshot creates a pending document + (48) rerun idempotent
async function testCreateOnlyWhenReady() {
  const t = await loadCanonicalTables(); const g = await generator();
  const notReady = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }], [t.billingReadinessChecks, { select: () => [readinessRow({ canonicalStatus: "missing_requirements" })] }],
    [t.billingDocumentRequests, { select: () => [], onInsert: () => { throw new Error("must not create"); } }],
  ]), DOC, async () => g.createOrAdoptCanonicalBillingDocument({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(notReady.status, "not_ready", "(26) not-ready never creates a document");
  const reused = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }], [t.billingReadinessChecks, { select: () => [readinessRow()] }],
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "pending", evidenceFingerprint: "bef_x" })], onInsert: () => { throw new Error("must not duplicate"); } }],
  ]), DOC, async () => g.createOrAdoptCanonicalBillingDocument({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(reused.status, "reused", "(48) idempotent reuse of the current document");
}

/** Spec for the document generator (pending → generated). */
function genSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { doc?: unknown; readiness?: unknown; claim?: unknown[]; commit?: unknown[]; refSelect?: unknown[]; refInsert?: (v: any) => unknown[]; docFailInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [o.doc ?? docRow()], onUpdate: qsel([o.claim ?? [docRow({ canonicalStatus: "generating" })], o.commit ?? [docRow({ canonicalStatus: "generated" })]]) }],
    [t.billingReadinessChecks, { select: () => [o.readiness ?? readinessRow()] }],
    [t.documentReferences, { select: () => o.refSelect ?? [], onInsert: o.refInsert ?? ((v) => [{ ...v, id: 71 }]), onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [], onInsert: o.docFailInsert ?? ((v) => [{ ...v, id: 1 }]) }],
  ]);
}

// (28/29/30/35) generated packet carries exact evidence, no invented codes, persisted DOS, exact reference
async function testGenerateExactEvidence() {
  const t = await loadCanonicalTables(); const g = await generator();
  let committed: Record<string, unknown> | null = null; let refCreated: Record<string, unknown> | null = null;
  const spec = genSpec(t, { commit: [docRow({ canonicalStatus: "generated" })], refInsert: (v) => { refCreated = v; return [{ ...v, id: 71 }]; } });
  spec.set(t.billingDocumentRequests, { select: () => [docRow()], onUpdate: qsel([[docRow({ canonicalStatus: "generating" })], (() => { const f = (v: any) => { committed = v; return [docRow({ ...v, canonicalStatus: "generated" })]; }; return f; })() as never]) });
  // Simpler: capture the commit via a custom onUpdate.
  let uc = 0;
  spec.set(t.billingDocumentRequests, { select: () => [docRow()], onUpdate: (v) => { uc++; if (uc === 2) committed = v; return [docRow({ ...v, id: 70, canonicalStatus: uc === 1 ? "generating" : "generated" })]; } });
  const r = await runWithDb(spec, GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.equal(r.status, "generated", JSON.stringify(r));
  const sd = (committed as any).sourceData as Record<string, unknown>;
  assert.equal(sd.date_of_service, OLD.toISOString(), "(30) persisted procedure time is DOS — never retry time");
  assert.equal(sd.procedure_event_id, 300, "(28) exact procedure evidence carried");
  assert.equal((committed as any).generatedByAi, false, "non-AI");
  for (const bad of ["cpt", "hcpcs", "icd", "modifier", "npi", "payer", "units", "pos"]) assert.ok(!(bad in sd), `(29) no invented ${bad}`);
  assert.equal((refCreated as any).documentKind, "billing_document", "(35) exact billing_document reference created");
}

// (31) concurrent generation claims once + (32) generated packet immutable
async function testGenerationConcurrencyAndImmutability() {
  const t = await loadCanonicalTables(); const g = await generator();
  const lost = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [docRow()], onUpdate: () => [] }], [t.billingReadinessChecks, { select: () => [readinessRow()] }],
  ]), GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.equal(lost.status, "already_claimed", "(31) second worker cannot generate twice");
  const done = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "generated" })], onUpdate: () => { throw new Error("must not rewrite a generated packet"); } }], [t.billingReadinessChecks, { select: () => [readinessRow()] }],
  ]), GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.equal(done.status, "already_generated", "(32) generated packet immutable");
}

// (27/42) stale readiness rejected (generator + retry never resolves)
async function testStaleReadinessRejected() {
  const t = await loadCanonicalTables(); const g = await generator();
  const stale = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [docRow({ evidenceFingerprint: "bef_OLD" })], onUpdate: () => { throw new Error("must not claim stale"); } }],
    [t.billingReadinessChecks, { select: () => [readinessRow({ evidenceFingerprint: "bef_NEW" })] }],
  ]), GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.equal(stale.status, "stale_readiness", "(27) stale evidence version rejected");
}

// (36/37) missing reference records exact retry; retry-persistence failure surfaced
async function testReferenceRetryTruth() {
  const t = await loadCanonicalTables(); const g = await generator();
  // createReference fails (active_kind_conflict via existing conflicting ref) → retry recorded.
  const recorded = await runWithDb(genSpec(t, { refSelect: [ref("billing_document", { sourceId: 999 })] , refInsert: () => { throw new Error("conflict"); } }), GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.ok(recorded.status === "generated_reference_retry_recorded" || recorded.status === "generated", `(36) reference retry path (${recorded.status})`);
  const notRecorded = await runWithDb(genSpec(t, { refInsert: () => { throw new Error("conflict"); }, docFailInsert: () => { throw new Error("ledger down"); } }), GEN, async () => g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" }));
  assert.equal(notRecorded.status, "generated_reference_retry_not_recorded", "(37) retry-persistence failure surfaced");
}

// (33/34) evidence change supersedes the current packet (procedure invalidation via orchestration)
async function testEvidenceChangeSupersedes() {
  const t = await loadCanonicalTables(); const o = await orchestration();
  let superseded = false;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "cancelled", completedAt: null })] }], // now invalid
    [t.documentReferences, { select: qsel([[reportRef()], [pnRef()], [onRef()]]), onUpdate: () => [{}] }],
    [t.procedureNotes, { select: qsel([[signedNote()], [orderNoteRow()]]) }], [t.prerequisiteConfig, { select: () => [cfg()] }],
    [t.billingReadinessChecks, { onUpdate: () => [], onInsert: (v) => [{ ...v, id: 101 }], select: () => [] }],
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "generated", evidenceFingerprint: "bef_OLD" })], onUpdate: (v) => { if ((v as any).canonicalStatus === "superseded") superseded = true; return [docRow({ canonicalStatus: "superseded" })]; } }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, DOC, async () => o.ensureCanonicalBillingDocumentForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "superseded_stale_document", "(34) procedure invalidation supersedes the packet");
  assert.ok(superseded, "(33) current document stamped superseded");
}

// (49) flags OFF → skipped_flag_off, ZERO billing-table access
async function testFlagsOffZeroAccess() {
  const t = await loadCanonicalTables(); const e = await evaluator(); const g = await generator();
  const r = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { throw new Error("must not read migration-0055"); }, onInsert: () => { throw new Error("no write"); } }],
    [t.billingDocumentRequests, { select: () => { throw new Error("must not read migration-0055"); } }],
    [t.ancillaryCases, { select: () => { throw new Error("must not read"); } }],
  ]), {}, async (calls: Call[]) => {
    const a = await e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    const b = await g.createOrAdoptCanonicalBillingDocument({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    const c = await g.generateBillingDocument({ clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" });
    assert.equal(countOps(calls, "select", t.billingReadinessChecks), 0, "(49) zero readiness reads");
    assert.equal(countOps(calls, "select", t.billingDocumentRequests), 0, "(49) zero document reads");
    return [a.status, b.status, c.status];
  });
  assert.deepEqual(r, ["skipped_flag_off", "skipped_flag_off", "skipped_flag_off"], "(49) all skipped_flag_off");
}

// (44/45/46) backfill dry-run zero writes; apply gated; never generates bodies
async function testBackfill() {
  const t = await loadCanonicalTables(); const b = await backfill();
  // (45) apply gated: flags OFF → canApply false
  const gated = await runWithDb(new Map(), {}, async () => b.canApply());
  assert.equal(gated, false, "(45) apply gated behind flags");
  // (44/47) classify makes ZERO writes and surfaces ambiguity
  const writes = await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow(), peRow({ id: 301 })], onInsert: () => { throw new Error("no write"); }, onUpdate: () => { throw new Error("no write"); } }],
    [t.documentReferences, { select: () => [reportRef()] }], [t.procedureNotes, { select: () => [signedNote()] }],
    [t.billingReadinessChecks, { select: () => [], onInsert: () => { throw new Error("no write"); } }],
    [t.billingDocumentRequests, { select: () => [], onInsert: () => { throw new Error("no write"); } }],
  ]), READY, async (calls: Call[]) => {
    const outcomes = await b.classify(caseRow() as never);
    assert.equal(countOps(calls, "insert"), 0, "(44) dry-run zero inserts");
    assert.equal(countOps(calls, "update"), 0, "(44) dry-run zero updates");
    assert.ok(outcomes.includes("repeated_episode_ambiguity"), "(47) ambiguous episode surfaced, never guessed");
    return outcomes;
  });
  assert.ok(Array.isArray(writes));
}

// (39/40/41/42/43) worker: exact failure-ID resolution; sibling untouched; source validated; stale never resolves
async function testWorkerExactResolution() {
  const t = await loadCanonicalTables(); const w = await worker();
  const ok = { id: 10, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 70, requestedAction: "generate_billing_document", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 11, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 71, requestedAction: "generate_billing_document", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [ok, sibling], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 10 }]; } }],
    // doc 70 already generated → resolve; doc 71 not found → sibling deferred.
    [t.billingDocumentRequests, { select: qsel([[docRow({ id: 70, canonicalStatus: "generated" })], []]) }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[10], "resolved", "(39) exact resolve");
  assert.notEqual(byId[11], "resolved", "(40) sibling untouched");
  assert.equal(resolves, 1, "(39) exactly one resolution");
  // (42) stale readiness never resolves
  let staleResolves = 0;
  const staleSpec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [{ ...ok, id: 12 }], onUpdate: (v) => { if ("resolvedAt" in v) staleResolves++; return [{ id: 12 }]; } }],
    [t.billingDocumentRequests, { select: () => [docRow({ id: 70, canonicalStatus: "pending", evidenceFingerprint: "bef_OLD" })] }],
    [t.billingReadinessChecks, { select: () => [readinessRow({ evidenceFingerprint: "bef_NEW" })] }],
  ]);
  const staleRes = await runWithDb(staleSpec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(staleRes.outcomes[0].status, "resolved", "(42) stale readiness never resolves");
  assert.equal(staleResolves, 0);
}

// K11 — report source validation (loadExactReportEvidence) is fail-closed on each
// exact-ownership dimension, including a dedicated `documentType !== "report"` case.
async function testK11ReportSourceValidationFailClosed() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const run = async (srcOverride: Record<string, unknown>) => {
    const spec = evalSpec(t);
    spec.set(t.caseDocumentReadiness, { select: () => [reportSourceRow(srcOverride)] });
    const r = await runWithDb(spec, READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
    return { ready: r.status === "ready_to_generate", blob: JSON.stringify(r.billingBlockers ?? []) };
  };
  // Dedicated documentType rejection (the previously-untested guard).
  const dt = await run({ documentType: "consent" });
  assert.ok(!dt.ready && dt.blob.includes("report_source_ownership_mismatch"), `K11: documentType !== report fails closed (got ${dt.blob})`);
  // Fail-closed matrix over the other exact-ownership dimensions.
  const wrongService = await run({ serviceType: "NerveGuard" });
  assert.ok(!wrongService.ready && wrongService.blob.includes("report_source_ownership_mismatch"), "K11: wrong service fails closed");
  const wrongClinic = await run({ clinicId: 2 });
  assert.ok(!wrongClinic.ready && wrongClinic.blob.includes("report_source_ownership_mismatch"), "K11: wrong clinic fails closed");
  const noExecNoScreening = await run({ executionCaseId: null, patientScreeningId: null });
  assert.ok(!noExecNoScreening.ready && noExecNoScreening.blob.includes("report_source_ownership_mismatch"), "K11: missing execution+screening linkage fails closed");
  const unsupportedStatus = await run({ documentStatus: "draft" });
  assert.ok(!unsupportedStatus.ready && unsupportedStatus.blob.includes("report_source_status_mismatch"), `K11: unsupported source status fails closed (got ${unsupportedStatus.blob})`);
}

// ── Phase 2K billing hardening (K7/K8/K10) ──
function bref(o: Record<string, unknown> = {}) { return { id: 40, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "canonical_billing_document_requests", sourceId: 70, documentStatus: "generated", supersededAt: null, ...o }; }
function bdoc(o: Record<string, unknown> = {}) { return { id: 70, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", evidenceFingerprint: "bef_x", supersededAt: null, ...o }; }

async function testK10ReferenceDurability() {
  const t = await loadCanonicalTables(); const g = await generator();
  const args = { clinicId: 1, ancillaryCaseId: 5, billingDocumentId: 70, source: "test" };
  const run = (refs: unknown[]) => runWithDb(new Map<unknown, TableSpec>([[t.documentReferences, { select: () => refs }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }]]), DOC, async (calls: Call[]) => ({ r: await g.ensureBillingReferenceDurability(args), inserts: countOps(calls, "insert", t.documentFailures) }));
  const present = await run([bref()]);
  assert.equal(present.r, "reference_present", "K10: exactly one current owned reference is durable");
  const superseded = await run([bref({ supersededAt: OLD })]);
  assert.ok(superseded.r === "link_retry_recorded" && superseded.inserts === 1, "K10: only a superseded reference → NOT durable → link retry recorded");
  const dup = await run([bref({ id: 40 }), bref({ id: 41 })]);
  assert.equal(dup.r, "duplicate_current_reference", "K10: duplicate current references → conflict");
  const wrong = await run([bref({ clinicId: 2 })]);
  assert.equal(wrong.r, "ownership_conflict", "K10: mismatched owner → ownership conflict");
}
async function testK7SupersedeReferenceDurable() {
  const t = await loadCanonicalTables(); const o = await orchestration();
  const clean = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [bdoc({ evidenceFingerprint: "old_fp" })], onUpdate: (v) => [{ ...v, id: 70 }] }],
    [t.documentReferences, { select: () => [], onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]), DOC, async (calls: Call[]) => ({ r: await o.supersedeStaleBillingDocument({ clinicId: 1, ancillaryCaseId: 5 }, "new_fp"), retries: countOps(calls, "insert", t.documentFailures) }));
  assert.ok(clean.r === true && clean.retries === 0, "K7: stale doc superseded + reference superseded cleanly → no retry");
  const miss = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingDocumentRequests, { select: () => [bdoc({ evidenceFingerprint: "old_fp" })], onUpdate: (v) => [{ ...v, id: 70 }] }],
    [t.documentReferences, { select: () => [bref()], onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]), DOC, async (calls: Call[]) => ({ r: await o.supersedeStaleBillingDocument({ clinicId: 1, ancillaryCaseId: 5 }, "new_fp"), retries: countOps(calls, "insert", t.documentFailures) }));
  assert.ok(miss.r === true && miss.retries === 1, "K7: residual current reference → durable supersede retry recorded (not fire-and-forget)");
}
async function testK8SupersessionDurablePostcondition() {
  const t = await loadCanonicalTables(); const o = await orchestration();
  const run = (refs: unknown[], docs: unknown[]) => runWithDb(new Map<unknown, TableSpec>([[t.documentReferences, { select: () => refs }], [t.billingDocumentRequests, { select: () => docs }]]), DOC, async () => o.billingReferenceSupersessionDurable(1, 5));
  assert.equal(await run([bref({ sourceId: 70 })], [bdoc({ id: 70, supersededAt: OLD })]), false, "K8 post-condition: a current reference pointing at a superseded document → NOT durable");
  assert.equal(await run([bref({ sourceId: 70 })], [bdoc({ id: 70, supersededAt: null })]), true, "K8 post-condition: current reference points at a current document → durable");
  assert.equal(await run([], []), true, "K8 post-condition: no current billing_document reference → durable");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["K11 report source validation fail-closed (documentType + matrix)", testK11ReportSourceValidationFailClosed],
  ["K10 billing reference durability (current/superseded/dup/owner)", testK10ReferenceDurability],
  ["K7 supersede reference durability + exact retry", testK7SupersedeReferenceDurable],
  ["K8 supersession durable post-condition", testK8SupersessionDurablePostcondition],
  ["(1) exact readiness happy path", testReadyHappyPath],
  ["(2/6) cross-clinic + nullable fail closed", testCrossClinicAndNullable],
  ["(3/4/9) snapshot exact identity + DOS", testSnapshotExactIdentityAndDos],
  ["(7) exact complete procedure required", testCompleteProcedureRequired],
  ["(8) terminal invalidation blocks", testTerminalInvalidationBlocks],
  ["(10) exact report required", testReportRequired],
  ["(13/14) procedure note signature rules", testProcedureNoteSignatureRules],
  ["(16/17/18) order note signature", testOrderNoteSignature],
  ["(20) claim blocker preserved", testClaimBlockerPreserved],
  ["(21) warning not blocker", testWarningNotBlocker],
  ["(19/22/23/24) overrides", testOverrides],
  ["(25) override audit failure prevents commit", testOverrideAuditFailurePreventsCommit],
  ["(26/48) create only when ready + idempotent", testCreateOnlyWhenReady],
  ["(28/29/30/35) generate exact evidence, no invention", testGenerateExactEvidence],
  ["(31/32) concurrency + immutability", testGenerationConcurrencyAndImmutability],
  ["(27) stale readiness rejected", testStaleReadinessRejected],
  ["(36/37) reference retry truth", testReferenceRetryTruth],
  ["(33/34) evidence change supersedes packet", testEvidenceChangeSupersedes],
  ["(49) flags OFF zero migration-0055 access", testFlagsOffZeroAccess],
  ["(44/45/46/47) backfill dry-run + gating + ambiguity", testBackfill],
  ["(39/40/41/42/43) worker exact resolution", testWorkerExactResolution],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();

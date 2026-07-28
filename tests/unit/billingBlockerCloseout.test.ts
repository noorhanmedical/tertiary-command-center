// Phase 2G blocker closeout — fail-closed config (§3), exact evidence (§4),
// executable link_billing_document recovery (§5).
//
//   npx tsx tests/unit/billingBlockerCloseout.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const evaluator = () => import("../../server/services/billingLifecycle/billingReadinessEvaluator");
const orchestration = () => import("../../server/services/billingLifecycle/billingLifecycleOrchestration");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const READY = { ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true, canonicalBillingReadiness: true } as const;
const DOC = { ...READY, canonicalBillingDocument: true } as const;
const GEN = { ...DOC, billingDocumentGenerator: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", procedureStatus: "complete", completedAt: OLD, createdAt: CREATED_AT, ...o }; }
function ref(kind: string, o: Record<string, unknown> = {}) { return { id: 40, clinicId: 1, ancillaryCaseId: 5, documentKind: kind, serviceType: "BrainWave", documentStatus: "uploaded", signedAt: null, sourceId: 900, sourceTable: "x", supersededAt: null, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return ref("report", { id: 41, documentStatus: "uploaded", sourceTable: "case_document_readiness", sourceId: 1000, ...o }); }
function pnRef(o: Record<string, unknown> = {}) { return ref("procedure_note", { id: 42, documentStatus: "signed", signedAt: OLD, sourceTable: "procedure_notes", sourceId: 900, ...o }); }
function onRef(o: Record<string, unknown> = {}) { return ref("order_note", { id: 43, documentStatus: "signed", signedAt: OLD, sourceTable: "procedure_notes", sourceId: 800, ...o }); }
function pnNote(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "post_procedure_note", signatureStatus: "signed", signedAt: OLD, supersededAt: null, ...o }; }
function onNote(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, supersededAt: null, ...o }; }
function cfg(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, serviceType: "BrainWave", requirementCode: "order_note_signature", blockerCategory: "billing_blocker", blocksStage: "billing_readiness", required: false, overrideAllowed: false, overrideRoles: null, overrideAuditRequired: true, active: true, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", procedureEventId: 300, billingBlockers: [], claimBlockers: [], warnings: [], evidenceFingerprint: "bef_x", evidenceSnapshot: { procedure_completed_at: OLD.toISOString(), procedure_event_id: 300 }, evaluatedAt: OLD, supersededAt: null, ...o }; }
function docRow(o: Record<string, unknown> = {}) { return { id: 70, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", evidenceFingerprint: "bef_x", billingReadinessCheckId: 100, procedureEventId: 300, claimBlockers: [], warnings: [], generatedByAi: false, globalPlexusPatientId: 10, patientClinicMembershipId: 20, executionCaseId: 900, patientScreeningId: 77, createdAt: CREATED_AT, ...o }; }
function migErr(): Error { const e = new Error("mig") as Error & { code?: string }; e.code = "42P01"; return e; }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }

/** Evaluator spec whose CONFIG read throws (fail-closed §3). */
function configFailSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { configErr?: Error; docFailInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.prerequisiteConfig, { select: () => { throw o.configErr ?? new Error("config db down"); } }],
    [t.documentFailures, { select: () => [], onInsert: o.docFailInsert ?? ((v) => [{ ...v, id: 1 }]) }],
    // These must NEVER be written when config fails closed.
    [t.billingReadinessChecks, { onInsert: () => { throw new Error("must not persist readiness on config failure"); }, onUpdate: () => { throw new Error("must not write"); } }],
  ]);
}

// §3(1/2/4) config read failure → requirements_unavailable_retry_recorded, no readiness/doc write
async function testConfigFailClosedRecorded() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(configFailSpec(t), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "requirements_unavailable_retry_recorded", "(§3-1/2) config failure never becomes ready + no doc");
}

// §3(3) migration missing stays DISTINCT from a generic config failure
async function testConfigFailMigrationDistinct() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(configFailSpec(t, { configErr: migErr() }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "migration_missing", "(§3-3) migration missing distinct");
}

// §3(5) retry-persistence failure surfaced
async function testConfigFailNotRecorded() {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(configFailSpec(t, { docFailInsert: () => { throw new Error("ledger down"); } }), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "requirements_unavailable_retry_not_recorded", "(§3-5) retry persistence failure surfaced");
}

// §3 worker never resolves requirements_unavailable
async function testWorkerNeverResolvesRequirementsUnavailable() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 9, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: null, sourceId: null, requestedAction: "evaluate_billing_readiness", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 9 }]; }, onInsert: (v) => [{ ...v, id: 10 }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.prerequisiteConfig, { select: () => { throw new Error("config down"); } }],
    [t.billingReadinessChecks, { onInsert: () => { throw new Error("no write"); } }],
  ]);
  const res = await runWithDb(spec, READY, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "requirements_unavailable never resolves");
  assert.equal(resolves, 0);
}

/** §4 evaluator spec (fully valid unless overridden). Reference read order:
 *  report, procedure_note, order_note. Note read order: pn note, on note. */
function evalSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { report?: unknown[]; pn?: unknown[]; on?: unknown[]; pnNote?: unknown[]; onNote?: unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([o.report ?? [reportRef()], o.pn ?? [pnRef()], o.on ?? [onRef()]]) }],
    [t.procedureNotes, { select: qsel([o.pnNote ?? [pnNote()], o.onNote ?? [onNote()]]) }],
    [t.prerequisiteConfig, { select: () => [cfg()] }],
    [t.billingReadinessChecks, { onUpdate: () => [], onInsert: (v) => [{ ...v, id: 100 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
}
async function expectBlock(o: Parameters<typeof evalSpec>[1], code: string, label: string) {
  const t = await loadCanonicalTables(); const e = await evaluator();
  const r = await runWithDb(evalSpec(t, o), READY, async () => e.evaluateCanonicalBillingReadiness({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "missing_requirements", `${label}: not ready`);
  assert.ok(r.billingBlockers!.some((b) => b.code === code), `${label}: expected ${code}, got ${r.billingBlockers!.map((b) => b.code).join(",")}`);
}

// §4 exact report evidence mismatches
async function testReportEvidence() {
  await expectBlock({ report: [reportRef({ clinicId: 2 })] }, "report_source_ownership_mismatch", "(§4) report wrong clinic");
  await expectBlock({ report: [reportRef({ ancillaryCaseId: 6 })] }, "report_source_ownership_mismatch", "(§4) report wrong case");
  await expectBlock({ report: [reportRef({ serviceType: "Cardio" })] }, "report_source_ownership_mismatch", "(§4) report wrong service");
  await expectBlock({ report: [reportRef({ sourceTable: "wrong_table" })] }, "report_source_table_mismatch", "(§4) report wrong source table");
  await expectBlock({ report: [reportRef(), reportRef({ id: 44 })] }, "report_evidence_ambiguous", "(§4) report ambiguity surfaced");
}

// §4 exact Procedure Note evidence mismatches
async function testProcedureNoteEvidence() {
  await expectBlock({ pn: [pnRef({ sourceTable: "wrong" })] }, "procedure_note_source_table_mismatch", "(§4) pn wrong source table");
  await expectBlock({ pnNote: [pnNote({ noteType: "order_note" })] }, "procedure_note_wrong_note_type", "(§4) pn wrong note type");
  await expectBlock({ pnNote: [pnNote({ supersededAt: OLD })] }, "procedure_note_superseded", "(§4) pn superseded note");
  await expectBlock({ pnNote: [pnNote({ clinicId: 2 })] }, "procedure_note_note_ownership_mismatch", "(§4) pn note wrong clinic");
  await expectBlock({ pn: [pnRef({ documentStatus: "signed", signedAt: OLD })], pnNote: [pnNote({ signatureStatus: "needs_signature", signedAt: null })] }, "procedure_note_reference_signed_note_unsigned", "(§4) signed ref → unsigned note");
  await expectBlock({ pn: [pnRef(), pnRef({ id: 45 })] }, "procedure_note_evidence_ambiguous", "(§4) pn ambiguity surfaced");
}

// §4 exact Order Note evidence mismatches
async function testOrderNoteEvidence() {
  await expectBlock({ onNote: [onNote({ noteType: "post_procedure_note" })] }, "order_note_wrong_note_type", "(§4) on wrong note type");
  await expectBlock({ onNote: [onNote({ supersededAt: OLD })] }, "order_note_superseded", "(§4) on superseded note");
  await expectBlock({ onNote: [onNote({ clinicId: 2 })] }, "order_note_note_ownership_mismatch", "(§4) on note wrong clinic");
  await expectBlock({ on: [onRef(), onRef({ id: 46 })] }, "order_note_evidence_ambiguous", "(§4) on ambiguity surfaced");
}

// §5(1/2/3) link_billing_document CREATES the missing reference + resolves; idempotent
async function testLinkCreatesMissingReference() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 20, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 70, requestedAction: "link_billing_document", resolvedAt: null, attemptCount: 1 };
  let resolves = 0; let refInserted = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 20 }]; }, onInsert: (v) => [{ ...v, id: 21 }] }],
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "generated" })] }],
    [t.billingReadinessChecks, { select: () => [readinessRow()] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => { refInserted++; return [{ ...v, id: 71 }]; } }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "(§5-1/2) link creates the missing reference then resolves");
  assert.equal(resolves, 1); assert.ok(refInserted >= 1, "(§5-1) reference was created");
}

// §5(6) sync_billing_document_reference does NOT create a missing reference
async function testSyncDoesNotCreate() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 22, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 70, requestedAction: "sync_billing_document_reference", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 22 }]; }, onInsert: (v) => [{ ...v, id: 23 }] }],
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "generated" })] }],
    [t.documentReferences, { select: () => [], onInsert: () => { throw new Error("sync must NOT create a reference"); } }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "reference_missing", "(§5-6) sync never creates; stays reference_missing");
  assert.equal(resolves, 0, "(§5-6/7) never resolves without an existing reference");
}

// §5(4) wrong clinic/case source is denied
async function testLinkOwnershipDenied() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 24, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 70, requestedAction: "link_billing_document", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 24 }]; } }],
    [t.billingDocumentRequests, { select: () => [docRow({ clinicId: 2, canonicalStatus: "generated" })] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "(§5-4) wrong-clinic source denied");
  assert.equal(resolves, 0);
}

// §5(8) sibling failures remain untouched
async function testSiblingUntouched() {
  const t = await loadCanonicalTables(); const w = await worker();
  const ok = { id: 30, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 70, requestedAction: "link_billing_document", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 31, clinicId: 1, ancillaryCaseId: 5, documentKind: "billing_document", sourceTable: "billing_document_requests", sourceId: 71, requestedAction: "link_billing_document", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [ok, sibling], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 30 }]; }, onInsert: (v) => [{ ...v, id: 40 }] }],
    // doc 70 generated → link creates + resolves; doc 71 not found → sibling deferred.
    [t.billingDocumentRequests, { select: qsel([[docRow({ id: 70, canonicalStatus: "generated" })], []]) }],
    [t.billingReadinessChecks, { select: () => [readinessRow()] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 71 }] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[30], "resolved", "(§5) exact resolve");
  assert.notEqual(byId[31], "resolved", "(§5-8) sibling untouched");
  assert.equal(resolves, 1);
}

// §6 — live trigger: flags OFF performs ZERO canonical billing-table operations
async function testTriggerFlagsOffZeroAccess() {
  const t = await loadCanonicalTables(); const o = await orchestration();
  const r = await runWithDb(new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { throw new Error("no read"); }, onInsert: () => { throw new Error("no write"); } }],
    [t.billingDocumentRequests, { select: () => { throw new Error("no read"); } }],
    [t.ancillaryCases, { select: () => { throw new Error("no read"); } }],
  ]), {}, async (calls: Call[]) => {
    const res = await o.triggerBillingReadinessForCommittedCase({ clinicId: 1, ancillaryCaseId: 5, source: "procedure_note_signed" });
    assert.equal(countOps(calls, "select", t.billingReadinessChecks), 0, "(§6) zero readiness reads when OFF");
    assert.equal(countOps(calls, "select", t.billingDocumentRequests), 0, "(§6) zero document reads when OFF");
    return res;
  });
  assert.equal(r, null, "(§6) trigger is a no-op with flags OFF");
}

// §6 — null clinic/case is a no-op (exact identity only; never cross-triggers)
async function testTriggerNullOwnershipNoop() {
  const o = await orchestration();
  const a = await runWithDb(new Map(), READY, async () => o.triggerBillingReadinessForCommittedCase({ clinicId: null, ancillaryCaseId: 5, source: "x" }));
  const b = await runWithDb(new Map(), READY, async () => o.triggerBillingReadinessForCommittedCase({ clinicId: 1, ancillaryCaseId: null, source: "x" }));
  assert.equal(a, null); assert.equal(b, null, "(§6) exact clinic+case required");
}

// §6 — a terminal procedure transition (cancelled) supersedes the current Billing
// Document via the trigger; the parent transition is never reversed (non-throwing).
async function testTerminalSupersedesViaTrigger() {
  const t = await loadCanonicalTables(); const o = await orchestration();
  let superseded = false;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "cancelled", completedAt: null })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [pnRef()], [onRef()]]), onUpdate: () => [{}] }],
    [t.procedureNotes, { select: qsel([[pnNote()], [onNote()]]) }],
    [t.prerequisiteConfig, { select: () => [cfg()] }],
    [t.billingReadinessChecks, { onUpdate: () => [], onInsert: (v) => [{ ...v, id: 101 }], select: () => [] }],
    [t.billingDocumentRequests, { select: () => [docRow({ canonicalStatus: "generated", evidenceFingerprint: "bef_OLD" })], onUpdate: (v) => { if ((v as any).canonicalStatus === "superseded") superseded = true; return [docRow({ canonicalStatus: "superseded" })]; } }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, DOC, async () => o.triggerBillingReadinessForCommittedCase({ clinicId: 1, ancillaryCaseId: 5, source: "procedure_cancelled" }));
  assert.equal(r?.status, "superseded_stale_document", "(§6) terminal transition supersedes stale Billing Document");
  assert.ok(superseded, "(§6) current document stamped superseded");
}

// §6 — the live hooks are actually WIRED into the real upstream boundaries.
async function testHooksWired() {
  const { readFileSync } = await import("node:fs"); const { join } = await import("node:path");
  const wiring: Array<[string, number]> = [
    ["server/services/physicianPortal/signatureWorkflow.ts", 2],      // signed + returned
    ["server/services/procedureLifecycle/procedureStateMachine.ts", 1], // terminal transitions
    ["server/services/procedureLifecycle/canonicalProcedureCompletion.ts", 1], // completion
    ["server/services/ancillaryDocuments/documentReferenceWriter.ts", 1], // report replacement
  ];
  for (const [f, count] of wiring) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    const n = (src.match(/triggerBillingReadinessForCommittedCase/g) ?? []).length;
    assert.ok(n >= count, `(§6) ${f} must wire the billing trigger (>= ${count}, got ${n})`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["§6 trigger flags OFF → zero canonical access", testTriggerFlagsOffZeroAccess],
  ["§6 trigger null clinic/case no-op", testTriggerNullOwnershipNoop],
  ["§6 terminal transition supersedes via trigger", testTerminalSupersedesViaTrigger],
  ["§6 live hooks wired into upstream boundaries", testHooksWired],
  ["§3(1/2/4) config fail-closed → retry recorded, no ready/doc", testConfigFailClosedRecorded],
  ["§3(3) migration missing distinct", testConfigFailMigrationDistinct],
  ["§3(5) retry persistence failure surfaced", testConfigFailNotRecorded],
  ["§3 worker never resolves requirements_unavailable", testWorkerNeverResolvesRequirementsUnavailable],
  ["§4 exact report evidence mismatches", testReportEvidence],
  ["§4 exact Procedure Note evidence mismatches", testProcedureNoteEvidence],
  ["§4 exact Order Note evidence mismatches", testOrderNoteEvidence],
  ["§5(1/2/3) link creates missing reference + resolves", testLinkCreatesMissingReference],
  ["§5(6/7) sync does not create missing reference", testSyncDoesNotCreate],
  ["§5(4) link ownership denied", testLinkOwnershipDenied],
  ["§5(8) sibling untouched", testSiblingUntouched],
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

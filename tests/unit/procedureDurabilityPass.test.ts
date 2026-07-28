// Phase 2F durability pass — generator/amendment/void retry truth, terminal
// transition reconciliation surfacing, and backfill apply-work queueing.
//
//   npx tsx tests/unit/procedureDurabilityPass.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const gen = () => import("../../server/services/procedureLifecycle/procedureNoteGenerator");
const lineage = () => import("../../server/services/procedureLifecycle/procedureNoteLineage");
const routes = () => import("../../server/routes/procedureEvents");
const backfill = () => import("../../script/backfillCanonicalProcedureLifecycle");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true } as const;
const GEN = { ...ALL, procedureNoteGenerator: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "in_progress", completedByUserId: null, completedAt: OLD, note: null, metadata: {}, globalPlexusPatientId: null, patientClinicMembershipId: null, startedAt: OLD, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function noteRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "generated", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, generatedText: "x", createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 1000, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", patientScreeningId: 77, executionCaseId: 900, ...o }; }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
function fakeApp() { const table: Record<string, (req: any, res: any) => unknown> = {}; const app = { get: (p: string, h: any) => { table[`GET ${p}`] = h; }, post: (p: string, h: any) => { table[`POST ${p}`] = h; } }; return { app, table }; }
function mockRes() { const res: any = { statusCode: 200, body: undefined }; res.status = (c: number) => { res.statusCode = c; return res; }; res.json = (b: any) => { res.body = b; return res; }; return res; }

// (2) generator retry-persistence failure is surfaced (retry_not_recorded)
async function testGeneratorRetryNotRecorded() {
  const t = await loadCanonicalTables(); const g = await gen();
  let calls = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: (v) => { calls++; return calls === 1 ? [noteRow({ generationStatus: "generating" })] : [{ ...v }]; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete" })] }],
    [t.documentReferences, { select: qsel([[reportRef()], []]) }], // report source unresolvable
    [t.caseDocumentReadiness, { select: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "report_content_unavailable_retry_not_recorded", "(2) generator persistence failure surfaced");
}

// (5) amendment reference failure + retry failure → not reported as reconciled
async function testAmendmentBothFail() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    // no prior ref; new-reference createReference insert throws AND retry ledger throws.
    [t.documentReferences, { select: () => [], onInsert: () => { throw new Error("ref down"); } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(r.status, "reconciliation_not_recorded", "(5) neither projection nor retry persisted → not amended");
}

// (7) void with missing reference does not silently return voided
async function testVoidMissingReference() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { select: () => [] }], // no procedure_note reference
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.voidProcedureNoteLineageForCase({ clinicId: 1, ancillaryCaseId: 5, reason: "cancelled", actorUserId: "u1" }));
  assert.equal(r.status, "voided_retry_recorded", "(7) missing reference → not silently voided");
}

// (8) void retry-persistence failure is surfaced (reference_missing)
async function testVoidRetryNotRecorded() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { select: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.voidProcedureNoteLineageForCase({ clinicId: 1, ancillaryCaseId: 5, reason: "cancelled", actorUserId: "u1" }));
  assert.equal(r.status, "reference_missing", "(8) void retry persistence failure surfaced");
}

// (9/10/11/12) terminal-transition routes surface note reconciliation truth; parent stays committed
async function testTerminalRoutesSurfaceReconciliation() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const procRef = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  const spec = () => new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { select: () => [procRef], onUpdate: () => [procRef] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  for (const [path, body] of [
    ["POST /api/procedure-events/:id/cancel", { reason: "x" }],
    ["POST /api/procedure-events/:id/no-show", {}],
    ["POST /api/procedure-events/:id/unable-to-complete", { reason: "x" }],
  ] as const) {
    const res = mockRes();
    await runWithDb(spec(), ALL, async () => table[path]({ clinicId: 1, params: { id: "300" }, body, session: { userId: "u1" } }, res));
    assert.equal(res.statusCode, 200, `${path} committed`);
    assert.equal(res.body.status, "transitioned", "(12) parent transition remains committed");
    assert.equal(res.body.noteReconciliation, "voided", `${path} surfaces note reconciliation truth`);
  }
  // A deferred reconciliation (missing reference) is surfaced, transition still committed.
  const deferredSpec = new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { select: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const res = mockRes();
  await runWithDb(deferredSpec, ALL, async () => table["POST /api/procedure-events/:id/cancel"]({ clinicId: 1, params: { id: "300" }, body: { reason: "x" }, session: { userId: "u1" } }, res));
  assert.equal(res.body.status, "transitioned");
  assert.equal(res.body.noteReconciliation, "deferred_retry_recorded", "(9) deferred reconciliation surfaced, transition committed");
}

// (13/14/15) backfill apply queues exact reconciliation work per classification, never generates
async function testBackfillApplyQueues() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
    [t.procedureNotes, { select: () => [], onInsert: () => { throw new Error("backfill must not create notes"); } }],
  ]);
  const pe = peRow({ ancillaryCaseId: 5 });
  const outcomes = ["procedure_note_reference_create", "note_generation_candidate", "generated_note_amendment_required", "signed_evidence_conflict", "voided_or_terminal_with_current_note"] as any;
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await b.queueApplyWork(pe as any, outcomes, { caseId: 5, noteId: 900 });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "(14) backfill never generates note bodies");
    return res;
  });
  assert.ok(["applied", "apply_deferred"].includes(r.overall), JSON.stringify(r));
  const actions = new Set(queued.map((q) => q.requestedAction));
  for (const a of ["link_procedure_note", "generate_procedure_note", "reconcile_procedure_note_lineage", "link_procedure_note_evidence", "void_procedure_note"]) {
    assert.ok(actions.has(a), `(13) apply queues exact ${a} work`);
  }
  // (15) exact source ids for note-bearing retries.
  const gen = queued.find((q) => q.requestedAction === "generate_procedure_note");
  assert.equal(gen!.sourceId, 900, "exact note id");
  assert.equal(gen!.sourceTable, "procedure_notes");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(2) generator retry-persistence failure surfaced", testGeneratorRetryNotRecorded],
  ["(5) amendment reference+retry both fail → not reconciled", testAmendmentBothFail],
  ["(7) void missing reference is not silently voided", testVoidMissingReference],
  ["(8) void retry-persistence failure surfaced", testVoidRetryNotRecorded],
  ["(9/10/11/12) terminal routes surface reconciliation truth", testTerminalRoutesSurfaceReconciliation],
  ["(13/14/15) backfill apply queues exact work, never generates", testBackfillApplyQueues],
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

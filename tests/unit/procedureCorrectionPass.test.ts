// Phase 2F correction pass — start-insert truth, explicit overrides, atomic
// lineage/void, completion-from-state, and transition reason enforcement.
//
//   npx tsx tests/unit/procedureCorrectionPass.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const sm = () => import("../../server/services/procedureLifecycle/procedureStateMachine");
const lineage = () => import("../../server/services/procedureLifecycle/procedureNoteLineage");
const completion = () => import("../../server/services/procedureLifecycle/canonicalProcedureCompletion");
const routes = () => import("../../server/routes/procedureEvents");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const LIFE = { canonicalProcedureLifecycle: true, canonicalAppointment: true } as const;
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "not_started", completedByUserId: null, completedAt: null, note: null, metadata: {}, globalPlexusPatientId: null, patientClinicMembershipId: null, startedAt: null, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function noteRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "generated", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, generatedText: "x", createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function apptEvt(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "BrainWave", status: "scheduled", executionCaseId: 900, patientScreeningId: 77, startsAt: OLD, endsAt: null, source: "x", metadata: {}, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function prereqRow(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, serviceType: "BrainWave", requirementCode: "informed_consent", blockerCategory: "hard_procedure_blocker", blocksStage: "procedure_start", required: true, overrideAllowed: true, overrideRoles: "admin", overrideAuditRequired: true, active: true, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
const flush = () => new Promise((r) => setImmediate(r));

function fakeApp() { const table: Record<string, (req: any, res: any) => unknown> = {}; const app = { get: (p: string, h: any) => { table[`GET ${p}`] = h; }, post: (p: string, h: any) => { table[`POST ${p}`] = h; } }; return { app, table }; }
function mockRes() { const res: any = { statusCode: 200, body: undefined }; res.status = (c: number) => { res.statusCode = c; return res; }; res.json = (b: any) => { res.body = b; return res; }; return res; }

function startSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { configs?: unknown[]; onPeInsert?: (v: any) => unknown[]; journeyOnInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [apptEvt()], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.prerequisiteConfig, { select: () => o.configs ?? [] }],
    [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureEvents, { select: () => [], onInsert: o.onPeInsert ?? ((v) => [{ ...peRow(), ...v, id: 300 }]) }],
    [t.journeyEvents, { onInsert: o.journeyOnInsert ?? (() => []) }],
  ]);
}

// (1/2/3/4) start inserts in_progress directly — never a completed row, no completedAt
async function testStartInsertsInProgress() {
  const t = await loadCanonicalTables(); const s = await sm();
  let payload: Record<string, unknown> | null = null;
  const spec = startSpec(t, { onPeInsert: (v) => { payload = v; return [{ ...peRow(), ...v, id: 300 }]; } });
  const r = await runWithDb(spec, LIFE, async (calls: Call[]) => {
    const res = await s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u1" });
    assert.equal(countOps(calls, "insert", t.procedureEvents), 1, "(2) exactly one procedure-event write");
    return res;
  });
  assert.equal(r.status, "started");
  const p = payload as Record<string, unknown>;
  assert.equal(p.procedureStatus, "in_progress", "(1) start inserts in_progress directly");
  assert.equal(p.completedAt, null, "(4) start never sets completedAt");
  assert.equal(p.completedByUserId, null);
  assert.ok(p.startedAt instanceof Date && p.lastTransitionAt instanceof Date, "server timestamps stamped");
  assert.notEqual(p.procedureStatus, "complete", "(3) never a completed row");
}

// (5) start triggers no completion-derived side effects (no badge/readiness/billing writes)
async function testStartNoCompletionSideEffects() {
  const t = await loadCanonicalTables(); const s = await sm();
  const spec = startSpec(t);
  await runWithDb(spec, LIFE, async (calls: Call[]) => {
    await s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u1" });
    await flush();
    assert.equal(countOps(calls, "insert", t.gse), 0, "(5) no procedure-complete badge on start");
    assert.equal(countOps(calls, "insert", t.caseDocumentReadiness), 0, "(5) no completion readiness on start");
  });
}

// (11) an applied override writes a PHI-free audit event
async function testOverrideAuditWritten() {
  const t = await loadCanonicalTables(); const s = await sm();
  const journey: Record<string, unknown>[] = [];
  const spec = startSpec(t, { configs: [prereqRow()], journeyOnInsert: (v) => { journey.push(v); return []; } });
  const r = await runWithDb(spec, LIFE, async () => s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u9", actorRole: "admin", override: { reason: "urgent", requirementCodes: ["informed_consent"] } }));
  assert.equal(r.status, "started");
  const ov = journey.find((j) => j.eventType === "procedure_prerequisite_override");
  assert.ok(ov, "(11) override audit event written");
  assert.equal((ov!.metadata as Record<string, unknown>).requirement_code, "informed_consent");
  assert.equal((ov!.metadata as Record<string, unknown>).actor_role, "admin");
  assert.equal(ov!.patientName, "[procedure_lifecycle_audit]", "PHI-free audit");
}

// (12) override audit failure defers the start (transactional)
async function testOverrideAuditFailureDefers() {
  const t = await loadCanonicalTables(); const s = await sm();
  const spec = startSpec(t, { configs: [prereqRow()], journeyOnInsert: () => { throw new Error("audit ledger down"); } });
  const r = await runWithDb(spec, LIFE, async () => s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u9", actorRole: "admin", override: { reason: "urgent", requirementCodes: ["informed_consent"] } }));
  assert.equal(r.status, "override_audit_failed", "(12) audit failure → start deferred, not silently started");
}

// (17/18) amendment: reference zero-row rolls back the note change (deferred, not amended)
async function testAmendmentReferenceRollback() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const priorRef = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  const spec = new Map<unknown, TableSpec>([
    // prior ref exists but its supersede update affects zero rows → rollback.
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    [t.documentReferences, { select: () => [priorRef], onUpdate: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.ok(r.status !== "amended_reference_created" && r.status !== "amended_reference_retry_recorded", "(18) partial reference failure never returns amended");
  assert.equal(r.status, "reconciliation_not_recorded");
}

// (19/20) void: reference zero-row rolls back the note void (deferred, not voided)
async function testVoidReferenceRollback() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const procRef = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { select: () => [procRef], onUpdate: () => [] }], // ref update zero rows
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.voidProcedureNoteLineageForCase({ clinicId: 1, ancillaryCaseId: 5, reason: "cancelled", actorUserId: "u1" }));
  assert.ok(r.status !== "voided" && r.status !== "voided_retry_recorded", "(20) partial reference failure never returns voided");
  assert.equal(r.status, "deferred_retry_recorded");
}

// (21) amendment records an exact durable link retry when the new reference can't be created
async function testAmendmentNewReferenceRetry() {
  const t = await loadCanonicalTables(); const l = await lineage();
  let failurePayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    // no prior ref; new reference createReference throws → durable retry recorded.
    [t.documentReferences, { select: () => [], onInsert: () => { const e = new Error("boom") as any; e.code = "08006"; throw e; } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => { failurePayload = v; return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(r.status, "amended_reference_retry_recorded");
  assert.equal(r.newReferenceCreated, false);
  const f = failurePayload as Record<string, unknown>;
  assert.equal(f.requestedAction, "link_procedure_note", "(21) exact durable link retry for the new note");
  assert.equal(f.sourceId, 901, "exact new note id");
}

// (27) completion from not_started is rejected (never jumps to complete)
async function testCompletionFromNotStartedRejected() {
  const t = await loadCanonicalTables(); const c = await completion();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "not_started" })], onUpdate: (v) => [{ ...v }] }],
  ]);
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5 });
    assert.equal(countOps(calls, "update", t.procedureEvents), 0, "not_started never updated to complete");
    return res;
  });
  assert.equal(r.status, "invalid_from_state");
  assert.equal(r.completionCommitted, false);
}

// (25/26) cancel + unable-to-complete require a non-empty reason (route → 400)
async function testTransitionReasonsRequired() {
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  for (const path of ["POST /api/procedure-events/:id/cancel", "POST /api/procedure-events/:id/unable-to-complete"]) {
    const res = mockRes();
    await table[path]({ clinicId: 1, params: { id: "300" }, body: {}, session: { userId: "u1" } }, res);
    assert.equal(res.statusCode, 400, `${path} requires a reason`);
  }
  // no-show does not require a reason (optional).
  const t = await loadCanonicalTables();
  await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }], [t.procedureNotes, { select: () => [] }],
    [t.documentReferences, { select: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]), LIFE, async () => {
    const res = mockRes();
    await table["POST /api/procedure-events/:id/no-show"]({ clinicId: 1, params: { id: "300" }, body: {}, session: { userId: "u1" } }, res);
    assert.equal(res.statusCode, 200, "no-show reason is optional");
  });
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/2/3/4) start inserts in_progress directly", testStartInsertsInProgress],
  ["(5) start triggers no completion side effects", testStartNoCompletionSideEffects],
  ["(11) applied override writes PHI-free audit", testOverrideAuditWritten],
  ["(12) override audit failure defers start", testOverrideAuditFailureDefers],
  ["(17/18) amendment reference rollback", testAmendmentReferenceRollback],
  ["(19/20) void reference rollback", testVoidReferenceRollback],
  ["(21) amendment new-reference durable retry", testAmendmentNewReferenceRetry],
  ["(27) completion from not_started rejected", testCompletionFromNotStartedRejected],
  ["(25/26) cancel/unable require a reason", testTransitionReasonsRequired],
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

// Phase 2F retry execution finalization — failed-note regeneration, exact
// void-reference recovery, executable backfill generation candidates, and
// exact-only retry resolution.
//
//   npx tsx tests/unit/procedureRetryExecutionFinalization.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const gen = () => import("../../server/services/procedureLifecycle/procedureNoteGenerator");
const lineage = () => import("../../server/services/procedureLifecycle/procedureNoteLineage");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const backfill = () => import("../../script/backfillCanonicalProcedureLifecycle");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true } as const;
const GEN = { ...ALL, procedureNoteGenerator: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "complete", completedByUserId: null, completedAt: OLD, note: null, metadata: {}, globalPlexusPatientId: null, patientClinicMembershipId: null, startedAt: OLD, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function noteRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "failed", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, generatedText: null, errorMessage: "prior", createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 1000, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", patientScreeningId: 77, executionCaseId: 900, ...o }; }
function procRef(o: Record<string, unknown> = {}) { return reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "pending_signature", ...o }); }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
function qupd(a: unknown[][]): (v: Record<string, unknown>) => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }

/** Eligible-generation spec around a note in the given generationStatus. */
function genSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, note: Record<string, unknown>, o: { onNoteUpdate?: (v: any) => unknown[]; readiness?: unknown[]; docFailInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [note], onUpdate: o.onNoteUpdate ?? qupd([[{ ...note, generationStatus: "generating" }], [{ ...note, generationStatus: "generated" }]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => o.readiness ?? [readinessRow()] }],
    [t.documentFailures, { select: () => [], onInsert: o.docFailInsert ?? ((v) => [{ ...v, id: 1 }]) }],
  ]);
}

// (1) exact failed-note regeneration succeeds
async function testFailedRetrySucceeds() {
  const t = await loadCanonicalTables(); const g = await gen();
  const r = await runWithDb(genSpec(t, noteRow({ generationStatus: "failed" })), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "generated");
}

// (2) normal pending generator never casually reclaims a failed note
async function testPendingGeneratorSkipsFailed() {
  const t = await loadCanonicalTables(); const g = await gen();
  const r = await runWithDb(genSpec(t, noteRow({ generationStatus: "failed" })), GEN, async (calls: Call[]) => {
    const res = await g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 });
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "no claim on a failed note via the pending path");
    return res;
  });
  assert.equal(r.status, "not_pending");
}

// (4) failed-note retry-persistence failure is surfaced (report unavailable + ledger down)
async function testFailedRetryPersistenceSurfaced() {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: qupd([[noteRow({ generationStatus: "generating" })], [{}]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [reportRef()], []]) }], // report source unresolvable in finalize
    [t.caseDocumentReadiness, { select: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "report_content_unavailable_retry_not_recorded", "(4) persistence failure surfaced");
}

// (5/6) cross-clinic and cross-case failed-note retries are denied (no claim)
async function testFailedRetryTenancyDenied() {
  const t = await loadCanonicalTables(); const g = await gen();
  const xclinic = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ clinicId: 2 })], onUpdate: () => { throw new Error("must not claim"); } }]]), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(xclinic.status, "cross_clinic_denied", "(5) cross-clinic denied");
  const xcase = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ ancillaryCaseId: 6 })], onUpdate: () => { throw new Error("must not claim"); } }]]), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(xcase.status, "cross_clinic_denied", "(6) cross-case denied");
}

// (7) concurrent failed-note retries claim exactly once
async function testFailedRetryConcurrent() {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: () => [] }]]); // claim loses race
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "already_claimed", "(7) only one worker claims");
}

// (3/26) worker: failed-note retry that fails again is NOT resolved
async function testWorkerFailedGenerationNeverResolves() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => { resolves++; return [{ id: 1 }]; }, onInsert: (v) => [{ ...v, id: 2 }] }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: qupd([[noteRow({ generationStatus: "generating" })], [{}]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [] }], // report unresolvable → generation fails again
    [t.caseDocumentReadiness, { select: () => [] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "(3/26) failed generation never resolves");
  assert.equal(resolves, 0, "no resolution write");
}

// (8/9/12) exact void-reference reconciliation of the named superseded note
async function testVoidReferenceReconciled() {
  const t = await loadCanonicalTables(); const l = await lineage();
  let refPatch: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: (v) => { refPatch = v; return [procRef()]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "reconciled");
  assert.equal((refPatch as Record<string, unknown>).documentStatus, "voided", "(9) exact reference voided");
}

// (10) already-voided reference is idempotent
async function testVoidReferenceAlreadyReconciled() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.documentReferences, { select: () => [procRef({ documentStatus: "voided", supersededAt: OLD })], onUpdate: () => { throw new Error("must not update"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "already_reconciled");
}

// (11/12/24) source-bearing void: reference_missing never resolves, never via no_current_note
async function testSourceBearingVoidReferenceMissing() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 3, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => { resolves++; return [{ id: 3 }]; } }],
    // the exact note is already superseded; no procedure_note reference exists.
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.documentReferences, { select: () => [] }],
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "reference_missing", "(11) reference_missing surfaced");
  assert.equal(resolves, 0, "(12/24) source-bearing void never resolves on missing reference / no_current_note");
}

// (13) source-less case-level void may idempotently resolve on no_current_note
async function testSourceLessVoidResolves() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 4, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => { resolves++; return [{ id: 4 }]; } }],
    [t.procedureNotes, { select: () => [] }], // no current note → idempotent
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "(13) source-less no_current_note resolves");
  assert.equal(resolves, 1);
}

// (14/15/16/17) backfill generation candidate ensures + reloads exact note + queues exact generate
async function testBackfillGenerationCandidate() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const created = noteRow({ id: 900, generationStatus: "pending" });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    // ensure: eligibility report, getReferenceBySource [], getActiveReference [], insert.
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 60 }], onUpdate: (v) => [{ ...v }] }],
    // findCaseScoped [], findLegacyUnlinked [], insert; then reload currentNote → created.
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["note_generation_candidate"] as any, { caseId: 5, noteId: null }));
  assert.ok(["applied", "apply_deferred"].includes(r.overall), JSON.stringify(r));
  const g = queued.find((q) => q.requestedAction === "generate_procedure_note");
  assert.ok(g, "(16) generate work queued");
  assert.equal(g!.sourceId, 900, "(15/17) exact non-null reloaded note id — never sourceId=null");
  assert.equal(g!.sourceTable, "procedure_notes");
}

// (18) backfill note-create failure does not return applied and never queues null-source generation
async function testBackfillGenerationCandidateEnsureFails() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [] }], // report missing → ensure ineligible → no note
    [t.procedureNotes, { select: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["note_generation_candidate"] as any, { caseId: 5, noteId: null }));
  assert.equal(r.overall, "apply_deferred", "(18) no note created → not applied");
  assert.ok(!queued.some((q) => q.requestedAction === "generate_procedure_note"), "(17) never queues generation without an exact note");
}

// (22/23) amendment deferred-retry-recorded vs reconciliation_not_recorded
async function testAmendmentRetryTruth() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const priorRef = procRef();
  // Reference-conflict rollback + retry recorded → amendment_deferred_retry_recorded.
  const recorded = await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    [t.documentReferences, { select: () => [priorRef], onUpdate: () => [] }], // ref supersede zero-row → rollback
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]), ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(recorded.status, "amendment_deferred_retry_recorded", "(22) deferred retry recorded");
  // Same rollback but ledger also fails → reconciliation_not_recorded.
  const notRecorded = await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    [t.documentReferences, { select: () => [priorRef], onUpdate: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]), ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(notRecorded.status, "reconciliation_not_recorded", "(23) retry-not-recorded surfaced");
}

// (27/28) exact-id resolution leaves sibling failures untouched (no broad resolution)
async function testSiblingsUntouched() {
  const t = await loadCanonicalTables(); const w = await worker();
  const ok = { id: 10, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 11, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 901, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [ok, sibling], onUpdate: () => { resolves++; return [{ id: 10 }]; } }],
    // note 900 already generated → resolve; note 901 not found → sibling stays deferred.
    [t.procedureNotes, { select: qsel([[noteRow({ id: 900, generationStatus: "generated" })], []]) }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[10], "resolved", "(27) exact resolve");
  assert.notEqual(byId[11], "resolved", "(28) sibling untouched — no broad resolution");
  assert.equal(resolves, 1, "exactly one resolution");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) exact failed-note regeneration succeeds", testFailedRetrySucceeds],
  ["(2) pending generator never reclaims a failed note", testPendingGeneratorSkipsFailed],
  ["(4) failed-note retry-persistence failure surfaced", testFailedRetryPersistenceSurfaced],
  ["(5/6) failed-note retry tenancy denied", testFailedRetryTenancyDenied],
  ["(7) concurrent failed-note retries claim once", testFailedRetryConcurrent],
  ["(3/26) worker: failed generation never resolves", testWorkerFailedGenerationNeverResolves],
  ["(8/9/12) exact void-reference reconciled", testVoidReferenceReconciled],
  ["(10) already-reconciled is idempotent", testVoidReferenceAlreadyReconciled],
  ["(11/12/24) source-bearing void reference_missing never resolves", testSourceBearingVoidReferenceMissing],
  ["(13) source-less no_current_note resolves", testSourceLessVoidResolves],
  ["(14/15/16/17) backfill generation candidate executable", testBackfillGenerationCandidate],
  ["(18) backfill note-create failure not applied", testBackfillGenerationCandidateEnsureFails],
  ["(22/23) amendment retry truth", testAmendmentRetryTruth],
  ["(27/28) siblings untouched, no broad resolution", testSiblingsUntouched],
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

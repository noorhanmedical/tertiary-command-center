// Phase 2F-A3 — completion commit truth, exact retries, evidence consistency.
//
//   npx tsx tests/unit/procedureLifecycleCommitAndEvidenceTruth.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const completion = () => import("../../server/services/procedureLifecycle/canonicalProcedureCompletion");
const noteSvc = () => import("../../server/services/procedureLifecycle/procedureNoteService");
const orch = () => import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
const repo = () => import("../../server/repositories/procedureEvents.repo");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const routes = () => import("../../server/routes/procedureEvents");
const REPO_SRC = readFileSync(join(process.cwd(), "server/repositories/procedureEvents.repo.ts"), "utf8");

const OLD = new Date("2027-06-10T09:00:00Z");
const NEW = new Date("2027-06-20T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;

function caseRow(o: Record<string, unknown> = {}) {
  return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o };
}
function peRow(o: Record<string, unknown> = {}) {
  return { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "complete", completedByUserId: null, completedAt: OLD, note: null, metadata: {}, globalPlexusPatientId: null, patientClinicMembershipId: null, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o };
}
function reportRef(o: Record<string, unknown> = {}) {
  return { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...o };
}
function noteRow(o: Record<string, unknown> = {}) {
  return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o };
}
function gseEvt(o: Record<string, unknown> = {}) {
  return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "BrainWave", status: "scheduled", executionCaseId: 900, patientScreeningId: 77, startsAt: OLD, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null, source: "x", metadata: {}, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o };
}
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
const flush = () => new Promise((r) => setImmediate(r));

/** Spec for an eligible canonical completion that inserts a fresh note. */
function completionSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { peSelect?: () => unknown[]; onPeInsert?: (v: any) => unknown[]; gse?: TableSpec; noteSelect?: () => unknown[]; onNoteInsert?: (v: any) => unknown[]; procThrows?: string } = {}) {
  const noteSel = o.procThrows ? () => { const e = new Error("x") as any; e.code = o.procThrows; throw e; } : (o.noteSelect ?? qsel([[], []]));
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, o.gse ?? { select: () => [gseEvt()], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureEvents, { select: o.peSelect ?? qsel([[], [peRow()]]), onInsert: o.onPeInsert ?? ((v) => [{ ...peRow(), ...v, id: 300 }]), onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureNotes, { select: noteSel, onInsert: o.onNoteInsert ?? ((v) => [{ ...noteRow(), ...v, id: 900 }]), onUpdate: (v) => [{ ...noteRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
  ]);
}

function fakeApp() {
  const table: Record<string, (req: any, res: any) => unknown> = {};
  const app = { get: (p: string, h: any) => { table[`GET ${p}`] = h; }, post: (p: string, h: any) => { table[`POST ${p}`] = h; } };
  return { app, table };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

// (1/2/3) migration missing BEFORE the event write → not committed / not 201 / no mirror
async function testPreCommitMigration() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const spec = completionSpec(t, { peSelect: () => { const e = new Error("x") as any; e.code = "42703"; throw e; } });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5 });
    assert.equal(countOps(calls, "update", t.gse), 0, "(3) no schedule mirror before commit");
    return res;
  });
  assert.equal(r.status, "migration_missing");
  assert.equal(r.completionCommitted, false, "(1) not committed before event write");
  // (2) route maps pre-commit migration → 503, not 201.
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  await runWithDb(spec, ALL, async () => {
    const res = mockRes();
    await table["POST /api/procedure-events/complete"]({ clinicId: 1, body: { serviceType: "BrainWave", ancillaryCaseId: 5 }, session: {} }, res);
    assert.equal(res.statusCode, 503, "(2) pre-commit migration is 503, never 201");
  });
}

// (4) post-commit note migration failure → completionCommitted=true
async function testPostCommitNoteMigration() {
  const t = await loadCanonicalTables();
  const c = await completion();
  // Event write succeeds; the NOTE flow hits a missing schema element.
  const spec = completionSpec(t, { peSelect: qsel([[], [peRow()]]), procThrows: "42703" });
  const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5 }));
  assert.equal(r.completionCommitted, true, "(4) committed even when note reconciliation fails");
  assert.equal(r.status, "completed_reconciliation_migration_missing");
  assert.notEqual(r.status, "migration_missing", "distinct from the pre-commit migration status");
}

// (5) direct case + mismatched schedule event → rejected (pre-commit)
async function testMismatchedScheduleEvent() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [gseEvt({ ancillaryCaseId: 6 })] }], // event names a DIFFERENT case
  ]);
  const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }));
  assert.equal(r.status, "invalid_schedule_event");
  assert.equal(r.completionCommitted, false);
}

// (6) direct case + cross-clinic schedule event → denied
async function testCrossClinicScheduleEvent() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [gseEvt({ clinicId: 2 })] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }));
  assert.equal(r.status, "cross_clinic_denied");
  assert.equal(r.completionCommitted, false);
}

// (7) cancelled/no_show schedule event cannot qualify
async function testCancelledScheduleEvent() {
  const t = await loadCanonicalTables();
  const c = await completion();
  for (const status of ["cancelled", "no_show"]) {
    const spec = new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.gse, { select: () => [gseEvt({ status })] }],
    ]);
    const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }));
    assert.equal(r.status, "invalid_schedule_event", `${status} must not qualify`);
  }
  // doctor_visit is never valid procedure evidence.
  const dv = new Map<unknown, TableSpec>([[t.ancillaryCases, { select: () => [caseRow()] }], [t.gse, { select: () => [gseEvt({ eventType: "doctor_visit" })] }]]);
  const r = await runWithDb(dv, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }));
  assert.equal(r.status, "invalid_schedule_event", "doctor_visit is never procedure evidence");
}

// (8) schedule event execution/screening mismatch → rejected
async function testScheduleIdentityMismatch() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [gseEvt({ executionCaseId: 999 })] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700, executionCaseId: 900 }));
  assert.equal(r.status, "identity_mismatch");
}

// (9/10) route mirrors ONLY the validated schedule event, awaited, warning on failure
async function testRouteScheduleMirror() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  // (9) direct case + INVALID schedule id → 409, and the schedule is NEVER mutated.
  const invalidSpec = new Map<unknown, TableSpec>([[t.ancillaryCases, { select: () => [caseRow()] }], [t.gse, { select: () => [gseEvt({ status: "cancelled" })], onUpdate: (v) => [{ ...v }] }]]);
  await runWithDb(invalidSpec, ALL, async (calls: Call[]) => {
    const res = mockRes();
    await table["POST /api/procedure-events/complete"]({ clinicId: 1, body: { serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }, session: {} }, res);
    assert.equal(res.statusCode, 409, "mismatched schedule event → conflict");
    assert.equal(countOps(calls, "update", t.gse), 0, "(9) an unvalidated schedule event is never mutated");
  });
  // (10) valid mirror THROWS → route awaits it, warns, still 201 (completion committed).
  const throwSpec = completionSpec(t, { gse: { select: () => [gseEvt()], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: () => { throw new Error("mirror down"); } } });
  await runWithDb(throwSpec, ALL, async () => {
    const res = mockRes();
    await table["POST /api/procedure-events/complete"]({ clinicId: 1, body: { serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }, session: { userId: "u1" } }, res);
    assert.equal(res.statusCode, 201, "(10) committed completion returns 201 even when mirror fails");
    assert.ok((res.body.warnings ?? []).includes("schedule_mirror_failed"), "mirror failure is surfaced as a warning");
  });
}

// (11) existing-event completion WHERE includes exact ancillaryCaseId
async function testExistingWhereScoped() {
  // Behavioral (12/13) below cover compatibility; this asserts the exact-case
  // predicate is part of the scoped update (predicate-blind fake can't verify WHERE).
  assert.ok(/completeExistingProcedureEvent[\s\S]*?eq\(procedureEvents\.ancillaryCaseId, expected\.ancillaryCaseId\)/.test(REPO_SRC), "(11) update WHERE requires exact ancillaryCaseId");
  assert.ok(/eq\(procedureEvents\.serviceType, expected\.serviceType\)/.test(REPO_SRC), "update WHERE requires exact service");
}

// (12/13) existing event service / execution mismatch → rejected (identity_mismatch)
async function testExistingIncompatible() {
  const t = await loadCanonicalTables();
  const c = await completion();
  for (const ex of [peRow({ serviceType: "EchoWave", procedureStatus: "in_progress", completedAt: null }), peRow({ executionCaseId: 999, procedureStatus: "in_progress", completedAt: null })]) {
    const spec = completionSpec(t, { peSelect: () => [ex] });
    const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, executionCaseId: 900 }));
    assert.equal(r.status, "identity_mismatch", "incompatible existing event is rejected");
    assert.equal(r.completionCommitted, false);
  }
}

// (14) repeated completion preserves the original completedAt (no rewrite)
async function testRepeatedPreservesCompletedAt() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const existing = peRow({ completedAt: OLD, procedureStatus: "complete" });
  const spec = completionSpec(t, { peSelect: () => [existing] });
  await runWithDb(spec, ALL, async (calls: Call[]) => {
    const r = await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5 });
    assert.equal(r.completionCommitted, true);
    assert.equal(countOps(calls, "update", t.procedureEvents), 0, "(14) already-complete event is never re-timestamped");
  });
}

// (15) concurrent winner preserves ITS completedAt; an explicit different time conflicts
async function testConcurrentWinnerPreservesTime() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const winner = peRow({ id: 300, completedAt: OLD, procedureStatus: "complete" });
  const spec = completionSpec(t, {
    peSelect: qsel([[], [winner], [winner]]),
    onPeInsert: () => { const e = new Error("dup") as any; e.code = "23505"; throw e; },
  });
  await runWithDb(spec, ALL, async (calls: Call[]) => {
    const r = await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5 });
    assert.equal(r.procedureEventId, 300, "reselected the exact winner");
    assert.equal(countOps(calls, "update", t.procedureEvents), 0, "(15) winner's completedAt preserved (no rewrite)");
  });
  // Explicit DIFFERENT completedAt on an already-complete event → timestamp_conflict.
  const conflict = await runWithDb(completionSpec(t, { peSelect: () => [peRow({ completedAt: OLD, procedureStatus: "complete" })] }), ALL,
    async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, completedAt: NEW }));
  assert.equal(conflict.status, "timestamp_conflict");
}

// (16/17) same-case linkage: clinicless synced; conflicting ownership not overwritten
async function testSameCaseLinkSync() {
  const t = await loadCanonicalTables();
  const r = await repo();
  // (16) clinicless same-case event → clinic filled + synced.
  let patch: Record<string, unknown> | null = null;
  const synced = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ clinicId: null, globalPlexusPatientId: null })], onUpdate: (v) => { patch = v; return [{ ...peRow(), ...v }]; } }]]),
    ALL, async () => r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5, globalPlexusPatientId: 10, patientClinicMembershipId: 20 }),
  );
  assert.equal(synced.outcome, "already_linked_same_case_and_synced");
  assert.equal((patch as Record<string, unknown>).clinicId, 1, "(16) clinicless event synchronized to the clinic");
  // (17) conflicting NON-NULL identity → identity_conflict, never overwritten.
  const conflict = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ clinicId: 1, globalPlexusPatientId: 99 })], onUpdate: (v) => [{ ...v }] }]]),
    ALL, async (calls) => { const res = await r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5, globalPlexusPatientId: 10 }); assert.equal(countOps(calls, "update", t.procedureEvents), 0); return res; },
  );
  assert.equal(conflict.outcome, "identity_conflict");
}

// (18/19/20) expected-clinic completion hook: cross-clinic denied; no clinicId=0
async function testHookExpectedClinic() {
  const t = await loadCanonicalTables();
  const o = await orch();
  // (18) another clinic's event → denied, no linkage/note.
  const denied = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ clinicId: 2, ancillaryCaseId: null })] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }]]),
    ALL, async (calls) => { const r = await o.onProcedureCompleted({ procedureEventId: 300, expectedClinicId: 1 }); assert.equal(countOps(calls, "update", t.procedureEvents), 0); return r; },
  );
  assert.equal(denied.status, "cross_clinic_denied", "(18) completion hook rejects another clinic's event");
  // (19) retry from clinic A cannot operate on clinic B's event.
  const w = await worker();
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_events", sourceId: 300, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const retry = await runWithDb(
    new Map<unknown, TableSpec>([[t.documentFailures, { select: () => [failure], onUpdate: () => [{ id: 1 }] }], [t.procedureEvents, { select: () => [peRow({ clinicId: 2 })] }]]),
    ALL, async (calls) => { const res = await w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }); assert.equal(countOps(calls, "update", t.documentFailures), 0, "cross-clinic retry never resolves"); return res; },
  );
  assert.equal(retry.outcomes[0].status, "cross_clinic_denied", "(19) clinic A retry cannot touch clinic B's event");
  // (20) no valid clinic (event clinic null + expected null) → unscoped, no retry with clinic 0.
  let failurePayload: Record<string, unknown> | null = null;
  const unscoped = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ clinicId: null, ancillaryCaseId: null })] }], [t.documentFailures, { select: () => [], onInsert: (v) => { failurePayload = v; return [{ ...v, id: 1 }]; } }]]),
    ALL, async () => o.onProcedureCompleted({ procedureEventId: 300, expectedClinicId: null }),
  );
  assert.equal(unscoped.status, "unscoped_event");
  assert.equal(failurePayload, null, "(20) no retry persistence manufactures clinicId=0");
}

// (21/22/23) three-flag runtime gate
async function testRuntimeGate() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  const r = await repo();
  const spec = new Map<unknown, TableSpec>([[t.ancillaryCases, { select: () => [caseRow()] }], [t.procedureEvents, { select: () => [peRow()] }], [t.documentReferences, { select: () => [reportRef()] }], [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900 }] }], [t.journeyEvents, { onInsert: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.gse, { select: () => [] }]]);
  // (21) two of three flags → createOrReuse skipped, zero reads.
  await runWithDb(spec, { canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalProcedureLifecycle: false }, async (calls: Call[]) => {
    const res = await n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(res.status, "skipped_flag_off", "(21) all three flags required");
    assert.equal(calls.length, 0, "partial flags ⇒ zero reads/writes");
  });
  // (22) partial flags preserve the legacy writer; (23) full runtime suppresses it.
  const legacySpec = new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [], onInsert: (v) => [{ ...v, id: 300 }] }], [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900 }] }], [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }], [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }]]);
  await runWithDb(legacySpec, { canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalProcedureLifecycle: false }, async (calls: Call[]) => {
    await r.markProcedureComplete({ serviceType: "BrainWave", patientScreeningId: 77, executionCaseId: 900 }); await flush();
    assert.ok(countOps(calls, "insert", t.procedureNotes) >= 1, "(22) partial flags preserve legacy writer");
  });
  await runWithDb(legacySpec, ALL, async (calls: Call[]) => {
    await r.markProcedureComplete({ serviceType: "BrainWave", patientScreeningId: 77, executionCaseId: 900 }); await flush();
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "(23) full runtime suppresses legacy writer");
  });
}

// (24) event-source retry unresolved when Procedure Note runtime is OFF
async function testEventRetryWaitsForNoteRuntime() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_events", sourceId: 300, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => [{ id: 1 }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()], onUpdate: (v) => [{ ...peRow(), ...v }] }],
  ]);
  // lifecycle ON, note runtime OFF (note flag off) → case linked, note deferred, NOT resolved.
  const res = await runWithDb(spec, { unifiedAncillaryDocuments: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: false }, async (calls) => {
    const r = await w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 });
    assert.equal(countOps(calls, "update", t.documentFailures), 0, "not resolved while note runtime OFF");
    return r;
  });
  assert.equal(res.outcomes[0].status, "linked_waiting_for_note_runtime");
}

// (25/26) exact note-source retry uses the named source, never creates/adopts another note
async function testNoteSourceRetryExact() {
  const t = await loadCanonicalTables();
  const w = await worker();
  let refPayload: Record<string, unknown> | null = null;
  const failure = { id: 3, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => [{ id: 3 }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureNotes, { select: () => [noteRow()], onInsert: () => { throw new Error("must not insert a note"); } }],
    [t.documentReferences, { select: () => [], onInsert: (v) => { refPayload = v; return [{ ...v, id: 55 }]; } }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const r = await w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "(26) never creates/adopts another note");
    return r;
  });
  assert.equal(res.outcomes[0].status, "resolved");
  assert.equal((refPayload as Record<string, unknown>).sourceId, 900, "(25) reference built for the exact named note id");
}

// (27/28/29) unsigned evidence synchronization
async function testUnsignedEvidenceSync() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  // (27/28) stale unsigned note → evidence-only update.
  let payload: Record<string, unknown> | null = null;
  const updated = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ procedureEventId: 111, reportDocumentReferenceId: 222 })], onUpdate: (v) => { payload = v; return [noteRow()]; } }]]),
    ALL, async () => n.synchronizeUnsignedProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, procedureEventId: 300, reportReferenceId: 42, effectiveDate: OLD }),
  );
  assert.equal(updated.status, "evidence_updated");
  const p = payload as Record<string, unknown>;
  for (const f of ["generatedText", "sourceData", "generationStatus", "signatureStatus", "signedAt", "signedByUserId"]) assert.ok(!(f in p), `(28) must not touch ${f}`);
  // (29) zero-row race → not reported as updated/reused.
  const zero = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ procedureEventId: 111 })], onUpdate: () => [] }]]),
    ALL, async () => n.synchronizeUnsignedProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, procedureEventId: 300, reportReferenceId: 42, effectiveDate: OLD }),
  );
  assert.equal(zero.status, "zero_row_conflict");
}

// (30/31/32) signed note whose report changed → audited AMENDMENT: prior signed
// body/signer/signedAt immutable, superseded; a new pending amendment created.
async function testSignedEvidenceConflict() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  let supersedePayload: Record<string, unknown> | null = null;
  let newNotePayload: Record<string, unknown> | null = null;
  // Signed note whose STORED evidence (111/222) differs from eligibility (300/42).
  const signed = noteRow({ signatureStatus: "signed", signedAt: OLD, procedureEventId: 111, reportDocumentReferenceId: 222 });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()]]), onUpdate: (v) => [{ ...v }] }],
    [t.procedureNotes, { select: () => [signed], onUpdate: (v) => { supersedePayload = v; return [{ ...signed, ...v }]; }, onInsert: (v) => { newNotePayload = v; return [{ ...noteRow(), ...v, id: 901 }]; } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "amended");
  if (r.status === "amended") { assert.equal(r.wasSigned, true); assert.equal(r.priorNoteId, 900); }
  // (30) the prior SIGNED note is only superseded — its body/signer/signedAt are untouched.
  const sp = supersedePayload as Record<string, unknown>;
  assert.ok("supersededAt" in sp, "prior note superseded");
  for (const f of ["generatedText", "generationStatus", "signatureStatus", "signedAt", "signedByUserId"]) assert.ok(!(f in sp), `(30) signed note ${f} never rewritten`);
  // (31/32) a NEW pending amendment carrying the exact new evidence + lineage link.
  const np = newNotePayload as Record<string, unknown>;
  assert.equal(np.supersedesNoteId, 900, "(32) amendment links to the prior note");
  assert.equal(np.generationStatus, "pending");
  assert.equal(np.signatureStatus, "needs_signature");
  assert.equal(np.reportDocumentReferenceId, 42, "(31) amendment carries the exact new report evidence");
}

// (33/34/35) atomic evidence retry
async function testAtomicEvidenceRetry() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  const ref = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  // (33) both note + reference updated atomically → linked.
  let noteUpd = 0, refUpd = 0;
  const ok = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureEvents, { select: () => [peRow()] }],
      [t.documentReferences, { select: qsel([[reportRef()], [ref]]), onUpdate: (v) => { refUpd++; return [{ ...ref, ...v }]; } }],
      [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => { noteUpd++; return [noteRow()]; } }],
    ]),
    ALL, async () => n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }),
  );
  assert.equal(ok.status, "linked");
  assert.ok(noteUpd === 1 && refUpd === 1, "(33) note + reference updated together");
  // (34) reference update affects zero rows → whole tx rolls back → not linked.
  const rollback = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureEvents, { select: () => [peRow()] }],
      [t.documentReferences, { select: qsel([[reportRef()], [ref]]), onUpdate: () => [] }],
      [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => [noteRow()] }],
    ]),
    ALL, async () => n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }),
  );
  assert.notEqual(rollback.status, "linked", "(34) partial write never reports linked");
  // (35) no reference at all → reference_missing (never linked).
  const missing = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureEvents, { select: () => [peRow()] }],
      [t.documentReferences, { select: qsel([[reportRef()], []]) }],
      [t.procedureNotes, { select: () => [noteRow()] }],
    ]),
    ALL, async () => n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }),
  );
  assert.equal(missing.status, "reference_missing");
}

// (36/38) retry worker resolves ONLY the exact failure id after full success
async function testExactResolution() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const ok = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 2, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 901, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [ok, sibling], onUpdate: () => { resolves++; return [{ id: 1 }]; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    // note 900 exists; note 901 does not → sibling stays deferred.
    [t.procedureNotes, { select: qsel([[noteRow({ id: 900 })], [/* 901 */]]) }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 55 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[1], "resolved");
  assert.notEqual(byId[2], "resolved", "(38) sibling not swept by broad resolution");
  assert.equal(resolves, 1, "(36) exactly one exact-id resolution");
}

// (37) retry-persistence failure is surfaced truthfully. A signed-note amendment
// that loses a zero-row race falls back to an evidence retry; when the ledger
// write itself fails, retryRecorded is FALSE (never overstated).
async function testRetryPersistenceFailure() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  const signed = noteRow({ signatureStatus: "signed", signedAt: OLD, procedureEventId: 111, reportDocumentReferenceId: 222 });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()]]), onUpdate: (v) => [{ ...v }] }],
    // amendment supersede loses the race (zero rows) → deferred; then the retry ledger throws.
    [t.procedureNotes, { select: () => [signed], onUpdate: () => [], onInsert: (v) => [{ ...v, id: 901 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "deferred_evidence_sync");
  if (r.status === "deferred_evidence_sync") assert.equal(r.retryRecorded, false, "(37) ledger failure surfaced, not swallowed");
}

// (39) no uncontrolled canonical schedule-update task escapes teardown
async function testNoEscapingScheduleTask() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const spec = completionSpec(t);
  await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = mockRes();
    await table["POST /api/procedure-events/complete"]({ clinicId: 1, body: { serviceType: "BrainWave", ancillaryCaseId: 5, globalScheduleEventId: 700 }, session: { userId: "u1" } }, res);
    const settled = calls.length;
    await flush(); await flush();
    assert.equal(calls.length, settled, "(39) no schedule-update task escapes after the handler returns");
  });
}

// (40) migration 0054 additive + no migration 0055
async function testMigration() {
  const body = readFileSync(join(process.cwd(), "migrations/0054_add_canonical_procedure_lifecycle.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(/uq_pe_canonical_ancillary_case/.test(body), "(40) canonical case uniqueness present");
  assert.ok(!/DROP TABLE/i.test(body.toUpperCase()) && !/TRUNCATE/i.test(body.toUpperCase()) && !/DROP COLUMN/i.test(body.toUpperCase()), "additive");
  const has55 = readdirSync(join(process.cwd(), "migrations")).some((f) => f.startsWith("0055"));
  assert.ok(!has55, "(40) no migration 0055 exists");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/2/3) pre-commit migration: not committed, 503, no mirror", testPreCommitMigration],
  ["(4) post-commit note migration → committed=true", testPostCommitNoteMigration],
  ["(5) direct case + mismatched schedule event rejected", testMismatchedScheduleEvent],
  ["(6) direct case + cross-clinic schedule event denied", testCrossClinicScheduleEvent],
  ["(7) cancelled/no_show/doctor_visit cannot qualify", testCancelledScheduleEvent],
  ["(8) schedule execution/screening mismatch rejected", testScheduleIdentityMismatch],
  ["(9/10) route mirrors only validated event, awaited, warns", testRouteScheduleMirror],
  ["(11) existing-event WHERE requires exact ancillaryCaseId", testExistingWhereScoped],
  ["(12/13) existing service/execution mismatch rejected", testExistingIncompatible],
  ["(14) repeated completion preserves completedAt", testRepeatedPreservesCompletedAt],
  ["(15) concurrent winner preserves its completedAt", testConcurrentWinnerPreservesTime],
  ["(16/17) same-case link sync + conflict guard", testSameCaseLinkSync],
  ["(18/19/20) expected-clinic hook + no clinicId=0", testHookExpectedClinic],
  ["(21/22/23) three-flag runtime gate", testRuntimeGate],
  ["(24) event-source retry waits for note runtime", testEventRetryWaitsForNoteRuntime],
  ["(25/26) exact note-source retry", testNoteSourceRetryExact],
  ["(27/28/29) unsigned evidence synchronization", testUnsignedEvidenceSync],
  ["(30/31/32) signed evidence conflict", testSignedEvidenceConflict],
  ["(33/34/35) atomic evidence retry", testAtomicEvidenceRetry],
  ["(36/38) exact-id resolution only", testExactResolution],
  ["(37) retry-persistence failure surfaced", testRetryPersistenceFailure],
  ["(39) no escaping schedule task", testNoEscapingScheduleTask],
  ["(40) migration additive + no 0055", testMigration],
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

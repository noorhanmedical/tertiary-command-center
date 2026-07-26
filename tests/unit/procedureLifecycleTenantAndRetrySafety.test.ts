// Phase 2F-A2 — canonical procedure identity, tenancy, and retry safety.
//
//   npx tsx tests/unit/procedureLifecycleTenantAndRetrySafety.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const completion = () => import("../../server/services/procedureLifecycle/canonicalProcedureCompletion");
const noteSvc = () => import("../../server/services/procedureLifecycle/procedureNoteService");
const orch = () => import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
const repo = () => import("../../server/repositories/procedureEvents.repo");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const routes = () => import("../../server/routes/procedureEvents");
const schema = () => import("@shared/schema/procedureEvents");
const MIGRATION = readFileSync(join(process.cwd(), "migrations/0054_add_canonical_procedure_lifecycle.sql"), "utf8");
const NOTE_SRC = readFileSync(join(process.cwd(), "server/services/procedureLifecycle/procedureNoteService.ts"), "utf8");

const COMPLETED_AT = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;
const NOTE_FLAGS = { canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;

function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved",
    originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10,
    patientClinicMembershipId: 20, lifecycleStatus: "active", ...over,
  };
}
function peRow(over: Record<string, unknown> = {}) {
  return {
    id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77,
    globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "complete",
    completedByUserId: null, completedAt: COMPLETED_AT, note: null, metadata: {},
    globalPlexusPatientId: null, patientClinicMembershipId: null,
    createdAt: CREATED_AT, updatedAt: CREATED_AT, ...over,
  };
}
function reportRef(over: Record<string, unknown> = {}) {
  return {
    id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave",
    documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness",
    sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...over,
  };
}
function noteRow(over: Record<string, unknown> = {}) {
  return {
    id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77,
    serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "pending",
    signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null,
    procedureEventId: 300, reportDocumentReferenceId: 42, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...over,
  };
}
function qsel(arrays: unknown[][]): () => unknown[] { let i = 0; return () => arrays[Math.min(i++, arrays.length - 1)]; }
const flush = () => new Promise((r) => setImmediate(r));

/** Spec that makes an eligible canonical completion succeed (procedure complete
 *  + current report), inserting a fresh case-scoped note. */
function eligibleCompletionSpec(
  t: Awaited<ReturnType<typeof loadCanonicalTables>>,
  o: { peSelect?: () => unknown[]; onPeInsert?: (v: Record<string, unknown>) => unknown[]; onNoteInsert?: (v: Record<string, unknown>) => unknown[]; case?: Record<string, unknown> } = {},
) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow(o.case ?? {})] }],
    [t.procedureEvents, { select: o.peSelect ?? qsel([[], [peRow()]]), onInsert: o.onPeInsert ?? ((v) => [{ ...peRow(), ...v, id: 300 }]), onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: o.onNoteInsert ?? ((v) => [{ ...noteRow(), ...v, id: 900 }]) }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
  ]);
}

// (1) canonical completion deduplicates by ancillaryCaseId (reuse existing event)
async function testDedupeByCase() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const existing = peRow({ id: 300 });
  const spec = eligibleCompletionSpec(t, { peSelect: () => [existing] });
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, completedAt: COMPLETED_AT });
    assert.equal(countOps(calls, "insert", t.procedureEvents), 0, "existing case event reused, not re-inserted");
    assert.ok(countOps(calls, "update", t.procedureEvents) >= 1, "existing event completed via update");
    return res;
  });
  assert.ok(["completed_note_created", "completed_note_reused", "completed_and_linked"].includes(r.status), r.status);
  assert.equal(r.procedureEventId, 300);
}

// (2) two same-service episodes create separate procedure events
async function testSeparateEpisodes() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const payloads: Record<string, unknown>[] = [];
  for (const cid of [5, 6]) {
    const spec = eligibleCompletionSpec(t, {
      case: { id: cid, executionCaseId: 900 + cid },
      peSelect: qsel([[], [peRow({ ancillaryCaseId: cid })]]),
      onPeInsert: (v) => { payloads.push(v); return [{ ...peRow({ ancillaryCaseId: cid }), ...v, id: 300 + cid }]; },
    });
    await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: cid, completedAt: COMPLETED_AT }));
  }
  assert.equal(payloads.length, 2, "each episode inserts its own event");
  assert.equal(payloads[0].ancillaryCaseId, 5);
  assert.equal(payloads[1].ancillaryCaseId, 6);
}

// (3) canonical completion never reuses another case's event (inserts its own)
async function testNeverReuseAnotherCase() {
  const t = await loadCanonicalTables();
  const c = await completion();
  let inserted: Record<string, unknown> | null = null;
  // Dedupe read for THIS case returns [] (case-scoped) → a fresh event is made.
  const spec = eligibleCompletionSpec(t, {
    peSelect: qsel([[], [peRow()]]),
    onPeInsert: (v) => { inserted = v; return [{ ...peRow(), ...v, id: 300 }]; },
  });
  await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, completedAt: COMPLETED_AT }));
  assert.ok(inserted, "a case-scoped event was created");
  assert.equal((inserted as Record<string, unknown>).ancillaryCaseId, 5, "event belongs to THIS case only");
}

// (4) concurrent duplicate completion reselects the exact case winner
async function testConcurrentReselect() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const winner = peRow({ id: 300 });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    // dedupe [] → insert throws 23505 → reselect [winner] → complete → eligibility [winner].
    [t.procedureEvents, {
      select: qsel([[], [winner], [winner]]),
      onInsert: () => { const e = new Error("dup") as Error & { code?: string }; e.code = "23505"; throw e; },
      onUpdate: (v) => [{ ...winner, ...v }],
    }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, completedAt: COMPLETED_AT }));
  assert.equal(r.procedureEventId, 300, "reselected the exact concurrent case winner");
}

// (5) canonical Procedure Note flag ON suppresses createPendingProcedureNotes
async function testCanonicalSuppressesLegacyNotes() {
  const t = await loadCanonicalTables();
  const r = await repo();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [], onInsert: (v) => [{ ...v, id: 300 }] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900 }] }],
    [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  await runWithDb(spec, { canonicalProcedureNote: true, unifiedAncillaryDocuments: true }, async (calls: Call[]) => {
    await r.markProcedureComplete({ serviceType: "BrainWave", patientScreeningId: 77, executionCaseId: 900 });
    await flush();
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "canonical flag ON ⇒ zero legacy-note inserts");
  });
}

// (6) canonical flag OFF preserves the legacy note writer
async function testLegacyNotesActiveWhenFlagOff() {
  const t = await loadCanonicalTables();
  const r = await repo();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [], onInsert: (v) => [{ ...v, id: 300 }] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900 }] }],
    [t.caseDocumentReadiness, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }], onUpdate: (v) => [{ ...v }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  await runWithDb(spec, { canonicalProcedureNote: false }, async (calls: Call[]) => {
    await r.markProcedureComplete({ serviceType: "BrainWave", patientScreeningId: 77, executionCaseId: 900 });
    await flush();
    assert.ok(countOps(calls, "insert", t.procedureNotes) >= 1, "legacy note writer remains active when flag OFF");
  });
}

// ─── Route harness ────────────────────────────────────────────────
function fakeApp() {
  const table: Record<string, (req: any, res: any) => unknown> = {};
  const app = {
    get: (p: string, h: (req: any, res: any) => unknown) => { table[`GET ${p}`] = h; },
    post: (p: string, h: (req: any, res: any) => unknown) => { table[`POST ${p}`] = h; },
  };
  return { app, table };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

// (7) completion route derives clinic from request context (missing → 403)
async function testCompletionRouteRequiresClinic() {
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const res = mockRes();
  await table["POST /api/procedure-events/complete"]({ clinicId: null, body: { serviceType: "BrainWave" }, session: {} }, res);
  assert.equal(res.statusCode, 403, "missing clinic context fails closed");
}

// (8) completion cannot act on another clinic's case (cross-clinic → 404)
async function testCompletionCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const spec = new Map<unknown, TableSpec>([[t.ancillaryCases, { select: () => [caseRow({ clinicId: 2 })] }]]);
  await runWithDb(spec, ALL, async () => {
    const res = mockRes();
    await table["POST /api/procedure-events/complete"]({ clinicId: 1, body: { serviceType: "BrainWave", ancillaryCaseId: 5 }, session: { userId: "u1" } }, res);
    assert.equal(res.statusCode, 404, "another clinic's case reads as not-found");
  });
}

// (9) procedure list is clinic-scoped (missing clinic → 403; success is DTO)
// (11) clinic DTO omits global patient/membership ids
async function testListClinicScopedAndDto() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  // Missing clinic → 403.
  const denied = mockRes();
  await table["GET /api/procedure-events"]({ clinicId: null, query: {} }, denied);
  assert.equal(denied.statusCode, 403);
  // Success → clinic DTO with global ids stripped.
  const spec = new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ globalPlexusPatientId: 10, patientClinicMembershipId: 20 })] }]]);
  await runWithDb(spec, ALL, async () => {
    const res = mockRes();
    await table["GET /api/procedure-events"]({ clinicId: 1, query: {} }, res);
    assert.equal(res.statusCode, 200);
    const row = res.body[0];
    assert.ok(!("globalPlexusPatientId" in row), "DTO omits globalPlexusPatientId");
    assert.ok(!("patientClinicMembershipId" in row), "DTO omits patientClinicMembershipId");
    assert.equal(row.ancillaryCaseId, 5, "tenant fields still present");
  });
}

// (10) single-event read is clinic-scoped (empty scoped read → 404)
async function testSingleReadClinicScoped() {
  const t = await loadCanonicalTables();
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const noClinic = mockRes();
  await table["GET /api/procedure-events/:id"]({ clinicId: null, params: { id: "300" } }, noClinic);
  assert.equal(noClinic.statusCode, 403);
  // Scoped read returns nothing (another clinic's row) → 404.
  const spec = new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [] }]]);
  await runWithDb(spec, ALL, async () => {
    const res = mockRes();
    await table["GET /api/procedure-events/:id"]({ clinicId: 1, params: { id: "300" } }, res);
    assert.equal(res.statusCode, 404, "another clinic's record behaves as not found");
  });
}

// (12) general/client insert contract cannot supply canonical identity fields
async function testInsertSchemaOmitsCanonicalFields() {
  const s = await schema();
  const shape = (s.insertProcedureEventSchema as any).shape as Record<string, unknown>;
  for (const k of ["clinicId", "ancillaryCaseId", "globalPlexusPatientId", "patientClinicMembershipId", "id", "createdAt", "updatedAt"]) {
    assert.ok(!(k in shape), `insert contract must omit ${k}`);
  }
  const parsed = s.insertProcedureEventSchema.parse({
    serviceType: "BrainWave", procedureStatus: "complete",
    clinicId: 99, ancillaryCaseId: 7, globalPlexusPatientId: 8, patientClinicMembershipId: 9,
  } as any);
  for (const k of ["clinicId", "ancillaryCaseId", "globalPlexusPatientId", "patientClinicMembershipId"]) {
    assert.ok(!(k in (parsed as Record<string, unknown>)), `parse must strip client-supplied ${k}`);
  }
}

// (13/14/15) hardened linkage: ownership validated, affected-row checked, zero-row not success
async function testLinkageOwnershipAndAffectedRows() {
  const t = await loadCanonicalTables();
  const r = await repo();
  // (13) existing DIFFERENT case → ownership_conflict (never re-homed).
  const conflict = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: 6 })], onUpdate: (v) => [{ ...v }] }]]),
    ALL,
    async (calls) => { const res = await r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5 }); assert.equal(countOps(calls, "update", t.procedureEvents), 0, "conflict never writes"); return res; },
  );
  assert.equal(conflict.outcome, "ownership_conflict");
  // cross-clinic ownership → ownership_conflict.
  const xclinic = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ clinicId: 2, ancillaryCaseId: null })] }]]),
    ALL, async () => r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5 }),
  );
  assert.equal(xclinic.outcome, "ownership_conflict");
  // (14) unlinked + one affected row → linked.
  const linked = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: null, clinicId: null })], onUpdate: (v) => [{ ...peRow(), ...v }] }]]),
    ALL, async () => r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5 }),
  );
  assert.equal(linked.outcome, "linked");
  // (15) zero affected rows (concurrent change) → zero_row_conflict, never linked.
  const zero = await runWithDb(
    new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: null })], onUpdate: () => [] }]]),
    ALL, async () => r.linkProcedureEventToAncillaryCase({ procedureEventId: 300, clinicId: 1, ancillaryCaseId: 5 }),
  );
  assert.equal(zero.outcome, "zero_row_conflict");
}

// (16/17) completion reconciliation is keyed to procedure_events, never procedure_notes
async function testReconciliationSourceIdentity() {
  const t = await loadCanonicalTables();
  const o = await orch();
  let failurePayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: null, executionCaseId: 900 })] }],
    [t.ancillaryCases, { select: () => [] }], // no owning case → deferred + retry
    [t.documentFailures, { select: () => [], onInsert: (v) => { failurePayload = v; return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => o.onProcedureCompleted(300));
  assert.equal(r.status, "deferred_ambiguous_case");
  const f = failurePayload as Record<string, unknown>;
  assert.equal(f.sourceTable, "procedure_events", "(16) completion failure keyed to procedure_events");
  assert.equal(f.sourceId, 300, "exact procedure event id");
  assert.notEqual(f.sourceTable, "procedure_notes", "(17) procedure-event id never labeled procedure_notes");
  assert.equal(f.requestedAction, "link_procedure_note");
}

// (18/19) link_procedure_note retry executes, resolves exact id; siblings isolated
async function testRetryLinkProcedureNote() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const okFailure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_events", sourceId: 300, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 2, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "link_procedure_note_evidence", resolvedAt: null, attemptCount: 1 };
  let resolvedCount = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [okFailure, sibling], onUpdate: () => { resolvedCount++; return [{ id: 1 }]; }, onInsert: (v) => [{ ...v, id: 9 }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[noteRow()], [noteRow()]]), onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }], onUpdate: (v) => [{ ...noteRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 10 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[1], "resolved", "(18) link_procedure_note resolves on success");
  // (19) the sibling evidence retry is processed on its OWN merits, not swept by #1.
  assert.notEqual(byId[2], "resolved", "sibling retry is not auto-resolved by a different failure");
}

// (20/28/29) evidence linker validates note/case/clinic; unsigned exact refresh; signed untouched
async function testEvidenceLinker() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  // cross-clinic note → denied, no write.
  const denied = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureNotes, { select: () => [noteRow({ clinicId: 2 })], onUpdate: (v) => [{ ...v }] }],
    ]),
    ALL, async (calls) => { const r = await n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }); assert.equal(countOps(calls, "update", t.procedureNotes), 0); return r; },
  );
  assert.equal(denied.status, "cross_clinic_denied");
  // (28) unsigned current note → evidence-only refresh (no body/signature fields).
  let evPayload: Record<string, unknown> | null = null;
  const linked = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureEvents, { select: () => [peRow()] }],
      [t.documentReferences, { select: () => [reportRef()], onUpdate: (v) => [{ ...v }] }],
      [t.procedureNotes, { select: () => [noteRow()], onUpdate: (v) => { evPayload = v; return [noteRow()]; } }],
    ]),
    ALL, async () => n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }),
  );
  assert.equal(linked.status, "linked");
  const ep = evPayload as Record<string, unknown>;
  for (const forbidden of ["generatedText", "sourceData", "signatureStatus", "signedAt", "signedByUserId"]) {
    assert.ok(!(forbidden in ep), `evidence refresh must not touch ${forbidden}`);
  }
  assert.ok("procedureEventId" in ep && "reportDocumentReferenceId" in ep, "evidence fields refreshed");
  // (29) SIGNED current note → never silently rewritten.
  const signed = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.procedureEvents, { select: () => [peRow()] }],
      [t.documentReferences, { select: () => [reportRef()] }],
      [t.procedureNotes, { select: () => [noteRow({ signatureStatus: "signed", signedAt: COMPLETED_AT })], onUpdate: (v) => [{ ...v }] }],
    ]),
    ALL, async (calls) => { const r = await n.linkProcedureNoteEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 }); assert.equal(countOps(calls, "update", t.procedureNotes), 0, "signed note never rewritten"); return r; },
  );
  assert.equal(signed.status, "still_deferred");
}

// (21) feature OFF → zero Phase 2F retry reads/writes
async function testRetryFlagOff() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_events", sourceId: 300, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  let peReads = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure] }],
    [t.procedureEvents, { select: () => { peReads++; return [peRow()]; } }],
  ]);
  // unified ON but lifecycle OFF → link_procedure_note(procedure_events) skipped, no PE reads.
  const res = await runWithDb(spec, { unifiedAncillaryDocuments: true, canonicalProcedureLifecycle: false, canonicalProcedureNote: false }, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 10 }));
  assert.equal(res.outcomes[0].status, "skipped_flag_off");
  assert.equal(peReads, 0, "flag OFF ⇒ zero Phase 2F retry reads");
}

// (22) awaited hooks: no async DB task escapes after the call returns
async function testNoEscapingAsync() {
  const t = await loadCanonicalTables();
  const c = await completion();
  const spec = eligibleCompletionSpec(t);
  await runWithDb(spec, ALL, async (calls: Call[]) => {
    await c.completeCanonicalProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, completedAt: COMPLETED_AT });
    const settled = calls.length;
    await flush();
    await flush();
    assert.equal(calls.length, settled, "no DB work escapes the awaited completion");
  });
}

// (23) legacy note lookup is clinic-scoped
async function testLegacyLookupClinicScoped() {
  // Clinic predicate is part of the SQL (verified by build/type); assert the
  // scoped column is present in the lookup (structural backstop to behavior).
  assert.ok(/findLegacyUnlinkedProcedureNotes[\s\S]*?eq\(procedureNotes\.clinicId, clinicId\)/.test(NOTE_SRC), "legacy lookup filters by clinic_id");
}

// (24/25/26) legacy adoption tenant/current/unlinked scoped; zero-row deferred; retry-persistence surfaced
async function testLegacyAdoptionSafety() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  const legacy = noteRow({ id: 800, ancillaryCaseId: null });
  // Zero-row adoption race → deferred (never success), with retry persistence flag.
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: qsel([[caseRow()], [caseRow()], [caseRow()]]) }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onInsert: (v) => [{ ...v, id: 42 }] }],
    // findCaseScoped [] → findLegacyUnlinked [legacy] → adopt update returns [] (zero-row race).
    [t.procedureNotes, { select: qsel([[], [legacy]]), onUpdate: () => [], onInsert: (v) => [{ ...v, id: 999 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "(26) durable retry recorded");
    return res;
  });
  assert.equal(r.status, "deferred_legacy_ambiguous");
  if (r.status === "deferred_legacy_ambiguous") {
    assert.equal(r.reason, "adoption_zero_row", "(25) zero-row adoption race is deferred, never success");
    assert.equal(r.retryRecorded, true, "(26) retry persistence surfaced truthfully");
  }
}

// (26b) retry persistence FAILURE is surfaced (retryRecorded=false)
async function testRetryPersistenceFailureSurfaced() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  const l1 = noteRow({ id: 800, ancillaryCaseId: null });
  const l2 = noteRow({ id: 801, ancillaryCaseId: null });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], [l1, l2]]), onUpdate: (v) => [{ ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    // Ledger write throws → retryRecorded must be false (never overstated).
    [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "deferred_legacy_ambiguous");
  if (r.status === "deferred_legacy_ambiguous") assert.equal(r.retryRecorded, false, "ledger failure is surfaced, not swallowed");
}

// (27) multiple completed events → procedure_event_ambiguous (never latest-picking)
async function testMultipleCompletedAmbiguous() {
  const t = await loadCanonicalTables();
  const e = await import("../../server/services/procedureLifecycle/procedureNoteEligibility");
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ id: 300 }), peRow({ id: 301, completedAt: new Date("2027-06-11T09:00:00Z") })] }],
    [t.documentReferences, { select: () => [reportRef()] }],
  ]);
  const r = await runWithDb(spec, NOTE_FLAGS, async () => e.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.procedureComplete, false);
  assert.ok(r.reasons.includes("procedure_event_ambiguous"), `reasons: ${r.reasons}`);
  assert.equal(r.eligible, false);
}

// (30) effectiveClinicalDate defaults to the actual procedure completedAt
async function testEffectiveDateDefaultsToCompletedAt() {
  const t = await loadCanonicalTables();
  const n = await noteSvc();
  let notePayload: Record<string, unknown> | null = null;
  let refPayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => { refPayload = v; return [{ ...v, id: 42 }]; } }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => { notePayload = v; return [{ ...noteRow(), ...v, id: 900 }]; } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  await runWithDb(spec, ALL, async () => n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal((notePayload as Record<string, unknown>).effectiveClinicalDate, COMPLETED_AT, "note effectiveClinicalDate = procedure completedAt");
  assert.equal((refPayload as Record<string, unknown>).effectiveClinicalDate, COMPLETED_AT, "reference effectiveClinicalDate = procedure completedAt");
}

// (31/32) migration 0054 adds canonical case uniqueness; remains additive/legacy-compatible
async function testMigration() {
  const body = MIGRATION.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_canonical_ancillary_case[\s\S]*?ON procedure_events\(ancillary_case_id\)[\s\S]*?WHERE ancillary_case_id IS NOT NULL/i.test(body), "(31) canonical procedure-event case uniqueness added");
  assert.ok(!/DROP COLUMN/i.test(body.toUpperCase()) && !/DROP TABLE/i.test(body.toUpperCase()) && !/TRUNCATE/i.test(body.toUpperCase()), "(32) additive/legacy-compatible");
  assert.ok(!/(?<!IS )\bNOT NULL\b/i.test(body.toUpperCase()), "no column NOT NULL that breaks legacy inserts");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) canonical completion dedupes by ancillaryCaseId", testDedupeByCase],
  ["(2) two same-service episodes create separate events", testSeparateEpisodes],
  ["(3) never reuses another case's event", testNeverReuseAnotherCase],
  ["(4) concurrent duplicate reselects exact case winner", testConcurrentReselect],
  ["(5) canonical flag ON suppresses createPendingProcedureNotes", testCanonicalSuppressesLegacyNotes],
  ["(6) canonical flag OFF preserves legacy note writer", testLegacyNotesActiveWhenFlagOff],
  ["(7) completion route derives clinic from context", testCompletionRouteRequiresClinic],
  ["(8) completion cannot act on another clinic's case", testCompletionCrossClinicDenied],
  ["(9/11) procedure list clinic-scoped + DTO omits global ids", testListClinicScopedAndDto],
  ["(10) single-event read clinic-scoped", testSingleReadClinicScoped],
  ["(12) insert contract omits canonical identity fields", testInsertSchemaOmitsCanonicalFields],
  ["(13/14/15) hardened linkage ownership + affected-row check", testLinkageOwnershipAndAffectedRows],
  ["(16/17) reconciliation keyed to procedure_events", testReconciliationSourceIdentity],
  ["(18/19) link_procedure_note retry resolves exact id; siblings isolated", testRetryLinkProcedureNote],
  ["(20/28/29) evidence linker validation + signed-safe", testEvidenceLinker],
  ["(21) feature OFF → zero Phase 2F retry reads/writes", testRetryFlagOff],
  ["(22) awaited hooks do not escape teardown", testNoEscapingAsync],
  ["(23) legacy note lookup clinic-scoped", testLegacyLookupClinicScoped],
  ["(24/25/26) legacy adoption zero-row deferred + retry surfaced", testLegacyAdoptionSafety],
  ["(26b) retry persistence failure surfaced", testRetryPersistenceFailureSurfaced],
  ["(27) multiple completed events → procedure_event_ambiguous", testMultipleCompletedAmbiguous],
  ["(30) effectiveClinicalDate defaults to completedAt", testEffectiveDateDefaultsToCompletedAt],
  ["(31/32) migration canonical uniqueness + additive", testMigration],
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

// Phase 2F — canonical Procedure Note identity (ancillary_case_id + note_type)
// and the live procedure-lifecycle orchestration hooks.
//
//   npx tsx tests/unit/procedureNoteCaseIdentity.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const noteSvc = () => import("../../server/services/procedureLifecycle/procedureNoteService");
const orch = () => import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");

const COMPLETED_AT = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const FLAGS = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;
const HOOK_FLAGS = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;

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

/** Stateful select returning each array in turn, then repeating the last. */
function qsel(arrays: unknown[][]): () => unknown[] {
  let i = 0;
  return () => arrays[Math.min(i++, arrays.length - 1)];
}

// (13) eligible call creates one case-scoped post_procedure_note + reference
async function testCreatesCaseScoped() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
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
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u1", source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 1, "exactly one note created");
    return res;
  });
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.procedureNoteId, 900);
    assert.equal(r.referenceId, 42);
    assert.equal(r.qualifyingProcedureEventId, 300);
    assert.equal(r.qualifyingReportReferenceId, 42);
    assert.equal(r.documentStatus, "pending_signature");
  }
  const np = notePayload as Record<string, unknown>;
  assert.equal(np.noteType, "post_procedure_note", "canonical note type");
  assert.equal(np.ancillaryCaseId, 5, "case-scoped identity");
  assert.equal(np.procedureEventId, 300, "exact procedure completion evidence");
  assert.equal(np.reportDocumentReferenceId, 42, "exact report evidence");
  assert.equal(np.generationStatus, "pending", "(26) no clinical body generated");
  assert.equal(np.signatureStatus, "needs_signature", "never auto-signed");
  assert.ok(!("generatedText" in np), "no clinical body generated");
  assert.ok(!("signedAt" in np) || np.signedAt == null, "never fabricate signedAt");
  const rp = refPayload as Record<string, unknown>;
  assert.equal(rp.documentKind, "procedure_note");
  assert.equal(rp.sourceTable, "procedure_notes");
  assert.equal(rp.sourceId, 900);
  assert.equal(rp.serviceType, "BrainWave");
  assert.equal(rp.actualCreatedAt, CREATED_AT, "reference preserves source note created_at");
}

// (14) repeated call reuses the same note
async function testReuse() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [reportRef({ id: 55, documentKind: "procedure_note", sourceId: 900, sourceTable: "procedure_notes" })]]), onInsert: (v) => [{ ...v, id: 99 }] }],
    // Evidence already matches eligibility → the unsigned reuse sync is a no-op.
    [t.procedureNotes, { select: () => [noteRow({ effectiveClinicalDate: COMPLETED_AT })], onInsert: (v) => [{ ...v, id: 901 }], onUpdate: (v) => [{ ...noteRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "reuse must not insert a new note");
    return res;
  });
  assert.equal(r.status, "reused");
  if (r.status === "reused") assert.equal(r.procedureNoteId, 900);
}

// (15) concurrent duplicate conflict reselects the exact winner
async function testConcurrentReselect() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  const winner = reportRef({ id: 77, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "pending_signature", serviceType: "BrainWave" });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    // #1 report (eligibility); #2 getReferenceBySource []; #3 getActiveReference [];
    // insert throws 23505; #4 reread → winner.
    [t.documentReferences, {
      select: qsel([[reportRef()], [], [], [winner]]),
      onInsert: () => { const e = new Error("dup") as Error & { code?: string }; e.code = "23505"; throw e; },
      onUpdate: (v) => [{ ...winner, ...v }],
    }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async () => s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.referenceId, 77, "reselected the exact concurrent winner");
    assert.equal(r.referenceDeferred, false, "winner reused, not falsely deferred");
  }
}

// (16) separate ancillary cases create separate notes (case-scoped identity)
async function testSeparateCases() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  let notePayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow({ id: 6, executionCaseId: 901, originatingScreeningId: 78 })] }],
    [t.procedureEvents, { select: () => [peRow({ id: 301, ancillaryCaseId: 6, executionCaseId: 901, patientScreeningId: 78 })] }],
    [t.documentReferences, { select: qsel([[reportRef({ ancillaryCaseId: 6 })], [], []]), onInsert: (v) => [{ ...v, id: 43 }] }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => { notePayload = v; return [{ ...noteRow(), ...v, id: 902 }]; } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async () => s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 6, source: "test" }));
  assert.equal(r.status, "created");
  assert.equal((notePayload as Record<string, unknown>).ancillaryCaseId, 6, "note stamped to its own case, never shared");
}

// (17) same-service repeated episodes stay separate — legacy note with >1
// candidate case is NEVER arbitrarily adopted
async function testSameServiceEpisodesSeparate() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  const legacy = noteRow({ id: 800, ancillaryCaseId: null });
  const spec = new Map<unknown, TableSpec>([
    // #1 service getCase; #2 eligibility getCase; #3 countCandidateCases → 2 rows.
    [t.ancillaryCases, { select: qsel([[caseRow()], [caseRow()], [caseRow(), caseRow({ id: 6 })]]) }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onInsert: (v) => [{ ...v, id: 42 }] }],
    // #1 findCaseScoped []; #2 findLegacyUnlinked [legacy].
    [t.procedureNotes, { select: qsel([[], [legacy]]), onInsert: (v) => [{ ...v, id: 999 }], onUpdate: (v) => [{ ...legacy, ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, HOOK_FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "ambiguous legacy note never adopted");
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no new note when ambiguous");
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "durable retry recorded");
    return res;
  });
  assert.equal(r.status, "deferred_legacy_ambiguous");
  if (r.status === "deferred_legacy_ambiguous") assert.equal(r.reason, "multiple_candidate_cases");
}

// (18) signed note reused unchanged
async function testSignedNoteUnchanged() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [reportRef({ id: 60, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: "signed" })]]), onInsert: (v) => [{ ...v, id: 61 }], onUpdate: (v) => [{ ...v, id: 60 }] }],
    [t.procedureNotes, { select: () => [noteRow({ signatureStatus: "signed", signedAt: COMPLETED_AT })], onInsert: (v) => [{ ...v, id: 998 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no new note");
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "signed note body/signature never touched");
    return res;
  });
  assert.equal(r.status, "reused");
  if (r.status === "reused") assert.equal(r.documentStatus, "signed");
}

// (19) ambiguous legacy note (multiple legacy rows) never arbitrarily adopted
async function testMultipleLegacyNotesDeferred() {
  const t = await loadCanonicalTables();
  const s = await noteSvc();
  const l1 = noteRow({ id: 800, ancillaryCaseId: null });
  const l2 = noteRow({ id: 801, ancillaryCaseId: null });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], [l1, l2]]), onInsert: (v) => [{ ...v, id: 999 }], onUpdate: (v) => [{ ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "never adopt one of several legacy notes");
    return res;
  });
  assert.equal(r.status, "deferred_legacy_ambiguous");
  if (r.status === "deferred_legacy_ambiguous") assert.equal(r.reason, "multiple_legacy_notes");
}

// (hook) onProcedureCompleted links the procedure event + delegates note creation
async function testHookLinksAndCreates() {
  const t = await loadCanonicalTables();
  const o = await orch();
  // The event starts UNLINKED (ancillary_case_id null): getById in the hook +
  // getById inside linkProcedureEventToAncillaryCase see it unlinked; after the
  // linkage write, eligibility's completion read sees it linked to case 5.
  const peUnlinked = peRow({ ancillaryCaseId: null });
  const peLinked = peRow({ ancillaryCaseId: 5 });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: qsel([[peUnlinked], [peUnlinked], [peLinked]]), onUpdate: (v) => [{ ...peLinked, ...v }] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, HOOK_FLAGS, async (calls: Call[]) => {
    const res = await o.onProcedureCompleted(300);
    assert.equal(countOps(calls, "update", t.procedureEvents), 1, "additive ancillary-case linkage written onto the procedure event");
    assert.equal(countOps(calls, "insert", t.procedureNotes), 1, "delegated Procedure Note creation");
    return res;
  });
  assert.equal(r.status, "created");
  assert.equal(r.procedureNoteId, 900);
}

// (12) feature OFF → both hooks perform zero reads/writes
async function testHooksFlagOff() {
  const t = await loadCanonicalTables();
  const o = await orch();
  const s = await noteSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()] }],
    [t.procedureNotes, { select: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [] }],
  ]);
  await runWithDb(spec, { canonicalProcedureLifecycle: false, canonicalProcedureNote: false }, async (calls: Call[]) => {
    const a = await o.onProcedureCompleted(300);
    assert.equal(a.status, "skipped_flag_off");
    const b = await o.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(b.status, "skipped_flag_off");
    const c = await s.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(c.status, "skipped_flag_off");
    assert.equal(calls.length, 0, "flags OFF ⇒ zero Phase 2F reads/writes");
  });
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(13) eligible creates one case-scoped post_procedure_note", testCreatesCaseScoped],
  ["(14) repeated call reuses the same note", testReuse],
  ["(15) concurrent duplicate conflict reselects the exact winner", testConcurrentReselect],
  ["(16) separate ancillary cases create separate notes", testSeparateCases],
  ["(17) same-service repeated episodes stay separate", testSameServiceEpisodesSeparate],
  ["(18) signed note reused unchanged", testSignedNoteUnchanged],
  ["(19) ambiguous legacy note never arbitrarily adopted", testMultipleLegacyNotesDeferred],
  ["(hook) onProcedureCompleted links event + delegates note creation", testHookLinksAndCreates],
  ["(12) feature OFF → hooks perform zero reads/writes", testHooksFlagOff],
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

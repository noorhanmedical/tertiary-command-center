// Phase 2F-B — procedure state machine, prerequisites, generator, lineage,
// void, signature sync, reconciliation, and backfill gates.
//
//   npx tsx tests/unit/procedureStateMachineAndGenerator.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const sm = () => import("../../server/services/procedureLifecycle/procedureStateMachine");
const prereq = () => import("../../server/services/procedureLifecycle/procedurePrerequisites");
const gen = () => import("../../server/services/procedureLifecycle/procedureNoteGenerator");
const lineage = () => import("../../server/services/procedureLifecycle/procedureNoteLineage");
const noteSvc = () => import("../../server/services/procedureLifecycle/procedureNoteService");
const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const routes = () => import("../../server/routes/procedureEvents");
const flagsMod = () => import("../../server/lib/featureFlags");

const OLD = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const LIFE = { canonicalProcedureLifecycle: true, canonicalAppointment: true } as const;
const ALL = { canonicalProcedureLifecycle: true, canonicalProcedureNote: true, unifiedAncillaryDocuments: true, canonicalAppointment: true } as const;
const GEN = { ...ALL, procedureNoteGenerator: true } as const;

function caseRow(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, lifecycleStatus: "active", ...o }; }
function peRow(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "not_started", completedByUserId: null, completedAt: null, note: null, metadata: {}, globalPlexusPatientId: null, patientClinicMembershipId: null, startedAt: null, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function reportRef(o: Record<string, unknown> = {}) { return { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...o }; }
function noteRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, procedureEventId: 300, reportDocumentReferenceId: 42, effectiveClinicalDate: OLD, generatedText: null, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function apptEvt(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "BrainWave", status: "scheduled", executionCaseId: 900, patientScreeningId: 77, startsAt: OLD, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null, source: "x", metadata: {}, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 1000, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", patientScreeningId: 77, executionCaseId: 900, ...o }; }
function prereqRow(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, serviceType: "BrainWave", requirementCode: "informed_consent", blockerCategory: "hard_procedure_blocker", blocksStage: "procedure_start", required: true, overrideAllowed: false, overrideRoles: null, overrideAuditRequired: true, active: true, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...o }; }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
function qupd(a: unknown[][]): (v: Record<string, unknown>) => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
const flush = () => new Promise((r) => setImmediate(r));

function fakeApp() { const table: Record<string, (req: any, res: any) => unknown> = {}; const app = { get: (p: string, h: any) => { table[`GET ${p}`] = h; }, post: (p: string, h: any) => { table[`POST ${p}`] = h; } }; return { app, table }; }
function mockRes() { const res: any = { statusCode: 200, body: undefined }; res.status = (c: number) => { res.statusCode = c; return res; }; res.json = (b: any) => { res.body = b; return res; }; return res; }

// A start spec: direct case, qualifying appointment, configurable prereqs.
function startSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { configs?: unknown[]; readiness?: unknown[]; pe?: unknown[]; appt?: unknown[]; onPeInsert?: (v: any) => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => o.appt ?? [apptEvt()], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.prerequisiteConfig, { select: () => o.configs ?? [] }],
    [t.caseDocumentReadiness, { select: () => o.readiness ?? [] }],
    [t.procedureEvents, { select: () => o.pe ?? [], onInsert: o.onPeInsert ?? ((v) => [{ ...peRow(), ...v, id: 300 }]), onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
}

// (1) start succeeds with no hard blockers
async function testStartSucceeds() {
  const t = await loadCanonicalTables(); const s = await sm();
  const r = await runWithDb(startSpec(t), LIFE, async () => s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u1" }));
  assert.equal(r.status, "started");
  assert.equal(r.prerequisites?.allowed, true);
}

// (2) hard configured blocker prevents start
async function testHardBlockerPreventsStart() {
  const t = await loadCanonicalTables(); const s = await sm();
  const r = await runWithDb(startSpec(t, { configs: [prereqRow()], readiness: [] }), LIFE, async (calls: Call[]) => {
    const res = await s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u1" });
    assert.equal(countOps(calls, "insert", t.procedureEvents), 0, "blocked start writes no event");
    return res;
  });
  assert.equal(r.status, "prerequisites_blocked");
  assert.ok(r.prerequisites?.hardBlockers.some((b) => b.requirementCode === "informed_consent"));
}

// (3) soft/billing/claim blocker does NOT block start
async function testSoftBlockerDoesNotBlock() {
  const t = await loadCanonicalTables(); const s = await sm();
  const configs = [prereqRow({ requirementCode: "coding", blockerCategory: "billing_blocker" }), prereqRow({ id: 2, requirementCode: "followup", blockerCategory: "documentation_follow_up" })];
  const r = await runWithDb(startSpec(t, { configs, readiness: [] }), LIFE, async () => s.startProcedure({ clinicId: 1, serviceType: "BrainWave", ancillaryCaseId: 5, actorUserId: "u1" }));
  assert.equal(r.status, "started");
  assert.ok((r.prerequisites?.billingBlockers.length ?? 0) >= 1);
  assert.equal(r.prerequisites?.hardBlockers.length, 0);
}

// (4) required consent blocks ONLY the configured service
async function testConsentBlocksOnlyConfiguredService() {
  const t = await loadCanonicalTables(); const p = await prereq();
  const blocked = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow({ serviceType: "BrainWave" })] }],
    [t.gse, { select: () => [apptEvt()] }],
    [t.prerequisiteConfig, { select: () => [prereqRow()] }],
    [t.caseDocumentReadiness, { select: () => [] }],
  ]), LIFE, async () => p.evaluateProcedurePrerequisites({ clinicId: 1, ancillaryCaseId: 5, stage: "procedure_start" }));
  assert.equal(blocked.allowed, false);
  // Different service with no config → allowed.
  const allowed = await runWithDb(new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow({ serviceType: "EchoWave" })] }],
    [t.gse, { select: () => [apptEvt({ serviceType: "EchoWave" })] }],
    [t.prerequisiteConfig, { select: () => [] }],
    [t.caseDocumentReadiness, { select: () => [] }],
  ]), LIFE, async () => p.evaluateProcedurePrerequisites({ clinicId: 1, ancillaryCaseId: 5, stage: "procedure_start" }));
  assert.equal(allowed.allowed, true);
}

// (5) authorized EXPLICIT override succeeds; (6) role alone / unauthorized stays blocked
async function testOverride() {
  const t = await loadCanonicalTables(); const p = await prereq();
  const spec = () => new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [apptEvt()] }],
    [t.prerequisiteConfig, { select: () => [prereqRow({ overrideAllowed: true, overrideRoles: "admin,clinician" })] }],
    [t.caseDocumentReadiness, { select: () => [] }],
  ]);
  const override = { reason: "clinical urgency", requirementCodes: ["informed_consent"] };
  // (6a) role alone (no override request) does NOT clear the hard blocker.
  const roleOnly = await runWithDb(spec(), LIFE, async () => p.evaluateProcedurePrerequisites({ clinicId: 1, ancillaryCaseId: 5, stage: "procedure_start", actorRole: "admin" }));
  assert.equal(roleOnly.allowed, false, "role eligibility alone never overrides");
  assert.ok(roleOnly.overrideableBlockers.length >= 1);
  assert.equal(roleOnly.appliedOverrides.length, 0);
  // (5) authorized explicit override with a reason clears it.
  const authorized = await runWithDb(spec(), LIFE, async () => p.evaluateProcedurePrerequisites({ clinicId: 1, ancillaryCaseId: 5, stage: "procedure_start", actorRole: "admin", override }));
  assert.equal(authorized.allowed, true, "(5) authorized explicit override clears the hard blocker");
  assert.equal(authorized.appliedOverrides[0]?.requirementCode, "informed_consent");
  // (6) unauthorized role remains blocked even WITH an explicit override request.
  const unauthorized = await runWithDb(spec(), LIFE, async () => p.evaluateProcedurePrerequisites({ clinicId: 1, ancillaryCaseId: 5, stage: "procedure_start", actorRole: "biller", override }));
  assert.equal(unauthorized.allowed, false, "(6) unauthorized role remains blocked");
  assert.equal(unauthorized.appliedOverrides.length, 0);
}

// (7) start/pause/resume transitions
async function testStartPauseResume() {
  const t = await loadCanonicalTables(); const s = await sm();
  const paused = await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v, procedureStatus: "paused" }] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async () => s.pauseProcedure(300, 1, "u1"));
  assert.equal(paused.status, "transitioned");
  assert.equal(paused.procedureEvent?.procedureStatus, "paused");
  const resumed = await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ procedureStatus: "paused" })], onUpdate: (v) => [{ ...peRow(), ...v, procedureStatus: "in_progress" }] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async () => s.resumeProcedure(300, 1, "u1"));
  assert.equal(resumed.status, "transitioned");
}

// (8) cancel/no-show/unable transitions (each voids note lineage)
async function testTerminalTransitions() {
  const t = await loadCanonicalTables(); const s = await sm();
  const spec = () => new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.procedureNotes, { select: () => [], onUpdate: (v) => [{ ...v }] }],
    [t.documentReferences, { onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  for (const [fn, st] of [[s.cancelProcedure, "cancelled"], [s.markProcedureNoShow, "no_show"], [s.markProcedureUnableToComplete, "unable_to_complete"]] as const) {
    const r = await runWithDb(spec(), ALL, async () => (fn as any)(300, 1, "reason", "u1"));
    assert.equal(r.status, "transitioned", st);
  }
}

// (9) invalid transition rejected
async function testInvalidTransition() {
  const t = await loadCanonicalTables(); const s = await sm();
  const r = await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ procedureStatus: "not_started" })], onUpdate: () => [] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async () => s.resumeProcedure(300, 1, "u1"));
  assert.equal(r.status, "invalid_transition");
  // terminal cannot reopen
  const term = await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete" })] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async () => s.pauseProcedure(300, 1, "u1"));
  assert.equal(term.status, "terminal_state");
}

// (10) cross-clinic transition denied (clinic-scoped read → not found)
async function testCrossClinicTransition() {
  const t = await loadCanonicalTables(); const s = await sm();
  const r = await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async (calls: Call[]) => {
    const res = await s.pauseProcedure(300, 1, "u1");
    assert.equal(countOps(calls, "update", t.procedureEvents), 0);
    return res;
  });
  assert.equal(r.status, "not_found");
}

// (11) server timestamps + actor recorded
async function testServerStampsAndActor() {
  const t = await loadCanonicalTables(); const s = await sm();
  let patch: Record<string, unknown> | null = null; let journey: Record<string, unknown> | null = null;
  await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => { patch = v; return [{ ...peRow(), ...v }]; } }],
    [t.journeyEvents, { onInsert: (v) => { journey = v; return []; } }],
  ]), LIFE, async () => s.pauseProcedure(300, 1, "u42"));
  assert.ok((patch as Record<string, unknown>).pausedAt instanceof Date, "server timestamp stamped");
  assert.ok((patch as Record<string, unknown>).lastTransitionAt instanceof Date);
  assert.equal((journey as Record<string, unknown>).actorUserId, "u42", "actor recorded");
  assert.equal((journey as Record<string, unknown>).patientName, "[procedure_lifecycle_audit]", "PHI-free audit sentinel");
}

// (15/22) eligible note enters pending generation and remains unsigned (generator OFF)
async function testEligibleNotePending() {
  const t = await loadCanonicalTables(); const n = await noteSvc();
  let notePayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.procedureNotes, { select: qsel([[], []]), onInsert: (v) => { notePayload = v; return [{ ...noteRow(), ...v, id: 900 }]; } }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => n.createOrReuseProcedureNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "created");
  const np = notePayload as Record<string, unknown>;
  assert.equal(np.generationStatus, "pending", "(15) pending generation");
  assert.equal(np.signatureStatus, "needs_signature", "(22) remains unsigned");
}

// (16/17/18/20) generator claims exact note once, uses exact evidence, pending→generated
async function testGeneratorSuccess() {
  const t = await loadCanonicalTables(); const g = await gen();
  let genPayload: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: qupd([[noteRow({ generationStatus: "generating" })], [{ ...noteRow(), generationStatus: "generated" }]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [reportRef()]]), onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
  ]);
  // Capture the generated update payload (second procedureNotes update).
  let calls = 0;
  const spec2 = new Map(spec);
  spec2.set(t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: (v) => { calls++; if (calls === 2) genPayload = v; return calls === 1 ? [noteRow({ generationStatus: "generating" })] : [{ ...noteRow(), ...v }]; } });
  const r = await runWithDb(spec2, GEN, async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "generated", "(20) pending→generating→generated");
  const gp = genPayload as Record<string, unknown>;
  assert.equal(gp.generationStatus, "generated");
  assert.ok(typeof gp.generatedText === "string" && (gp.generatedText as string).length > 0, "(18) body generated from evidence");
  assert.equal(gp.generatedByAi, false, "truthful generatedByAi");
  const sd = gp.sourceData as Record<string, unknown>;
  assert.equal(sd.procedure_event_id, 300, "(18) exact procedure evidence");
  assert.equal(sd.report_document_reference_id, 42, "(18) exact report evidence");
}

// (17) concurrent generation does not duplicate (claim yields zero rows)
async function testGeneratorConcurrent() {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: () => [] }], // claim loses the race
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: () => [reportRef()] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "already_claimed", "(17) second worker never duplicates a body");
}

// (19/21) unsafe/unavailable report → failed with PHI-free code, no fabricated text
async function testGeneratorReportUnavailable() {
  const t = await loadCanonicalTables(); const g = await gen();
  let failPayload: Record<string, unknown> | null = null; let calls = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: (v) => { calls++; if (calls === 2) failPayload = v; return calls === 1 ? [noteRow({ generationStatus: "generating" })] : [{ ...v }]; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], []]) }], // report ref lookup fails
    [t.caseDocumentReadiness, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "report_content_unavailable_retry_recorded");
  const fp = failPayload as Record<string, unknown>;
  assert.equal(fp.generationStatus, "failed", "(21) moves to failed");
  assert.equal(fp.errorMessage, "report_content_unavailable", "(21) PHI-free error code");
  assert.ok(!("generatedText" in fp), "(19) no fabricated text");
}

// (23) report replacement creates exactly one amendment
async function testAmendmentCreatesOne() {
  const t = await loadCanonicalTables(); const l = await lineage();
  let inserts = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => [{ ...v }], onInsert: (v) => { inserts++; return [{ ...noteRow(), ...v, id: 901 }]; } }],
    [t.documentReferences, { onUpdate: (v) => [{ ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(r.status, "amended_reference_created");
  assert.equal(inserts, 1, "(23) exactly one amendment note");
}

// (26) cancel voids the current note + reference
async function testVoidOnInvalidProcedure() {
  const t = await loadCanonicalTables(); const l = await lineage();
  let notePatch: Record<string, unknown> | null = null; let refUpd = 0;
  const procRef = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => { notePatch = v; return [{ ...v }]; } }],
    [t.documentReferences, { select: () => [procRef], onUpdate: () => { refUpd++; return [procRef]; } }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.voidProcedureNoteLineageForCase({ clinicId: 1, ancillaryCaseId: 5, reason: "cancelled", actorUserId: "u1" }));
  assert.equal(r.status, "voided");
  const np = notePatch as Record<string, unknown>;
  assert.equal(np.generationStatus, "voided", "(26) unsigned note voided");
  assert.ok("supersededAt" in np);
  assert.ok(refUpd >= 1, "(26) reference voided");
}

// (26b) signed note void supersedes without rewriting body
async function testVoidSignedNote() {
  const t = await loadCanonicalTables(); const l = await lineage();
  let notePatch: Record<string, unknown> | null = null;
  const procRef = reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900 });
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ signatureStatus: "signed", signedAt: OLD, generationStatus: "approved" })], onUpdate: (v) => { notePatch = v; return [{ ...v }]; } }],
    [t.documentReferences, { select: () => [procRef], onUpdate: () => [procRef] }], [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.voidProcedureNoteLineageForCase({ clinicId: 1, ancillaryCaseId: 5, reason: "cancelled", actorUserId: "u1" }));
  assert.equal(r.status, "voided");
  const np = notePatch as Record<string, unknown>;
  for (const f of ["generatedText", "generationStatus", "signatureStatus", "signedAt", "signedByUserId"]) assert.ok(!(f in np), `signed void must not touch ${f}`);
  assert.ok("supersededAt" in np);
}

// (27/28) signature reference sync after sign / return
async function testSignatureSync() {
  const t = await loadCanonicalTables(); const n = await noteSvc();
  const spec = (docStatus: string) => new Map<unknown, TableSpec>([
    [t.documentReferences, { select: () => [reportRef({ id: 55, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, documentStatus: docStatus === "signed" ? "pending_signature" : "signed" })], onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const signed = await runWithDb(spec("signed"), ALL, async () => n.syncProcedureNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: OLD }));
  assert.equal(signed.status, "synced");
  const returned = await runWithDb(spec("pending_signature"), ALL, async () => n.syncProcedureNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "pending_signature", signedAt: null }));
  assert.equal(returned.status, "synced");
}

// (29) signature sync feature OFF → no-op (zero reads/writes)
async function testSignatureSyncFlagOff() {
  const t = await loadCanonicalTables(); const n = await noteSvc();
  let reads = 0;
  await runWithDb(new Map<unknown, TableSpec>([[t.documentReferences, { select: () => { reads++; return []; } }]]), { canonicalProcedureNote: false }, async () => {
    const r = await n.syncProcedureNoteReferenceSignature({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, documentStatus: "signed", signedAt: OLD });
    assert.equal(r.status, "skipped_flag_off");
  });
  assert.equal(reads, 0, "(29) feature OFF → zero reference reads/writes");
}

// (31/32/33/34) exact retry actions execute; siblings unresolved; generator/lineage retries
async function testRetryActions() {
  const t = await loadCanonicalTables(); const w = await worker();
  // void_procedure_note retry (idempotent no_current_note → resolved)
  const voidFailure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolved = 0;
  const r = await runWithDb(new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [voidFailure], onUpdate: () => { resolved++; return [{ id: 1 }]; } }],
    [t.procedureNotes, { select: () => [] }], // no current note → idempotent void resolves
  ]), ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(r.outcomes[0].status, "resolved", "(31) void retry executes");
  assert.equal(resolved, 1, "(43) exact-id resolution only, no broad resolution");
}

// (33) generator retry uses the exact note id
async function testGeneratorRetryExact() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 2, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let calls = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: () => [{ id: 2 }] }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "pending" })], onUpdate: (v) => { calls++; return calls === 1 ? [noteRow({ generationStatus: "generating" })] : [{ ...v }]; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [reportRef()]]), onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(r.outcomes[0].status, "resolved", "(33) generator retry resolves the exact note");
}

// (35/36/37/38) backfill dry-run default + apply gates (structural)
async function testBackfillGates() {
  const src = readFileSync(join(process.cwd(), "script/backfillCanonicalProcedureLifecycle.ts"), "utf8");
  assert.match(src, /BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY === "YES"/, "(35) apply gate");
  assert.match(src, /featureFlags\.canonicalProcedureLifecycle && featureFlags\.canonicalProcedureNote && featureFlags\.unifiedAncillaryDocuments/, "(35) triple-flag apply gate");
  assert.match(src, /multiple_candidate_cases/, "(37) ambiguity classified, never first/newest");
  assert.ok(!/generatedText|generateProcedureNote/.test(src), "(38) backfill never generates bodies");
  assert.ok(!/DELETE FROM|TRUNCATE|update\(clinics/i.test(src), "no data deletion/clinic mutation");
}

// (39/40/41/42/44) exclusions + defaults
async function testExclusionsAndDefaults() {
  const f = await flagsMod();
  for (const flag of ["canonicalProcedureLifecycle", "canonicalProcedureNote", "unifiedAncillaryDocuments", "procedureNoteGenerator"] as const) {
    assert.equal((f.featureFlags as any)[flag], false, `(39) ${flag} defaults OFF`);
  }
  // (41) Phase 2J adds migration 0056 (canonical claim/invoice/payment); the
  // forbidden-next boundary is 0057.
  assert.ok(!readdirSync(join(process.cwd(), "migrations")).some((x) => x.startsWith("0057")), "(41) no migration 0057");
  // (40/42) no billing_document / Twilio / SMS in the Phase 2F-B procedure files
  // (Phase 2G billing lives in server/services/billingLifecycle/, not here).
  const files = ["procedureStateMachine", "procedurePrerequisites", "procedureNoteGenerator", "procedureNoteLineage"].map((n) => readFileSync(join(process.cwd(), `server/services/procedureLifecycle/${n}.ts`), "utf8")).join("\n").toLowerCase();
  for (const tok of ["billing_document", "twilio", " sms", "invoice", "text message"]) assert.ok(!files.includes(tok), `(40/42/23-24) must not reference ${tok}`);
  // (44) awaited state transition leaves no escaping async DB task.
  const t = await loadCanonicalTables(); const s = await sm();
  await runWithDb(new Map<unknown, TableSpec>([[t.procedureEvents, { select: () => [peRow({ procedureStatus: "in_progress" })], onUpdate: (v) => [{ ...peRow(), ...v }] }], [t.journeyEvents, { onInsert: () => [] }]]), LIFE, async (calls: Call[]) => {
    await s.pauseProcedure(300, 1, "u1");
    const settled = calls.length; await flush(); await flush();
    assert.equal(calls.length, settled, "(44) no escaping async DB task");
  });
}

// (12/13/14) canonical completion clinicless sync + immutable completedAt + episodes are covered in
// procedureLifecycleTenantAndRetrySafety / procedureLifecycleCommitAndEvidenceTruth; a route smoke test here:
// (route) start route is clinic-scoped
async function testStartRouteClinicScoped() {
  const { app, table } = fakeApp();
  (await routes()).registerProcedureEventRoutes(app as any);
  const res = mockRes();
  await table["POST /api/procedure-events/start"]({ clinicId: null, body: { serviceType: "BrainWave", ancillaryCaseId: 5 }, session: {} }, res);
  assert.equal(res.statusCode, 403, "start route fails closed without clinic context");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) start succeeds with no hard blockers", testStartSucceeds],
  ["(2) hard configured blocker prevents start", testHardBlockerPreventsStart],
  ["(3) soft/billing blocker does not block start", testSoftBlockerDoesNotBlock],
  ["(4) required consent blocks only configured service", testConsentBlocksOnlyConfiguredService],
  ["(5/6) authorized override / unauthorized blocked", testOverride],
  ["(7) start/pause/resume transitions", testStartPauseResume],
  ["(8) cancel/no-show/unable transitions", testTerminalTransitions],
  ["(9) invalid transition rejected", testInvalidTransition],
  ["(10) cross-clinic transition denied", testCrossClinicTransition],
  ["(11) server timestamps + actor recorded", testServerStampsAndActor],
  ["(15/22) eligible note pending + unsigned", testEligibleNotePending],
  ["(16/18/20) generator claims once + exact evidence", testGeneratorSuccess],
  ["(17) concurrent generation no duplicate", testGeneratorConcurrent],
  ["(19/21) unavailable report → failed, no fabrication", testGeneratorReportUnavailable],
  ["(23) report replacement creates one amendment", testAmendmentCreatesOne],
  ["(26) invalid procedure voids note/reference", testVoidOnInvalidProcedure],
  ["(24/26b) signed note void supersedes, body immutable", testVoidSignedNote],
  ["(27/28) signature reference sync", testSignatureSync],
  ["(29) signature sync feature OFF → no-op", testSignatureSyncFlagOff],
  ["(31/43) exact retry actions + no broad resolution", testRetryActions],
  ["(33) generator retry uses exact note id", testGeneratorRetryExact],
  ["(35/37/38) backfill dry-run + apply gates", testBackfillGates],
  ["(39/40/41/42/44) exclusions + defaults", testExclusionsAndDefaults],
  ["(route) start route clinic-scoped", testStartRouteClinicScoped],
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

// Phase 2F retry execution finalization + exact-recovery closeout.
//
// Covers: verified failed-note regeneration (bound to an exact unresolved
// failure), post-claim recovery (never stranded `generating`), truthful
// generated-reference synchronization, terminal-evidence-gated void
// reconciliation, exact-source lineage retries, backfill generation suppression,
// and exact-only retry resolution.
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
function failRow(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1, ...o }; }
function qsel(a: unknown[][]): () => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
function qupd(a: unknown[][]): (v: Record<string, unknown>) => unknown[] { let i = 0; return () => a[Math.min(i++, a.length - 1)]; }
function migErr(): Error { const e = new Error("migration_missing") as Error & { code?: string }; e.code = "42P01"; return e; }

/** Eligible-generation spec around a note in the given generationStatus. The
 *  verifying unresolved failure is present so the exact-failure retry passes its
 *  §7 binding check; dedupe selects thereafter find none (→ insert). */
function genSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, note: Record<string, unknown>, o: { onNoteUpdate?: (v: any) => unknown[]; readiness?: unknown[]; docFailInsert?: (v: any) => unknown[]; failuresSelect?: () => unknown[] } = {}) {
  return new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [note], onUpdate: o.onNoteUpdate ?? qupd([[{ ...note, generationStatus: "generating" }], [{ ...note, generationStatus: "generated" }]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => o.readiness ?? [readinessRow()] }],
    [t.documentFailures, { select: o.failuresSelect ?? qsel([[failRow()], []]), onInsert: o.docFailInsert ?? ((v) => [{ ...v, id: 1 }]) }],
  ]);
}

// (17) verified exact failed-note regeneration succeeds
async function testVerifiedFailedRetrySucceeds() {
  const t = await loadCanonicalTables(); const g = await gen();
  const r = await runWithDb(genSpec(t, noteRow({ generationStatus: "failed" })), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "generated", "(12/17) exact reference synced → generated");
}

// (16) an UNVERIFIED failed-note retry cannot execute (no matching / mismatched failure)
async function testUnverifiedFailedRetryRejected() {
  const t = await loadCanonicalTables(); const g = await gen();
  const noClaim: TableSpec = { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: () => { throw new Error("must not claim an unverified failed note"); } };
  // No unresolved failure at all.
  const missing = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, noClaim], [t.documentFailures, { select: () => [] }]]), GEN,
    async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 999 }));
  assert.equal(missing.status, "failure_not_verified", "(16) missing failure not verified");
  // A failure exists but names a DIFFERENT source id.
  const mismatch = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, noClaim], [t.documentFailures, { select: () => [failRow({ sourceId: 901 })] }]]), GEN,
    async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(mismatch.status, "failure_not_verified", "(16) source-mismatched failure not verified");
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

// (11) post-claim migration failure on the FAILED path restores generating→failed
async function testFailedRetryPostClaimMigrationRestores() {
  const t = await loadCanonicalTables(); const g = await gen();
  const updates: Record<string, unknown>[] = []; let uc = 0;
  const onNoteUpdate = (v: any) => { uc++; updates.push(v); if (uc === 2) throw migErr(); return [{ ...noteRow(), ...v }]; };
  const r = await runWithDb(genSpec(t, noteRow({ generationStatus: "failed" }), { onNoteUpdate }), GEN,
    async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "migration_missing", "(11) migration surfaced");
  assert.equal(updates[0].generationStatus, "generating", "claim happened");
  assert.equal(updates[updates.length - 1].generationStatus, "failed", "(11) note restored — never stranded generating");
}

// (10) post-claim migration failure on the PENDING path restores generating→failed
async function testPendingPostClaimMigrationRestores() {
  const t = await loadCanonicalTables(); const g = await gen();
  const updates: Record<string, unknown>[] = []; let uc = 0;
  const onNoteUpdate = (v: any) => { uc++; updates.push(v); if (uc === 2) throw migErr(); return [{ ...noteRow(), ...v }]; };
  const r = await runWithDb(genSpec(t, noteRow({ generationStatus: "pending" }), { onNoteUpdate }), GEN,
    async () => g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "migration_missing", "(10) migration surfaced");
  assert.equal(updates[updates.length - 1].generationStatus, "failed", "(10) pending claim restored to failed");
}

// (13) generated-note reference sync: missing reference → truthful separate retry + resolve
async function testWorkerGeneratedMissingReferenceRetry() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = failRow({ id: 20 });
  let resolves = 0; const records: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; else records.push(v); return [{ id: 20 }]; }, onInsert: (v) => { records.push(v); return [{ ...v, id: 30 }]; } }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })] }],
    [t.documentReferences, { select: () => [] }], // no reference → no_reference + recorded sync retry
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "(13) generation boundary resolves once a separate sync retry is durable");
  assert.equal(resolves, 1);
  assert.ok(records.length >= 1, "(13) a distinct reference retry was recorded — not lost");
}

// (15) generated-note reference sync: zero-row update → truthful separate retry + resolve
async function testWorkerGeneratedZeroRowReference() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = failRow({ id: 21 });
  let resolves = 0; let records = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; else records++; return [{ id: 21 }]; }, onInsert: (v) => { records++; return [{ ...v, id: 31 }]; } }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: () => [] }], // zero-row → sync_failed + recorded
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "(15) zero-row reference records a durable retry then resolves");
  assert.equal(resolves, 1);
  assert.ok(records >= 1, "(15) reference retry recorded");
}

// (12) generated-note reference sync: exact one-row update → synced → resolve, no retry
async function testWorkerGeneratedReferenceSynced() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = failRow({ id: 22 });
  let resolves = 0; let records = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; else records++; return [{ id: 22 }]; }, onInsert: () => { records++; return [{ id: 32 }]; } }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: (v) => [{ ...v }] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "(12) synced reference resolves");
  assert.equal(resolves, 1); assert.equal(records, 0, "(12) no retry needed when synced");
}

// (14) generated-note reference belonging to the WRONG case is denied (never resolved)
async function testWorkerGeneratedWrongCaseReference() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = failRow({ id: 23 });
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 23 }]; }, onInsert: () => [{ id: 33 }] }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })] }],
    [t.documentReferences, { select: () => [procRef({ ancillaryCaseId: 6 })], onUpdate: () => { throw new Error("must not update a wrong-case reference"); } }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "(14) wrong-case reference is denied, not resolved");
  assert.equal(resolves, 0);
}

// (5/6) cross-clinic and cross-case verified failed-note retries are denied (no claim)
async function testFailedRetryTenancyDenied() {
  const t = await loadCanonicalTables(); const g = await gen();
  const guard: TableSpec = { select: () => [failRow()] };
  const xclinic = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ clinicId: 2 })], onUpdate: () => { throw new Error("must not claim"); } }], [t.documentFailures, guard]]), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(xclinic.status, "cross_clinic_denied", "(5) cross-clinic denied");
  const xcase = await runWithDb(new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ ancillaryCaseId: 6 })], onUpdate: () => { throw new Error("must not claim"); } }], [t.documentFailures, guard]]), GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(xcase.status, "cross_clinic_denied", "(6) cross-case denied");
}

// concurrent verified failed-note retries claim exactly once
async function testFailedRetryConcurrent() {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([[t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: () => [] }], [t.documentFailures, { select: () => [failRow()] }]]); // claim loses race
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "already_claimed", "only one worker claims");
}

// (18/19/26) worker: failed-note retry that fails again is NOT resolved; sibling untouched
async function testWorkerFailedGenerationNeverResolves() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 1 }]; }, onInsert: (v) => [{ ...v, id: 2 }] }],
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: qupd([[noteRow({ generationStatus: "generating" })], [noteRow({ generationStatus: "failed" })]]) }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [] }], // report unresolvable → not eligible after claim
    [t.caseDocumentReadiness, { select: () => [] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "(18/26) failed generation never resolves");
  assert.equal(resolves, 0, "(19) no resolution write");
}

// (4) cancelled exact procedure passes terminal void validation → reconciled
async function testVoidTerminalCancelled() { await voidTerminal("cancelled", "reconciled"); }
// (5t) no_show passes terminal validation
async function testVoidTerminalNoShow() { await voidTerminal("no_show", "reconciled"); }
// (6t) unable_to_complete passes terminal validation
async function testVoidTerminalUnable() { await voidTerminal("unable_to_complete", "reconciled"); }

async function voidTerminal(procedureStatus: string, expected: string) {
  const t = await loadCanonicalTables(); const l = await lineage();
  let refPatch: Record<string, unknown> | null = null;
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: (v) => { refPatch = v; return [procRef()]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, expected, `terminal ${procedureStatus} → ${expected}`);
  assert.equal((refPatch as Record<string, unknown>).documentStatus, "voided", "exact reference voided");
}

// (3) an AMENDMENT-superseded note (procedure still complete) fails terminal void validation
async function testVoidAmendmentSupersededRejected() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    // superseded (amendment) but the exact procedure is still `complete`.
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "generated" })] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete" })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: () => { throw new Error("must not void a report-amended note"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "terminal_evidence_missing", "(3) amendment-superseded note is NOT voidable");
}

// (3w) worker: terminal_evidence_missing never resolves the void failure
async function testWorkerVoidTerminalEvidenceMissingNeverResolves() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 40, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 40 }]; } }],
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "generated" })] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete" })] }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: () => { throw new Error("must not void"); } }],
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "(3w) no terminal evidence → not resolved");
  assert.equal(resolves, 0);
}

// exact void-reference reconciliation of the named superseded/voided note (terminal)
async function testVoidReferenceAlreadyReconciled() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "cancelled" })] }],
    [t.documentReferences, { select: () => [procRef({ documentStatus: "voided", supersededAt: OLD })], onUpdate: () => { throw new Error("must not update"); } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, "already_reconciled");
}

// (24) source-bearing void: reference_missing never resolves (terminal evidence present)
async function testSourceBearingVoidReferenceMissing() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 3, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 3 }]; } }],
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided" })] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "cancelled" })] }],
    [t.documentReferences, { select: () => [] }], // no procedure_note reference exists
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "reference_missing", "(24) reference_missing surfaced");
  assert.equal(resolves, 0, "(24) source-bearing void never resolves on missing reference");
}

// source-less case-level void may idempotently resolve on no_current_note
async function testSourceLessVoidResolves() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 4, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: null, sourceId: null, requestedAction: "void_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 4 }]; } }],
    [t.procedureNotes, { select: () => [] }], // no current note → idempotent
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "resolved", "source-less no_current_note resolves");
  assert.equal(resolves, 1);
}

// (8) an invalid procedure_notes + null-sourceId lineage pairing is rejected (never resolved)
async function testWorkerLineageInvalidPairingRejected() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = { id: 50, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "reconcile_procedure_note_lineage", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 50 }]; } }],
    [t.procedureNotes, { select: () => { throw new Error("must not act on an invalid pairing"); } }],
  ]);
  const res = await runWithDb(spec, ALL, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.equal(res.outcomes[0].status, "still_deferred", "(8) invalid pairing not processed");
  assert.equal(res.outcomes[0].message, "invalid_source_pairing");
  assert.equal(resolves, 0);
}

// (7) backfill queues lineage reconciliation against the EXACT non-null note id
async function testBackfillAmendmentExactSource() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["generated_note_amendment_required"] as any, { caseId: 5, noteId: 900 }));
  assert.ok(["applied", "apply_deferred"].includes(r.overall), JSON.stringify(r));
  const a = queued.find((q) => q.requestedAction === "reconcile_procedure_note_lineage");
  assert.ok(a, "(7) lineage reconciliation queued");
  assert.equal(a!.sourceId, 900, "(7) exact non-null note id");
  assert.equal(a!.sourceTable, "procedure_notes");
  // With no resolvable note id, the amendment is unresolved and NEVER queued as procedure_notes+null.
  const r2 = await runWithDb(new Map<unknown, TableSpec>([[t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 2 }]; } }]]), ALL,
    async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["generated_note_amendment_required"] as any, { caseId: 5, noteId: null }));
  assert.equal(r2.overall, "apply_deferred", "(7) no note id → not applied");
}

// (14b/15b/16b/17b) backfill generation candidate ensures + reloads exact note + queues exact generate
async function testBackfillGenerationCandidate() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const created = noteRow({ id: 900, generationStatus: "pending" });
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 60 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
  ]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["note_generation_candidate"] as any, { caseId: 5, noteId: null }));
  assert.ok(["applied", "apply_deferred"].includes(r.overall), JSON.stringify(r));
  const g = queued.find((q) => q.requestedAction === "generate_procedure_note");
  assert.ok(g, "generate work queued");
  assert.equal(g!.sourceId, 900, "exact non-null reloaded note id — never sourceId=null");
  assert.equal(g!.sourceTable, "procedure_notes");
}

// (1/2b) backfill NEVER generates a body — even with the generator flag ON
async function testBackfillNeverGeneratesWithGeneratorOn() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const created = noteRow({ id: 900, generationStatus: "pending" });
  const noteWrites: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 60 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => { noteWrites.push(v); return [{ ...created, ...v, id: 900 }]; }, onUpdate: (v) => { noteWrites.push(v); return [{ ...v }]; } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  // Generator flag ON — suppression MUST be enforced in code.
  await runWithDb(spec, GEN, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["note_generation_candidate"] as any, { caseId: 5, noteId: null }));
  for (const w of noteWrites) {
    assert.notEqual(w.generationStatus, "generating", "(1) backfill never claims for generation");
    assert.notEqual(w.generationStatus, "generated", "(1) backfill never marks generated");
    assert.ok(w.generatedText == null || w.generatedText === "", "(2) backfill never writes a body");
  }
}

// (1) generation suppression is enforced in the ensure gate itself — the ONLY
// procedure_notes UPDATE in a created-path ensure is the generator's claim, so a
// suppressed ensure performs ZERO note updates while an unsuppressed one claims.
// This guards the completion-hook route the backfill drives via onProcedureCompleted.
function ensureCreatedSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>) {
  const created = noteRow({ id: 900, generationStatus: "pending" });
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], [], [reportRef()]]), onInsert: (v) => [{ ...v, id: 42 }], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }], onUpdate: (v) => [{ ...created, ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
}
async function testEnsureSuppressesGenerationWithGeneratorOn() {
  const t = await loadCanonicalTables();
  const orch = await import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
  // Control: generator ON, NOT suppressed → the generator claims (≥1 note update).
  const control = await runWithDb(ensureCreatedSpec(t), GEN, async (calls: Call[]) => {
    await orch.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    return countOps(calls, "update", t.procedureNotes);
  });
  assert.ok(control >= 1, "(control) generator ON claims the note — test is discriminating");
  // Suppressed: generator ON but suppressGeneration:true → ZERO note updates (no claim, no body).
  const suppressed = await runWithDb(ensureCreatedSpec(t), GEN, async (calls: Call[]) => {
    await orch.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test", suppressGeneration: true });
    return countOps(calls, "update", t.procedureNotes);
  });
  assert.equal(suppressed, 0, "(1) suppressGeneration blocks the generator in code — no note update, no body");
}

// (1c) onProcedureCompleted forwards suppressGeneration to the ensure (backfill route)
async function testOnProcedureCompletedForwardsSuppression() {
  const t = await loadCanonicalTables();
  const orch = await import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
  const spec = ensureCreatedSpec(t);
  // The event is already linked to case 5; onProcedureCompleted validates + ensures.
  spec.set(t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: 5, procedureStatus: "complete", completedAt: OLD })], onUpdate: (v) => [{ ...peRow(), ...v }] });
  const noteUpdates = await runWithDb(spec, GEN, async (calls: Call[]) => {
    await orch.onProcedureCompleted({ procedureEventId: 300, expectedClinicId: 1, suppressGeneration: true });
    return countOps(calls, "update", t.procedureNotes);
  });
  assert.equal(noteUpdates, 0, "(1c) completion-hook route never generates under suppression");
}

// (22/23) amendment deferred-retry-recorded vs reconciliation_not_recorded (exact prior-note source)
async function testAmendmentRetryTruth() {
  const t = await loadCanonicalTables(); const l = await lineage();
  const priorRef = procRef();
  const queued: Record<string, unknown>[] = [];
  const recorded = await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    [t.documentReferences, { select: () => [priorRef], onUpdate: () => [] }], // ref supersede zero-row → rollback
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }],
  ]), ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(recorded.status, "amendment_deferred_retry_recorded", "(22) deferred retry recorded");
  const rec = queued.find((q) => q.requestedAction === "reconcile_procedure_note_lineage");
  assert.equal(rec!.sourceId, 900, "(4) reconcile queued against the exact prior note id");
  assert.equal(rec!.sourceTable, "procedure_notes");
  const notRecorded = await runWithDb(new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "generated" })], onUpdate: (v) => [{ ...v }], onInsert: (v) => [{ ...noteRow(), ...v, id: 901 }] }],
    [t.documentReferences, { select: () => [priorRef], onUpdate: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }], [t.documentFailures, { select: () => [], onInsert: () => { throw new Error("ledger down"); } }],
  ]), ALL, async () => l.amendProcedureNoteLineage({ clinicId: 1, ancillaryCaseId: 5, newReportReferenceId: 99, procedureEventId: 300, effectiveDate: OLD, actorUserId: "u1" }));
  assert.equal(notRecorded.status, "reconciliation_not_recorded", "(23) retry-not-recorded surfaced");
}

// (18/19) exact-id resolution leaves sibling failures untouched (no broad resolution)
async function testSiblingsUntouched() {
  const t = await loadCanonicalTables(); const w = await worker();
  const ok = { id: 10, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 900, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  const sibling = { id: 11, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_notes", sourceId: 901, requestedAction: "generate_procedure_note", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [ok, sibling], onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 10 }]; } }],
    // note 900 already generated (reference synced) → resolve; note 901 not found → sibling stays deferred.
    [t.procedureNotes, { select: qsel([[noteRow({ id: 900, generationStatus: "generated" })], []]) }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: (v) => [{ ...v }] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  const byId = Object.fromEntries(res.outcomes.map((o) => [o.failureId, o.status]));
  assert.equal(byId[10], "resolved", "(18) exact resolve");
  assert.notEqual(byId[11], "resolved", "(19) sibling untouched — no broad resolution");
  assert.equal(resolves, 1, "exactly one resolution");
}

// ── Phase 2K hardening ──
// K5 — a PENDING note whose fresh eligibility read fails records a durable exact
// generate retry (self-healing), stays pending, and dedups; later eligible resolves.
async function testK5GeneratorNotYetEligibleRecordsRetry() {
  const t = await loadCanonicalTables(); const g = await gen();
  const inserts: Record<string, unknown>[] = [];
  const spec = genSpec(t, noteRow({ generationStatus: "pending" }), {
    readiness: [], // no acceptable report → eligibility fails
    failuresSelect: () => [],
    docFailInsert: (v) => { inserts.push(v); return [{ ...v, id: 1 }]; },
  });
  spec.set(t.documentReferences, { select: () => [], onUpdate: (v) => [{ ...v }] }); // no current report reference
  const r = await runWithDb(spec, GEN, async (calls: Call[]) => {
    const res = await g.generateProcedureNote({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 });
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "K5: note stays pending — never claimed/generated on not_yet_eligible");
    return res;
  });
  assert.equal(r.status, "not_yet_eligible_retry_recorded", "K5: durable generate retry recorded on not_yet_eligible");
  assert.ok(inserts.some((i) => i.requestedAction === "generate_procedure_note"), "K5: exact generate_procedure_note retry queued");
}
// K5 — classifyGeneratorOutcome treats the retry-recorded status as durable.
async function testK5ClassifyDurable() {
  const orch = await import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
  const w1: string[] = []; const c1 = orch.classifyGeneratorOutcome("not_yet_eligible_retry_recorded" as any, w1);
  assert.ok(c1.generationDeferred === true && c1.generationRetryRecorded === true, "K5: retry_recorded → durable deferral");
  const w2: string[] = []; const c2 = orch.classifyGeneratorOutcome("not_yet_eligible_retry_not_recorded" as any, w2);
  assert.ok(c2.generationDeferred === true && c2.generationRetryRecorded === false, "K5: retry_not_recorded → non-durable");
}
// K1 — the signature-sync retry ENSURES-OR-CREATES the reference (no dependence on a
// separate link_procedure_note failure), then mirrors the signature → resolved.
async function testK1SignatureSyncEnsuresReference() {
  const t = await loadCanonicalTables(); const w = await worker();
  const note = noteRow({ generationStatus: "generated", signatureStatus: "signed", signedAt: OLD });
  let refCreated = false;
  // First reference lookup (sync) → none; ensure creates it; second lookup → present.
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [note] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.documentReferences, { select: () => (refCreated ? [procRef({ documentStatus: "signed" })] : []), onInsert: (v) => { refCreated = true; return [{ ...v, id: 55 }]; }, onUpdate: (v) => [{ ...v }] }],
    [t.documentFailures, { select: () => [failRow({ id: 30, requestedAction: "sync_procedure_note_signature" })], onInsert: (v) => [{ ...v, id: 2 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await w.retryAncillaryDocumentFailure(failRow({ id: 30, requestedAction: "sync_procedure_note_signature" }) as any);
    assert.ok(countOps(calls, "insert", t.documentReferences) >= 1, "K1: reference deterministically created (ensure-or-create), not left missing");
    return res;
  });
  assert.equal(r.status, "resolved", "K1: reference ensured + signature synced → resolved (no dependence on a separate link failure)");
}
// K2 — a wrong-service lineage retry performs ZERO mutation (never attaches to another
// service episode).
async function testK2LineageWrongServiceZeroMutation() {
  const t = await loadCanonicalTables(); const w = await worker();
  const failure = failRow({ id: 40, requestedAction: "reconcile_procedure_note_lineage" });
  const spec = new Map<unknown, TableSpec>([
    // Note is NerveGuard; the case (reconciliation target) is BrainWave → mismatch.
    [t.procedureNotes, { select: () => [noteRow({ serviceType: "NerveGuard" })], onUpdate: () => { throw new Error("K2: wrong-service lineage must not mutate the note"); } }],
    [t.ancillaryCases, { select: () => [caseRow({ serviceType: "BrainWave" })] }],
    [t.documentReferences, { select: () => [], onInsert: () => { throw new Error("K2: wrong-service lineage must not create a reference"); } }],
    [t.documentFailures, { select: () => [failure], onInsert: (v) => [{ ...v, id: 3 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async (calls: Call[]) => {
    const res = await w.retryAncillaryDocumentFailure(failure as any);
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "K2: zero note mutation");
    return res;
  });
  assert.equal(r.status, "source_type_mismatch", "K2: wrong-service lineage retry rejected, never re-driving ensure");
}
// K3 — the backfill DRY-RUN classifier's report acceptance EXACTLY matches the live
// eligibility service's status set (no broader vocabulary that overstates applicability).
async function testK3ClassifierEligibilityParity() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const elig = await import("../../server/services/procedureLifecycle/procedureNoteEligibility");
  for (const status of ["uploaded", "completed", "approved", "generated", "signed", "pending", "voided"]) {
    const spec = new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.documentReferences, { select: () => [reportRef({ documentStatus: status })] }],
      [t.procedureNotes, { select: () => [] }],
      [t.caseDocumentReadiness, { select: () => [readinessRow({ documentStatus: status })] }],
    ]);
    const outcomes = await runWithDb(spec, ALL, async () => b.classify(peRow({ ancillaryCaseId: 5, procedureStatus: "complete" }) as any));
    const eligible = elig.ACCEPTABLE_REPORT_STATUSES.has(status);
    assert.equal(outcomes.includes("exact_report_evidence_available"), eligible, `K3: report '${status}' classifier availability == live eligibility (${eligible})`);
    assert.equal(outcomes.includes("note_generation_candidate"), eligible, `K3: report '${status}' generation-candidate == live eligibility`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["K5 generator not_yet_eligible records durable retry", testK5GeneratorNotYetEligibleRecordsRetry],
  ["K5 classifyGeneratorOutcome durability", testK5ClassifyDurable],
  ["K1 signature-sync ensures-or-creates reference", testK1SignatureSyncEnsuresReference],
  ["K2 lineage wrong-service zero mutation", testK2LineageWrongServiceZeroMutation],
  ["K3 backfill classifier ↔ eligibility parity", testK3ClassifierEligibilityParity],
  ["(17) verified exact failed-note regeneration succeeds", testVerifiedFailedRetrySucceeds],
  ["(16) unverified failed-note retry cannot execute", testUnverifiedFailedRetryRejected],
  ["(2) pending generator never reclaims a failed note", testPendingGeneratorSkipsFailed],
  ["(11) failed-retry post-claim migration restores failed", testFailedRetryPostClaimMigrationRestores],
  ["(10) pending post-claim migration restores failed", testPendingPostClaimMigrationRestores],
  ["(13) generated missing-reference truthful retry + resolve", testWorkerGeneratedMissingReferenceRetry],
  ["(15) generated zero-row reference truthful retry + resolve", testWorkerGeneratedZeroRowReference],
  ["(12) generated reference synced → resolve", testWorkerGeneratedReferenceSynced],
  ["(14) generated wrong-case reference denied", testWorkerGeneratedWrongCaseReference],
  ["(5/6) failed-note retry tenancy denied", testFailedRetryTenancyDenied],
  ["concurrent failed-note retries claim once", testFailedRetryConcurrent],
  ["(18/19/26) worker: failed generation never resolves", testWorkerFailedGenerationNeverResolves],
  ["(4) void terminal cancelled reconciles", testVoidTerminalCancelled],
  ["(5) void terminal no_show reconciles", testVoidTerminalNoShow],
  ["(6) void terminal unable_to_complete reconciles", testVoidTerminalUnable],
  ["(3) amendment-superseded note rejected by void", testVoidAmendmentSupersededRejected],
  ["(3w) worker: terminal evidence missing never resolves", testWorkerVoidTerminalEvidenceMissingNeverResolves],
  ["void reference already-reconciled is idempotent", testVoidReferenceAlreadyReconciled],
  ["(24) source-bearing void reference_missing never resolves", testSourceBearingVoidReferenceMissing],
  ["source-less no_current_note resolves", testSourceLessVoidResolves],
  ["(8) invalid lineage source pairing rejected", testWorkerLineageInvalidPairingRejected],
  ["(7) backfill amendment queues exact note source", testBackfillAmendmentExactSource],
  ["backfill generation candidate executable", testBackfillGenerationCandidate],
  ["(1/2) backfill never generates with generator ON", testBackfillNeverGeneratesWithGeneratorOn],
  ["(1) ensure suppresses generation in code with generator ON", testEnsureSuppressesGenerationWithGeneratorOn],
  ["(1c) onProcedureCompleted forwards suppression", testOnProcedureCompletedForwardsSuppression],
  ["(22/23) amendment retry truth + exact source", testAmendmentRetryTruth],
  ["(18/19) siblings untouched, no broad resolution", testSiblingsUntouched],
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

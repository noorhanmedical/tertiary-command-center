// Phase 2F final acceptance — generator-outcome propagation, exact terminal
// procedure ownership (fail-closed), exact unresolved-failure verification, and
// report-missing backfill truth.
//
//   npx tsx tests/unit/procedureFinalAcceptance.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const orch = () => import("../../server/services/procedureLifecycle/procedureLifecycleOrchestration");
const gen = () => import("../../server/services/procedureLifecycle/procedureNoteGenerator");
const lineage = () => import("../../server/services/procedureLifecycle/procedureNoteLineage");
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
function migErr(): Error { const e = new Error("migration_missing") as Error & { code?: string }; e.code = "42P01"; return e; }

// ─── §4 — generator-outcome classification (the exact logic ensure applies) ──
async function testClassifyGeneratorOutcomeMatrix() {
  const o = await orch();
  const cases: Array<[string, { deferred: boolean | undefined; recorded: boolean | undefined; warn: string }]> = [
    ["generated", { deferred: undefined, recorded: undefined, warn: "" }],
    ["generated_reference_retry_recorded", { deferred: true, recorded: true, warn: "generation_reference_deferred" }],
    ["failed_retry_recorded", { deferred: true, recorded: true, warn: "generation_deferred_failed_retry_recorded" }],
    ["report_content_unavailable_retry_recorded", { deferred: true, recorded: true, warn: "generation_deferred_report_content_unavailable_retry_recorded" }],
    ["generated_reference_retry_not_recorded", { deferred: true, recorded: false, warn: "reconciliation_not_recorded" }],
    ["failed_retry_not_recorded", { deferred: true, recorded: false, warn: "reconciliation_not_recorded" }],
    ["report_content_unavailable_retry_not_recorded", { deferred: true, recorded: false, warn: "reconciliation_not_recorded" }],
    ["already_claimed", { deferred: true, recorded: undefined, warn: "generation_already_claimed" }],
    ["not_yet_eligible", { deferred: true, recorded: undefined, warn: "generation_not_yet_eligible" }],
    ["migration_missing", { deferred: true, recorded: undefined, warn: "generation_migration_missing" }],
    ["failure_not_verified", { deferred: true, recorded: undefined, warn: "generation_failure_not_verified" }],
  ];
  for (const [status, exp] of cases) {
    const warnings: string[] = [];
    const r = o.classifyGeneratorOutcome(status as never, warnings);
    assert.equal(r.generationDeferred, exp.deferred, `${status} deferred`);
    assert.equal(r.generationRetryRecorded, exp.recorded, `${status} recorded`);
    if (exp.warn) assert.ok(warnings.includes(exp.warn), `${status} warns ${exp.warn} (got ${warnings.join(",")})`);
    if (status === "generated") assert.equal(warnings.length, 0, "generated adds no warning");
  }
}

/** Created-path ensure spec whose generator, when invoked, fully generates. */
function ensureGenSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { syncRef?: unknown[]; noteUpdate?: (v: any, n: number) => unknown[] } = {}) {
  const created = noteRow({ id: 900, generationStatus: "pending" });
  let uc = 0;
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow({ procedureStatus: "complete", completedAt: OLD })] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], [], [reportRef()], [reportRef()], [reportRef()], o.syncRef ?? [procRef()]]), onInsert: (v) => [{ ...v, id: 42 }], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }], onUpdate: (v) => { uc++; return (o.noteUpdate ? o.noteUpdate(v, uc) : [{ ...created, ...v }]); } }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
}

// (1) ensure propagates generatorOutcome=generated (and a synced reference)
async function testEnsurePropagatesGenerated() {
  const t = await loadCanonicalTables(); const o = await orch();
  const r = await runWithDb(ensureGenSpec(t), GEN, async () => o.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(r.status === "created" || r.status === "reused", `parent committed (${r.status})`);
  assert.equal(r.generatorOutcome, "generated", "(1) generator outcome exposed");
  assert.equal(r.generationDeferred, undefined, "(1) not deferred");
}

// (2) ensure exposes generated_reference_retry_recorded as a durable deferral
async function testEnsurePropagatesReferenceDeferred() {
  const t = await loadCanonicalTables(); const o = await orch();
  // sync finds NO reference → generator records a distinct sync retry → deferred+durable.
  const r = await runWithDb(ensureGenSpec(t, { syncRef: [] }), GEN, async () => o.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(r.status === "created" || r.status === "reused", "parent still committed");
  assert.equal(r.generatorOutcome, "generated_reference_retry_recorded", "(2) exposed");
  assert.equal(r.generationDeferred, true); assert.equal(r.generationRetryRecorded, true);
  assert.ok(r.warnings.includes("generation_reference_deferred"), "(2) warning present");
}

// (8) ensure keeps migration_missing visible (never silently created/reused)
async function testEnsurePropagatesMigrationMissing() {
  const t = await loadCanonicalTables(); const o = await orch();
  // Generator commit (2nd note update) throws a migration code → migration_missing.
  const noteUpdate = (v: any, n: number) => { if (n === 2) throw migErr(); return [{ ...noteRow(), ...v }]; };
  const r = await runWithDb(ensureGenSpec(t, { noteUpdate }), GEN, async () => o.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.ok(r.status === "created" || r.status === "reused", "parent still committed, not reversed");
  assert.equal(r.generatorOutcome, "migration_missing", "(8) migration_missing visible");
  assert.equal(r.generationDeferred, true);
}

// (11) suppressGeneration performs ZERO generator calls (no note update, no outcome)
async function testEnsureSuppressionZeroGeneratorCalls() {
  const t = await loadCanonicalTables(); const o = await orch();
  const updates = await runWithDb(ensureGenSpec(t), GEN, async (calls: Call[]) => {
    const r = await o.ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test", suppressGeneration: true });
    assert.equal(r.generatorOutcome, undefined, "(11) no generator outcome under suppression");
    return countOps(calls, "update", t.procedureNotes);
  });
  assert.equal(updates, 0, "(11) zero generator note updates under suppression");
}

// (12/durability) worker keeps a link failure UNRESOLVED when generation deferred non-durably
async function testWorkerKeepsOpenOnNonDurableGeneration() {
  const t = await loadCanonicalTables(); const w = await import("../../server/services/ancillaryDocuments/retryWorker");
  const failure = { id: 70, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: null, sourceId: null, requestedAction: "reconcile_procedure_note_lineage", resolvedAt: null, attemptCount: 1 };
  let resolves = 0;
  // ensure → created; generator's report source is unresolvable (readiness []) AND
  // the failure ledger is down → report_content_unavailable_retry_NOT_recorded, a
  // NON-DURABLE deferral. The driving lineage failure must therefore stay open.
  const created = noteRow({ id: 900, generationStatus: "pending" });
  const spec = new Map<unknown, TableSpec>([
    // listUnresolved sees the failure; the generator's own dedupe finds NONE (so it
    // must INSERT, which the down ledger rejects → retry NOT recorded).
    [t.documentFailures, { select: qsel([[failure], []]), onUpdate: (v) => { if ("resolvedAt" in v) resolves++; return [{ id: 70 }]; }, onInsert: () => { throw new Error("ledger down"); } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], [], [reportRef()], [reportRef()], [reportRef()]]), onInsert: (v) => [{ ...v, id: 42 }], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [] }], // report source unresolvable → report unavailable
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }], onUpdate: (v) => [{ ...created, ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, GEN, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 5 }));
  assert.notEqual(res.outcomes[0].status, "resolved", "non-durable generation deferral keeps the failure open");
  assert.equal(resolves, 0, "no resolution write while generation reconciliation not recorded");
}

// ─── §5 — exact terminal procedure ownership ─────────────────────────────────
async function voidOwnership(procEventSelect: () => unknown[], expected: string, note: Record<string, unknown> = {}) {
  const t = await loadCanonicalTables(); const l = await lineage();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ supersededAt: OLD, generationStatus: "voided", ...note })] }],
    [t.procedureEvents, { select: procEventSelect }],
    [t.documentReferences, { select: () => [procRef()], onUpdate: (v) => [{ ...procRef(), ...v }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => l.reconcileVoidedProcedureNoteReference({ clinicId: 1, ancillaryCaseId: 5, noteId: 900 }));
  assert.equal(r.status, expected, `expected ${expected}, got ${r.status}`);
}
// (19/20/21) exact terminal statuses accepted (exact lookup returns the event)
async function testVoidExactCancelled() { await voidOwnership(() => [peRow({ procedureStatus: "cancelled" })], "reconciled"); }
async function testVoidExactNoShow() { await voidOwnership(() => [peRow({ procedureStatus: "no_show" })], "reconciled"); }
async function testVoidExactUnable() { await voidOwnership(() => [peRow({ procedureStatus: "unable_to_complete" })], "reconciled"); }
// (18) complete rejected
async function testVoidCompleteRejected() { await voidOwnership(() => [peRow({ procedureStatus: "complete" })], "terminal_evidence_missing"); }
// (13/14) NULL clinic / NULL case → exact lookup fails closed ([]), raw has NULL → terminal_evidence_missing
async function testVoidNullClinicRejected() { await voidOwnership(qsel([[], [peRow({ clinicId: null, procedureStatus: "cancelled" })]]), "terminal_evidence_missing"); }
async function testVoidNullCaseRejected() { await voidOwnership(qsel([[], [peRow({ ancillaryCaseId: null, procedureStatus: "cancelled" })]]), "terminal_evidence_missing"); }
// (15/16/17) wrong clinic / case / service → exact lookup fails closed ([]), raw non-null mismatch → ownership_conflict
async function testVoidWrongClinicRejected() { await voidOwnership(qsel([[], [peRow({ clinicId: 2, procedureStatus: "cancelled" })]]), "ownership_conflict"); }
async function testVoidWrongCaseRejected() { await voidOwnership(qsel([[], [peRow({ ancillaryCaseId: 6, procedureStatus: "cancelled" })]]), "ownership_conflict"); }
async function testVoidWrongServiceRejected() { await voidOwnership(qsel([[], [peRow({ serviceType: "Cardio", procedureStatus: "cancelled" })]]), "ownership_conflict"); }
// note with no procedureEventId → terminal_evidence_missing (never mutates reference)
async function testVoidNullEventRejected() { await voidOwnership(() => [], "terminal_evidence_missing", { procedureEventId: null }); }

// ─── §6 — exact unresolved-failure verification ──────────────────────────────
async function verifyRejects(failure: Record<string, unknown>, label: string) {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: () => { throw new Error("must not write a note on unverified failure"); } }],
    [t.documentFailures, { select: () => [failure] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "failure_not_verified", `${label} → failure_not_verified`);
}
async function testFailureNullCaseRejected() { await verifyRejects(failRow({ ancillaryCaseId: null }), "(22) null case"); }
async function testFailureWrongCaseRejected() { await verifyRejects(failRow({ ancillaryCaseId: 6 }), "(23) wrong case"); }
async function testFailureWrongKindRejected() { await verifyRejects(failRow({ documentKind: "report" }), "(24) wrong kind"); }
async function testFailureWrongActionRejected() { await verifyRejects(failRow({ requestedAction: "link_procedure_note" }), "(25) wrong action"); }
async function testFailureWrongSourceTableRejected() { await verifyRejects(failRow({ sourceTable: "procedure_events" }), "(26) wrong source table"); }
async function testFailureWrongSourceIdRejected() { await verifyRejects(failRow({ sourceId: 901 }), "(27) wrong source id"); }
async function testFailureResolvedRejected() { await verifyRejects(failRow({ resolvedAt: OLD }), "(28) resolved failure"); }

// (29) exact unresolved failure accepted → regenerates once
async function testFailureExactAccepted() {
  const t = await loadCanonicalTables(); const g = await gen();
  const created = noteRow({ generationStatus: "failed" });
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [created], onUpdate: qsel([[{ ...created, generationStatus: "generating" }], [{ ...created, generationStatus: "generated" }]]) as never }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow()] }],
    [t.documentReferences, { select: () => [reportRef()], onUpdate: (v) => [{ ...v }] }],
    [t.caseDocumentReadiness, { select: () => [readinessRow()] }],
    [t.documentFailures, { select: () => [failRow()], onInsert: (v) => [{ ...v, id: 2 }] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "generated", "(29) exact failure regenerates");
}

// (30) concurrent second claim cannot run (claim returns zero rows)
async function testFailureConcurrentSecondClaim() {
  const t = await loadCanonicalTables(); const g = await gen();
  const spec = new Map<unknown, TableSpec>([
    [t.procedureNotes, { select: () => [noteRow({ generationStatus: "failed" })], onUpdate: () => [] }],
    [t.documentFailures, { select: () => [failRow()] }],
  ]);
  const r = await runWithDb(spec, GEN, async () => g.retryFailedProcedureNoteGeneration({ clinicId: 1, ancillaryCaseId: 5, noteId: 900, failureId: 1 }));
  assert.equal(r.status, "already_claimed", "(30) second claim loses the race");
}

// ─── §7 — report-missing backfill truth ──────────────────────────────────────
// (32/33/34/35) report missing → explicit unresolved action, apply_deferred, no generation
async function testBackfillReportMissingDeferred() {
  const t = await loadCanonicalTables(); const b = await backfill();
  const queued: Record<string, unknown>[] = [];
  const spec = new Map<unknown, TableSpec>([[t.documentFailures, { select: () => [], onInsert: (v) => { queued.push(v); return [{ ...v, id: 1 }]; } }], [t.procedureNotes, { select: () => [], onInsert: () => { throw new Error("no note may be created for a missing-report case"); } }]]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["exact_report_evidence_missing"] as any, { caseId: 5, noteId: null }));
  assert.equal(r.overall, "apply_deferred", "(35) never applied");
  assert.equal(r.actions.report, "unresolved", "(32) explicit unresolved report action");
  assert.ok(!queued.some((q) => q.requestedAction === "generate_procedure_note"), "(33) no generation queued");
}

// (31) deterministic link + report missing → still apply_deferred (report forces it)
async function testBackfillLinkPlusReportMissingDeferred() {
  const t = await loadCanonicalTables(); const b = await backfill();
  // onProcedureCompleted resolves the linked event; report stays unresolved.
  const created = noteRow({ id: 900, generationStatus: "pending" });
  const spec = new Map<unknown, TableSpec>([
    [t.procedureEvents, { select: () => [peRow({ ancillaryCaseId: 5 })], onUpdate: (v) => [{ ...peRow(), ...v }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.documentReferences, { select: qsel([[reportRef()], [], []]), onInsert: (v) => [{ ...v, id: 42 }], onUpdate: (v) => [{ ...v }] }],
    [t.procedureNotes, { select: qsel([[], [], [created]]), onInsert: (v) => [{ ...created, ...v, id: 900 }], onUpdate: (v) => [{ ...created, ...v }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["deterministic_link", "exact_report_evidence_missing"] as any, { caseId: 5, noteId: null }));
  assert.equal(r.overall, "apply_deferred", "(31) report-missing forces apply_deferred even when link completes");
  assert.equal(r.actions.report, "unresolved");
}

// (36) report available preserves the generation-candidate path
async function testBackfillReportAvailablePreservesGeneration() {
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
  const r = await runWithDb(spec, ALL, async () => b.queueApplyWork(peRow({ ancillaryCaseId: 5 }) as any, ["note_generation_candidate", "exact_report_evidence_available"] as any, { caseId: 5, noteId: null }));
  assert.equal(r.actions.report, undefined, "(36) no unresolved report action when evidence available");
  assert.ok(queued.some((q) => q.requestedAction === "generate_procedure_note" && q.sourceId === 900), "(36) generation queued against exact note");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1-10,12) generator outcome classification matrix", testClassifyGeneratorOutcomeMatrix],
  ["(1) ensure propagates generated", testEnsurePropagatesGenerated],
  ["(2) ensure exposes reference-deferred durable", testEnsurePropagatesReferenceDeferred],
  ["(8) ensure keeps migration_missing visible", testEnsurePropagatesMigrationMissing],
  ["(11) suppression → zero generator calls", testEnsureSuppressionZeroGeneratorCalls],
  ["(durability) worker keeps open on non-durable generation", testWorkerKeepsOpenOnNonDurableGeneration],
  ["(19) exact cancelled accepted", testVoidExactCancelled],
  ["(20) exact no_show accepted", testVoidExactNoShow],
  ["(21) exact unable_to_complete accepted", testVoidExactUnable],
  ["(18) complete rejected", testVoidCompleteRejected],
  ["(13) NULL event clinic rejected", testVoidNullClinicRejected],
  ["(14) NULL event case rejected", testVoidNullCaseRejected],
  ["(15) wrong event clinic rejected", testVoidWrongClinicRejected],
  ["(16) wrong event case rejected", testVoidWrongCaseRejected],
  ["(17) wrong event service rejected", testVoidWrongServiceRejected],
  ["(evt) missing procedure event rejected", testVoidNullEventRejected],
  ["(22) NULL failure case rejected", testFailureNullCaseRejected],
  ["(23) wrong failure case rejected", testFailureWrongCaseRejected],
  ["(24) wrong documentKind rejected", testFailureWrongKindRejected],
  ["(25) wrong requestedAction rejected", testFailureWrongActionRejected],
  ["(26) wrong sourceTable rejected", testFailureWrongSourceTableRejected],
  ["(27) wrong sourceId rejected", testFailureWrongSourceIdRejected],
  ["(28) resolved failure rejected", testFailureResolvedRejected],
  ["(29) exact unresolved failure accepted", testFailureExactAccepted],
  ["(30) concurrent second claim cannot run", testFailureConcurrentSecondClaim],
  ["(32/33/34/35) report missing → apply_deferred, no generation", testBackfillReportMissingDeferred],
  ["(31) link + report missing → apply_deferred", testBackfillLinkPlusReportMissingDeferred],
  ["(36) report available preserves generation", testBackfillReportAvailablePreservesGeneration],
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

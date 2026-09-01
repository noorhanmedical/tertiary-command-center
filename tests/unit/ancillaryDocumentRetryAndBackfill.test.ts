// Phase 2E-B — reconciliation retry worker + backfill apply foundation.
//
//   npx tsx tests/unit/ancillaryDocumentRetryAndBackfill.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const worker = () => import("../../server/services/ancillaryDocuments/retryWorker");
const refWriter = () => import("../../server/services/ancillaryDocuments/documentReferenceWriter");
const BACKFILL_SRC = readFileSync(join(process.cwd(), "script/backfillAncillaryDocuments.ts"), "utf8");
const CLI_SRC = readFileSync(join(process.cwd(), "script/retryAncillaryDocumentFailures.ts"), "utf8");
const START = new Date("2027-06-01T10:00:00Z");
const FLAGS = { unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalAppointment: true } as const;

function caseRow(over: Record<string, unknown> = {}) {
  return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", lifecycleStatus: "active", originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10, patientClinicMembershipId: 20, ...over };
}

// ─── (1) worker flag OFF → zero processed, zero IO ────────────────
async function testWorkerFlagOff() {
  const t = await loadCanonicalTables();
  const w = await worker();
  let reads = 0;
  const spec = new Map<unknown, TableSpec>([[t.documentFailures, { select: () => { reads++; return []; } }]]);
  const r = await runWithDb(spec, { unifiedAncillaryDocuments: false }, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 10 }));
  assert.equal(r.processed, 0);
  assert.deepEqual(r.outcomes, []);
  assert.equal(reads, 0, "flag OFF issues zero reads");
}

// ─── (2) worker drains listed rows + resolves link_order_note ─────
async function testWorkerResolvesLinkOrderNote() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const evt = () => ({ id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, source: "x", metadata: {}, createdAt: START, updatedAt: START });
  const failure = { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: null, requestedAction: "link_order_note", resolvedAt: null, attemptCount: 1 };
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onInsert: (v) => [{ ...v, id: 2 }], onUpdate: (v) => [{ ...v }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [evt()] }],
    [t.adminReviewEvents, { select: () => [{ id: 555 }] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...v, id: 900, signatureStatus: "needs_signature" }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const r = await runWithDb(spec, FLAGS, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 50 }));
  assert.equal(r.processed, 1);
  assert.equal(r.outcomes[0].status, "resolved");
  // PHI-free outcomes: only failureId / action / status / message.
  for (const o of r.outcomes) {
    for (const k of Object.keys(o)) {
      assert.ok(["failureId", "requestedAction", "status", "message"].includes(k), `unexpected outcome key ${k}`);
    }
  }
}

// ─── (3) worker skips actions with no automatic retry ─────────────
async function testWorkerSkipsUnhandled() {
  const t = await loadCanonicalTables();
  const w = await worker();
  // supersede_reference has no safe automatic re-drive → skipped.
  const failure = { id: 9, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, requestedAction: "supersede_reference", resolvedAt: null, attemptCount: 1 };
  const spec = new Map<unknown, TableSpec>([[t.documentFailures, { select: () => [failure], onInsert: (v) => [{ ...v, id: 2 }] }]]);
  const r = await runWithDb(spec, FLAGS, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 10 }));
  assert.equal(r.outcomes[0].status, "skipped");
}

// ─── (4) backfill apply is gated (source-level) ───────────────────
async function testBackfillGates() {
  assert.match(BACKFILL_SRC, /BACKFILL_ANCILLARY_DOCUMENTS_APPLY === "YES"/);
  assert.match(BACKFILL_SRC, /Refusing to apply[\s\S]*?FEATURE_UNIFIED_ANCILLARY_DOCUMENTS/);
  // Order Note linking additionally requires FEATURE_CANONICAL_ORDER_NOTE.
  assert.match(BACKFILL_SRC, /featureFlags\.canonicalOrderNote/);
  // Never copies bytes / generates notes / bills.
  const low = BACKFILL_SRC.toLowerCase();
  for (const forbidden of ["filebytes", "generatetext", "billing_document generation"]) {
    assert.ok(!low.includes(forbidden), `backfill must not ${forbidden}`);
  }
  // Retry CLI: dry-run default + apply gate + PHI-free ids output.
  assert.match(CLI_SRC, /RETRY_ANCILLARY_DOCUMENTS_APPLY === "YES"/);
  assert.match(CLI_SRC, /LIST_DRY_RUN/);
  assert.match(CLI_SRC, /Math\.min\(n, 500\)/);
}

// ─── (5) backfill determinism (behavioral): idempotent reference ──
async function testBackfillDeterministicIdempotent() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  // First index → created; second (same source) → reused. No note/clinic writes.
  const created = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
      [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    ]),
    FLAGS,
    async (calls: Call[]) => {
      const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 7001, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "backfill_2e" });
      assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no Procedure Note generation");
      assert.equal(countOps(calls, "update", t.ancillaryCases), 0, "no clinic/case mutation");
      return res;
    },
  );
  assert.equal(created.status, "created");
  const existing = { id: 42, clinicId: 1, ancillaryCaseId: 5, sourceTable: "case_document_readiness", sourceId: 7001, documentKind: "report", supersededAt: null, documentStatus: "uploaded" };
  const reused = await runWithDb(
    new Map<unknown, TableSpec>([
      [t.ancillaryCases, { select: () => [caseRow()] }],
      [t.documentReferences, { select: () => [existing], onInsert: (v) => [{ ...v, id: 99 }] }],
    ]),
    FLAGS,
    async (calls: Call[]) => {
      const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 7001, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "backfill_2e" });
      assert.equal(countOps(calls, "insert", t.documentReferences), 0, "rerun reuses, never duplicates");
      return res;
    },
  );
  assert.equal(reused.status, "reused_exact_source");
}

// ─── (6) Phase 2F: worker handles link_procedure_note (procedure_events) ──
async function testWorkerHandlesProcedureNoteLink() {
  const t = await loadCanonicalTables();
  const w = await worker();
  const peRow = { id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", procedureStatus: "complete", completedAt: START, createdAt: START, updatedAt: START, globalPlexusPatientId: null, patientClinicMembershipId: null };
  const reportRef = { id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "EchoWave", documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness", sourceId: 1000, actualCreatedAt: START, metadata: {} };
  const noteRow = { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, procedureEventId: 300, reportDocumentReferenceId: 42, createdAt: START, updatedAt: START };
  const failure = { id: 7, clinicId: 1, ancillaryCaseId: 5, documentKind: "procedure_note", sourceTable: "procedure_events", sourceId: 300, requestedAction: "link_procedure_note", resolvedAt: null, attemptCount: 1 };
  const spec = new Map<unknown, TableSpec>([
    [t.documentFailures, { select: () => [failure], onInsert: (v) => [{ ...v, id: 8 }], onUpdate: (v) => [{ ...v }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: () => [peRow], onUpdate: (v) => [{ ...peRow, ...v }] }],
    [t.documentReferences, { select: (() => { const q = [[reportRef], [], []]; let i = 0; return () => q[Math.min(i++, q.length - 1)]; })(), onInsert: (v) => [{ ...v, id: 55 }] }],
    [t.procedureNotes, { select: (() => { const q = [[], []]; let i = 0; return () => q[Math.min(i++, q.length - 1)]; })(), onInsert: (v) => [{ ...noteRow, ...v, id: 900 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const r = await runWithDb(spec, { unifiedAncillaryDocuments: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true, canonicalAppointment: true }, async () => w.retryUnresolvedAncillaryDocumentFailures({ limit: 10 }));
  assert.equal(r.processed, 1);
  assert.ok(["resolved", "not_yet_eligible", "still_deferred"].includes(r.outcomes[0].status), `unexpected: ${r.outcomes[0].status}`);
  // PHI-free outcome keys only.
  for (const o of r.outcomes) for (const k of Object.keys(o)) assert.ok(["failureId", "requestedAction", "status", "message"].includes(k), `unexpected key ${k}`);
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) worker flag OFF → zero processed, zero IO", testWorkerFlagOff],
  ["(2) worker drains + resolves link_order_note; PHI-free outcomes", testWorkerResolvesLinkOrderNote],
  ["(3) worker skips actions with no automatic retry", testWorkerSkipsUnhandled],
  ["(4) backfill + CLI apply gates present", testBackfillGates],
  ["(5) backfill deterministic + idempotent (no note/clinic writes)", testBackfillDeterministicIdempotent],
  ["(6) worker handles Phase 2F link_procedure_note (procedure_events)", testWorkerHandlesProcedureNoteLink],
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

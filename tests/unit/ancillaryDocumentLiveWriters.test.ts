// Phase 2E-B — live Ancillary Document writers (Order Note orchestration +
// report/consent/screening reference writers).
//
//   npx tsx tests/unit/ancillaryDocumentLiveWriters.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const orchestration = () => import("../../server/services/ancillaryDocuments/orderNoteOrchestration");
const refWriter = () => import("../../server/services/ancillaryDocuments/documentReferenceWriter");
const apptSvc = () => import("../../server/services/canonicalAppointments/canonicalAppointmentService");

const START = new Date("2027-06-01T10:00:00Z");
const FLAGS = { canonicalOrderNote: true, canonicalAppointment: true, unifiedAncillaryDocuments: true } as const;

function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved",
    originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10,
    patientClinicMembershipId: 20, lifecycleStatus: "active", ...over,
  };
}
function evt(over: Record<string, unknown> = {}) {
  return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null, source: "x", metadata: {}, createdAt: START, updatedAt: START, ...over };
}
function noteRow(over: Record<string, unknown> = {}) {
  return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", noteType: "order_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, createdAt: START, updatedAt: START, ...over };
}
function orderNoteSpec(t: any, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [evt()] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.adminReviewEvents, { select: () => [{ id: 555 }] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

// ─── (1) approved + qualifying appointment → Order Note created ────
async function testEligibleCreates() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  const r = await runWithDb(orderNoteSpec(t), FLAGS, async () =>
    o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "admin_review" }));
  assert.equal(r.status, "created");
  assert.equal(r.orderNoteId, 900);
}

// ─── (2) approved, appointment MISSING → not_yet_eligible (one side) ─
async function testApprovedNoAppointment() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  const spec = orderNoteSpec(t, { gse: { select: () => [] } }); // no qualifying appointment yet
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "admin_review" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no note without an appointment");
    return res;
  });
  assert.equal(r.status, "not_yet_eligible");
}

// ─── (3) appointment present, review PENDING → not_yet_eligible ────
async function testAppointmentNotApproved() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  const spec = orderNoteSpec(t, { ancillaryCases: { select: () => [caseRow({ adminReviewStatus: "pending" })] } });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "test:appointment" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "same-day pending review → no note");
    return res;
  });
  assert.equal(r.status, "not_yet_eligible");
}

// ─── (4) later approved → note created; (5) duplicate hooks reuse ──
async function testDuplicateHooksReuse() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  // First: create. Second: an existing case note is found → reuse.
  const first = await runWithDb(orderNoteSpec(t), FLAGS, async () => o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "s" }));
  assert.equal(first.status, "created");
  const reuseSpec = orderNoteSpec(t, { procedureNotes: { select: () => [noteRow({ id: 905 })], onInsert: (v) => [{ ...v, id: 999 }] } });
  const second = await runWithDb(reuseSpec, FLAGS, async (calls: Call[]) => {
    const res = await o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "s" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "duplicate hook must not insert a second note");
    return res;
  });
  assert.equal(second.status, "reused");
  assert.equal(second.orderNoteId, 905);
}

// ─── (6) flag OFF → skipped, zero IO ──────────────────────────────
async function testFlagOff() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  const r = await runWithDb(orderNoteSpec(t), { canonicalOrderNote: false }, async (calls: Call[]) => {
    const res = await o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "s" });
    assert.equal(calls.length, 0, "flag OFF issues zero reads/writes");
    return res;
  });
  assert.equal(r.status, "skipped_flag_off");
}

// ─── (7) hook never throws + records durable retry on error ───────
async function testHookNeverReversesParent() {
  const t = await loadCanonicalTables();
  const o = await orchestration();
  // Force the note insert to throw AFTER eligibility passes.
  const spec = orderNoteSpec(t, {
    procedureNotes: { select: () => [], onInsert: () => { throw Object.assign(new Error("db down"), { code: "08006" }); } },
    documentFailures: { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] },
  });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    // Must NOT throw (parent transaction already committed).
    const res = await o.ensureCanonicalOrderNoteForAncillaryCase({ clinicId: 1, ancillaryCaseId: 5, source: "admin_review" });
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "durable retry recorded on hook failure");
    return res;
  });
  assert.ok(r.status === "failed" || r.status === "reconciliation_not_recorded", `truthful failure, got ${r.status}`);
}

// ─── (8) doctor_visit never triggers Order Note work ──────────────
async function testDoctorVisitNoNote() {
  const t = await loadCanonicalTables();
  const a = await apptSvc();
  const r = await runWithDb(orderNoteSpec(t), FLAGS, async (calls: Call[]) => {
    const res = await a.createCanonicalAncillaryAppointment({ clinicId: 1, ancillaryCaseId: 5, eventType: "doctor_visit" as never, startsAt: START, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "doctor_visit → no Order Note");
    return res;
  });
  assert.equal(r.status, "invalid_event_type");
}

// ─── (9) cancel does not create an Order Note ─────────────────────
async function testCancelNoNote() {
  const t = await loadCanonicalTables();
  const a = await apptSvc();
  const spec = orderNoteSpec(t, { gse: { select: () => [evt({ status: "scheduled" })], onUpdate: (v) => [{ ...evt(), ...v }] } });
  await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await a.cancelCanonicalAppointment({ eventId: 700, clinicId: 1, source: "test", reason: "patient request" });
    assert.equal(res.status, "cancelled");
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "cancel must not create an Order Note");
  });
}

// ─── (10) no_show does not create an Order Note ───────────────────
async function testNoShowNoNote() {
  const t = await loadCanonicalTables();
  const a = await apptSvc();
  const spec = orderNoteSpec(t, { gse: { select: () => [evt({ status: "scheduled" })], onUpdate: (v) => [{ ...evt(), ...v }] } });
  await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await a.noShowCanonicalAppointment({ eventId: 700, clinicId: 1, source: "test", reason: "no show" });
    assert.equal(res.status, "no_show");
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no_show must not create an Order Note");
  });
}

// ─── Reference writers ────────────────────────────────────────────
function refSpec(t: any, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    // Deterministic single active case for (screening|exec)+service.
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

// ─── (11) report source → one reference, correct case, NO bytes ───
async function testReportReference() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  let payload: Record<string, unknown> | null = null;
  const spec = refSpec(t, { documentReferences: { select: () => [], onInsert: (v) => { payload = v; return [{ ...v, id: 42 }]; } } });
  const r = await runWithDb(spec, FLAGS, async () => w.ensureAncillaryDocumentReference({
    documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001,
    serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1,
    documentStatus: "uploaded", source: "document_complete_action",
  }));
  assert.equal(r.status, "created");
  if (r.status === "created") { assert.equal(r.ancillaryCaseId, 5); assert.equal(r.referenceId, 42); }
  const p = payload as Record<string, unknown>;
  assert.equal(p.documentKind, "report");
  assert.equal(p.sourceTable, "case_document_readiness");
  assert.equal(p.sourceId, 3001);
  assert.equal(p.ancillaryCaseId, 5);
  // No document bytes / note body ever stored.
  const blob = JSON.stringify(p).toLowerCase();
  for (const forbidden of ["generatedtext", "note_text", "filebytes", "bytes", "blob", "\"content\""]) {
    assert.ok(!blob.includes(forbidden), `reference must not carry ${forbidden}`);
  }
}

// ─── (12) repeat report event reuses the same reference ───────────
async function testReportReferenceReuse() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  // Existing reference for the same (source_table, source_id, kind).
  const existing = { id: 42, clinicId: 1, ancillaryCaseId: 5, sourceTable: "case_document_readiness", sourceId: 3001, documentKind: "report", supersededAt: null, documentStatus: "uploaded" };
  const spec = refSpec(t, { documentReferences: { select: () => [existing], onInsert: (v) => [{ ...v, id: 99 }] } });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3001, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x" });
    assert.equal(countOps(calls, "insert", t.documentReferences), 0, "reuse must not insert a new reference");
    return res;
  });
  assert.equal(r.status, "reused_exact_source");
  if (r.status === "reused_exact_source") assert.equal(r.referenceId, 42);
}

// ─── (13) consent → correct case reference ────────────────────────
async function testConsentReference() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  let payload: Record<string, unknown> | null = null;
  const spec = refSpec(t, { documentReferences: { select: () => [], onInsert: (v) => { payload = v; return [{ ...v, id: 43 }]; } } });
  const r = await runWithDb(spec, FLAGS, async () => w.ensureAncillaryDocumentReference({
    documentKind: "consent", sourceTable: "case_document_readiness", sourceId: 3002, serviceType: "EchoWave",
    executionCaseId: 900, expectedClinicId: 1, documentStatus: "completed", signedAt: START, source: "x",
  }));
  assert.equal(r.status, "created");
  assert.equal((payload as Record<string, unknown>).documentKind, "consent");
  assert.equal((payload as Record<string, unknown>).signedAt, START);
}

// ─── (14) screening_form → correct case reference ─────────────────
async function testScreeningFormReference() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  let payload: Record<string, unknown> | null = null;
  const spec = refSpec(t, { documentReferences: { select: () => [], onInsert: (v) => { payload = v; return [{ ...v, id: 44 }]; } } });
  const r = await runWithDb(spec, FLAGS, async () => w.ensureAncillaryDocumentReference({
    documentKind: "screening_form", sourceTable: "case_document_readiness", sourceId: 3003, serviceType: "EchoWave",
    patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x",
  }));
  assert.equal(r.status, "created");
  assert.equal((payload as Record<string, unknown>).documentKind, "screening_form");
  assert.equal((payload as Record<string, unknown>).ancillaryCaseId, 5);
}

// ─── (15) ambiguous case does NOT attach → durable retry ──────────
async function testAmbiguousNoAttach() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  // Two active cases matching the same service — ambiguous.
  const spec = refSpec(t, {
    ancillaryCases: { select: () => [caseRow({ id: 5 }), caseRow({ id: 6 })] },
    documentReferences: { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] },
  });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3004, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x" });
    assert.equal(countOps(calls, "insert", t.documentReferences), 0, "ambiguous case never attaches");
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "ambiguity records durable retry");
    return res;
  });
  assert.equal(r.status, "deferred_ambiguous_case");
  if (r.status === "deferred_ambiguous_case") assert.equal(r.reason, "multiple_cases");
}

// ─── (16) no matching case → durable retry, no attach ─────────────
async function testNoCaseNoAttach() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  const spec = refSpec(t, { ancillaryCases: { select: () => [caseRow({ serviceType: "OtherService" })] } });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3005, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x" });
    assert.equal(countOps(calls, "insert", t.documentReferences), 0);
    return res;
  });
  assert.equal(r.status, "deferred_ambiguous_case");
  if (r.status === "deferred_ambiguous_case") assert.equal(r.reason, "no_case");
}

// ─── (17) cross-clinic writer denied ──────────────────────────────
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  // The resolved case is clinic 1, but the caller asserts clinic 2.
  const spec = refSpec(t, { ancillaryCases: { select: () => [caseRow({ clinicId: 1 })] } });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3006, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 2, documentStatus: "uploaded", source: "x" });
    assert.equal(countOps(calls, "insert", t.documentReferences), 0, "no cross-clinic attachment");
    return res;
  });
  assert.equal(r.status, "cross_clinic_denied");
}

// ─── (18) reference writer flag OFF → skipped, zero IO ────────────
async function testRefWriterFlagOff() {
  const t = await loadCanonicalTables();
  const w = await refWriter();
  const r = await runWithDb(refSpec(t), { unifiedAncillaryDocuments: false }, async (calls: Call[]) => {
    const res = await w.ensureAncillaryDocumentReference({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3007, serviceType: "EchoWave", patientScreeningId: 77, expectedClinicId: 1, documentStatus: "uploaded", source: "x" });
    assert.equal(calls.length, 0, "flag OFF issues zero reads/writes");
    return res;
  });
  assert.equal(r.status, "skipped_flag_off");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) approved + appointment → Order Note created", testEligibleCreates],
  ["(2) approved, appointment missing → not_yet_eligible", testApprovedNoAppointment],
  ["(3) appointment, review pending → not_yet_eligible (same-day)", testAppointmentNotApproved],
  ["(4/5) later approved creates; duplicate hooks reuse", testDuplicateHooksReuse],
  ["(6) Order Note flag OFF → skipped, zero IO", testFlagOff],
  ["(7) hook failure → durable retry, never reverses parent", testHookNeverReversesParent],
  ["(8) doctor_visit never triggers Order Note", testDoctorVisitNoNote],
  ["(9) cancel does not create an Order Note", testCancelNoNote],
  ["(10) no_show does not create an Order Note", testNoShowNoNote],
  ["(11) report source → one reference, no bytes", testReportReference],
  ["(12) repeat report event reuses reference", testReportReferenceReuse],
  ["(13) consent → correct case reference", testConsentReference],
  ["(14) screening_form → correct case reference", testScreeningFormReference],
  ["(15) ambiguous case does not attach → retry", testAmbiguousNoAttach],
  ["(16) no matching case → retry, no attach", testNoCaseNoAttach],
  ["(17) cross-clinic writer denied", testCrossClinicDenied],
  ["(18) reference writer flag OFF → skipped, zero IO", testRefWriterFlagOff],
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

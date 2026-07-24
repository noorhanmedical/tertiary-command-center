// Phase 2E-A — canonical Order Note service behavior.
//
//   npx tsx tests/unit/orderNoteService.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const svc = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const START = new Date("2027-06-01T10:00:00Z");
const EFFECTIVE = new Date("2027-06-15T00:00:00Z");

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
  return { id: 900, clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", noteType: "order_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, createdAt: START, updatedAt: START, ...over };
}

function baseSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [evt()] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}
const FLAGS = { canonicalOrderNote: true, canonicalAppointment: true, unifiedAncillaryDocuments: true } as const;

// ─── (1) feature OFF performs zero reads/writes ───────────────────
async function testFlagOffZeroIo() {
  const t = await loadCanonicalTables();
  const s = await svc();
  await runWithDb(baseSpec(t), { canonicalOrderNote: false }, async (calls: Call[]) => {
    const r = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(r.status, "skipped_flag_off");
    assert.equal(calls.length, 0, "flag OFF issues zero reads/writes");
  });
}

// ─── (2) clinic mismatch denied ───────────────────────────────────
async function testClinicMismatch() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, { ancillaryCases: { select: () => [caseRow({ clinicId: 2 })] } });
  const r = await runWithDb(spec, FLAGS, async (calls) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0);
    return res;
  });
  assert.equal(r.status, "cross_clinic_denied");
}

// ─── (3) ineligible case creates no note ──────────────────────────
async function testIneligibleNoNote() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, { ancillaryCases: { select: () => [caseRow({ adminReviewStatus: "pending" })] } });
  const r = await runWithDb(spec, FLAGS, async (calls) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "ineligible → no note");
    assert.equal(countOps(calls, "insert", t.documentReferences), 0);
    return res;
  });
  assert.equal(r.status, "ineligible");
}

// ─── (4/7/8/9/10/11/13) eligible creates canonical note + reference ─
async function testEligibleCreates() {
  const t = await loadCanonicalTables();
  const s = await svc();
  let notePayload: Record<string, unknown> | null = null;
  let refPayload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    procedureNotes: { select: () => [], onInsert: (v) => { notePayload = v; return [{ ...noteRow(), ...v, id: 900 }]; } },
    documentReferences: { select: () => [], onInsert: (v) => { refPayload = v; return [{ ...v, id: 42 }]; } },
  });
  const r = await runWithDb(spec, FLAGS, async () => s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u1", effectiveClinicalDate: EFFECTIVE, source: "test" }));
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.orderNoteId, 900);
    assert.equal(r.referenceId, 42, "(13) registry reference created");
    // (10/11) no auto-sign; unresolved → pending_signature
    assert.equal(r.signatureRequirement, "unresolved");
    assert.equal(r.documentStatus, "pending_signature");
    assert.equal(r.qualifyingAppointmentId, 700);
  }
  const np = notePayload as Record<string, unknown>;
  // (10) never auto-signed
  assert.equal(np.signatureStatus, "needs_signature");
  assert.ok(!("signedAt" in np) || np.signedAt == null, "must not fabricate signedAt");
  // (7/9) actualCreatedAt server-owned — the note payload never sets a created timestamp
  assert.ok(!("createdAt" in np) && !("actualCreatedAt" in np), "createdAt is server-owned, never client-set");
  const rp = refPayload as Record<string, unknown>;
  // (6) links to case, appointment, admin review
  assert.equal(rp.ancillaryCaseId, 5);
  assert.equal(rp.sourceTable, "procedure_notes");
  assert.equal(rp.sourceId, 900);
  assert.equal((rp.metadata as Record<string, unknown>).qualifying_appointment_id, 700);
  assert.equal((rp.metadata as Record<string, unknown>).admin_review_status, "approved");
  // (8) effectiveClinicalDate separate from actual creation
  assert.equal(rp.effectiveClinicalDate, EFFECTIVE);
  assert.ok(!("actualCreatedAt" in rp), "reference actualCreatedAt is server-owned");
}

// ─── (5) repeat call reuses current note ──────────────────────────
async function testReuse() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, { procedureNotes: { select: () => [noteRow()], onInsert: (v) => [{ ...v, id: 999 }] } });
  const r = await runWithDb(spec, FLAGS, async (calls) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "reuse must not insert a new note");
    return res;
  });
  assert.equal(r.status, "reused");
  if (r.status === "reused") assert.equal(r.orderNoteId, 900);
}

// ─── (12) signed note not silently overwritten ────────────────────
async function testSignedNoteNotOverwritten() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    procedureNotes: { select: () => [noteRow({ signatureStatus: "signed", signedAt: START })], onInsert: (v) => [{ ...v, id: 998 }] },
  });
  const r = await runWithDb(spec, FLAGS, async (calls) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no new note");
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "signed note is not overwritten");
    return res;
  });
  assert.equal(r.status, "reused");
  if (r.status === "reused") assert.equal(r.documentStatus, "signed");
}

// ─── (14/15) reference failure creates durable retry; no false success ─
async function testReferenceFailureRetry() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    documentReferences: { select: () => [], onInsert: () => { const e = new Error("boom") as Error & { code?: string }; e.code = "08006"; throw e; } },
    documentFailures: { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] },
  });
  const r = await runWithDb(spec, FLAGS, async (calls) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "durable retry recorded on reference failure");
    return res;
  });
  // Note still created, but reference deferred — truthful partial, not false full success.
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.referenceDeferred, true);
    assert.equal(r.referenceId, undefined);
  }
}

// ─── (16) audit/retry metadata contains no PHI ────────────────────
async function testNoPhiInAuditRetry() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const journeyPayloads: Record<string, unknown>[] = [];
  const spec = baseSpec(t, {
    journeyEvents: { onInsert: (v) => { journeyPayloads.push(v); return []; } },
  });
  await runWithDb(spec, FLAGS, async () => s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u1", source: "test" }));
  assert.ok(journeyPayloads.length >= 1, "audit events written");
  for (const p of journeyPayloads) {
    assert.equal(p.patientName, "[ancillary_document_audit]");
    assert.equal(p.patientDob, null);
    const blob = JSON.stringify(p.metadata ?? {}).toLowerCase();
    for (const phi of ["\"name\"", "dob", "mrn", "phone", "insurance", "diagnosis", "medication", "reasoning"]) {
      assert.ok(!blob.includes(phi), `audit metadata must not contain PHI token: ${phi}`);
    }
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) feature OFF performs zero reads/writes", testFlagOffZeroIo],
  ["(2) clinic mismatch denied", testClinicMismatch],
  ["(3) ineligible case creates no note", testIneligibleNoNote],
  ["(4/6/7/8/10/11/13) eligible creates note + reference, links, no auto-sign", testEligibleCreates],
  ["(5) repeat call reuses current note", testReuse],
  ["(12) signed note not silently overwritten", testSignedNoteNotOverwritten],
  ["(14/15) reference failure → durable retry, no false success", testReferenceFailureRetry],
  ["(16) audit/retry metadata contains no PHI", testNoPhiInAuditRetry],
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

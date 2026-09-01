// Phase 2E-A2 — canonical Order Note identity is (ancillary_case_id, note_type).
//
//   npx tsx tests/unit/orderNoteCaseIdentity.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const svc = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const MIGRATION = readFileSync(join(process.cwd(), "migrations/0053_add_unified_ancillary_documents.sql"), "utf8");
const SERVICE_SRC = readFileSync(join(process.cwd(), "server/services/ancillaryDocuments/orderNoteService.ts"), "utf8");
const START = new Date("2027-06-01T10:00:00Z");
const FLAGS = { canonicalOrderNote: true, canonicalAppointment: true, unifiedAncillaryDocuments: true } as const;

function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved",
    originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10,
    patientClinicMembershipId: 20, lifecycleStatus: "active", ...over,
  };
}
function evt(over: Record<string, unknown> = {}) {
  return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "BrainWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null, source: "x", metadata: {}, createdAt: START, updatedAt: START, ...over };
}
function noteRow(over: Record<string, unknown> = {}) {
  return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "BrainWave", noteType: "order_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, supersededAt: null, supersedesNoteId: null, createdAt: START, updatedAt: START, ...over };
}
function queued<T>(results: T[][]): () => T[] { let i = 0; return () => results[Math.min(i++, results.length - 1)]; }

function baseSpec(
  t: Awaited<ReturnType<typeof loadCanonicalTables>>,
  over: Partial<Record<string, TableSpec>> = {},
) {
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [evt()] }],
    [t.adminReviewEvents, { select: () => [{ id: 555 }] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 900 + Number(v.ancillaryCaseId ?? 0) }], onUpdate: (v) => [{ ...noteRow(), ...v, id: 800 }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}
async function create(t: Awaited<ReturnType<typeof loadCanonicalTables>>, spec: Map<unknown, TableSpec>, input: Record<string, unknown>, flags = FLAGS) {
  const s = await svc();
  return runWithDb(spec, flags, async (calls: Call[]) => ({ res: await s.createOrReuseOrderNote(input as never), calls }));
}

// ─── (1) same case repeated → reuse the same note ─────────────────
async function testSameCaseReuse() {
  const t = await loadCanonicalTables();
  // First call: no case note yet → create (id 905 for case 5).
  const first = await create(t, baseSpec(t), { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(first.res.status, "created");
  // Second call: the case note now exists → reuse it.
  const second = await create(t, baseSpec(t, { procedureNotes: { select: () => [noteRow({ id: 905 })] } }), { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(second.res.status, "reused");
  if (second.res.status === "reused") assert.equal(second.res.orderNoteId, 905);
}

// ─── (2/3) different cases, same screening+service → different notes ─
async function testDifferentCasesDifferentNotes() {
  const t = await loadCanonicalTables();
  let payloadA: Record<string, unknown> | null = null;
  let payloadB: Record<string, unknown> | null = null;
  const specA = baseSpec(t, {
    ancillaryCases: { select: () => [caseRow({ id: 5 })] },
    procedureNotes: { select: () => [], onInsert: (v) => { payloadA = v; return [{ ...noteRow(), ...v, id: 905 }]; } },
  });
  const specB = baseSpec(t, {
    ancillaryCases: { select: () => [caseRow({ id: 6 })] },
    gse: { select: () => [evt({ ancillaryCaseId: 6, id: 701 })] },
    procedureNotes: { select: () => [], onInsert: (v) => { payloadB = v; return [{ ...noteRow(), ...v, id: 906 }]; } },
  });
  const a = await create(t, specA, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  const b = await create(t, specB, { clinicId: 1, ancillaryCaseId: 6, source: "x" });
  assert.equal(a.res.status, "created");
  assert.equal(b.res.status, "created");
  if (a.res.status === "created" && b.res.status === "created") {
    assert.notEqual(a.res.orderNoteId, b.res.orderNoteId, "distinct notes per ancillary case");
  }
  // (3) each note is stamped to its OWN case — no cross-case borrowing.
  assert.equal((payloadA as Record<string, unknown>).ancillaryCaseId, 5);
  assert.equal((payloadB as Record<string, unknown>).ancillaryCaseId, 6);
}

// ─── (4) registry references remain case-specific ─────────────────
async function testReferenceCaseSpecific() {
  const t = await loadCanonicalTables();
  let ref: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    procedureNotes: { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 905 }] },
    documentReferences: { select: () => [], onInsert: (v) => { ref = v; return [{ ...v, id: 42 }]; } },
  });
  await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  const r = ref as Record<string, unknown>;
  assert.equal(r.ancillaryCaseId, 5);
  assert.equal(r.sourceTable, "procedure_notes");
  assert.equal(r.sourceId, 905, "reference points at THIS case's note id");
}

// ─── (5) canonical unique index is ancillary-case scoped ──────────
async function testCanonicalUniqueIndexScope() {
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_pn_order_note_active_case[\s\S]*?\(ancillary_case_id, note_type\)[\s\S]*?WHERE note_type = 'order_note' AND ancillary_case_id IS NOT NULL AND superseded_at IS NULL/i.test(MIGRATION),
    "canonical current Order Note unique index must be (ancillary_case_id, note_type) partial",
  );
  // The legacy global (screening, service, note_type) unique is replaced.
  assert.ok(/DROP INDEX IF EXISTS idx_pn_unique_note/i.test(MIGRATION), "legacy global unique index must be dropped");
}

// ─── (6) legacy unlinked note does not block a second case-scoped note ─
async function testLegacyDoesNotBlockCaseScoped() {
  // Index A (linked) and index B (legacy unlinked) are DISJOINT partial
  // uniques: a case-scoped note (ancillary_case_id NOT NULL) never
  // collides with a legacy unlinked note (ancillary_case_id NULL).
  assert.ok(/uq_pn_order_note_active_case[\s\S]*?ancillary_case_id IS NOT NULL/i.test(MIGRATION));
  assert.ok(/uq_pn_order_note_legacy[\s\S]*?ancillary_case_id IS NULL/i.test(MIGRATION));
}

// ─── (7) ambiguous legacy note is NOT auto-attached ───────────────
async function testAmbiguousLegacyNotAttached() {
  const t = await loadCanonicalTables();
  // case-scoped lookup empty, then TWO legacy notes → ambiguous.
  const spec = baseSpec(t, {
    procedureNotes: { select: queued([[], [noteRow({ id: 801, ancillaryCaseId: null }), noteRow({ id: 802, ancillaryCaseId: null })]]), onInsert: (v) => [{ ...v, id: 999 }], onUpdate: (v) => [{ ...v, id: 999 }] },
  });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "deferred_legacy_ambiguous");
  if (res.status === "deferred_legacy_ambiguous") assert.equal(res.reason, "multiple_legacy_notes");
  assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "no note created");
  assert.equal(countOps(calls, "update", t.procedureNotes), 0, "no legacy note attached");
}

// ─── (8) ambiguous legacy note creates durable retry ──────────────
async function testAmbiguousLegacyRetry() {
  const t = await loadCanonicalTables();
  const spec = baseSpec(t, {
    procedureNotes: { select: queued([[], [noteRow({ id: 801, ancillaryCaseId: null }), noteRow({ id: 802, ancillaryCaseId: null })]]) },
  });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "deferred_legacy_ambiguous");
  assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "durable retry recorded");
}

// ─── (9) deterministic single-candidate legacy may be linked ──────
async function testDeterministicLegacyLink() {
  const t = await loadCanonicalTables();
  let updatePayload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    // ancillaryCases constant [case] → candidate-case count = 1 (deterministic).
    procedureNotes: {
      select: queued([[], [noteRow({ id: 800, ancillaryCaseId: null })]]),
      onInsert: (v) => [{ ...v, id: 999 }],
      onUpdate: (v) => { updatePayload = v; return [{ ...noteRow(), ...v, id: 800 }]; },
    },
  });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "reused");
  if (res.status === "reused") {
    assert.equal(res.orderNoteId, 800);
    assert.equal(res.adoptedLegacy, true);
  }
  assert.equal(countOps(calls, "insert", t.procedureNotes), 0, "adoption does not insert a new note");
  assert.equal(countOps(calls, "update", t.procedureNotes), 1, "adoption is a single link update");
  const up = updatePayload as Record<string, unknown>;
  assert.equal(up.ancillaryCaseId, 5, "legacy note linked to THIS case");
  // LINK-ONLY: never touches clinical body / signature / signer.
  for (const forbidden of ["generatedText", "signatureStatus", "signedAt", "signedByUserId", "generationStatus"]) {
    assert.ok(!(forbidden in up), `adoption must not modify ${forbidden}`);
  }
}

// ─── (10) signed note reused without clinical-content update ───────
async function testSignedNoteReusedNoUpdate() {
  const t = await loadCanonicalTables();
  const spec = baseSpec(t, {
    procedureNotes: { select: () => [noteRow({ id: 905, signatureStatus: "signed", signedAt: START })], onInsert: (v) => [{ ...v, id: 999 }], onUpdate: (v) => [{ ...v, id: 905 }] },
  });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "reused");
  if (res.status === "reused") assert.equal(res.documentStatus, "signed");
  assert.equal(countOps(calls, "insert", t.procedureNotes), 0);
  assert.equal(countOps(calls, "update", t.procedureNotes), 0, "signed note must never be overwritten");
}

// ─── (11) superseded note excluded from current-note lookup ───────
async function testSupersededExcluded() {
  const t = await loadCanonicalTables();
  // Contract: the current-note query filters superseded_at IS NULL, so a
  // superseded row is never returned as the current note — the DB returns
  // empty and the service creates a fresh current note.
  assert.ok(/uq_pn_order_note_active_case[\s\S]*?superseded_at IS NULL/i.test(MIGRATION), "current index excludes superseded");
  assert.ok(/isNull\(procedureNotes\.supersededAt\)/.test(SERVICE_SRC), "current-note query filters superseded_at IS NULL");
  // Behavioral: DB excludes the superseded row (returns []) → create fresh.
  const spec = baseSpec(t, { procedureNotes: { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 910 }] } });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "created");
  assert.equal(countOps(calls, "insert", t.procedureNotes), 1);
}

// ─── (12) supersession/version foundation without mutating old row ─
async function testSupersessionFoundation() {
  const t = await loadCanonicalTables();
  const gen = await import("../../shared/schema/generatedNotes");
  const cols = Object.keys(gen.procedureNotes);
  assert.ok(cols.includes("supersedesNoteId") && cols.includes("supersededAt"), "version foundation columns present");
  assert.ok(/supersedes_note_id[\s\S]*?REFERENCES procedure_notes\(id\)/i.test(MIGRATION), "self-FK supersedes_note_id → procedure_notes(id)");
  // The service NEVER writes supersededAt/supersedesNoteId (no correction
  // flow here) — creating/reusing a note leaves any prior row untouched.
  const spec = baseSpec(t, { procedureNotes: { select: () => [], onInsert: (v) => { assert.ok(!("supersededAt" in v) && !("supersedesNoteId" in v), "create must not set supersession fields"); return [{ ...noteRow(), ...v, id: 905 }]; } } });
  const { res } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "created");
}

// ─── (13) approved Admin Review event id stored when available ─────
async function testAdminReviewEventStored() {
  const t = await loadCanonicalTables();
  let payload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    adminReviewEvents: { select: () => [{ id: 555 }] },
    procedureNotes: { select: () => [], onInsert: (v) => { payload = v; return [{ ...noteRow(), ...v, id: 905 }]; } },
  });
  const { res } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal((payload as Record<string, unknown>).adminReviewEventId, 555);
  if (res.status === "created") {
    assert.equal(res.adminReviewEventId, 555);
    assert.equal(res.adminReviewEvidenceDeferred, false);
  }
}

// ─── (14) missing immutable review event → warning, not fabricated ─
async function testMissingAdminReviewEvent() {
  const t = await loadCanonicalTables();
  let payload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    adminReviewEvents: { select: () => [] }, // approved status, but no immutable event row
    procedureNotes: { select: () => [], onInsert: (v) => { payload = v; return [{ ...noteRow(), ...v, id: 905 }]; } },
  });
  const { res } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal((payload as Record<string, unknown>).adminReviewEventId, null, "never fabricate an event id");
  if (res.status === "created") {
    assert.equal(res.adminReviewEvidenceDeferred, true);
    assert.ok(res.warnings.includes("admin_review_event_link_unavailable"));
    assert.equal(res.adminReviewEventId, undefined);
  }
}

// ─── (15) qualifying appointment id matches the case appointment ──
async function testQualifyingAppointmentStored() {
  const t = await loadCanonicalTables();
  let payload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    gse: { select: () => [evt({ id: 700 })] },
    procedureNotes: { select: () => [], onInsert: (v) => { payload = v; return [{ ...noteRow(), ...v, id: 905 }]; } },
  });
  const { res } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal((payload as Record<string, unknown>).qualifyingGlobalScheduleEventId, 700);
  if (res.status === "created") assert.equal(res.qualifyingAppointmentId, 700);
}

// ─── (16) cross-clinic note lookup is denied ──────────────────────
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const spec = baseSpec(t, { ancillaryCases: { select: () => [caseRow({ clinicId: 2 })] } });
  const { res, calls } = await create(t, spec, { clinicId: 1, ancillaryCaseId: 5, source: "x" });
  assert.equal(res.status, "cross_clinic_denied");
  assert.equal(countOps(calls, "insert", t.procedureNotes), 0);
  assert.equal(countOps(calls, "select", t.procedureNotes), 0, "no case-scoped read across clinics");
}

// ─── (17) feature OFF → zero new case-scoped reads/writes ─────────
async function testFlagOffZeroIo() {
  const t = await loadCanonicalTables();
  const { res, calls } = await create(t, baseSpec(t), { clinicId: 1, ancillaryCaseId: 5, source: "x" }, { canonicalOrderNote: false });
  assert.equal(res.status, "skipped_flag_off");
  assert.equal(calls.length, 0);
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) same case repeated → reuse", testSameCaseReuse],
  ["(2/3) different cases → different notes, stamped to own case", testDifferentCasesDifferentNotes],
  ["(4) registry references remain case-specific", testReferenceCaseSpecific],
  ["(5) canonical unique index is ancillary-case scoped", testCanonicalUniqueIndexScope],
  ["(6) legacy unlinked note does not block a case-scoped note", testLegacyDoesNotBlockCaseScoped],
  ["(7) ambiguous legacy note is not auto-attached", testAmbiguousLegacyNotAttached],
  ["(8) ambiguous legacy note creates durable retry", testAmbiguousLegacyRetry],
  ["(9) deterministic single-candidate legacy is linked safely", testDeterministicLegacyLink],
  ["(10) signed note reused without clinical-content update", testSignedNoteReusedNoUpdate],
  ["(11) superseded note excluded from current-note lookup", testSupersededExcluded],
  ["(12) supersession/version foundation without mutating old row", testSupersessionFoundation],
  ["(13) approved Admin Review event id stored when available", testAdminReviewEventStored],
  ["(14) missing immutable review event → warning, not fabricated id", testMissingAdminReviewEvent],
  ["(15) qualifying appointment id matches case appointment", testQualifyingAppointmentStored],
  ["(16) cross-clinic note lookup is denied", testCrossClinicDenied],
  ["(17) feature OFF → zero new case-scoped reads/writes", testFlagOffZeroIo],
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

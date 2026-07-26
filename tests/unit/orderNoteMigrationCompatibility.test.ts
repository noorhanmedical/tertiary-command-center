// Phase 2E-A3 — legacy note-write compatibility, signature-ownership
// hardening, and Admin Review evidence retry.
//
//   npx tsx tests/unit/orderNoteMigrationCompatibility.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const MIGRATION = readFileSync(join(process.cwd(), "migrations/0053_add_unified_ancillary_documents.sql"), "utf8");
// Forward path with SQL comments stripped — proves the DDL itself, not the
// prose, is additive.
const noComments = MIGRATION.replace(/--.*$/gm, "");

const orderNoteSvc = () => import("../../server/services/ancillaryDocuments/orderNoteService");
const signWf = () => import("../../server/services/physicianPortal/signatureWorkflow");
const notesRepo = () => import("../../server/repositories/generatedNotes.repo");
const genSchema = () => import("../../shared/schema/generatedNotes");

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
  return { id: 900, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", noteType: "order_note", generationStatus: "pending", signatureStatus: "needs_signature", signedAt: null, signedByUserId: null, generatedText: "body", supersededAt: null, supersedesNoteId: null, createdAt: START, updatedAt: START, ...over };
}
function signableNote(over: Record<string, unknown> = {}) {
  return noteRow({ id: 42, generationStatus: "generated", signatureStatus: "needs_signature", generatedText: "body", ...over });
}

function baseSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [evt()] }],
    [t.procedureNotes, { select: () => [], onInsert: (v) => [{ ...noteRow(), ...v, id: 900 }], onUpdate: (v) => [{ ...noteRow(), ...v }] }],
    [t.documentReferences, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.documentFailures, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.adminReviewEvents, { select: () => [{ id: 555 }] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

// ─── (1) migration has NO always-enforced Order Note case CHECK ───
async function testNoCaseCheck() {
  assert.ok(!/chk_pn_order_note_requires_case/i.test(MIGRATION), "no case-required CHECK constraint may exist");
  assert.ok(!/note_type <> 'order_note'/i.test(noComments), "the legacy-breaking CHECK expression must be gone from the DDL");
  // The deferral rationale is documented.
  assert.ok(/case-required DB CHECK[\s\S]*?legacy Order Note writers are retired or bridged/i.test(MIGRATION));
  assert.ok(/unlinked[\s\S]*?backfilled/i.test(MIGRATION));
  assert.ok(/ambiguous notes[\s\S]*?resolved/i.test(MIGRATION));
}

// ─── (2) legacy unlinked order_note stays insertable (no blocking CHECK) ─
async function testLegacyUnlinkedInsertable() {
  // With no CHECK on order_note rows, an INSERT with ancillary_case_id NULL
  // is not rejected by any constraint. The only order_note constraint is a
  // partial unique that itself is scoped to ancillary_case_id IS NULL.
  assert.ok(!/chk_pn_order_note_requires_case/i.test(MIGRATION));
  assert.ok(/uq_pn_order_note_legacy[\s\S]*?ancillary_case_id IS NULL/i.test(MIGRATION), "legacy unlinked partial unique present");
  // procedure_notes.ancillary_case_id is never promoted to NOT NULL, so an
  // unlinked legacy insert is accepted by the column definition too.
  assert.ok(!/ALTER COLUMN ancillary_case_id[\s\S]*?SET NOT NULL/i.test(MIGRATION));
}

// ─── (3) canonical service still requires + writes ancillaryCaseId ─
async function testCanonicalWritesCaseId() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  let payload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, { procedureNotes: { select: () => [], onInsert: (v) => { payload = v; return [{ ...noteRow(), ...v, id: 900 }]; } } });
  const r = await runWithDb(spec, FLAGS, async () => s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" }));
  assert.equal(r.status, "created");
  assert.equal((payload as Record<string, unknown>).ancillaryCaseId, 5, "canonical note is always stamped with its ancillary case");
}

// ─── (4/5) legacy + canonical partial uniques are disjoint ────────
async function testPartialUniquesDisjoint() {
  assert.ok(/uq_pn_order_note_active_case[\s\S]*?ancillary_case_id IS NOT NULL/i.test(MIGRATION), "canonical index scoped to ancillary_case_id IS NOT NULL");
  assert.ok(/uq_pn_order_note_legacy[\s\S]*?ancillary_case_id IS NULL/i.test(MIGRATION), "legacy index scoped to ancillary_case_id IS NULL");
  // Disjoint predicates → a linked and an unlinked note never collide, so
  // legacy unlinked and case-scoped notes coexist.
}

// ─── (6) same case cannot have two active canonical notes ─────────
async function testSameCaseSingleActive() {
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_pn_order_note_active_case[\s\S]*?\(ancillary_case_id, note_type\)[\s\S]*?WHERE note_type = 'order_note' AND ancillary_case_id IS NOT NULL AND superseded_at IS NULL/i.test(MIGRATION),
    "one active canonical order_note per (ancillary_case_id, note_type)",
  );
}

// ─── (7) separate cases each keep one note ────────────────────────
async function testSeparateCasesEachOne() {
  // The unique key includes ancillary_case_id, so distinct cases index into
  // distinct slots — each may hold its own active note.
  assert.ok(/uq_pn_order_note_active_case[\s\S]*?\(ancillary_case_id, note_type\)/i.test(MIGRATION));
}

// ─── (8) superseded note releases current uniqueness ──────────────
async function testSupersededReleasesUniqueness() {
  assert.ok(/uq_pn_order_note_active_case[\s\S]*?superseded_at IS NULL/i.test(MIGRATION), "superseded rows fall out of the current unique");
}

// ─── (9) post_procedure_note uniqueness unchanged ─────────────────
async function testPostProcedureUnchanged() {
  assert.ok(
    /uq_pn_post_procedure_note[\s\S]*?\(patient_screening_id, service_type, note_type\)[\s\S]*?WHERE note_type = 'post_procedure_note'/i.test(MIGRATION),
    "post_procedure_note keeps screening+service identity",
  );
}

// ─── (10) migration deletes no data ───────────────────────────────
async function testMigrationDeletesNoData() {
  for (const re of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bUPDATE\s+\w+\s+SET\b/i]) {
    assert.ok(!re.test(noComments), `forward path must not destroy data; found ${re}`);
  }
  // Dropping an INDEX definition removes no rows and is the only DROP allowed.
  assert.ok(/DROP INDEX IF EXISTS idx_pn_unique_note/i.test(MIGRATION));
}

// ─── (11/12/13) general insert schema rejects signature fields ────
async function testInsertSchemaRejectsSignatureFields() {
  const { insertProcedureNoteSchema } = await genSchema();
  const shape = Object.keys(insertProcedureNoteSchema.shape);
  for (const f of ["signedAt", "signedByUserId", "signatureStatus"]) {
    assert.ok(!shape.includes(f), `insert schema must omit ${f}`);
  }
  // Parsing a client body drops the signature fields entirely.
  const parsed = insertProcedureNoteSchema.parse({
    serviceType: "EchoWave", noteType: "order_note",
    signedAt: START, signedByUserId: "attacker", signatureStatus: "signed",
  } as Record<string, unknown>) as Record<string, unknown>;
  assert.ok(!("signedAt" in parsed), "(11) signedAt stripped");
  assert.ok(!("signedByUserId" in parsed), "(12) signedByUserId stripped");
  assert.ok(!("signatureStatus" in parsed), "(13) signatureStatus stripped");
}

// ─── (14/15) signing uses session user id + server timestamp ──────
async function testSignUsesSessionAndServerTime() {
  const t = await loadCanonicalTables();
  const wf = await signWf();
  wf.setBillingReevalScheduler(() => { /* drop side-effect: no async DB leak */ });
  try {
    let up: Record<string, unknown> | null = null;
    const spec = baseSpec(t, {
      procedureNotes: { select: () => [signableNote()], onUpdate: (v) => { up = v; return [{ ...signableNote(), ...v }]; } },
    });
    const before = Date.now();
    const r = await runWithDb(spec, {}, async () =>
      wf.signProcedureNote({ id: 42, clinicId: 1, authenticatedSignerUserId: "session-user-1" }));
    assert.equal(r.ok, true);
    const p = up as Record<string, unknown>;
    assert.equal(p.signatureStatus, "signed");
    assert.equal(p.signedByUserId, "session-user-1", "(14) signer is the session user id");
    assert.ok(p.signedAt instanceof Date, "(15) signedAt is a server Date");
    assert.ok((p.signedAt as Date).getTime() >= before, "(15) signedAt is server 'now', not backdated");
    assert.equal(p.generationStatus, "approved", "signing promotes to approved");
  } finally {
    wf.setBillingReevalScheduler(null);
  }
}

// ─── (16) client signer identity cannot be injected ───────────────
async function testClientSignerCannotBeUsed() {
  const { insertProcedureNoteSchema } = await genSchema();
  const { signProcedureNoteRow } = await notesRepo();
  // No client-body path carries a signer id into a note...
  const parsed = insertProcedureNoteSchema.parse({ serviceType: "EchoWave", noteType: "order_note", signedByUserId: "attacker" } as Record<string, unknown>) as Record<string, unknown>;
  assert.ok(!("signedByUserId" in parsed));
  // ...and the server-owned command writes exactly the session signer it is
  // given (here null), never fabricating one.
  const t = await loadCanonicalTables();
  let up: Record<string, unknown> | null = null;
  const spec = baseSpec(t, { procedureNotes: { select: () => [signableNote()], onUpdate: (v) => { up = v; return [{ ...signableNote(), ...v }]; } } });
  await runWithDb(spec, {}, async () => signProcedureNoteRow({ id: 42, clinicId: 1, signedByUserId: null }));
  assert.equal((up as Record<string, unknown>).signedByUserId, null, "absent signer is null, never fabricated");
}

// ─── (17) client signedAt cannot be used ──────────────────────────
async function testClientSignedAtCannotBeUsed() {
  const { insertProcedureNoteSchema } = await genSchema();
  const { signProcedureNoteRow } = await notesRepo();
  const parsed = insertProcedureNoteSchema.parse({ serviceType: "EchoWave", noteType: "order_note", signedAt: new Date("2000-01-01T00:00:00Z") } as Record<string, unknown>) as Record<string, unknown>;
  assert.ok(!("signedAt" in parsed), "client signedAt stripped on create");
  // The signing command stamps server time; it has no signedAt input at all.
  const t = await loadCanonicalTables();
  let up: Record<string, unknown> | null = null;
  const spec = baseSpec(t, { procedureNotes: { select: () => [signableNote()], onUpdate: (v) => { up = v; return [{ ...signableNote(), ...v }]; } } });
  const before = Date.now();
  await runWithDb(spec, {}, async () => signProcedureNoteRow({ id: 42, clinicId: 1, signedByUserId: "u1" }));
  const at = (up as Record<string, unknown>).signedAt as Date;
  assert.ok(at instanceof Date && at.getTime() >= before, "server-stamped signedAt");
}

// ─── (18) general update cannot overwrite a signed note (any field) ─
async function testGeneralUpdateCannotOverwriteSigned() {
  const t = await loadCanonicalTables();
  const { updateGeneratedNote } = await notesRepo();
  const spec = baseSpec(t, { procedureNotes: { select: () => [signableNote({ signatureStatus: "signed", signedAt: START })], onUpdate: (v) => [{ ...v }] } });
  await runWithDb(spec, {}, async (calls: Call[]) => {
    // Content field rejected...
    await assert.rejects(
      () => updateGeneratedNote(42, { generatedText: "tampered" } as never),
      /signed_note_immutable/i,
      "signed content is immutable via general update",
    );
    // ...and so is a non-content field (full immutability, not silent ignore).
    await assert.rejects(
      () => updateGeneratedNote(42, { generationStatus: "pending" } as never),
      /signed_note_immutable/i,
      "even generationStatus cannot change on a signed note",
    );
    assert.equal(countOps(calls, "update", t.procedureNotes), 0, "no write occurs on rejection");
  });
}

// ─── (19) return-for-correction uses the dedicated clinic-scoped path ─
async function testReturnUsesDedicatedContract() {
  const t = await loadCanonicalTables();
  const wf = await signWf();
  let up: Record<string, unknown> | null = null;
  const spec = baseSpec(t, { procedureNotes: { select: () => [signableNote()], onUpdate: (v) => { up = v; return [{ ...signableNote(), ...v }]; } } });
  const r = await runWithDb(spec, {}, async () =>
    wf.returnProcedureNoteForCorrection({ id: 42, clinicId: 1, reason: "  please fix section 2  " }));
  assert.equal(r.ok, true);
  const p = up as Record<string, unknown>;
  assert.equal(p.signatureStatus, "returned_for_correction");
  assert.equal(p.returnReason, "please fix section 2", "reason trimmed");
  // The dedicated command never fabricates signing/approval fields on a return.
  for (const forbidden of ["signedAt", "signedByUserId", "generationStatus"]) {
    assert.ok(!(forbidden in p), `return must not write ${forbidden}`);
  }
}

// ─── (20/21) missing approved review event → durable retry, no fake id ─
async function testMissingReviewEventCreatesRetry() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  let notePayload: Record<string, unknown> | null = null;
  let failurePayload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    adminReviewEvents: { select: () => [] }, // approved case, but no immutable event row
    procedureNotes: { select: () => [], onInsert: (v) => { notePayload = v; return [{ ...noteRow(), ...v, id: 900 }]; } },
    documentFailures: { select: () => [], onInsert: (v) => { failurePayload = v; return [{ ...v, id: 1 }]; } },
  });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.createOrReuseOrderNote({ clinicId: 1, ancillaryCaseId: 5, source: "test" });
    assert.ok(countOps(calls, "insert", t.documentFailures) >= 1, "(20) durable evidence retry recorded");
    return res;
  });
  const fp = failurePayload as Record<string, unknown>;
  assert.equal(fp.requestedAction, "link_order_note_evidence");
  assert.equal(fp.errorCode, "ADMIN_REVIEW_EVENT_LINK_MISSING");
  assert.equal(fp.documentKind, "order_note");
  assert.equal(fp.sourceTable, "procedure_notes");
  assert.equal(fp.sourceId, 900, "retry targets the created note");
  // (21) no fabricated event id anywhere.
  assert.equal((notePayload as Record<string, unknown>).adminReviewEventId, null);
  assert.equal(r.status, "created");
  if (r.status === "created") {
    assert.equal(r.adminReviewEvidenceDeferred, true);
    assert.equal(r.adminReviewEventId, undefined);
    assert.ok(r.warnings.includes("admin_review_event_link_unavailable"));
  }
}

// ─── (22/23) retry later links the event, touching only the evidence ─
async function testRetryLinksEventOnly() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  let up: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    // Valid, same-clinic, same-case current order note (found by raw read).
    procedureNotes: { select: () => [noteRow({ id: 900 })], onUpdate: (v) => { up = v; return [{ ...noteRow(), ...v }]; } },
    adminReviewEvents: { select: () => [{ id: 555 }] }, // now resolvable
    documentReferences: { select: () => [] }, // no reference yet — link note only, never fabricate
  });
  const r = await runWithDb(spec, FLAGS, async (calls: Call[]) => {
    const res = await s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 });
    assert.equal(countOps(calls, "update", t.procedureNotes), 1, "single link-only update");
    assert.equal(countOps(calls, "insert", t.documentReferences), 0, "missing reference is never fabricated");
    return res;
  });
  assert.equal(r.status, "linked");
  if (r.status === "linked") { assert.equal(r.adminReviewEventId, 555); assert.equal(r.orderNoteId, 900); }
  const p = up as Record<string, unknown>;
  assert.equal(p.adminReviewEventId, 555, "(22) approved event linked");
  // (23) LINK-ONLY: never clinical/signature fields.
  for (const forbidden of ["generatedText", "signatureStatus", "signedAt", "signedByUserId", "generationStatus", "noteType"]) {
    assert.ok(!(forbidden in p), `evidence retry must not modify ${forbidden}`);
  }
}

// ─── (24) both feature flags OFF → zero evidence-retry reads/writes ─
async function testFeatureOffNoEvidenceRetry() {
  const t = await loadCanonicalTables();
  const s = await orderNoteSvc();
  const r = await runWithDb(baseSpec(t), { unifiedAncillaryDocuments: false, canonicalOrderNote: false }, async (calls: Call[]) => {
    const res = await s.linkOrderNoteAdminReviewEvidence({ clinicId: 1, ancillaryCaseId: 5, sourceId: 900 });
    assert.equal(calls.length, 0, "feature OFF issues zero reads/writes");
    return res;
  });
  assert.equal(r.status, "skipped_flag_off");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) migration has no always-enforced Order Note case CHECK", testNoCaseCheck],
  ["(2) legacy unlinked order_note remains insertable", testLegacyUnlinkedInsertable],
  ["(3) canonical service requires + writes ancillaryCaseId", testCanonicalWritesCaseId],
  ["(4/5) legacy + canonical partial uniques are disjoint / coexist", testPartialUniquesDisjoint],
  ["(6) same case cannot have two active canonical notes", testSameCaseSingleActive],
  ["(7) separate cases may each have one note", testSeparateCasesEachOne],
  ["(8) superseded note releases current uniqueness", testSupersededReleasesUniqueness],
  ["(9) post_procedure_note uniqueness unchanged", testPostProcedureUnchanged],
  ["(10) migration deletes no data", testMigrationDeletesNoData],
  ["(11/12/13) general insert schema rejects signature fields", testInsertSchemaRejectsSignatureFields],
  ["(14/15) signing uses session user id + server timestamp", testSignUsesSessionAndServerTime],
  ["(16) client signer identity cannot be used", testClientSignerCannotBeUsed],
  ["(17) client signedAt cannot be used", testClientSignedAtCannotBeUsed],
  ["(18) general update cannot overwrite signed note content", testGeneralUpdateCannotOverwriteSigned],
  ["(19) return-for-correction uses the dedicated contract", testReturnUsesDedicatedContract],
  ["(20/21) missing approved review event → durable retry, no fake id", testMissingReviewEventCreatesRetry],
  ["(22/23) retry links approved event, evidence-only", testRetryLinksEventOnly],
  ["(24) feature OFF creates no evidence retry", testFeatureOffNoEvidenceRetry],
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

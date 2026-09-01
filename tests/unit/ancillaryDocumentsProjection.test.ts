// Phase 2E-A — unified Ancillary Documents read projection.
//
//   npx tsx tests/unit/ancillaryDocumentsProjection.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec } from "../support/canonicalHarness";

const svc = () => import("../../server/services/ancillaryDocuments/documentProjection");
const T0 = new Date("2027-06-01T10:00:00Z");
const T1 = new Date("2027-06-02T10:00:00Z");

function ref(over: Record<string, unknown> = {}) {
  return {
    id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note",
    sourceSystem: "canonical", sourceTable: "procedure_notes", sourceId: 900,
    documentStatus: "signed", effectiveClinicalDate: null, actualCreatedAt: T0,
    signedAt: null, supersededAt: null, serviceType: "EchoWave", ...over,
  };
}
async function project(t: Awaited<ReturnType<typeof loadCanonicalTables>>, refs: unknown[], query: Record<string, unknown> = { clinicId: 1 }, flag = true) {
  const s = await svc();
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => refs }]]);
  return runWithDb(spec, { unifiedAncillaryDocuments: flag }, async (calls) => ({ res: await s.getAncillaryDocumentsProjection(query as never), calls }));
}

// ─── (1) Order Note + report share the same case collection ───────
async function testSharedCaseCollection() {
  const t = await loadCanonicalTables();
  const { res } = await project(t, [
    ref({ id: 1, documentKind: "order_note", sourceId: 900 }),
    ref({ id: 2, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 5000, documentStatus: "uploaded" }),
  ]);
  assert.equal(res.cases.length, 1, "one ancillary case collection");
  assert.equal(res.cases[0].ancillaryCaseId, 5);
  assert.deepEqual(res.cases[0].documents.map((d) => d.documentKind).sort(), ["order_note", "report"]);
}

// ─── (2) consent / screening_form link to the correct case ────────
async function testLinkToCorrectCase() {
  const t = await loadCanonicalTables();
  const { res } = await project(t, [
    ref({ id: 1, ancillaryCaseId: 5, documentKind: "order_note" }),
    ref({ id: 2, ancillaryCaseId: 6, documentKind: "consent", sourceTable: "case_document_readiness", sourceId: 7000, documentStatus: "uploaded" }),
  ]);
  const c5 = res.cases.find((c) => c.ancillaryCaseId === 5)!;
  const c6 = res.cases.find((c) => c.ancillaryCaseId === 6)!;
  assert.deepEqual(c5.documents.map((d) => d.documentKind), ["order_note"]);
  assert.deepEqual(c6.documents.map((d) => d.documentKind), ["consent"]);
}

// ─── (3) different services stay in separate collections ──────────
async function testDifferentServicesSeparate() {
  const t = await loadCanonicalTables();
  const { res } = await project(t, [
    ref({ id: 1, ancillaryCaseId: 5, serviceType: "EchoWave" }),
    ref({ id: 2, ancillaryCaseId: 9, serviceType: "SleepWave" }),
  ]);
  assert.equal(res.cases.length, 2);
  assert.equal(res.cases.find((c) => c.ancillaryCaseId === 5)!.serviceType, "EchoWave");
  assert.equal(res.cases.find((c) => c.ancillaryCaseId === 9)!.serviceType, "SleepWave");
}

// ─── (4/5) stable source IDs; authorized download only, no bytes ──
async function testStablePointerNoBytes() {
  const t = await loadCanonicalTables();
  // A procedure_notes source with NO stored authorized pointer → download is
  // null (NEVER fabricated as procedure_notes:900). sourceTable/sourceId
  // remain as identifiers.
  const { res } = await project(t, [ref({ sourceTable: "procedure_notes", sourceId: 900, metadata: {} })]);
  const doc = res.cases[0].documents[0];
  assert.equal(doc.sourceTable, "procedure_notes");
  assert.equal(doc.sourceId, 900);
  assert.equal(doc.downloadReference, null, "no fabricated sourceTable:sourceId download");
  for (const forbidden of ["content", "bytes", "body", "generatedText", "noteText", "fileData", "blob"]) {
    assert.ok(!(forbidden in doc), `projection must not expose document bytes/body: ${forbidden}`);
  }
  // A documents-library pointer is NOT emitted (route is not tenant-safe) → null.
  const { res: res2 } = await project(t, [ref({ id: 7, ancillaryCaseId: 5, documentKind: "consent", sourceTable: "case_document_readiness", sourceId: 42, metadata: { download_reference: "documents:123" } })]);
  const doc2 = res2.cases[0].documents.find((d) => d.ancillaryDocumentReferenceId === 7)!;
  assert.equal(doc2.downloadReference, null, "non-tenant-safe documents route is not emitted");
  // A raw bucket key / URL is rejected outright.
  const { res: res3 } = await project(t, [ref({ id: 8, ancillaryCaseId: 5, sourceTable: "case_document_readiness", sourceId: 43, metadata: { download_reference: "s3://bucket/secret/key.pdf" } })]);
  assert.equal(res3.cases[0].documents.find((d) => d.ancillaryDocumentReferenceId === 8)!.downloadReference, null, "raw bucket key rejected");
}

// ─── (6) cross-clinic reads are denied ────────────────────────────
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const { res } = await project(t, [
    ref({ id: 1, clinicId: 1, ancillaryCaseId: 5 }),
    ref({ id: 2, clinicId: 2, ancillaryCaseId: 8 }), // other clinic
  ]);
  assert.equal(res.cases.length, 1);
  assert.equal(res.cases[0].ancillaryCaseId, 5);
  assert.ok(!res.cases.some((c) => c.ancillaryCaseId === 8), "another clinic's case must not surface");
}

// ─── (7) current vs history distinct ──────────────────────────────
async function testCurrentVsHistory() {
  const t = await loadCanonicalTables();
  const refs = [
    ref({ id: 1, documentKind: "order_note", documentStatus: "signed", actualCreatedAt: T0 }),
    ref({ id: 2, documentKind: "order_note", documentStatus: "superseded", supersededAt: T1, actualCreatedAt: T1 }),
  ];
  const withHistory = (await project(t, refs, { clinicId: 1, includeHistory: true })).res;
  const readiness = withHistory.cases[0].documents.map((d) => d.readiness).sort();
  assert.deepEqual(readiness, ["history", "ready"], "superseded → history, signed → ready");

  const currentOnly = (await project(t, refs, { clinicId: 1, includeHistory: false })).res;
  assert.equal(currentOnly.cases[0].documents.length, 1, "history excluded when includeHistory=false");
  assert.equal(currentOnly.cases[0].documents[0].readiness, "ready");
}

// ─── (8) missing optional docs create warnings ────────────────────
async function testOptionalMissingWarning() {
  const t = await loadCanonicalTables();
  const { res } = await project(t, [ref({ documentKind: "order_note" })]); // no report/screening_form
  const warnings = res.cases[0].warnings;
  assert.ok(warnings.includes("report_missing"));
  assert.ok(warnings.includes("screening_form_missing"));
}

// ─── (9) mandatory consent readiness follows config, not optional path ─
async function testConsentNotOptionalWarning() {
  const t = await loadCanonicalTables();
  // Consent is NOT an optional-warning kind — its absence must not be
  // reported through the optional `*_missing` warning path.
  const { res } = await project(t, [ref({ documentKind: "order_note" })]);
  assert.ok(!res.cases[0].warnings.includes("consent_missing"), "consent is not an optional-warning kind");
  // When present, consent appears as a document in the collection.
  const present = (await project(t, [
    ref({ id: 1, documentKind: "order_note" }),
    ref({ id: 2, documentKind: "consent", sourceTable: "case_document_readiness", sourceId: 7000, documentStatus: "uploaded" }),
  ])).res;
  assert.ok(present.cases[0].documents.some((d) => d.documentKind === "consent"));
}

// ─── (10) projection failure fails closed (no legacy fallback) ────
async function testFailsClosed() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => { throw new Error("db down"); } }]]);
  await assert.rejects(
    runWithDb(spec, { unifiedAncillaryDocuments: true }, async () => s.getAncillaryDocumentsProjection({ clinicId: 1 })),
    /db down/,
    "projection must fail closed, not silently return a legacy/empty fallback",
  );
}

// ─── (11) flag OFF → zero reads ───────────────────────────────────
async function testFlagOffZeroReads() {
  const t = await loadCanonicalTables();
  const { res, calls } = await project(t, [ref()], { clinicId: 1 }, false);
  assert.equal(res.flagOff, true);
  assert.deepEqual(res.cases, []);
  assert.equal(calls.length, 0, "flag OFF issues zero reads");
}

// ─── (12) projection never generates Procedure/Billing documents ──
async function testReadOnlyNoGeneration() {
  const t = await loadCanonicalTables();
  const { res, calls } = await project(t, [ref()]);
  assert.equal(countOps(calls, "insert"), 0, "projection is read-only");
  assert.equal(countOps(calls, "update"), 0);
  const kinds = res.cases.flatMap((c) => c.documents.map((d) => d.documentKind));
  for (const forbidden of ["procedure_note", "billing_document"]) {
    assert.ok(!kinds.includes(forbidden), `projection must not surface ${forbidden}`);
  }
}

// ─── (13) case-scoped Order Notes never merge across cases ────────
async function testOrderNotesCaseScoped() {
  const t = await loadCanonicalTables();
  // Two ancillary cases (same clinic) each with their OWN order_note
  // reference pointing at a distinct procedure_notes id.
  const { res } = await project(t, [
    ref({ id: 1, ancillaryCaseId: 5, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 905 }),
    ref({ id: 2, ancillaryCaseId: 6, documentKind: "order_note", sourceTable: "procedure_notes", sourceId: 906 }),
  ]);
  assert.equal(res.cases.length, 2, "each ancillary case keeps its own Order Note");
  const c5 = res.cases.find((c) => c.ancillaryCaseId === 5)!;
  const c6 = res.cases.find((c) => c.ancillaryCaseId === 6)!;
  assert.equal(c5.documents[0].sourceId, 905);
  assert.equal(c6.documents[0].sourceId, 906);
  assert.notEqual(c5.documents[0].sourceId, c6.documents[0].sourceId, "no cross-case note sharing");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(13) case-scoped Order Notes never merge across cases", testOrderNotesCaseScoped],
  ["(1) Order Note + report share the same case collection", testSharedCaseCollection],
  ["(2) consent / screening_form link to the correct case", testLinkToCorrectCase],
  ["(3) different services stay in separate collections", testDifferentServicesSeparate],
  ["(4/5) stable source IDs, no copied body/file", testStablePointerNoBytes],
  ["(6) cross-clinic reads are denied", testCrossClinicDenied],
  ["(7) current vs history are distinct", testCurrentVsHistory],
  ["(8) missing optional docs create warnings", testOptionalMissingWarning],
  ["(9) mandatory consent readiness follows config", testConsentNotOptionalWarning],
  ["(10) projection failure fails closed", testFailsClosed],
  ["(11) flag OFF → zero reads", testFlagOffZeroReads],
  ["(12) projection never generates Procedure/Billing documents", testReadOnlyNoGeneration],
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

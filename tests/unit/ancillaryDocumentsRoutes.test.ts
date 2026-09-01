// Phase 2E-B — clinic-scoped Ancillary Documents read routes.
//
//   npx tsx tests/unit/ancillaryDocumentsRoutes.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, type TableSpec } from "../support/canonicalHarness";

const routesMod = () => import("../../server/routes/ancillaryDocuments");
const FLAGS = { unifiedAncillaryDocuments: true } as const;
const D1 = new Date("2027-06-01T10:00:00Z");
const D2 = new Date("2027-06-02T10:00:00Z");

function caseRow(over: Record<string, unknown> = {}) {
  return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", lifecycleStatus: "active", ...over };
}
function ref(over: Record<string, unknown> = {}) {
  return {
    id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "EchoWave", documentKind: "report",
    sourceSystem: "x", sourceTable: "case_document_readiness", sourceId: 3001, documentStatus: "uploaded",
    effectiveClinicalDate: null, actualCreatedAt: D1, signedAt: null, supersededAt: null,
    globalPlexusPatientId: 10, patientScreeningId: 77, executionCaseId: 900, metadata: {}, ...over,
  };
}

// Minimal express shim capturing registered GET handlers.
type Handler = (req: any, res: any) => Promise<void> | void;
function fakeApp() {
  const routes: Record<string, Handler> = {};
  return {
    app: { get(path: string, ...h: Handler[]) { routes[path] = h[h.length - 1]; } },
    routes,
  };
}
function fakeRes() {
  const rec: any = { statusCode: 200, body: null };
  rec.status = (c: number) => { rec.statusCode = c; return rec; };
  rec.json = (b: unknown) => { rec.body = b; return rec; };
  return rec;
}

async function loadRoutes() {
  const { registerAncillaryDocumentsRoutes } = await routesMod();
  const { app, routes } = fakeApp();
  registerAncillaryDocumentsRoutes(app as never);
  return routes;
}

// ─── (1) clinic-scoped case route returns projection ──────────────
async function testCaseRoute() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.documentReferences, { select: () => [ref()] }],
  ]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-cases/:ancillaryCaseId/documents"]({ clinicId: 1, params: { ancillaryCaseId: "5" }, query: {} }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flagOff, false);
  assert.equal(res.body.cases.length, 1);
  assert.equal(res.body.cases[0].ancillaryCaseId, 5);
}

// ─── (2) cross-clinic case → 404 (no detail disclosure) ───────────
async function testCaseRouteCrossClinic() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow({ clinicId: 2 })] }], // owned by clinic 2
    [t.documentReferences, { select: () => [] }],
  ]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-cases/:ancillaryCaseId/documents"]({ clinicId: 1, params: { ancillaryCaseId: "5" }, query: {} }, res));
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /not found/i);
}

// ─── (3) missing clinic scope → 403 ───────────────────────────────
async function testCaseRouteNoClinic() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const res = fakeRes();
  await runWithDb(new Map(), FLAGS, async () =>
    routes["/api/ancillary-cases/:ancillaryCaseId/documents"]({ clinicId: null, params: { ancillaryCaseId: "5" }, query: {} }, res));
  assert.equal(res.statusCode, 403);
}

// ─── (4) global route: items + authorized downloads + no internals ─
// (Deterministic SQL ordering + true keyset traversal are proven behaviorally
//  in ancillaryDocumentsPaginationAndSourceSafety.test.ts with a store fake.)
async function testGlobalRouteShape() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const rows = [ref({ id: 1 }), ref({ id: 2 }), ref({ id: 3 })];
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => rows }]]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: { limit: "50" } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 3);
  for (const it of res.body.items) {
    // No fabricated sourceTable:sourceId download (metadata carries no pointer).
    assert.equal(it.downloadReference, null, "no fabricated download pointer");
    // sourceTable + sourceId remain as identifiers.
    assert.equal(it.sourceTable, "case_document_readiness");
    assert.ok(Number.isInteger(it.sourceId));
    assert.ok(!("resolvedAt" in it) && !("attemptCount" in it) && !("errorCode" in it), "no retry-ledger internals");
  }
}

// ─── (5) global route: bounded limit + STRING cursor ──────────────
async function testGlobalRouteBounded() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const rows = Array.from({ length: 5 }, (_, i) => ref({ id: i + 1, actualCreatedAt: new Date(D1.getTime() + i * 1000) }));
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => rows }]]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: { limit: "2" } }, res));
  assert.equal(res.body.items.length, 2, "limit honored");
  assert.equal(typeof res.body.nextCursor, "string", "opaque STRING cursor, not a numeric id");
  assert.ok(res.body.nextCursor.length > 0);
}

// ─── (5b) malformed cursor → 400 ──────────────────────────────────
async function testMalformedCursor400() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => [] }]]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: { cursor: "!!!not-a-cursor!!!" } }, res));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "INVALID_CURSOR");
}

// ─── (6) missing migration + flag ON → controlled 503 ─────────────
async function testMigrationMissing503() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const spec = new Map<unknown, TableSpec>([
    [t.documentReferences, { select: () => { throw Object.assign(new Error("no table"), { code: "42P01" }); } }],
  ]);
  const res = fakeRes();
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: {} }, res));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING");
}

// ─── (7) feature OFF → disabled contract, ZERO canonical reads ────
async function testFlagOffDisabled() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  let reads = 0;
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => { reads++; return []; } }]]);
  const res = fakeRes();
  await runWithDb(spec, { unifiedAncillaryDocuments: false }, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: {} }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.disabled, true, "explicit disabled contract");
  assert.deepEqual(res.body.items, []);
  assert.equal(reads, 0, "zero migration-0053 reads when flag OFF");
}

// ─── (8) case route flag OFF → disabled contract, zero reads ──────
async function testCaseRouteFlagOff() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  let reads = 0;
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => { reads++; return [caseRow()]; } }],
    [t.documentReferences, { select: () => { reads++; return []; } }],
  ]);
  const res = fakeRes();
  await runWithDb(spec, { unifiedAncillaryDocuments: false }, async () =>
    routes["/api/ancillary-cases/:ancillaryCaseId/documents"]({ clinicId: 1, params: { ancillaryCaseId: "5" }, query: {} }, res));
  assert.equal(res.body.disabled, true);
  assert.equal(reads, 0, "zero reads when flag OFF");
}

// ─── (9) global route: unknown/identity params are ignored (no search) ─
async function testNoIdentitySearch() {
  const t = await loadCanonicalTables();
  const routes = await loadRoutes();
  const spec = new Map<unknown, TableSpec>([[t.documentReferences, { select: () => [ref()] }]]);
  const res = fakeRes();
  // A patient-name / global-identity style query must not broaden results —
  // the handler only honors the allowlisted clinic-scoped filters.
  await runWithDb(spec, FLAGS, async () =>
    routes["/api/ancillary-documents"]({ clinicId: 1, query: { patientName: "Jane Doe", mrn: "X", globalSearch: "1" } }, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1, "unknown identity params neither error nor broaden scope");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) clinic-scoped case route", testCaseRoute],
  ["(2) cross-clinic case → 404", testCaseRouteCrossClinic],
  ["(3) missing clinic scope → 403", testCaseRouteNoClinic],
  ["(4) global route shape: items, authorized downloads, no internals", testGlobalRouteShape],
  ["(5) global route bounded limit + string cursor", testGlobalRouteBounded],
  ["(5b) malformed cursor → 400", testMalformedCursor400],
  ["(6) missing migration + flag ON → 503", testMigrationMissing503],
  ["(7) feature OFF → disabled contract, zero reads", testFlagOffDisabled],
  ["(8) case route flag OFF → disabled, zero reads", testCaseRouteFlagOff],
  ["(9) no global identity search", testNoIdentitySearch],
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

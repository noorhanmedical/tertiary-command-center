// Phase 2H — canonical Clinician Portal overview: read model, route, DTO, client.
//
//   npx tsx tests/unit/clinicianPortalCanonicalOverview.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const overview = () => import("../../server/services/clinicianPortal/canonicalOverview");
const routes = () => import("../../server/routes/clinicianPortalCanonical");
const dto = () => import("../../shared/clinicianPortalOverview");
const clientFlag = () => import("../../client/src/lib/clinicianPortalCanonicalFlag");

const OLD = new Date("2027-06-10T09:00:00Z");
// Upstream chain that enables ALL three sections.
const ALL = { ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true, canonicalBillingReadiness: true } as const;

function readiness(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, billingBlockers: [], claimBlockers: [], evaluatedAt: OLD, ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, canonicalStatus: "generated", supersededAt: null, ...o }; }
function ref(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", documentStatus: "signed", serviceType: "BrainWave", signedAt: OLD, effectiveClinicalDate: OLD, actualCreatedAt: OLD, supersededAt: null, ...o }; }
function note(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, noteType: "post_procedure_note", signatureStatus: "signed", generationStatus: "generated", supersededAt: null, ...o }; }
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved", ...o }; }

function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { readiness?: unknown[]; docs?: unknown[]; refs?: unknown[]; notes?: unknown[]; cases?: unknown[]; readinessErr?: boolean } = {}) {
  return new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { if (o.readinessErr) throw new Error("finance down"); return o.readiness ?? []; } }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [] }],
    [t.documentReferences, { select: () => o.refs ?? [] }],
    [t.procedureNotes, { select: () => o.notes ?? [] }],
    [t.ancillaryCases, { select: () => o.cases ?? [] }],
  ]);
}

// (13) finance counts current readiness once per case + docs truthfully
async function testFinanceCounts() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    readiness: [readiness({ ancillaryCaseId: 5, canonicalStatus: "ready_to_generate", claimBlockers: [{ code: "prior_auth" }], billingBlockers: [] }), readiness({ id: 2, ancillaryCaseId: 6, canonicalStatus: "missing_requirements", billingBlockers: [{ code: "order_note_signature_unresolved" }] })],
    docs: [billingDoc({ ancillaryCaseId: 5, canonicalStatus: "generated" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.availability, "available");
  assert.equal(r.finance.counts.evaluated, 2);
  assert.equal(r.finance.counts.readyToGenerate, 1);
  assert.equal(r.finance.counts.missingRequirements, 1);
  assert.equal(r.finance.counts.claimBlockedOnly, 1, "ready + claim blocker → claim-blocked-only");
  assert.equal(r.finance.counts.billingDocumentGenerated, 1);
  assert.ok(r.finance.claimBlockersByCode.some((c) => c.code === "prior_auth"), "claim blockers preserved");
  assert.ok(r.finance.billingBlockersByCode.some((c) => c.code === "order_note_signature_unresolved"));
}

// (14) superseded readiness excluded from current counts
async function testSupersededExcluded() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { readiness: [readiness({ supersededAt: OLD }), readiness({ id: 2, ancillaryCaseId: 6, canonicalStatus: "superseded" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.counts.evaluated, 1, "superseded snapshot excluded from evaluated");
}

// (7/8) cross-clinic rows never counted (in-memory tenancy defense)
async function testCrossClinicExcluded() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    readiness: [readiness({ clinicId: 2 })], refs: [ref({ clinicId: 2 })], cases: [acase({ clinicId: 2 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.counts.evaluated, 0, "no cross-clinic finance leakage");
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "no cross-clinic document leakage");
  assert.equal(r.engagement.counts.activeCases, 0, "no cross-clinic engagement leakage");
}

// (19) partial finance failure is unavailable, NOT zero (other sections still available)
async function testPartialFailureUnavailable() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { readinessErr: true, refs: [ref()], cases: [acase()] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.availability, "unavailable", "(19) failed finance section → unavailable, not zero");
  assert.equal(r.ordersNotes.availability, "available", "other sections unaffected");
  assert.equal(r.engagement.availability, "available");
}

// (3/upstream) each section reports upstream_flag_off when its flag is OFF
async function testUpstreamFlagOff() {
  const t = await loadCanonicalTables(); const o = await overview();
  const financeOff = await runWithDb(spec(t, { readiness: [readiness()] }), { ...ALL, canonicalBillingReadiness: false }, async (calls: Call[]) => {
    const res = await o.getClinicianPortalCanonicalOverview({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.billingReadinessChecks), 0, "no readiness read when upstream OFF");
    return res;
  });
  assert.equal(financeOff.finance.availability, "upstream_flag_off");
  const ordersOff = await runWithDb(spec(t, { refs: [ref()] }), { ...ALL, unifiedAncillaryDocuments: false }, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(ordersOff.ordersNotes.availability, "upstream_flag_off");
  const engOff = await runWithDb(spec(t, { cases: [acase()] }), { ...ALL, ancillaryCaseWrite: false }, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(engOff.engagement.availability, "upstream_flag_off");
}

// (20/21/22/23/25/26) orders & notes counts truthfully; kinds distinct; superseded excluded
async function testOrdersNotesCounts() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    refs: [ref({ id: 1, documentKind: "order_note" }), ref({ id: 2, documentKind: "procedure_note", documentStatus: "pending_signature" }), ref({ id: 3, documentKind: "report" }), ref({ id: 4, documentKind: "order_note", supersededAt: OLD })],
    notes: [note({ id: 1, signatureStatus: "returned_for_correction" }), note({ id: 2, generationStatus: "generated" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 1, "(20/23) superseded order_note excluded, kinds distinct");
  assert.equal(r.ordersNotes.counts.currentProcedureNotes, 1);
  assert.equal(r.ordersNotes.counts.currentReports, 1, "(22) report counted separately");
  assert.equal(r.ordersNotes.counts.pendingSignatures, 1, "(25) pending signature counted");
  assert.equal(r.ordersNotes.counts.returnedForCorrection, 1, "(26) returned-for-correction counted");
}

// (29) engagement service-specific Admin Review counts + (9/33) null outreach
async function testEngagementCounts() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, adminReviewStatus: "approved" }), acase({ id: 6, adminReviewStatus: "needs_information" }), acase({ id: 7, adminReviewStatus: "pending" }), acase({ id: 8, lifecycleStatus: "closed", adminReviewStatus: "approved" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.engagement.counts.activeCases, 3, "closed case excluded from active");
  assert.equal(r.engagement.counts.approved, 1);
  assert.equal(r.engagement.counts.needsInformation, 1);
  assert.equal(r.engagement.counts.pending, 1);
  assert.equal(r.engagement.rows[0].lastSentAt, null, "(33) missing outreach data stays null");
  assert.equal(r.engagement.rows[0].engagementListName, null);
}

// (9/12) repeated same-service episodes remain separate + deterministic bounded ordering
async function testEpisodesSeparateAndOrdered() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    // two DISTINCT ancillary cases, same service — must remain two rows, ordered by id.
    readiness: [readiness({ id: 2, ancillaryCaseId: 9 }), readiness({ id: 1, ancillaryCaseId: 6 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.counts.evaluated, 2, "same-service episodes remain separate");
  assert.deepEqual(r.finance.rows.map((x) => x.ancillaryCaseId), [6, 9], "deterministic ascending order by ancillaryCaseId");
}

// (18) DTO carries NO revenue/claim/payment fields
async function testDtoNoFinancialFields() {
  const d = await dto();
  const o = d.disabledClinicianPortalOverview(new Date().toISOString());
  const keys = Object.keys(o.finance.counts).join(",").toLowerCase();
  for (const bad of ["revenue", "amount", "paid", "balance", "collection", "invoice", "remittance", "payer", "income", "claimtotal"]) {
    assert.ok(!keys.includes(bad), `(18) Finance DTO must not carry financial field: ${bad}`);
  }
  assert.equal(o.disabled, true);
}

// ─── Route ────────────────────────────────────────────────────────
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(handlers: Function[], req: unknown, res: unknown) { for (const h of handlers) { let nexted = false; await h(req, res, () => { nexted = true; }); if (!nexted) return; } }

// (1/3) flag OFF → explicit disabled contract BEFORE any canonical read
async function testRouteFlagOffDisabled() {
  const t = await loadCanonicalTables(); const { app, map } = fakeApp(); (await routes()).registerClinicianPortalCanonicalRoutes(app);
  const handlers = map["GET /api/clinician-portal/canonical-overview"];
  const res = mockRes();
  await runWithDb(new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { throw new Error("must not read when flag off"); } }],
    [t.ancillaryCases, { select: () => { throw new Error("must not read"); } }],
  ]), { clinicianPortalCanonicalData: false }, async (calls: Call[]) => {
    await invoke(handlers, { session: { userId: "u1", role: "clinician" }, clinicId: 1 }, res);
    assert.equal(countOps(calls, "select"), 0, "(3) zero canonical reads when flag OFF");
  });
  assert.equal((res.body as { disabled: boolean }).disabled, true, "(1) disabled contract");
}

// (11) role guard: non-clinician/admin → 403; unauthenticated → 401
async function testRouteRoleGuard() {
  const { app, map } = fakeApp(); (await routes()).registerClinicianPortalCanonicalRoutes(app);
  const handlers = map["GET /api/clinician-portal/canonical-overview"];
  const r401 = mockRes(); await invoke(handlers, { session: {} }, r401);
  assert.equal(r401.statusCode, 401, "unauthenticated → 401");
  const r403 = mockRes(); await invoke(handlers, { session: { userId: "u", role: "biller" } }, r403);
  assert.equal(r403.statusCode, 403, "wrong role → 403");
}

// (11) clinic scope required (server context) → 403 when absent
async function testRouteClinicScope() {
  const { app, map } = fakeApp(); (await routes()).registerClinicianPortalCanonicalRoutes(app);
  const handlers = map["GET /api/clinician-portal/canonical-overview"];
  const res = mockRes();
  await runWithDb(new Map(), { clinicianPortalCanonicalData: true }, async () => {
    await invoke(handlers, { session: { userId: "u", role: "clinician" }, clinicId: null }, res);
  });
  assert.equal(res.statusCode, 403, "no clinic scope → 403 (never body-supplied)");
}

// ─── Client (static behavioral guards) ────────────────────────────
// (2) client flag defaults OFF
async function testClientFlagDefaultOff() {
  const f = await clientFlag();
  assert.equal(f.isClinicianPortalCanonicalDataEnabled(), false, "(2) client flag defaults OFF");
}

// (35/40) one query, no localStorage as a data source
async function testClientNoLocalStorageSingleQuery() {
  const hook = readFileSync(join(process.cwd(), "client/src/components/physician/useCanonicalOverview.ts"), "utf8");
  const panel = readFileSync(join(process.cwd(), "client/src/components/physician/CanonicalOverviewPanel.tsx"), "utf8");
  for (const [name, src] of [["hook", hook], ["panel", panel]] as const) {
    assert.ok(!src.includes("localStorage") && !src.includes("sessionStorage"), `(40) ${name} must not use browser storage as a data source`);
  }
  assert.equal((hook.match(/useQuery</g) ?? []).length, 1, "(35) exactly one canonical overview query call (no N+1)");
  assert.ok(hook.includes("enabled"), "(3) query gated by the flag (no request when OFF)");
}

// (42) the three protected tiles render the panel (no layout redesign — one panel each)
async function testTilesWirePanel() {
  for (const f of [
    "client/src/components/physician/finance/FinancePage.tsx",
    "client/src/components/physician/orders/OrdersNotesPage.tsx",
    "client/src/components/physician/engagement/PlexusEngagementPage.tsx",
  ]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(src.includes("CanonicalOverviewPanel"), `(42) ${f} wires the canonical panel`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(13/17) finance counts + claim blockers preserved", testFinanceCounts],
  ["(14) superseded readiness excluded", testSupersededExcluded],
  ["(7/8) cross-clinic excluded", testCrossClinicExcluded],
  ["(19) partial failure unavailable not zero", testPartialFailureUnavailable],
  ["(upstream) sections report upstream_flag_off", testUpstreamFlagOff],
  ["(20-26) orders & notes counts", testOrdersNotesCounts],
  ["(29/33) engagement counts + null outreach", testEngagementCounts],
  ["(9/12) episodes separate + deterministic order", testEpisodesSeparateAndOrdered],
  ["(18) DTO has no financial fields", testDtoNoFinancialFields],
  ["(1/3) route flag OFF disabled before reads", testRouteFlagOffDisabled],
  ["(11) route role guard", testRouteRoleGuard],
  ["(11) route clinic scope", testRouteClinicScope],
  ["(2) client flag defaults OFF", testClientFlagDefaultOff],
  ["(35/40) client single query, no storage", testClientNoLocalStorageSingleQuery],
  ["(42) tiles wire the panel", testTilesWirePanel],
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

// Phase 2I — PCS/ACS canonical view: stage-vector read models, exact-source
// truth, identity/episode preservation, pagination, route auth, migration-503.
//
//   npx tsx tests/unit/pcsAcsCanonicalView.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const pcs = () => import("../../server/services/pcs/pcsCanonicalView");
const acs = () => import("../../server/services/acs/acsCanonicalView");
const routes = () => import("../../server/routes/pcsAcsCanonical");
const viewQuery = () => import("../../server/services/canonicalStage/viewQuery");

const OLD = new Date("2027-06-10T09:00:00Z");
// Enable every upstream stage flag + both 2I surface flags.
const ALL = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  serviceSpecificAdminReview: true, engagementAdminReviewSync: true,
  pcsCanonicalView: true, acsCanonicalView: true,
} as const;

// ── row builders (all default to case 5, clinic 1, service BrainWave) ──
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved", globalPlexusPatientId: 900, patientClinicMembershipId: 800, executionCaseId: 70, originatingScreeningId: 77, ...o }; }
function adminEvent(o: Record<string, unknown> = {}) { return { id: 1, ancillaryCaseId: 5, newStatus: "approved", actualReviewedAt: OLD, source: "manual", ...o }; }
function list(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, sourceType: "admin_review", sourceId: "s-100", label: "Batch A", sentToEngagementAt: OLD, ...o }; }
function membership(o: Record<string, unknown> = {}) { return { id: 200, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "active", ...o }; }
function appt(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", status: "scheduled", startsAt: OLD, ...o }; }
function orderRef(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", documentStatus: "signed", serviceType: "BrainWave", sourceTable: "procedure_notes", sourceId: 1, executionCaseId: 70, patientScreeningId: 77, signedAt: OLD, effectiveClinicalDate: OLD, actualCreatedAt: OLD, supersededAt: null, ...o }; }
function orderNote(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, generationStatus: "generated", supersededAt: null, ...o }; }
function procRef(o: Record<string, unknown> = {}) { return orderRef({ id: 2, documentKind: "procedure_note", documentStatus: "signed", sourceId: 2, ...o }); }
function procNote(o: Record<string, unknown> = {}) { return orderNote({ id: 2, noteType: "post_procedure_note", ...o }); }
function reportRef(o: Record<string, unknown> = {}) { return orderRef({ id: 3, documentKind: "report", documentStatus: "uploaded", sourceTable: "case_document_readiness", sourceId: 3, ...o }); }
function cdr(o: Record<string, unknown> = {}) { return { id: 3, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", executionCaseId: 70, patientScreeningId: 77, ...o }; }
function proc(o: Record<string, unknown> = {}) { return { id: 400, clinicId: 1, ancillaryCaseId: 5, procedureStatus: "complete", completedAt: OLD, lastTransitionAt: OLD, updatedAt: OLD, ...o }; }
function readiness(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, canonicalStatus: "ready_to_generate", supersededAt: null, evaluatedAt: OLD, billingBlockers: [], claimBlockers: [], ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, canonicalStatus: "generated", supersededAt: null, generatedAt: OLD, ...o }; }
function gpp(o: Record<string, unknown> = {}) { return { id: 900, displayName: "Jane Doe", dob: "1980-01-01", ...o }; }
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, clinicMrn: "MRN-1", ...o }; }

type Opts = {
  cases?: unknown[]; adminEvents?: unknown[]; lists?: unknown[]; memberships?: unknown[]; appts?: unknown[];
  refs?: unknown[]; notes?: unknown[]; cdrs?: unknown[]; procs?: unknown[]; readiness?: unknown[]; docs?: unknown[];
  gpps?: unknown[]; pcms?: unknown[]; casesMigration?: boolean; refsMigration?: boolean; procsError?: boolean;
};
function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts = {}) {
  const mig = () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); };
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => { if (o.casesMigration) return mig(); return o.cases ?? [acase()]; } }],
    [t.adminReviewEvents, { select: () => o.adminEvents ?? [] }],
    [t.engagementLists, { select: () => o.lists ?? [] }],
    [t.engagementMemberships, { select: () => o.memberships ?? [] }],
    [t.gse, { select: () => o.appts ?? [] }],
    [t.documentReferences, { select: () => { if (o.refsMigration) return mig(); return o.refs ?? []; } }],
    [t.procedureNotes, { select: () => o.notes ?? [] }],
    [t.caseDocumentReadiness, { select: () => o.cdrs ?? [] }],
    [t.procedureEvents, { select: () => { if (o.procsError) throw new Error("proc read down"); return o.procs ?? []; } }],
    [t.billingReadinessChecks, { select: () => o.readiness ?? [] }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [] }],
    [t.globalPatients, { select: () => o.gpps ?? [gpp()] }],
    [t.memberships, { select: () => o.pcms ?? [pcm()] }],
  ]);
}
async function runAcs(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts, flags: Record<string, boolean> = ALL) {
  const a = await acs();
  return runWithDb(spec(t, o), flags, async () => a.getAcsCanonicalView({ clinicId: 1 }));
}
async function runPcs(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts, flags: Record<string, boolean> = ALL) {
  const p = await pcs();
  return runWithDb(spec(t, o), flags, async () => p.getPcsCanonicalView({ clinicId: 1 }));
}

// ── Stage truth ──
async function testAcsStageVectorTruth() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, {
    cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt()],
    refs: [orderRef(), procRef(), reportRef()], notes: [orderNote(), procNote()], cdrs: [cdr()],
    procs: [proc()], readiness: [readiness()], docs: [billingDoc()],
  });
  assert.equal(r.availability, "available");
  assert.equal(r.rows.length, 1, "one row per case");
  const v = r.rows[0];
  assert.equal(v.adminReview.status, "approved", "(40) admin review stage");
  assert.equal(v.engagement.memberships.length, 1, "(41) engagement membership stage");
  assert.equal(v.appointment.status, "scheduled", "(42) appointment stage");
  assert.equal(v.orderNote.status, "signed", "(43) order note stage from validated source");
  assert.equal(v.procedure.status, "complete", "(44) procedure stage");
  assert.equal(v.report.status, "uploaded", "(45) report stage from validated source");
  assert.equal(v.procedureNote.status, "signed", "(46) procedure note stage");
  assert.equal(v.signature.status, "signed", "(47) signature from exact note source");
  assert.equal(v.billingReadiness.status, "ready_to_generate", "(48) billing readiness stage");
  assert.equal(v.billingDocument.status, "generated", "(49) billing document stage");
  assert.equal(v.currentStage, null, "(63) fully complete → currentStage null (resolved)");
  assert.equal(v.currentStageIntegrity, "resolved");
}

// (43/16) order note with a WRONG-case source is rejected (status null + warning), never false
async function testOrderNoteWrongSourceRejected() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], refs: [orderRef()], notes: [orderNote({ ancillaryCaseId: 6 })] });
  assert.equal(r.rows[0].orderNote.status, null, "(43) cross-case order-note source → no false stage");
  assert.ok(r.rows[0].orderNote.warnings.some((w) => w.startsWith("order_note_cross_case_source")));
}

// (45) report with unresolved episode is rejected
async function testReportEpisodeRejected() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], refs: [reportRef({ executionCaseId: null, patientScreeningId: null })], cdrs: [cdr({ executionCaseId: null, patientScreeningId: null })] });
  assert.equal(r.rows[0].report.status, null, "(45) unresolved-episode report → no false stage");
  assert.ok(r.rows[0].report.warnings.some((w) => w.startsWith("report_episode_unresolved")));
}

// (50) superseded billing readiness excluded (fake returns it, in-memory filter drops it)
async function testSupersededExcluded() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], readiness: [readiness({ supersededAt: OLD })] });
  assert.equal(r.rows[0].billingReadiness.status, null, "(50) superseded readiness not shown as current");
}

// (21/50) cross-clinic readiness/billing-doc rows dropped by the in-memory
// tenancy re-check (defense-in-depth: the fake db ignores the SQL clinic filter).
async function testCrossClinicReadinessDropped() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], readiness: [readiness({ clinicId: 2 })], docs: [billingDoc({ clinicId: 2 })] });
  assert.equal(r.rows[0].billingReadiness.status, null, "(21) cross-clinic readiness never attached");
  assert.equal(r.rows[0].billingDocument.status, null, "(21) cross-clinic billing document never attached");
}

// (51) terminal procedure preserved + halts currentStage at procedure
async function testTerminalProcedure() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt()], refs: [orderRef()], notes: [orderNote()], procs: [proc({ procedureStatus: "cancelled", completedAt: null })] });
  assert.equal(r.rows[0].procedure.status, "cancelled", "(51) terminal state preserved");
  assert.equal(r.rows[0].currentStage, "procedure", "(52/63) terminal procedure halts at procedure, not advanced");
}

// (52/53) missing source → stage available with null status (not success), currentStage stops there
async function testMissingSourceNotSuccess() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ adminReviewStatus: "approved" })], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [] });
  assert.equal(r.rows[0].appointment.status, null, "(53) missing appointment → null, not success");
  assert.equal(r.rows[0].currentStage, "appointment", "(52) currentStage stops at first incomplete");
}

// (54) claim blockers preserved separately from billing blockers
async function testBlockersSeparate() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], readiness: [readiness({ billingBlockers: [{ code: "order_note_unsigned" }], claimBlockers: [{ code: "prior_auth" }] })] });
  assert.ok(r.rows[0].billingReadiness.billingBlockers.some((b) => b.code === "order_note_unsigned"));
  assert.ok(r.rows[0].billingReadiness.claimBlockers.some((b) => b.code === "prior_auth"));
}

// (72) upstream flag disabled reported truthfully per stage
async function testUpstreamFlagOff() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()] }, { ...ALL, canonicalAppointment: false, unifiedAncillaryDocuments: false });
  assert.equal(r.rows[0].appointment.availability, "upstream_flag_off", "(72) appointment upstream off");
  assert.equal(r.rows[0].orderNote.availability, "upstream_flag_off", "(72) documents upstream off");
  assert.equal(r.rows[0].adminReview.availability, "available", "admin review still available");
}

// (73) one failed section does not falsify others (ordinary procedure read failure).
// With every stage BEFORE procedure complete, the failed procedure stage is the
// first non-available stage → no false current stage (conflicting), not a zero.
async function testOneSectionFailure() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, {
    cases: [acase()], procsError: true, adminEvents: [adminEvent()],
    lists: [list()], memberships: [membership()], appts: [appt()], refs: [orderRef()], notes: [orderNote()],
  });
  assert.equal(r.rows[0].procedure.availability, "unavailable", "(71/73) failed procedure stage → unavailable");
  assert.equal(r.rows[0].adminReview.availability, "available", "other stages intact");
  assert.equal(r.rows[0].orderNote.status, "signed", "earlier stages resolved from live data");
  assert.equal(r.rows[0].currentStage, null, "(52) a failed stage yields no false current stage");
  assert.equal(r.rows[0].currentStageIntegrity, "conflicting");
}

// ── Identity + episode preservation ──
async function testPcsIdentityAndEpisodes() {
  const t = await loadCanonicalTables();
  const r = await runPcs(t, {
    // one patient (gpp 900 / pcm 800) with TWO same-service BrainWave episodes.
    cases: [acase({ id: 5 }), acase({ id: 9 })],
    gpps: [gpp()], pcms: [pcm()],
  });
  assert.equal(r.rows.length, 1, "(55) grouped under one exact patient identity");
  assert.equal(r.rows[0].globalPlexusPatientId, 900);
  assert.equal(r.rows[0].patientDisplay, "Jane Doe", "(31) authorized display resolved from ids");
  assert.equal(r.rows[0].episodes.length, 2, "(33/56) two same-service episodes kept separate");
  assert.deepEqual(r.rows[0].episodes.map((e) => e.ancillaryCaseId), [5, 9]);
}

// (34) two patients with the same display name remain distinct groups
async function testSameNameDistinct() {
  const t = await loadCanonicalTables();
  const r = await runPcs(t, {
    cases: [acase({ id: 5, globalPlexusPatientId: 900, patientClinicMembershipId: 800 }), acase({ id: 9, globalPlexusPatientId: 901, patientClinicMembershipId: 801 })],
    gpps: [gpp({ id: 900, displayName: "John Smith" }), gpp({ id: 901, displayName: "John Smith" })],
    pcms: [pcm({ id: 800 }), pcm({ id: 801, clinicMrn: "MRN-2" })],
  });
  assert.equal(r.rows.length, 2, "(34) same-name patients remain distinct by exact identity");
  assert.deepEqual(r.rows.map((g) => g.globalPlexusPatientId), [900, 901]);
}

// (57) missing patient identity does not merge by demographics
async function testMissingIdentityNoMerge() {
  const t = await loadCanonicalTables();
  const r = await runPcs(t, {
    cases: [acase({ id: 5, globalPlexusPatientId: null, patientClinicMembershipId: null }), acase({ id: 9, globalPlexusPatientId: null, patientClinicMembershipId: null })],
    gpps: [], pcms: [],
  });
  assert.equal(r.rows.length, 2, "(32/57) missing-identity cases never merged by demographics");
  assert.ok(r.rows.every((g) => !g.identityAvailable));
}

// (21/22/23) cross-clinic cases excluded
async function testCrossClinicExcluded() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ id: 5, clinicId: 1 }), acase({ id: 9, clinicId: 2 })] });
  assert.equal(r.rows.length, 1, "(22) cross-clinic ancillary case excluded");
  assert.equal(r.rows[0].ancillaryCaseId, 5);
}

// ── Pagination + bounds ──
async function testAcsPaginationBounds() {
  const t = await loadCanonicalTables();
  const p = await acs();
  const r = await runWithDb(spec(t, { cases: [acase({ id: 7 }), acase({ id: 3 }), acase({ id: 5 })] }), ALL, async () => p.getAcsCanonicalView({ clinicId: 1, limit: 2 }));
  assert.equal(r.rows.length, 2, "(60/67) bounded to limit");
  assert.deepEqual(r.rows.map((x) => x.ancillaryCaseId), [3, 5], "(38) deterministic ascending order + bounded page");
  assert.ok(r.pageInfo.nextCursor, "(38) nextCursor emitted when more remain");
}
async function testCursorRoundTrip() {
  const q = await viewQuery();
  const enc = q.encodeCursor(42);
  assert.equal(q.decodeCursor(enc), 42, "(38) opaque cursor round-trips");
  assert.equal(q.decodeCursor("not a number"), null, "invalid cursor rejected");
  assert.equal(q.decodeCursor(null), null);
}
async function testLimitClamp() {
  const t = await loadCanonicalTables();
  const p = await acs();
  const r = await runWithDb(spec(t, { cases: [acase()] }), ALL, async () => p.getAcsCanonicalView({ clinicId: 1, limit: 100000 }));
  assert.ok(r.pageInfo.limit <= 100, "(60) hard max limit enforced");
}

// (29) batched source reads — no per-row N+1 across many cases
async function testBatchedReads() {
  const t = await loadCanonicalTables();
  const p = await acs();
  await runWithDb(spec(t, {
    cases: [acase({ id: 5 }), acase({ id: 6 }), acase({ id: 7 })],
    refs: [orderRef({ ancillaryCaseId: 5 }), orderRef({ id: 11, ancillaryCaseId: 6 }), orderRef({ id: 12, ancillaryCaseId: 7 })],
    notes: [orderNote({ id: 1 }), orderNote({ id: 11, ancillaryCaseId: 6 }), orderNote({ id: 12, ancillaryCaseId: 7 })],
  }), ALL, async (calls: Call[]) => {
    await p.getAcsCanonicalView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.documentReferences), 1, "(29) one batched references read for many cases");
    assert.equal(countOps(calls, "select", t.procedureNotes), 1, "(29) one batched notes read for many cases");
  });
}

// ── Flags OFF ──
async function testSectionFlagOff() {
  const t = await loadCanonicalTables();
  const rAcs = await runAcs(t, { cases: [acase()] }, { ...ALL, ancillaryCaseWrite: false });
  assert.equal(rAcs.availability, "upstream_flag_off", "(72) ACS upstream (2B) off → truthful");
  assert.equal(rAcs.rows.length, 0);
}

// ── Route: flags OFF disabled contract + zero reads ──
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(handlers: Function[], req: unknown, res: unknown) { for (const h of handlers) { let nexted = false; await h(req, res, () => { nexted = true; }); if (!nexted) return; } }
async function handlers(path: string) { const { app, map } = fakeApp(); (await routes()).registerPcsAcsCanonicalRoutes(app); return map[`GET ${path}`]; }

async function testRouteFlagOffZeroReads() {
  const t = await loadCanonicalTables();
  for (const [path, flagKey] of [["/api/pcs/canonical-view", "pcsCanonicalView"], ["/api/acs/canonical-view", "acsCanonicalView"]] as const) {
    const h = await handlers(path); const res = mockRes();
    const role = path.includes("pcs") ? "liaison" : "technician";
    await runWithDb(spec(t, {}), { [flagKey]: false }, async (calls: Call[]) => {
      await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res);
      assert.equal(countOps(calls, "select"), 0, `(5/6) ${path} flag OFF → zero canonical reads`);
    });
    assert.equal((res.body as { disabled: boolean }).disabled, true, `${path} disabled contract`);
  }
}

// (25-30) role guard preserves PCS≠ACS authorized roles + clinic scope
async function testRouteAuth() {
  const pcsH = await handlers("/api/pcs/canonical-view");
  const acsH = await handlers("/api/acs/canonical-view");
  const check = async (h: Function[], session: unknown, clinicId: unknown, expect: number) => {
    const res = mockRes();
    await runWithDb(new Map(), { pcsCanonicalView: true, acsCanonicalView: true }, async () => { await invoke(h, { session, clinicId }, res); });
    return res.statusCode === expect || (expect === 200 && res.statusCode === 200);
  };
  assert.ok(await check(pcsH, {}, 1, 401), "(unauth) → 401");
  assert.ok(await check(pcsH, { userId: "u" }, 1, 403), "(25) missing role → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "wizard" }, 1, 403), "(26) unknown role → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "biller" }, 1, 403), "(27) biller → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "technician" }, 1, 403), "(28/29) technician denied on PCS (roles not unified)");
  assert.ok(await check(acsH, { userId: "u", role: "liaison" }, 1, 403), "(28/29) liaison denied on ACS (roles not unified)");
  assert.ok(await check(pcsH, { userId: "u", role: "clinician" }, 1, 403), "clinician → 403");
  // clinic scope required
  assert.ok(await check(pcsH, { userId: "u", role: "liaison" }, null, 403), "(30) missing clinic scope → 403");
  assert.ok(await check(acsH, { userId: "u", role: "technician" }, null, 403), "(30) missing clinic scope → 403");
}
async function testRouteAllowedRoles() {
  const t = await loadCanonicalTables();
  const pcsH = await handlers("/api/pcs/canonical-view");
  const acsH = await handlers("/api/acs/canonical-view");
  for (const [h, role] of [[pcsH, "liaison"], [pcsH, "admin"], [acsH, "technician"], [acsH, "admin"]] as const) {
    const res = mockRes();
    await runWithDb(spec(t, {}), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); });
    assert.equal(res.statusCode, 200, `(28/29) ${role} allowed`);
    assert.equal((res.body as { disabled: boolean }).disabled, false);
  }
}

// (68/69) migration missing → 503; (70/71) ordinary section failure stays 200
async function testRouteMigration503() {
  const t = await loadCanonicalTables();
  for (const [path, role, migKey] of [["/api/pcs/canonical-view", "liaison", "casesMigration"], ["/api/acs/canonical-view", "technician", "casesMigration"], ["/api/acs/canonical-view", "technician", "refsMigration"]] as const) {
    const h = await handlers(path); const res = mockRes();
    await runWithDb(spec(t, { cases: [acase()], [migKey]: true } as Opts), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); });
    assert.equal(res.statusCode, 503, `(68/69) ${path} ${migKey} → 503`);
    assert.equal((res.body as { code: string }).code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING");
  }
}
async function testRouteOrdinaryFailure200() {
  const t = await loadCanonicalTables();
  const h = await handlers("/api/acs/canonical-view"); const res = mockRes();
  await runWithDb(spec(t, { cases: [acase()], procsError: true }), ALL, async () => { await invoke(h, { session: { userId: "u", role: "technician" }, clinicId: 1, query: {} }, res); });
  assert.equal(res.statusCode, 200, "(70/71) ordinary section failure stays 200");
  const body = res.body as { rows: { procedure: { availability: string } }[] };
  assert.equal(body.rows[0].procedure.availability, "unavailable", "failed stage unavailable, not zero");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["ACS stage-vector truth", testAcsStageVectorTruth],
  ["(43/16) order-note wrong source rejected", testOrderNoteWrongSourceRejected],
  ["(45) report episode rejected", testReportEpisodeRejected],
  ["(50) superseded readiness excluded", testSupersededExcluded],
  ["(21) cross-clinic readiness/doc dropped in-memory", testCrossClinicReadinessDropped],
  ["(51/52) terminal procedure halts", testTerminalProcedure],
  ["(52/53) missing source not success", testMissingSourceNotSuccess],
  ["(54) claim vs billing blockers separate", testBlockersSeparate],
  ["(72) upstream flag off truthful", testUpstreamFlagOff],
  ["(73) one section failure isolates", testOneSectionFailure],
  ["(55/33/56) PCS identity + episodes", testPcsIdentityAndEpisodes],
  ["(34) same-name distinct", testSameNameDistinct],
  ["(32/57) missing identity no merge", testMissingIdentityNoMerge],
  ["(22) cross-clinic excluded", testCrossClinicExcluded],
  ["(38/60/67) ACS pagination bounds", testAcsPaginationBounds],
  ["(38) cursor round-trip", testCursorRoundTrip],
  ["(60) limit clamp", testLimitClamp],
  ["(29) batched reads no N+1", testBatchedReads],
  ["(72) section flag off", testSectionFlagOff],
  ["(5/6) route flag off zero reads", testRouteFlagOffZeroReads],
  ["(25-30) route auth roles + scope", testRouteAuth],
  ["(28/29) allowed roles", testRouteAllowedRoles],
  ["(68/69) migration 503", testRouteMigration503],
  ["(70/71) ordinary failure 200", testRouteOrdinaryFailure200],
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

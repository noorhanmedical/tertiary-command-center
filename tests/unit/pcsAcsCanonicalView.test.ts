// Phase 2I final acceptance — identity-invalid visibility, episode retrievability,
// admin/appointment/billing terminal & version truth, availability integrity.
//
//   npx tsx tests/unit/pcsAcsCanonicalView.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const pcs = () => import("../../server/services/pcs/pcsCanonicalView");
const acs = () => import("../../server/services/acs/acsCanonicalView");
const routes = () => import("../../server/routes/pcsAcsCanonical");
const identity = () => import("../../server/services/pcs/pcsIdentity");

const OLD = new Date("2027-06-10T09:00:00Z");
const NEWER = new Date("2027-07-01T09:00:00Z");
const ALL = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  serviceSpecificAdminReview: true, engagementAdminReviewSync: true,
  pcsCanonicalView: true, acsCanonicalView: true,
} as const;

function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved", globalPlexusPatientId: 900, patientClinicMembershipId: 800, executionCaseId: 70, originatingScreeningId: 77, ...o }; }
function adminEvent(o: Record<string, unknown> = {}) { return { id: 1, ancillaryCaseId: 5, serviceType: "BrainWave", newStatus: "approved", actualReviewedAt: OLD, source: "manual", ...o }; }
function list(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, sourceType: "admin_review", sourceId: "s-100", label: "Batch A", sentToEngagementAt: OLD, ...o }; }
function membership(o: Record<string, unknown> = {}) { return { id: 200, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "active", ...o }; }
function appt(o: Record<string, unknown> = {}) { return { id: 300, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "ancillary_appointment", status: "scheduled", startsAt: OLD, parentEventId: null, ...o }; }
function orderRef(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", documentStatus: "signed", serviceType: "BrainWave", sourceTable: "procedure_notes", sourceId: 1, executionCaseId: 70, patientScreeningId: 77, signedAt: OLD, effectiveClinicalDate: OLD, actualCreatedAt: OLD, supersededAt: null, ...o }; }
function orderNote(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, generationStatus: "generated", supersededAt: null, ...o }; }
function procRef(o: Record<string, unknown> = {}) { return orderRef({ id: 2, documentKind: "procedure_note", documentStatus: "signed", sourceId: 2, ...o }); }
function procNote(o: Record<string, unknown> = {}) { return orderNote({ id: 2, noteType: "post_procedure_note", ...o }); }
function reportRef(o: Record<string, unknown> = {}) { return orderRef({ id: 3, documentKind: "report", documentStatus: "uploaded", sourceTable: "case_document_readiness", sourceId: 3, ...o }); }
function cdr(o: Record<string, unknown> = {}) { return { id: 3, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", executionCaseId: 70, patientScreeningId: 77, ...o }; }
function proc(o: Record<string, unknown> = {}) { return { id: 400, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", procedureStatus: "complete", completedAt: OLD, lastTransitionAt: OLD, updatedAt: OLD, ...o }; }
function readiness(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evaluatedAt: OLD, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: null, reportDocumentReferenceId: null, procedureNoteDocumentReferenceId: null, billingBlockers: [], claimBlockers: [], ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, generatedAt: OLD, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: null, reportDocumentReferenceId: null, procedureNoteDocumentReferenceId: null, ...o }; }
function gpp(o: Record<string, unknown> = {}) { return { id: 900, displayName: "Jane Doe", dob: "1980-01-01", identityStatus: "active", mergedIntoPatientId: null, ...o }; }
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active", clinicMrn: "MRN-1", ...o }; }

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
async function runPcs(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts, extra: Record<string, unknown> = {}, flags: Record<string, boolean> = ALL) {
  const p = await pcs();
  return runWithDb(spec(t, o), flags, async () => p.getPcsCanonicalView({ clinicId: 1, ...extra }));
}
const acsRow0 = (r: Awaited<ReturnType<typeof runAcs>>) => r.rows[0];

// ═══ ACS stage-vector truth (admin fail-closed w/ agreeing event) ═══
async function testAcsStageVectorTruth() {
  const t = await loadCanonicalTables();
  const v = acsRow0(await runAcs(t, { cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt()], refs: [orderRef(), procRef(), reportRef()], notes: [orderNote(), procNote()], cdrs: [cdr()], procs: [proc()], readiness: [readiness()], docs: [billingDoc()] }));
  assert.equal(v.adminReview.status, "approved"); assert.equal(v.adminReview.available, true); assert.equal(v.adminReview.integrity, "resolved");
  assert.equal(v.appointment.status, "scheduled"); assert.equal(v.orderNote.status, "signed"); assert.equal(v.procedure.status, "complete");
  assert.equal(v.report.status, "uploaded"); assert.equal(v.procedureNote.status, "signed"); assert.equal(v.signature.status, "signed");
  assert.equal(v.billingReadiness.status, "ready_to_generate"); assert.equal(v.billingDocument.status, "generated");
  assert.equal(v.currentStage, null); assert.equal(v.currentStageIntegrity, "resolved");
}

// ═══ §8 Identity visibility (1-9) ═══
async function testIdentityResolver() {
  const id = await identity();
  const cases: Array<[Record<string, unknown>, string | null]> = [
    [{ membership: pcm(), globalPatient: gpp() }, null],
    [{ membership: pcm({ globalPlexusPatientId: 900 }), globalPatient: gpp(), caseGlobalPatientId: 901 }, "identity_patient_membership_conflict"],
    [{ membership: pcm({ clinicId: 2 }), globalPatient: gpp() }, "identity_membership_wrong_clinic"],
    [{ membership: pcm({ membershipStatus: "withdrawn" }), globalPatient: gpp() }, "identity_membership_inactive"],
    [{ membership: undefined, globalPatient: undefined, caseMembershipId: null }, "identity_membership_missing"],
    [{ membership: pcm(), globalPatient: undefined }, "identity_global_patient_missing"],
    [{ membership: pcm(), globalPatient: gpp({ mergedIntoPatientId: 950 }) }, "identity_global_patient_not_current"],
    [{ membership: pcm(), globalPatient: gpp({ identityStatus: "inactive" }) }, "identity_global_patient_not_current"],
  ];
  for (const [args, warn] of cases) {
    const res = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, ...(args as Record<string, never>) });
    if (warn == null) { assert.equal(res.resolved, true); assert.equal(res.patientDisplay, "Jane Doe"); }
    else { assert.equal(res.resolved, false); assert.equal(res.patientDisplay, null, `${warn} exposes no PHI`); assert.ok(res.warnings.includes(warn), `expected ${warn}`); }
  }
}
// (1-9) same-clinic invalid-membership cases are SURFACED in the unresolved stream
async function testInvalidMembershipCasesSurfaced() {
  const t = await loadCanonicalTables();
  const cases = [
    acase({ id: 5, patientClinicMembershipId: 800, globalPlexusPatientId: 900 }),          // verified
    acase({ id: 6, patientClinicMembershipId: null, globalPlexusPatientId: null }),          // null membership
    acase({ id: 7, patientClinicMembershipId: 810, globalPlexusPatientId: 900 }),            // membership missing
    acase({ id: 8, patientClinicMembershipId: 820, globalPlexusPatientId: 900 }),            // inactive membership
    acase({ id: 9, patientClinicMembershipId: 830, globalPlexusPatientId: 900 }),            // wrong-clinic membership
    acase({ id: 10, patientClinicMembershipId: 840, globalPlexusPatientId: 901 }),           // patient/membership conflict
  ];
  const pcms = [
    pcm({ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }),
    pcm({ id: 820, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "withdrawn" }),
    pcm({ id: 830, clinicId: 2, globalPlexusPatientId: 900, membershipStatus: "active" }),
    pcm({ id: 840, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }),
  ];
  const r = await runPcs(t, { cases, pcms, gpps: [gpp({ id: 900 })] });
  const unresolvedIds = r.unresolved.rows.map((g) => g.episodes[0]?.ancillaryCaseId).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(unresolvedIds, [6, 7, 8, 9, 10], "(1-7) every invalid-membership same-clinic case surfaced, not dropped");
  assert.ok(r.unresolved.rows.every((g) => !g.identityAvailable && g.patientDisplay == null && g.clinicMrn == null), "(9) no PHI for unresolved");
  assert.ok(r.unresolved.rows.every((g) => g.episodes.length === 1), "(8) each unresolved case separate by ancillaryCaseId");
  // verified stream holds only the verified patient (case 5)
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].episodes[0].ancillaryCaseId, 5); assert.equal(r.rows[0].patientDisplay, "Jane Doe");
}

// ═══ §8 Pagination (10-15) ═══
async function testEpisodeContinuation() {
  const t = await loadCanonicalTables();
  // one verified patient with 150 episodes (> per-patient bound 100)
  const many = Array.from({ length: 150 }, (_, i) => acase({ id: 1000 + i, patientClinicMembershipId: 800, globalPlexusPatientId: 900 }));
  const p1 = await runPcs(t, { cases: many, pcms: [pcm()], gpps: [gpp()] });
  const g = p1.rows[0];
  assert.equal(g.episodes.length, 100, "(11) per-patient episode bound = 100");
  assert.ok(g.episodesNextCursor, "(10) verified patient over the bound has a retrievable continuation cursor");
  const p2 = await runPcs(t, { cases: many, pcms: [pcm()], gpps: [gpp()] }, { episodeMembershipId: 800, episodeCursor: g.episodesNextCursor });
  assert.equal(p2.rows.length, 1); assert.equal(p2.rows[0].episodes.length, 50, "(11) remaining 50 episodes retrievable");
  assert.deepEqual(p2.rows[0].episodes.map((e) => e.ancillaryCaseId), many.slice(100).map((c) => c.id));
}
async function testUnresolvedContinuation() {
  const t = await loadCanonicalTables();
  const many = Array.from({ length: 60 }, (_, i) => acase({ id: 2000 + i, patientClinicMembershipId: null, globalPlexusPatientId: null }));
  const page1 = await runPcs(t, { cases: many, pcms: [] });
  assert.equal(page1.unresolved.rows.length, 50, "(12) first unresolved page bounded");
  assert.ok(page1.unresolved.pageInfo.nextCursor, "(12) unresolved beyond first page is retrievable");
  const page2 = await runPcs(t, { cases: many, pcms: [] }, { unresolvedCursor: page1.unresolved.pageInfo.nextCursor });
  assert.equal(page2.unresolved.rows.length, 10, "(12) remaining unresolved retrievable");
  assert.deepEqual(page2.unresolved.rows.map((g) => g.episodes[0].ancillaryCaseId), many.slice(50).map((c) => c.id));
}
async function testCursorsDistinct() {
  const t = await loadCanonicalTables();
  // verified member 800 (id cursor) + unresolved null cases; verify separate cursors
  const cases = [acase({ id: 5, patientClinicMembershipId: 800 }), acase({ id: 6, patientClinicMembershipId: null, globalPlexusPatientId: null })];
  const r = await runPcs(t, { cases, pcms: [pcm({ id: 800 })], gpps: [gpp()] });
  // membership cursor is null here (only one member ≤ limit); unresolved cursor null (one case ≤ limit)
  assert.equal(r.pageInfo.nextCursor, null); assert.equal(r.unresolved.pageInfo.nextCursor, null, "(13) verified & unresolved cursors are independent fields");
  assert.equal(r.rows.length, 1); assert.equal(r.unresolved.rows.length, 1);
}

// ═══ §8 Admin Review (16-20) ═══
async function testAdminReview() {
  const t = await loadCanonicalTables();
  const ok = acsRow0(await runAcs(t, { cases: [acase({ adminReviewStatus: "approved" })], adminEvents: [adminEvent({ newStatus: "approved" })] }));
  assert.equal(ok.adminReview.status, "approved"); assert.equal(ok.adminReview.available, true); assert.equal(ok.adminReview.at, OLD.toISOString(), "(16) exact event pair qualifies");
  const tied = acsRow0(await runAcs(t, { cases: [acase()], adminEvents: [adminEvent({ id: 1, newStatus: "approved", actualReviewedAt: OLD }), adminEvent({ id: 2, newStatus: "rejected", actualReviewedAt: OLD })] }));
  assert.equal(tied.adminReview.status, null); assert.equal(tied.adminReview.integrity, "conflicting"); assert.ok(tied.adminReview.warnings.includes("admin_review_event_conflict"), "(17)");
  assert.equal(tied.currentStage, null); assert.equal(tied.currentStageIntegrity, "conflicting", "(20) admin conflict blocks currentStage");
  const mismatch = acsRow0(await runAcs(t, { cases: [acase({ adminReviewStatus: "approved" })], adminEvents: [adminEvent({ newStatus: "rejected" })] }));
  assert.equal(mismatch.adminReview.integrity, "conflicting"); assert.ok(mismatch.adminReview.warnings.includes("admin_review_event_projection_mismatch"), "(18)");
  // (19) source read failure → unavailable (adminReviewEvents throws) — simulate via casesMigration? Use a dedicated read failure:
  const failSpec = spec(t, { cases: [acase()] });
  failSpec.set(t.adminReviewEvents, { select: () => { throw new Error("admin read down"); } });
  const p = await acs();
  const failRow = (await runWithDb(failSpec, ALL, async () => p.getAcsCanonicalView({ clinicId: 1 }))).rows[0];
  assert.equal(failRow.adminReview.availability, "unavailable"); assert.equal(failRow.adminReview.available, false, "(19) admin read failure → unavailable");
  assert.equal(failRow.currentStageIntegrity, "conflicting");
}

// ═══ §8 Appointment (21-25) ═══
async function testAppointmentTerminal() {
  const t = await loadCanonicalTables();
  for (const status of ["scheduled", "completed", "cancelled", "no_show", "blocked", "pending_sync"] as const) {
    const v = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ status, cancellationReason: status === "cancelled" ? "x" : null, noShowReason: status === "no_show" ? "x" : null })] }));
    assert.equal(v.appointment.status, status, `(21/22) ${status} appointment displayed (not missing)`);
    assert.equal(v.appointment.available, true);
  }
  // (23) terminal appointment does not advance past appointment
  const term = acsRow0(await runAcs(t, { cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt({ status: "cancelled", cancellationReason: "x" })] }));
  assert.equal(term.currentStage, "appointment", "(23) cancelled appointment halts at appointment");
  // (24) reschedule lineage → the leaf is current
  const lineage = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ id: 300, status: "rescheduled" }), appt({ id: 301, status: "scheduled", parentEventId: 300 })] }));
  assert.equal(lineage.appointment.sourceId, 301, "(24) exact lineage resolves the current leaf");
  // (25) multiple independent leaves → conflict
  const dup = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ id: 300 }), appt({ id: 301 })] }));
  assert.equal(dup.appointment.integrity, "conflicting"); assert.ok(dup.appointment.warnings.includes("duplicate_current_evidence"), "(25)");
  // wrong-service terminal event rejected
  const wrong = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ status: "cancelled", serviceType: "VitalWave" })] }));
  assert.equal(wrong.appointment.status, null); assert.ok(wrong.appointment.warnings.includes("appointment_wrong_service"));
}

// ═══ §8 Billing Document (26-31) ═══
async function testBillingDocVersion() {
  const t = await loadCanonicalTables();
  const good = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ id: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11 })], docs: [billingDoc({ billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11 })] }));
  assert.equal(good.billingDocument.status, "generated", "(26) exact non-null id+fingerprint+refs qualifies");
  const rNull = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ evidenceFingerprint: null })], docs: [billingDoc({ evidenceFingerprint: "fp-1" })] }));
  assert.ok(rNull.billingDocument.warnings.includes("billing_document_fingerprint_unresolved"), "(27) null readiness fingerprint rejected");
  const dNull = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ evidenceFingerprint: "fp-1" })], docs: [billingDoc({ evidenceFingerprint: null })] }));
  assert.ok(dNull.billingDocument.warnings.includes("billing_document_fingerprint_unresolved"), "(28) null document fingerprint rejected");
  const bothNull = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ evidenceFingerprint: null })], docs: [billingDoc({ evidenceFingerprint: null })] }));
  assert.equal(bothNull.billingDocument.status, null); assert.ok(bothNull.billingDocument.warnings.includes("billing_document_fingerprint_unresolved"), "(29) NULL=NULL is never version proof");
  const stale = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ evidenceFingerprint: "fp-2" })], docs: [billingDoc({ evidenceFingerprint: "fp-OLD" })] }));
  assert.ok(stale.billingDocument.warnings.includes("billing_document_stale_fingerprint"), "(30)");
  const refMismatch = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ orderNoteDocumentReferenceId: 11 })], docs: [billingDoc({ orderNoteDocumentReferenceId: 99 })] }));
  assert.ok(refMismatch.billingDocument.warnings.includes("billing_document_reference_mismatch"), "(31) mismatched exact document-reference IDs rejected");
}

// ═══ regression (32-39) ═══
async function testServiceRegression() {
  const t = await loadCanonicalTables();
  const rOn = acsRow0(await runAcs(t, { cases: [acase()], refs: [orderRef({ serviceType: "VitalWave" })], notes: [orderNote({ serviceType: "VitalWave" })] }));
  assert.equal(rOn.orderNote.status, null); assert.ok(rOn.orderNote.warnings.includes("order_note_wrong_service"), "(32) exact service validation intact");
}
async function testConflictRegression() {
  const t = await loadCanonicalTables();
  const dup = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ id: 500 }), readiness({ id: 501 })] }));
  assert.ok(dup.billingReadiness.warnings.includes("duplicate_current_evidence"), "(33) duplicate readiness conflict intact");
}
async function testAcsRepeatedSeparate() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ id: 5 }), acase({ id: 9 })] });
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map((x) => x.ancillaryCaseId), [5, 9], "(34)");
}
async function testReportEpisodeRegression() {
  const t = await loadCanonicalTables();
  const r = acsRow0(await runAcs(t, { cases: [acase()], refs: [reportRef({ executionCaseId: null, patientScreeningId: null })], cdrs: [cdr({ executionCaseId: null, patientScreeningId: null })] }));
  assert.ok(r.report.warnings.includes("report_episode_unresolved"), "(35)");
}
async function testCrossClinicExcluded() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ id: 5, clinicId: 1 }), acase({ id: 9, clinicId: 2 })] });
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].ancillaryCaseId, 5);
}
async function testBatchedReads() {
  const t = await loadCanonicalTables();
  const p = await acs();
  await runWithDb(spec(t, { cases: [acase({ id: 5 }), acase({ id: 6 }), acase({ id: 7 })], refs: [orderRef({ ancillaryCaseId: 5 }), orderRef({ id: 11, ancillaryCaseId: 6 }), orderRef({ id: 12, ancillaryCaseId: 7 })], notes: [orderNote({ id: 1 }), orderNote({ id: 11, ancillaryCaseId: 6 }), orderNote({ id: 12, ancillaryCaseId: 7 })] }), ALL, async (calls: Call[]) => {
    await p.getAcsCanonicalView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.documentReferences), 1, "batched references read");
    assert.equal(countOps(calls, "select", t.procedureNotes), 1, "batched notes read");
  });
}

// ═══ route auth / flags / migration (36/37/39) ═══
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(handlers: Function[], req: unknown, res: unknown) { for (const h of handlers) { let nexted = false; await h(req, res, () => { nexted = true; }); if (!nexted) return; } }
async function handlers(path: string) { const { app, map } = fakeApp(); (await routes()).registerPcsAcsCanonicalRoutes(app); return map[`GET ${path}`]; }
async function testRouteAuthAndFlags() {
  const t = await loadCanonicalTables();
  const pcsH = await handlers("/api/pcs/canonical-view"); const acsH = await handlers("/api/acs/canonical-view");
  const check = async (h: Function[], session: unknown, clinicId: unknown, expect: number) => {
    const res = mockRes();
    await runWithDb(new Map(), { pcsCanonicalView: true, acsCanonicalView: true }, async () => { await invoke(h, { session, clinicId, query: {} }, res); });
    return res.statusCode === expect;
  };
  assert.ok(await check(pcsH, {}, 1, 401), "unauth 401");
  assert.ok(await check(pcsH, { userId: "u" }, 1, 403), "(36) missing role");
  assert.ok(await check(pcsH, { userId: "u", role: "technician" }, 1, 403), "(36) technician denied on PCS");
  assert.ok(await check(acsH, { userId: "u", role: "liaison" }, 1, 403), "(36) liaison denied on ACS");
  assert.ok(await check(pcsH, { userId: "u", role: "liaison" }, null, 403), "missing clinic scope");
  // flag off zero reads
  const res = mockRes();
  await runWithDb(spec(t, {}), { pcsCanonicalView: false }, async (calls: Call[]) => { await invoke(pcsH, { session: { userId: "u", role: "liaison" }, clinicId: 1, query: {} }, res); assert.equal(countOps(calls, "select"), 0, "flag off zero reads"); });
  assert.equal((res.body as { disabled: boolean }).disabled, true);
}
async function testRouteMigration503() {
  const t = await loadCanonicalTables();
  for (const [path, role] of [["/api/pcs/canonical-view", "liaison"], ["/api/acs/canonical-view", "technician"]] as const) {
    const h = await handlers(path); const res = mockRes();
    await runWithDb(spec(t, { cases: [acase()], casesMigration: true }), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); });
    assert.equal(res.statusCode, 503, `(37) ${path} migration → 503`);
    assert.equal((res.body as { code: string }).code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING");
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["ACS stage-vector truth", testAcsStageVectorTruth],
  ["(1-9) identity resolver", testIdentityResolver],
  ["(1-9) invalid-membership cases surfaced", testInvalidMembershipCasesSurfaced],
  ["(10/11) verified episode continuation", testEpisodeContinuation],
  ["(12) unresolved continuation", testUnresolvedContinuation],
  ["(13) cursors distinct", testCursorsDistinct],
  ["(16-20) admin review fail-closed", testAdminReview],
  ["(21-25) appointment terminal + lineage", testAppointmentTerminal],
  ["(26-31) billing document non-null version", testBillingDocVersion],
  ["(32) service regression", testServiceRegression],
  ["(33) conflict regression", testConflictRegression],
  ["(34) ACS repeated same-service separate", testAcsRepeatedSeparate],
  ["(35) report episode regression", testReportEpisodeRegression],
  ["cross-clinic excluded", testCrossClinicExcluded],
  ["batched reads no N+1", testBatchedReads],
  ["(36) route auth + flags", testRouteAuthAndFlags],
  ["(37) migration 503", testRouteMigration503],
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

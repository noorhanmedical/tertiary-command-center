// Phase 2I truth closeout — stage-vector exact identity/service/version/conflict
// truth, availability semantics, patient-centric PCS pagination, route auth.
//
//   npx tsx tests/unit/pcsAcsCanonicalView.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const pcs = () => import("../../server/services/pcs/pcsCanonicalView");
const acs = () => import("../../server/services/acs/acsCanonicalView");
const routes = () => import("../../server/routes/pcsAcsCanonical");
const identity = () => import("../../server/services/pcs/pcsIdentity");
const viewQuery = () => import("../../server/services/canonicalStage/viewQuery");

const OLD = new Date("2027-06-10T09:00:00Z");
const NEWER = new Date("2027-07-01T09:00:00Z");
const ALL = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  serviceSpecificAdminReview: true, engagementAdminReviewSync: true,
  pcsCanonicalView: true, acsCanonicalView: true,
} as const;

// ── builders ──
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
function readiness(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evaluatedAt: OLD, evidenceFingerprint: "fp-1", billingBlockers: [], claimBlockers: [], ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, generatedAt: OLD, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...o }; }
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
async function runPcs(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Opts, flags: Record<string, boolean> = ALL) {
  const p = await pcs();
  return runWithDb(spec(t, o), flags, async () => p.getPcsCanonicalView({ clinicId: 1 }));
}
const acsRow0 = (r: Awaited<ReturnType<typeof runAcs>>) => r.rows[0];

// ═══ Stage-vector truth ═══
async function testAcsStageVectorTruth() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt()], refs: [orderRef(), procRef(), reportRef()], notes: [orderNote(), procNote()], cdrs: [cdr()], procs: [proc()], readiness: [readiness()], docs: [billingDoc()] });
  const v = acsRow0(r);
  assert.equal(v.adminReview.status, "approved"); assert.equal(v.engagement.memberships.length, 1);
  assert.equal(v.appointment.status, "scheduled"); assert.equal(v.orderNote.status, "signed");
  assert.equal(v.procedure.status, "complete"); assert.equal(v.report.status, "uploaded");
  assert.equal(v.procedureNote.status, "signed"); assert.equal(v.signature.status, "signed");
  assert.equal(v.billingReadiness.status, "ready_to_generate"); assert.equal(v.billingDocument.status, "generated", "(18) doc bound to readiness id+fp qualifies");
  assert.equal(v.currentStage, null); assert.equal(v.currentStageIntegrity, "resolved");
  // (32) exact current source → available true
  assert.equal(v.appointment.available, true); assert.equal(v.billingDocument.available, true);
}

// ═══ §9 Identity resolver (1-8) ═══
async function testIdentityResolver() {
  const id = await identity();
  const ok = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, membership: pcm() as never, globalPatient: gpp() as never });
  assert.equal(ok.resolved, true, "(1) exact active membership + matching patient qualifies");
  assert.equal(ok.patientDisplay, "Jane Doe"); assert.equal(ok.clinicMrn, "MRN-1"); assert.equal(ok.groupKey, "900|800");
  const conflict = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 901, caseMembershipId: 800, membership: pcm({ globalPlexusPatientId: 900 }) as never, globalPatient: gpp() as never });
  assert.equal(conflict.resolved, false); assert.ok(conflict.warnings.includes("identity_patient_membership_conflict"), "(2) mismatch rejected");
  const wrongClinic = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, membership: pcm({ clinicId: 2 }) as never, globalPatient: gpp() as never });
  assert.ok(wrongClinic.warnings.includes("identity_membership_wrong_clinic"), "(3) other-clinic membership rejected");
  const inactive = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, membership: pcm({ membershipStatus: "withdrawn" }) as never, globalPatient: gpp() as never });
  assert.ok(inactive.warnings.includes("identity_membership_inactive"), "(4) inactive membership rejected");
  const noMem = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: null, membership: undefined, globalPatient: undefined });
  assert.equal(noMem.resolved, false); assert.equal(noMem.patientDisplay, null, "(5) missing membership exposes no PHI");
  assert.ok(noMem.warnings.includes("identity_membership_missing"));
  const noGpp = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, membership: pcm() as never, globalPatient: undefined });
  assert.ok(noGpp.warnings.includes("identity_global_patient_missing"), "(6) missing global patient → identity unavailable");
  const merged = id.verifyCaseIdentity({ clinicId: 1, caseGlobalPatientId: 900, caseMembershipId: 800, membership: pcm() as never, globalPatient: gpp({ mergedIntoPatientId: 950 }) as never });
  assert.ok(merged.warnings.includes("identity_global_patient_not_current"), "merged-away patient rejected");
}
// (5) read model never exposes global PHI without a verified membership
async function testPcsNoPhiWithoutMembership() {
  const t = await loadCanonicalTables();
  // case names gpp 900 but membership 800 belongs to another clinic → not paged →
  // case not grouped under the patient; PHI never resolved.
  const r = await runPcs(t, { pcms: [pcm({ clinicId: 2 })], cases: [acase()], gpps: [gpp()] });
  // The active-clinic membership page is empty (pcm clinic 2) → member cases empty;
  // the case has a non-null membership so it is NOT in the unresolved (null) bucket.
  assert.ok(r.rows.every((g) => g.patientDisplay == null || g.identityAvailable), "(5) no PHI without verified membership");
  assert.ok(!r.rows.some((g) => g.identityAvailable && g.globalPlexusPatientId === 900 && g.patientClinicMembershipId === 800), "cross-clinic membership never resolves the patient");
}
// (7) two same-name patients remain distinct
async function testSameNameDistinct() {
  const t = await loadCanonicalTables();
  const r = await runPcs(t, {
    pcms: [pcm({ id: 800, globalPlexusPatientId: 900 }), pcm({ id: 801, globalPlexusPatientId: 901 })],
    gpps: [gpp({ id: 900, displayName: "John Smith" }), gpp({ id: 901, displayName: "John Smith" })],
    cases: [acase({ id: 5, globalPlexusPatientId: 900, patientClinicMembershipId: 800 }), acase({ id: 9, globalPlexusPatientId: 901, patientClinicMembershipId: 801 })],
  });
  assert.equal(r.rows.length, 2, "(7) same-name patients distinct by exact identity");
  assert.deepEqual(r.rows.map((g) => g.globalPlexusPatientId), [900, 901]);
}
// (8/9) unresolved identity cases separate; verified patient episodes not split
async function testPcsEpisodesAndUnresolved() {
  const t = await loadCanonicalTables();
  const r = await runPcs(t, {
    pcms: [pcm({ id: 800, globalPlexusPatientId: 900 })],
    gpps: [gpp({ id: 900 })],
    // two same-service episodes for the one verified patient + one null-identity case
    cases: [acase({ id: 5, patientClinicMembershipId: 800, globalPlexusPatientId: 900 }), acase({ id: 9, patientClinicMembershipId: 800, globalPlexusPatientId: 900 }), acase({ id: 12, patientClinicMembershipId: null, globalPlexusPatientId: null })],
  });
  const verified = r.rows.find((g) => g.identityAvailable);
  assert.ok(verified, "verified patient group present");
  assert.equal(verified!.episodes.length, 2, "(9) same patient episodes kept together, not split");
  const unresolved = r.rows.filter((g) => !g.identityAvailable);
  assert.equal(unresolved.length, 1, "(8) null-identity case is its own group");
  assert.equal(unresolved[0].episodes[0].ancillaryCaseId, 12);
}

// ═══ §9 Service truth (10-17) ═══
async function testServiceTruth() {
  const t = await loadCanonicalTables();
  const wrong = { serviceType: "VitalWave" };
  // 10 admin review wrong-service event → no timestamp, warning (status from projection)
  const rAdmin = acsRow0(await runAcs(t, { cases: [acase()], adminEvents: [adminEvent(wrong)] }));
  assert.equal(rAdmin.adminReview.at, null); assert.ok(rAdmin.adminReview.warnings.includes("admin_review_wrong_service_event"), "(10)");
  // 11 appointment
  const rAppt = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt(wrong)] }));
  assert.equal(rAppt.appointment.status, null); assert.ok(rAppt.appointment.warnings.includes("appointment_wrong_service"), "(11)");
  // 12 order note ref/source
  const rOn = acsRow0(await runAcs(t, { cases: [acase()], refs: [orderRef(wrong)], notes: [orderNote(wrong)] }));
  assert.equal(rOn.orderNote.status, null); assert.ok(rOn.orderNote.warnings.includes("order_note_wrong_service"), "(12)");
  // 13 procedure
  const rProc = acsRow0(await runAcs(t, { cases: [acase()], procs: [proc(wrong)] }));
  assert.equal(rProc.procedure.status, null); assert.ok(rProc.procedure.warnings.includes("procedure_wrong_service"), "(13)");
  // 14 report
  const rRep = acsRow0(await runAcs(t, { cases: [acase()], refs: [reportRef(wrong)], cdrs: [cdr(wrong)] }));
  assert.equal(rRep.report.status, null); assert.ok(rRep.report.warnings.includes("report_wrong_service"), "(14)");
  // 15 procedure note
  const rPn = acsRow0(await runAcs(t, { cases: [acase()], refs: [procRef(wrong)], notes: [procNote(wrong)] }));
  assert.equal(rPn.procedureNote.status, null); assert.ok(rPn.procedureNote.warnings.includes("procedure_note_wrong_service"), "(15)");
  // 16 billing readiness
  const rBr = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness(wrong)] }));
  assert.equal(rBr.billingReadiness.status, null); assert.ok(rBr.billingReadiness.warnings.includes("billing_readiness_wrong_service"), "(16)");
  // 17 billing document
  const rBd = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness()], docs: [billingDoc(wrong)] }));
  assert.equal(rBd.billingDocument.status, null); assert.ok(rBd.billingDocument.warnings.includes("billing_document_wrong_service"), "(17)");
}

// ═══ §9 Billing Document version (18-22) ═══
async function testBillingDocVersion() {
  const t = await loadCanonicalTables();
  const good = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ id: 500, evidenceFingerprint: "fp-1" })], docs: [billingDoc({ billingReadinessCheckId: 500, evidenceFingerprint: "fp-1" })] }));
  assert.equal(good.billingDocument.status, "generated", "(18) exact readiness id + fingerprint qualifies");
  const wrongId = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ id: 500 })], docs: [billingDoc({ billingReadinessCheckId: 777 })] }));
  assert.equal(wrongId.billingDocument.status, null); assert.ok(wrongId.billingDocument.warnings.includes("billing_document_wrong_readiness"), "(19)");
  const stale = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ evidenceFingerprint: "fp-2" })], docs: [billingDoc({ evidenceFingerprint: "fp-OLD" })] }));
  assert.equal(stale.billingDocument.status, null); assert.ok(stale.billingDocument.warnings.includes("billing_document_stale_fingerprint"), "(20)");
  const supersededDoc = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness()], docs: [billingDoc({ supersededAt: OLD })] }));
  assert.equal(supersededDoc.billingDocument.status, null, "(21) superseded doc excluded");
  const noReadiness = acsRow0(await runAcs(t, { cases: [acase()], readiness: [], docs: [billingDoc()] }));
  assert.equal(noReadiness.billingDocument.status, null); assert.ok(noReadiness.billingDocument.warnings.includes("billing_document_readiness_unresolved"), "(22) doc without current readiness rejected");
}

// ═══ §9 Conflict truth (23-30) ═══
async function testConflictTruth() {
  const t = await loadCanonicalTables();
  const dupOn = acsRow0(await runAcs(t, { cases: [acase()], refs: [orderRef({ id: 1 }), orderRef({ id: 2, sourceId: 1 })], notes: [orderNote()] }));
  assert.equal(dupOn.orderNote.status, null); assert.equal(dupOn.orderNote.available, false); assert.ok(dupOn.orderNote.warnings.includes("duplicate_current_evidence"), "(23) duplicate order-note refs → conflict");
  const dupRep = acsRow0(await runAcs(t, { cases: [acase()], refs: [reportRef({ id: 3 }), reportRef({ id: 4, sourceId: 3 })], cdrs: [cdr()] }));
  assert.ok(dupRep.report.warnings.includes("duplicate_current_evidence"), "(24) duplicate report refs → conflict");
  const dupPn = acsRow0(await runAcs(t, { cases: [acase()], refs: [procRef({ id: 2 }), procRef({ id: 7, sourceId: 2 })], notes: [procNote()] }));
  assert.ok(dupPn.procedureNote.warnings.includes("duplicate_current_evidence"), "(25) duplicate procedure-note refs → conflict");
  const dupBr = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ id: 500 }), readiness({ id: 501 })] }));
  assert.ok(dupBr.billingReadiness.warnings.includes("duplicate_current_evidence"), "(26) duplicate readiness → conflict");
  const dupBd = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness()], docs: [billingDoc({ id: 600 }), billingDoc({ id: 601 })] }));
  assert.ok(dupBd.billingDocument.warnings.includes("duplicate_current_evidence"), "(27) duplicate billing docs → conflict");
  // (28) conflicting appointments → conflict UNLESS lineage proves current
  const dupAppt = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ id: 300 }), appt({ id: 301 })] }));
  assert.ok(dupAppt.appointment.warnings.includes("duplicate_current_evidence"), "(28) two current appts, no lineage → conflict");
  const lineage = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt({ id: 300, status: "completed" }), appt({ id: 301, status: "scheduled", parentEventId: 300 })] }));
  assert.equal(lineage.appointment.sourceId, 301, "(28) reschedule lineage resolves the one current successor");
  // (29) conflicting procedure events → conflict
  const dupProc = acsRow0(await runAcs(t, { cases: [acase()], procs: [proc({ id: 400 }), proc({ id: 401 })] }));
  assert.ok(dupProc.procedure.warnings.includes("duplicate_current_evidence"), "(29) duplicate procedure events → conflict");
}
// (30/35) a conflicting stage yields currentStage null + integrity conflicting
async function testConflictNoCurrentStage() {
  const t = await loadCanonicalTables();
  const v = acsRow0(await runAcs(t, { cases: [acase()], adminEvents: [adminEvent()], lists: [list()], memberships: [membership()], appts: [appt({ id: 300 }), appt({ id: 301 })] }));
  assert.equal(v.currentStage, null, "(35) conflict → no false current stage");
  assert.equal(v.currentStageIntegrity, "conflicting");
  assert.equal(v.appointment.available, false);
}

// ═══ §9 Availability semantics (31-35) ═══
async function testAvailabilitySemantics() {
  const t = await loadCanonicalTables();
  // 31 successful query, no appointment → availability available, available false, status null
  const none = acsRow0(await runAcs(t, { cases: [acase()], appts: [] }));
  assert.equal(none.appointment.availability, "available"); assert.equal(none.appointment.available, false); assert.equal(none.appointment.status, null, "(31)");
  // 32 exact current appointment → available true
  const one = acsRow0(await runAcs(t, { cases: [acase()], appts: [appt()] }));
  assert.equal(one.appointment.available, true, "(32)");
  // 33 query failure → unavailable + available false
  const fail = acsRow0(await runAcs(t, { cases: [acase()], procsError: true }));
  assert.equal(fail.procedure.availability, "unavailable"); assert.equal(fail.procedure.available, false, "(33)");
  // 34 upstream flag off → available false
  const off = acsRow0(await runAcs(t, { cases: [acase()] }, { ...ALL, canonicalAppointment: false }));
  assert.equal(off.appointment.availability, "upstream_flag_off"); assert.equal(off.appointment.available, false, "(34)");
}

// ═══ regression ═══
async function testReportEpisodeStillExact() {
  const t = await loadCanonicalTables();
  const r = acsRow0(await runAcs(t, { cases: [acase()], refs: [reportRef({ executionCaseId: null, patientScreeningId: null })], cdrs: [cdr({ executionCaseId: null, patientScreeningId: null })] }));
  assert.equal(r.report.status, null); assert.ok(r.report.warnings.includes("report_episode_unresolved"), "(36) report episode validation intact");
}
async function testAcsRepeatedSameServiceSeparate() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ id: 5 }), acase({ id: 9 })] });
  assert.equal(r.rows.length, 2, "(37) repeated same-service ACS cases separate");
  assert.deepEqual(r.rows.map((x) => x.ancillaryCaseId), [5, 9]);
}
async function testCrossClinicExcluded() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase({ id: 5, clinicId: 1 }), acase({ id: 9, clinicId: 2 })] });
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].ancillaryCaseId, 5, "cross-clinic case excluded");
}
async function testCrossClinicReadinessDropped() {
  const t = await loadCanonicalTables();
  const r = acsRow0(await runAcs(t, { cases: [acase()], readiness: [readiness({ clinicId: 2 })], docs: [billingDoc({ clinicId: 2 })] }));
  assert.equal(r.billingReadiness.status, null); assert.equal(r.billingDocument.status, null, "cross-clinic billing rows dropped in memory");
}
async function testBatchedReads() {
  const t = await loadCanonicalTables();
  const p = await acs();
  await runWithDb(spec(t, { cases: [acase({ id: 5 }), acase({ id: 6 }), acase({ id: 7 })], refs: [orderRef({ ancillaryCaseId: 5 }), orderRef({ id: 11, ancillaryCaseId: 6 }), orderRef({ id: 12, ancillaryCaseId: 7 })], notes: [orderNote({ id: 1 }), orderNote({ id: 11, ancillaryCaseId: 6 }), orderNote({ id: 12, ancillaryCaseId: 7 })] }), ALL, async (calls: Call[]) => {
    await p.getAcsCanonicalView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.documentReferences), 1, "(N+1) one batched references read");
    assert.equal(countOps(calls, "select", t.procedureNotes), 1, "(N+1) one batched notes read");
  });
}
async function testAcsPaginationBounds() {
  const t = await loadCanonicalTables();
  const p = await acs();
  const r = await runWithDb(spec(t, { cases: [acase({ id: 7 }), acase({ id: 3 }), acase({ id: 5 })] }), ALL, async () => p.getAcsCanonicalView({ clinicId: 1, limit: 2 }));
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map((x) => x.ancillaryCaseId), [3, 5]); assert.ok(r.pageInfo.nextCursor, "bounded page + cursor");
}
async function testCursorRoundTrip() {
  const q = await viewQuery();
  assert.equal(q.decodeCursor(q.encodeCursor(42)), 42); assert.equal(q.decodeCursor("x"), null);
}
async function testSectionFlagOff() {
  const t = await loadCanonicalTables();
  const r = await runAcs(t, { cases: [acase()] }, { ...ALL, ancillaryCaseWrite: false });
  assert.equal(r.availability, "upstream_flag_off"); assert.equal(r.rows.length, 0);
}

// ═══ route auth / flags / migration ═══
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(handlers: Function[], req: unknown, res: unknown) { for (const h of handlers) { let nexted = false; await h(req, res, () => { nexted = true; }); if (!nexted) return; } }
async function handlers(path: string) { const { app, map } = fakeApp(); (await routes()).registerPcsAcsCanonicalRoutes(app); return map[`GET ${path}`]; }

async function testRouteFlagOffZeroReads() {
  const t = await loadCanonicalTables();
  for (const [path, flagKey, role] of [["/api/pcs/canonical-view", "pcsCanonicalView", "liaison"], ["/api/acs/canonical-view", "acsCanonicalView", "technician"]] as const) {
    const h = await handlers(path); const res = mockRes();
    await runWithDb(spec(t, {}), { [flagKey]: false }, async (calls: Call[]) => {
      await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res);
      assert.equal(countOps(calls, "select"), 0, `${path} flag OFF → zero reads`);
    });
    assert.equal((res.body as { disabled: boolean }).disabled, true);
  }
}
async function testRouteAuth() {
  const pcsH = await handlers("/api/pcs/canonical-view");
  const acsH = await handlers("/api/acs/canonical-view");
  const check = async (h: Function[], session: unknown, clinicId: unknown, expect: number) => {
    const res = mockRes();
    await runWithDb(new Map(), { pcsCanonicalView: true, acsCanonicalView: true }, async () => { await invoke(h, { session, clinicId, query: {} }, res); });
    return res.statusCode === expect;
  };
  assert.ok(await check(pcsH, {}, 1, 401), "unauth → 401");
  assert.ok(await check(pcsH, { userId: "u" }, 1, 403), "(40) missing role → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "wizard" }, 1, 403), "unknown role → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "biller" }, 1, 403), "biller → 403");
  assert.ok(await check(pcsH, { userId: "u", role: "technician" }, 1, 403), "(40) technician denied on PCS");
  assert.ok(await check(acsH, { userId: "u", role: "liaison" }, 1, 403), "(40) liaison denied on ACS");
  assert.ok(await check(pcsH, { userId: "u", role: "liaison" }, null, 403), "missing clinic scope → 403");
}
async function testRouteAllowedRoles() {
  const t = await loadCanonicalTables();
  const pcsH = await handlers("/api/pcs/canonical-view");
  const acsH = await handlers("/api/acs/canonical-view");
  for (const [h, role] of [[pcsH, "liaison"], [pcsH, "admin"], [acsH, "technician"], [acsH, "admin"]] as const) {
    const res = mockRes();
    await runWithDb(spec(t, {}), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); });
    assert.equal(res.statusCode, 200, `${role} allowed`);
  }
}
async function testRouteMigration503() {
  const t = await loadCanonicalTables();
  for (const [path, role, migKey] of [["/api/pcs/canonical-view", "liaison", "casesMigration"], ["/api/acs/canonical-view", "technician", "casesMigration"], ["/api/acs/canonical-view", "technician", "refsMigration"]] as const) {
    const h = await handlers(path); const res = mockRes();
    await runWithDb(spec(t, { cases: [acase()], [migKey]: true } as Opts), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); });
    assert.equal(res.statusCode, 503, `(39) ${path} ${migKey} → 503`);
    assert.equal((res.body as { code: string }).code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING");
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["ACS stage-vector truth", testAcsStageVectorTruth],
  ["(1-8) identity resolver", testIdentityResolver],
  ["(5) PCS no PHI without membership", testPcsNoPhiWithoutMembership],
  ["(7) same-name distinct", testSameNameDistinct],
  ["(8/9) episodes together + unresolved separate", testPcsEpisodesAndUnresolved],
  ["(10-17) service truth", testServiceTruth],
  ["(18-22) billing document version", testBillingDocVersion],
  ["(23-29) conflict truth", testConflictTruth],
  ["(30/35) conflict → no current stage", testConflictNoCurrentStage],
  ["(31-34) availability semantics", testAvailabilitySemantics],
  ["(36) report episode still exact", testReportEpisodeStillExact],
  ["(37) ACS repeated same-service separate", testAcsRepeatedSameServiceSeparate],
  ["cross-clinic case excluded", testCrossClinicExcluded],
  ["cross-clinic billing dropped", testCrossClinicReadinessDropped],
  ["batched reads no N+1", testBatchedReads],
  ["ACS pagination bounds", testAcsPaginationBounds],
  ["cursor round-trip", testCursorRoundTrip],
  ["section flag off", testSectionFlagOff],
  ["route flag off zero reads", testRouteFlagOffZeroReads],
  ["(40) route auth distinct roles", testRouteAuth],
  ["route allowed roles", testRouteAllowedRoles],
  ["(39) migration 503", testRouteMigration503],
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

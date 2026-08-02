// Phase 2H — canonical Clinician Portal overview: read model, exact-source
// validation, Engagement list/membership wiring, route auth, migration-503.
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
const NEWER = new Date("2027-07-20T09:00:00Z");
// Upstream chain that enables ALL three sections.
const ALL = { ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true, canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true, canonicalBillingReadiness: true } as const;

// ─── Row builders — refs are matched to EXACT sources by (sourceTable, sourceId) ─
function readiness(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, billingBlockers: [], claimBlockers: [], evaluatedAt: OLD, ...o }; }
function billingDoc(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, canonicalStatus: "generated", supersededAt: null, ...o }; }
// An order_note reference + its exact procedure_notes source (note_type order_note).
function ref(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, documentKind: "order_note", documentStatus: "signed", serviceType: "BrainWave", sourceTable: "procedure_notes", sourceId: 1, executionCaseId: null, signedAt: OLD, effectiveClinicalDate: OLD, actualCreatedAt: OLD, supersededAt: null, ...o }; }
function note(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", noteType: "order_note", signatureStatus: "signed", signedAt: OLD, generationStatus: "generated", supersededAt: null, ...o }; }
function cdr(o: Record<string, unknown> = {}) { return { id: 1, clinicId: 1, serviceType: "BrainWave", documentType: "report", documentStatus: "uploaded", executionCaseId: null, ...o }; }
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved" as string | null, ...o }; }
function list(o: Record<string, unknown> = {}) { return { id: 100, clinicId: 1, sourceType: "admin_review", sourceId: "src-100", label: "Batch A", sentToEngagementAt: OLD, ...o }; }
function membership(o: Record<string, unknown> = {}) { return { id: 200, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "active", ...o }; }

function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: {
  readiness?: unknown[]; docs?: unknown[]; refs?: unknown[]; notes?: unknown[]; cdr?: unknown[];
  cases?: unknown[]; lists?: unknown[]; memberships?: unknown[];
  readinessErr?: boolean; readinessMigration?: boolean; refsMigration?: boolean; casesMigration?: boolean;
} = {}) {
  const migErr = () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); };
  return new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { if (o.readinessErr) throw new Error("finance down"); if (o.readinessMigration) return migErr(); return o.readiness ?? []; } }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [] }],
    [t.documentReferences, { select: () => { if (o.refsMigration) return migErr(); return o.refs ?? []; } }],
    [t.procedureNotes, { select: () => o.notes ?? [] }],
    [t.caseDocumentReadiness, { select: () => o.cdr ?? [] }],
    [t.ancillaryCases, { select: () => { if (o.casesMigration) return migErr(); return o.cases ?? []; } }],
    [t.engagementLists, { select: () => o.lists ?? [] }],
    [t.engagementMemberships, { select: () => o.memberships ?? [] }],
  ]);
}

// ─── Finance ──────────────────────────────────────────────────────
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
  assert.equal(r.finance.counts.claimBlockedOnly, 1);
  assert.equal(r.finance.counts.billingDocumentGenerated, 1);
  assert.ok(r.finance.claimBlockersByCode.some((c) => c.code === "prior_auth"));
  assert.ok(r.finance.billingBlockersByCode.some((c) => c.code === "order_note_signature_unresolved"));
  assert.equal(r.finance.rows.length, 2, "bounded finance rows rendered");
}

async function testSupersededExcluded() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { readiness: [readiness({ supersededAt: OLD }), readiness({ id: 2, ancillaryCaseId: 6, canonicalStatus: "superseded" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.counts.evaluated, 1);
}

// (11/12/13) cross-clinic rows never counted (in-memory tenancy defense)
async function testCrossClinicExcluded() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    readiness: [readiness({ clinicId: 2 })], refs: [ref({ clinicId: 2 })], notes: [note({ clinicId: 2 })], cases: [acase({ clinicId: 2 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.counts.evaluated, 0, "no cross-clinic finance leakage");
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "no cross-clinic document leakage");
  assert.equal(r.engagement.counts.activeCases, 0, "no cross-clinic engagement leakage");
}

// (33) partial finance failure is unavailable, NOT zero (other sections available)
async function testPartialFailureUnavailable() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { readinessErr: true, refs: [ref()], notes: [note()], cases: [acase()] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.finance.availability, "unavailable", "(33) failed finance → unavailable, not zero");
  assert.equal(r.ordersNotes.availability, "available", "other sections unaffected");
  assert.equal(r.engagement.availability, "available");
}

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

// ─── Orders & Notes — exact-source validation (§3) ────────────────
async function testOrdersNotesCounts() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    refs: [
      ref({ id: 1, documentKind: "order_note", sourceId: 1 }),
      ref({ id: 2, documentKind: "procedure_note", documentStatus: "pending_signature", sourceId: 2 }),
      ref({ id: 3, documentKind: "report", sourceId: 3, sourceTable: "case_document_readiness" }),
      ref({ id: 4, documentKind: "order_note", sourceId: 1, supersededAt: OLD }),
    ],
    notes: [note({ id: 1, noteType: "order_note", signatureStatus: "signed" }), note({ id: 2, noteType: "post_procedure_note", signatureStatus: "needs_signature", generationStatus: "generated" })],
    cdr: [cdr({ id: 3 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 1, "(8/15) superseded order_note excluded, kinds distinct");
  assert.equal(r.ordersNotes.counts.currentProcedureNotes, 1);
  assert.equal(r.ordersNotes.counts.currentReports, 1, "(19) report counted separately");
  assert.equal(r.ordersNotes.counts.pendingSignatures, 1);
  assert.equal(r.ordersNotes.rows.length, 3, "only validated refs render as rows");
}

// (8) exact order-note source qualifies
async function testExactOrderNoteQualifies() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref()], notes: [note()] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 1);
}

// (9) wrong sourceTable rejected
async function testWrongSourceTableRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ sourceTable: "documents" })], notes: [note()] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(9) wrong sourceTable rejected");
  assert.ok(r.ordersNotes.warnings.some((w) => w.startsWith("order_note_wrong_source_table")), "integrity warning surfaced");
}

// (10) missing source rejected
async function testMissingSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ sourceId: 999 })], notes: [note({ id: 1 })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(10) missing source rejected");
  assert.ok(r.ordersNotes.warnings.some((w) => w.startsWith("order_note_source_missing")));
}

// (11) wrong clinic source rejected — the source note belongs to another clinic
async function testWrongClinicSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  // The note has clinicId 2; the batched load is clinic-scoped, so it never
  // enters the map for clinic 1 → treated as missing source (rejected).
  const r = await runWithDb(spec(t, { refs: [ref({ clinicId: 1 })], notes: [note({ clinicId: 2 })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(11) wrong-clinic source rejected");
}

// (12) wrong case source rejected
async function testWrongCaseSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ ancillaryCaseId: 5 })], notes: [note({ ancillaryCaseId: 6 })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(12) cross-case source rejected");
  assert.ok(r.ordersNotes.warnings.some((w) => w.startsWith("order_note_cross_case_source")));
}

// (13) wrong service source rejected
async function testWrongServiceSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ serviceType: "BrainWave" })], notes: [note({ serviceType: "VitalWave" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(13) wrong-service source rejected");
}

// (14) wrong noteType rejected
async function testWrongNoteTypeRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ documentKind: "order_note", sourceId: 1 })], notes: [note({ id: 1, noteType: "post_procedure_note" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(14) wrong noteType rejected");
  assert.ok(r.ordersNotes.warnings.some((w) => w.startsWith("order_note_wrong_note_type")));
}

// (15) superseded source rejected
async function testSupersededSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref()], notes: [note({ supersededAt: OLD })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(15) superseded source rejected");
}

// (16) signed reference pointing to unsigned source rejected
async function testSignedRefUnsignedSourceRejected() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, { refs: [ref({ documentStatus: "signed" })], notes: [note({ signatureStatus: "needs_signature", signedAt: null })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.currentOrderNotes, 0, "(16) signed ref + unsigned source rejected");
  assert.ok(r.ordersNotes.warnings.some((w) => w.startsWith("order_note_signed_ref_unsigned_source")));
}

// (17/18) returned + generated counts come from the EXACT referenced note only
async function testReturnedAndGeneratedFromExactSource() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    refs: [
      ref({ id: 1, documentKind: "procedure_note", documentStatus: "pending_signature", sourceId: 10 }),
      ref({ id: 2, documentKind: "procedure_note", documentStatus: "pending_signature", sourceId: 11, ancillaryCaseId: 6 }),
    ],
    notes: [
      note({ id: 10, noteType: "post_procedure_note", signatureStatus: "returned_for_correction", generationStatus: "generated" }),
      note({ id: 11, noteType: "post_procedure_note", ancillaryCaseId: 6, signatureStatus: "needs_signature", generationStatus: "approved" }),
      // An UNREFERENCED returned note — must NOT be counted (no current reference).
      note({ id: 99, noteType: "post_procedure_note", ancillaryCaseId: 7, signatureStatus: "returned_for_correction", generationStatus: "generated" }),
    ],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.ordersNotes.counts.returnedForCorrection, 1, "(17) returned count from referenced source only (unreferenced note excluded)");
  assert.equal(r.ordersNotes.counts.generatedNotes, 2, "(18) generated count from referenced sources only");
}

// (19) report source validation is exact
async function testReportSourceExact() {
  const t = await loadCanonicalTables(); const o = await overview();
  const good = await runWithDb(spec(t, { refs: [ref({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3 })], cdr: [cdr({ id: 3, documentType: "report", documentStatus: "uploaded" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(good.ordersNotes.counts.currentReports, 1, "exact report source qualifies");
  const badType = await runWithDb(spec(t, { refs: [ref({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3 })], cdr: [cdr({ id: 3, documentType: "informed_consent" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(badType.ordersNotes.counts.currentReports, 0, "(19) wrong documentType report rejected");
  const badStatus = await runWithDb(spec(t, { refs: [ref({ documentKind: "report", sourceTable: "case_document_readiness", sourceId: 3 })], cdr: [cdr({ id: 3, documentStatus: "missing" })] }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(badStatus.ordersNotes.counts.currentReports, 0, "(19) non-current report status rejected");
}

// (20) source reads are BATCHED, not N+1
async function testSourceReadsBatched() {
  const t = await loadCanonicalTables(); const o = await overview();
  await runWithDb(spec(t, {
    refs: [
      ref({ id: 1, documentKind: "order_note", sourceId: 1 }),
      ref({ id: 2, documentKind: "procedure_note", sourceId: 2 }),
      ref({ id: 3, documentKind: "order_note", sourceId: 3 }),
      ref({ id: 4, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 4 }),
      ref({ id: 5, documentKind: "report", sourceTable: "case_document_readiness", sourceId: 5 }),
    ],
    notes: [note({ id: 1, noteType: "order_note" }), note({ id: 2, noteType: "post_procedure_note" }), note({ id: 3, noteType: "order_note" })],
    cdr: [cdr({ id: 4 }), cdr({ id: 5 })],
  }), ALL, async (calls: Call[]) => {
    await o.getClinicianPortalCanonicalOverview({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.procedureNotes), 1, "(20) one batched procedure_notes read for many refs");
    assert.equal(countOps(calls, "select", t.caseDocumentReadiness), 1, "(20) one batched case_document_readiness read for many refs");
  });
}

// ─── Engagement — list/membership wiring (§4) ─────────────────────
async function testEngagementCounts() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, adminReviewStatus: "approved" }), acase({ id: 6, adminReviewStatus: "needs_information" }), acase({ id: 7, adminReviewStatus: "pending" }), acase({ id: 8, lifecycleStatus: "closed", adminReviewStatus: "approved" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.engagement.counts.activeCases, 3, "closed case excluded");
  assert.equal(r.engagement.counts.approved, 1);
  assert.equal(r.engagement.counts.needsInformation, 1);
  assert.equal(r.engagement.counts.pending, 1);
  assert.equal(r.engagement.rows[0].lastSentAt, null, "(25) missing outreach stays null");
  assert.equal(r.engagement.rows[0].engagementListName, null);
  assert.deepEqual(r.engagement.rows[0].memberships, []);
}

// (21) exact active membership displayed
async function testActiveMembershipDisplayed() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, serviceType: "BrainWave" })],
    lists: [list({ id: 100, label: "Batch A", sourceType: "admin_review", sourceId: "s-100", sentToEngagementAt: OLD })],
    memberships: [membership({ id: 200, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "active" }), membership({ id: 201, engagementListId: 100, ancillaryCaseId: 5, serviceType: "BrainWave", status: "removed" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  const row = r.engagement.rows[0];
  assert.equal(row.memberships.length, 1, "(21) only ACTIVE membership displayed");
  assert.equal(row.memberships[0].engagementMembershipId, 200);
  assert.equal(row.memberships[0].engagementListDisplayName, "Batch A");
  assert.equal(row.engagementListName, "Batch A");
  assert.equal(row.lastSentAt, OLD.toISOString());
}

// (22) same-date lists remain distinct by ID/source identity
async function testSameDateListsDistinct() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, serviceType: "BrainWave" })],
    lists: [list({ id: 100, label: "Batch A", sourceId: "s-100", sentToEngagementAt: OLD }), list({ id: 101, label: "Batch B", sourceId: "s-101", sentToEngagementAt: OLD })],
    memberships: [membership({ id: 200, engagementListId: 100, ancillaryCaseId: 5 }), membership({ id: 201, engagementListId: 101, ancillaryCaseId: 5 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  const row = r.engagement.rows[0];
  assert.equal(row.memberships.length, 2, "(22) same-date lists preserved as distinct memberships");
  assert.deepEqual(row.memberships.map((m) => m.engagementListId), [100, 101]);
  assert.notEqual(row.memberships[0].engagementListSourceId, row.memberships[1].engagementListSourceId);
}

// (23) repeated same-service cases remain separate
async function testRepeatedSameServiceSeparate() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, serviceType: "BrainWave" }), acase({ id: 9, serviceType: "BrainWave" })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  assert.equal(r.engagement.rows.length, 2, "(23) repeated same-service episodes remain separate rows");
  assert.deepEqual(r.engagement.rows.map((x) => x.ancillaryCaseId), [5, 9], "(27) deterministic bounded ordering");
}

// (24) most-recently-sent uses persisted sentToEngagementAt (no first/newest fallback)
async function testMostRecentSentPersisted() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, serviceType: "BrainWave" })],
    lists: [list({ id: 100, label: "Older", sourceId: "s-100", sentToEngagementAt: OLD }), list({ id: 101, label: "Newer", sourceId: "s-101", sentToEngagementAt: NEWER })],
    memberships: [membership({ id: 200, engagementListId: 100, ancillaryCaseId: 5 }), membership({ id: 201, engagementListId: 101, ancillaryCaseId: 5 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  const row = r.engagement.rows[0];
  assert.equal(row.lastSentAt, NEWER.toISOString(), "(24) most-recent from persisted sentToEngagementAt");
  assert.equal(row.engagementListName, "Newer");
}

// (26) cross-clinic membership/list excluded
async function testCrossClinicMembershipExcluded() {
  const t = await loadCanonicalTables(); const o = await overview();
  const r = await runWithDb(spec(t, {
    cases: [acase({ id: 5, serviceType: "BrainWave" })],
    lists: [list({ id: 100, clinicId: 2, label: "Other clinic" })],   // list belongs to clinic 2
    memberships: [membership({ id: 200, engagementListId: 100, ancillaryCaseId: 5 })],
  }), ALL, async () => o.getClinicianPortalCanonicalOverview({ clinicId: 1 }));
  const row = r.engagement.rows[0];
  assert.equal(row.memberships.length, 0, "(26) cross-clinic list excluded");
  assert.equal(row.lastSentAt, null);
}

// ─── DTO regression ───────────────────────────────────────────────
async function testDtoNoFinancialFields() {
  const d = await dto();
  const o = d.disabledClinicianPortalOverview(new Date().toISOString());
  const keys = Object.keys(o.finance.counts).join(",").toLowerCase();
  for (const bad of ["revenue", "amount", "paid", "balance", "collection", "invoice", "remittance", "payer", "income", "claimtotal"]) {
    assert.ok(!keys.includes(bad), `(34) Finance DTO must not carry financial field: ${bad}`);
  }
  assert.equal(o.disabled, true);
}

// ─── Route: auth (§5) ─────────────────────────────────────────────
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(handlers: Function[], req: unknown, res: unknown) { for (const h of handlers) { let nexted = false; await h(req, res, () => { nexted = true; }); if (!nexted) return; } }

async function handlers() { const { app, map } = fakeApp(); (await routes()).registerClinicianPortalCanonicalRoutes(app); return map["GET /api/clinician-portal/canonical-overview"]; }

async function testRouteFlagOffDisabled() {
  const t = await loadCanonicalTables(); const h = await handlers(); const res = mockRes();
  await runWithDb(new Map<unknown, TableSpec>([
    [t.billingReadinessChecks, { select: () => { throw new Error("must not read when flag off"); } }],
    [t.ancillaryCases, { select: () => { throw new Error("must not read"); } }],
  ]), { clinicianPortalCanonicalData: false }, async (calls: Call[]) => {
    await invoke(h, { session: { userId: "u1", role: "clinician" }, clinicId: 1 }, res);
    assert.equal(countOps(calls, "select"), 0, "(1/2) zero canonical reads when flag OFF");
  });
  assert.equal((res.body as { disabled: boolean }).disabled, true, "flag OFF disabled contract");
}

// (28/29/30/31) role guard — unauth 401; missing/unknown/wrong role 403; clinician/admin allowed
async function testRouteRoleGuard() {
  const h = await handlers();
  const r401 = mockRes(); await invoke(h, { session: {} }, r401);
  assert.equal(r401.statusCode, 401, "unauthenticated → 401");
  const rMissing = mockRes(); await invoke(h, { session: { userId: "u" } }, rMissing);
  assert.equal(rMissing.statusCode, 403, "(28) missing role → 403 (no clinician default)");
  const rUnknown = mockRes(); await invoke(h, { session: { userId: "u", role: "wizard" } }, rUnknown);
  assert.equal(rUnknown.statusCode, 403, "(29) unknown role → 403");
  for (const role of ["scheduler", "biller", "technician"]) {
    const res = mockRes(); await invoke(h, { session: { userId: "u", role } }, res);
    assert.equal(res.statusCode, 403, `(29) ${role} → 403`);
  }
}

async function testRouteAllowedRoles() {
  const t = await loadCanonicalTables(); const h = await handlers();
  for (const role of ["clinician", "admin"]) {
    const res = mockRes();
    await runWithDb(spec(t, {}), { ...ALL, clinicianPortalCanonicalData: true }, async () => {
      await invoke(h, { session: { userId: "u", role }, clinicId: 1 }, res);
    });
    assert.equal(res.statusCode, 200, `(30) ${role} allowed`);
    assert.equal((res.body as { disabled: boolean }).disabled, false);
  }
}

async function testRouteClinicScope() {
  const h = await handlers(); const res = mockRes();
  await runWithDb(new Map(), { clinicianPortalCanonicalData: true }, async () => {
    await invoke(h, { session: { userId: "u", role: "clinician" }, clinicId: null }, res);
  });
  assert.equal(res.statusCode, 403, "(31) no clinic scope → 403 (never body-supplied)");
}

// (31b) Intentional contract: an admin WITHOUT a session clinic scope
// (clinicContext sets req.clinicId=null for admins) is fail-closed 403 — the
// Clinician Portal is strictly per-clinic and never inferred to all-clinics.
async function testRouteAdminNullClinic() {
  const h = await handlers(); const res = mockRes();
  await runWithDb(new Map(), { clinicianPortalCanonicalData: true }, async () => {
    await invoke(h, { session: { userId: "u", role: "admin" }, clinicId: null }, res);
  });
  assert.equal(res.statusCode, 403, "(31b) admin without a clinic scope → 403 (fail-closed, intentional)");
}

// ─── Route: migration-missing → 503 (§6) ──────────────────────────
async function testMigration503() {
  const t = await loadCanonicalTables(); const h = await handlers();
  const cases: Array<[string, ReturnType<typeof spec>]> = [
    ["finance table missing", spec(t, { readinessMigration: true })],
    ["unified-document table missing", spec(t, { refsMigration: true })],
    ["ancillary-case/Engagement table missing", spec(t, { casesMigration: true })],
  ];
  for (const [label, s] of cases) {
    const res = mockRes();
    await runWithDb(s, { ...ALL, clinicianPortalCanonicalData: true }, async () => {
      await invoke(h, { session: { userId: "u", role: "clinician" }, clinicId: 1 }, res);
    });
    assert.equal(res.statusCode, 503, `(32) ${label} → 503`);
    assert.equal((res.body as { code: string }).code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING", `${label} → migration code`);
  }
}

// (33) ordinary one-section failure → 200 with that section unavailable, others intact
async function testOrdinarySectionFailure200() {
  const t = await loadCanonicalTables(); const h = await handlers(); const res = mockRes();
  await runWithDb(spec(t, { readinessErr: true, refs: [ref()], notes: [note()], cases: [acase()] }), { ...ALL, clinicianPortalCanonicalData: true }, async () => {
    await invoke(h, { session: { userId: "u", role: "clinician" }, clinicId: 1 }, res);
  });
  assert.equal(res.statusCode, 200, "(33) ordinary section failure stays 200");
  const body = res.body as { finance: { availability: string }; ordersNotes: { availability: string } };
  assert.equal(body.finance.availability, "unavailable");
  assert.equal(body.ordersNotes.availability, "available");
}

// ─── Client static guards ─────────────────────────────────────────
async function testClientFlagDefaultOff() {
  const f = await clientFlag();
  assert.equal(f.isClinicianPortalCanonicalDataEnabled(), false, "(client) flag defaults OFF");
}

async function testClientNoLocalStorageSingleQuery() {
  const hook = readFileSync(join(process.cwd(), "client/src/components/physician/useCanonicalOverview.ts"), "utf8");
  const panel = readFileSync(join(process.cwd(), "client/src/components/physician/CanonicalOverviewPanel.tsx"), "utf8");
  for (const [name, src] of [["hook", hook], ["panel", panel]] as const) {
    assert.ok(!src.includes("localStorage") && !src.includes("sessionStorage"), `(37) ${name} must not use browser storage`);
  }
  assert.equal((hook.match(/useQuery</g) ?? []).length, 1, "(36) exactly one canonical overview query call");
  assert.ok(hook.includes("enabled"), "query gated by the flag");
}

// Each page branches on the flag: flag ON returns the canonical page, and the
// legacy body no longer renders the canonical panel beside mock content.
async function testPagesBranchOnFlag() {
  const pages: Array<[string, string]> = [
    ["client/src/components/physician/finance/FinancePage.tsx", "CanonicalFinancePage"],
    ["client/src/components/physician/orders/OrdersNotesPage.tsx", "CanonicalOrdersNotesPage"],
    ["client/src/components/physician/engagement/PlexusEngagementPage.tsx", "CanonicalEngagementPage"],
  ];
  for (const [f, canon] of pages) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(src.includes("isClinicianPortalCanonicalDataEnabled()"), `${f} checks the flag`);
    assert.ok(new RegExp(`return <${canon}`).test(src), `${f} returns <${canon}/> when flag ON`);
    assert.ok(!src.includes("CanonicalOverviewPanel"), `${f} legacy body must not render the panel beside mock content`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["finance counts + claim blockers + rows", testFinanceCounts],
  ["superseded readiness excluded", testSupersededExcluded],
  ["(11-13) cross-clinic excluded", testCrossClinicExcluded],
  ["(33) partial failure unavailable not zero", testPartialFailureUnavailable],
  ["upstream sections report upstream_flag_off", testUpstreamFlagOff],
  ["orders & notes exact-source counts", testOrdersNotesCounts],
  ["(8) exact order-note source qualifies", testExactOrderNoteQualifies],
  ["(9) wrong sourceTable rejected", testWrongSourceTableRejected],
  ["(10) missing source rejected", testMissingSourceRejected],
  ["(11) wrong clinic source rejected", testWrongClinicSourceRejected],
  ["(12) wrong case source rejected", testWrongCaseSourceRejected],
  ["(13) wrong service source rejected", testWrongServiceSourceRejected],
  ["(14) wrong noteType rejected", testWrongNoteTypeRejected],
  ["(15) superseded source rejected", testSupersededSourceRejected],
  ["(16) signed ref → unsigned source rejected", testSignedRefUnsignedSourceRejected],
  ["(17/18) returned+generated from exact source", testReturnedAndGeneratedFromExactSource],
  ["(19) report source validation exact", testReportSourceExact],
  ["(20) source reads batched not N+1", testSourceReadsBatched],
  ["engagement counts + null outreach", testEngagementCounts],
  ["(21) exact active membership displayed", testActiveMembershipDisplayed],
  ["(22) same-date lists distinct", testSameDateListsDistinct],
  ["(23/27) repeated same-service separate + ordered", testRepeatedSameServiceSeparate],
  ["(24) most-recent sent persisted", testMostRecentSentPersisted],
  ["(26) cross-clinic membership excluded", testCrossClinicMembershipExcluded],
  ["(34) DTO has no financial fields", testDtoNoFinancialFields],
  ["route flag OFF disabled before reads", testRouteFlagOffDisabled],
  ["(28-30) route role guard", testRouteRoleGuard],
  ["(30) clinician/admin allowed", testRouteAllowedRoles],
  ["(31) route clinic scope", testRouteClinicScope],
  ["(31b) admin without clinic scope → 403", testRouteAdminNullClinic],
  ["(32) migration missing → 503", testMigration503],
  ["(33) ordinary section failure → 200", testOrdinarySectionFailure200],
  ["client flag defaults OFF", testClientFlagDefaultOff],
  ["(36/37) client single query, no storage", testClientNoLocalStorageSingleQuery],
  ["pages branch on flag, no panel beside mock", testPagesBranchOnFlag],
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

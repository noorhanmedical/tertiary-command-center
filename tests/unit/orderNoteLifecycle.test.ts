// Phase P1 — pure clinician ancillary-workflow presentation logic tests.
//
// Runs standalone with:
//   npx tsx tests/unit/orderNoteLifecycle.test.ts
//
// The module under test is client-side but PURE (no React, no I/O); its only
// `@shared` import is a `import type` (erased at runtime), so tsx runs it as-is.

import assert from "node:assert/strict";
import {
  ORDER_NOTE_STATE_LABELS,
  orderNoteStateTone,
  orderNoteStateLabel,
  isReReviewState,
  WORKLIST_FILTERS,
  worklistFilterById,
  filterWorklist,
  parseOrderNoteSections,
  buildCaseTimeline,
  caseEngagementSummary,
  type SignatureWorklistItem,
} from "../../client/src/components/physician/orderNoteLifecycle";
import type { ClinicianPortalCanonicalOverview, OrdersNotesRow } from "../../shared/clinicianPortalOverview";

// ─── state labels + tones ─────────────────────────────────────────────────────
function testStaleStateIsFirstClass() {
  assert.equal(ORDER_NOTE_STATE_LABELS["signed_stale_review_required"], "Signed — Re-review Required");
  // never rendered as plain "Signed"
  assert.notEqual(orderNoteStateLabel("signed_stale_review_required"), "Signed");
  // destructive tone
  assert.equal(orderNoteStateTone("signed_stale_review_required"), "red");
  assert.equal(orderNoteStateTone("signed"), "green");
  assert.equal(orderNoteStateTone("updated_review_required"), "amber");
  assert.equal(orderNoteStateTone("ready_for_review"), "blue");
}

function testReReviewStates() {
  assert.equal(isReReviewState("signed_stale_review_required"), true);
  assert.equal(isReReviewState("updated_review_required"), true);
  assert.equal(isReReviewState("signed"), false);
  assert.equal(isReReviewState(null), false);
}

function testUnknownStateFallsBackToHumanized() {
  assert.equal(orderNoteStateLabel("some_new_state"), "some new state");
  assert.equal(orderNoteStateLabel(null), "—");
}

// ─── worklist filters ─────────────────────────────────────────────────────────
const wi = (over: Partial<SignatureWorklistItem> = {}): SignatureWorklistItem => ({
  signable: false,
  signatureStatus: "needs_signature",
  noteType: "order_note",
  orderNotePortalState: null,
  requiresScreening: false,
  screeningComplete: null,
  ...over,
});

function testNeedsMySignatureFilter() {
  const f = worklistFilterById("needs_my_signature");
  assert.equal(f.match(wi({ signable: true })), true);
  assert.equal(f.match(wi({ signable: false })), false);
}

function testScreeningIncompleteOnlyWhenRequired() {
  const f = worklistFilterById("screening_incomplete");
  // required + awaiting → match
  assert.equal(f.match(wi({ requiresScreening: true, orderNotePortalState: "awaiting_screening" })), true);
  // awaiting but NOT required (e.g. Echo/vascular) → never a screening blocker
  assert.equal(f.match(wi({ requiresScreening: false, orderNotePortalState: "awaiting_screening" })), false);
  // required but already past screening → no match
  assert.equal(f.match(wi({ requiresScreening: true, orderNotePortalState: "ready_for_review" })), false);
}

function testReReviewFilter() {
  const f = worklistFilterById("re_review_required");
  assert.equal(f.match(wi({ orderNotePortalState: "signed_stale_review_required" })), true);
  assert.equal(f.match(wi({ orderNotePortalState: "updated_review_required" })), true);
  assert.equal(f.match(wi({ orderNotePortalState: "signed" })), false);
}

function testFilterWorklistAndUnknownIdFallsBackToAll() {
  const items = [
    wi({ signable: true }),
    wi({ signatureStatus: "signed" }),
    wi({ orderNotePortalState: "signed_stale_review_required" }),
  ];
  assert.equal(filterWorklist(items, "needs_my_signature").length, 1);
  assert.equal(filterWorklist(items, "signed").length, 1);
  assert.equal(filterWorklist(items, "re_review_required").length, 1);
  // unknown id → All
  assert.equal(filterWorklist(items, "nonsense").length, 3);
  assert.equal(worklistFilterById("nonsense").id, "all");
  // registry stable
  assert.equal(WORKLIST_FILTERS[0].id, "all");
}

// ─── section parser ────────────────────────────────────────────────────────────
function testParsesRenderedSectionStructure() {
  const text = [
    "PATIENT INFORMATION",
    "-------------------",
    "Name: Jane Doe",
    "DOB: 1970-01-01",
    "",
    "CLINICAL HISTORY / INDICATION",
    "-----------------------------",
    "Documented history of X.",
    "",
    "ORDERING CLINICIAN ATTESTATION",
    "------------------------------",
    "I attest…",
    "Signature: ____",
  ].join("\n");
  const sections = parseOrderNoteSections(text);
  assert.equal(sections.length, 3);
  assert.equal(sections[0].heading, "PATIENT INFORMATION");
  assert.match(sections[0].body, /Name: Jane Doe/);
  assert.match(sections[0].body, /DOB: 1970-01-01/);
  assert.equal(sections[1].heading, "CLINICAL HISTORY / INDICATION");
  assert.equal(sections[2].heading, "ORDERING CLINICIAN ATTESTATION");
  assert.match(sections[2].body, /Signature: ____/);
  // no dash-rule lines leak into bodies
  assert.ok(!sections.some((s) => /^-{3,}$/.test(s.body.split("\n")[0] ?? "")));
}

function testParserFallbackForUnstructuredBody() {
  const sections = parseOrderNoteSections("just a plain body with no headings");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, null);
  assert.equal(sections[0].body, "just a plain body with no headings");
}

function testParserEmpty() {
  assert.deepEqual(parseOrderNoteSections(""), []);
  assert.deepEqual(parseOrderNoteSections(null), []);
}

// ─── case timeline ──────────────────────────────────────────────────────────────
function overview(rows: {
  orders?: OrdersNotesRow[];
  finance?: ClinicianPortalCanonicalOverview["finance"]["rows"];
  engagement?: ClinicianPortalCanonicalOverview["engagement"]["rows"];
} = {}): ClinicianPortalCanonicalOverview {
  return {
    disabled: false,
    generatedAt: new Date().toISOString(),
    dataVersion: "test",
    clinicScoped: true,
    finance: {
      availability: "available", warnings: [],
      counts: { evaluated: 0, readyToGenerate: 0, missingRequirements: 0, billingDocumentPending: 0, billingDocumentGenerated: 0, claimBlockedOnly: 0, supersededOrInvalidated: 0 },
      billingBlockersByCode: [], claimBlockersByCode: [], lastEvaluatedAt: null,
      rows: rows.finance ?? [],
    },
    ordersNotes: {
      availability: "available", warnings: [],
      counts: { currentOrderNotes: 0, currentProcedureNotes: 0, currentReports: 0, pendingSignatures: 0, returnedForCorrection: 0, generatedNotes: 0, missingEvidence: 0 },
      rows: rows.orders ?? [],
    },
    engagement: {
      availability: "available", warnings: [],
      counts: { activeCases: 0, approved: 0, needsInformation: 0, pending: 0, rejected: 0 },
      rows: rows.engagement ?? [],
    },
  };
}

const oRow = (over: Partial<OrdersNotesRow>): OrdersNotesRow => ({
  ancillaryCaseId: 1,
  serviceType: "BrainWave",
  patientDisplay: "Jane Doe",
  documentKind: "order_note",
  documentStatus: "current",
  signedAt: null,
  effectiveClinicalDate: null,
  actualCreatedAt: null,
  ...over,
});

function testScreeningStepOnlyWhenRequired() {
  const withScreening = buildCaseTimeline(overview(), {
    ancillaryCaseId: 1, requiresScreening: true, screeningComplete: false, orderNotePortalState: "awaiting_screening",
  });
  assert.ok(withScreening.some((s) => s.key === "screening"), "BW/VW timeline includes screening");
  const screening = withScreening.find((s) => s.key === "screening")!;
  assert.equal(screening.reached, false);
  assert.equal(screening.attention, true);

  const noScreening = buildCaseTimeline(overview(), {
    ancillaryCaseId: 1, requiresScreening: false, screeningComplete: null, orderNotePortalState: "ready_for_review",
  });
  assert.ok(!noScreening.some((s) => s.key === "screening"), "Echo/vascular timeline has NO screening step");
}

function testStaleOrderNoteStepIsRedAndNeedsAttention() {
  const steps = buildCaseTimeline(
    overview({ orders: [oRow({ documentKind: "order_note", documentStatus: "current", signedAt: "2026-08-01T00:00:00Z" })] }),
    { ancillaryCaseId: 1, requiresScreening: false, screeningComplete: null, orderNotePortalState: "signed_stale_review_required" },
  );
  const on = steps.find((s) => s.key === "order_note")!;
  assert.equal(on.tone, "red");
  assert.equal(on.attention, true);
  assert.equal(on.reached, false, "a stale-after-signature note is NOT a completed step");
}

function testFullTimelineOrderAndReachedFlags() {
  const ov = overview({
    orders: [
      oRow({ documentKind: "order_note", signedAt: "2026-08-01T00:00:00Z" }),
      oRow({ documentKind: "procedure_note", documentStatus: "current", signedAt: "2026-08-02T00:00:00Z" }),
      oRow({ documentKind: "report", documentStatus: "on_file" }),
    ],
    finance: [{ ancillaryCaseId: 1, serviceType: "BrainWave", patientDisplay: "Jane", readinessStatus: "ready_to_generate", billingDocumentStatus: "billing_document_generated", billingBlockerCount: 0, claimBlockerCount: 0, evaluatedAt: null }],
  });
  const steps = buildCaseTimeline(ov, { ancillaryCaseId: 1, requiresScreening: true, screeningComplete: true, orderNotePortalState: "signed" });
  assert.deepEqual(steps.map((s) => s.key), ["screening", "order_note", "procedure_note", "report", "billing"]);
  assert.ok(steps.every((s) => s.reached), "all steps reached in a fully complete case");
}

function testBillingBlockersRaiseAttention() {
  const ov = overview({
    finance: [{ ancillaryCaseId: 1, serviceType: "Echo", patientDisplay: "Bob", readinessStatus: "missing_requirements", billingDocumentStatus: null, billingBlockerCount: 2, claimBlockerCount: 1, evaluatedAt: null }],
  });
  const steps = buildCaseTimeline(ov, { ancillaryCaseId: 1, requiresScreening: false, screeningComplete: null, orderNotePortalState: "signed" });
  const billing = steps.find((s) => s.key === "billing")!;
  assert.equal(billing.attention, true);
  assert.match(billing.detail ?? "", /3 blocker/);
}

function testEngagementSummary() {
  const ov = overview({ engagement: [{ ancillaryCaseId: 7, serviceType: "Echo", patientDisplay: "X", adminReviewStatus: "approved", lifecycleStatus: "scheduled", engagementListId: null, engagementListName: null, lastSentAt: null, memberships: [] }] });
  assert.deepEqual(caseEngagementSummary(ov, 7), { lifecycleStatus: "scheduled", adminReviewStatus: "approved" });
  assert.equal(caseEngagementSummary(ov, 999), null);
  assert.equal(caseEngagementSummary(null, 7), null);
}

async function run() {
  testStaleStateIsFirstClass();
  testReReviewStates();
  testUnknownStateFallsBackToHumanized();
  testNeedsMySignatureFilter();
  testScreeningIncompleteOnlyWhenRequired();
  testReReviewFilter();
  testFilterWorklistAndUnknownIdFallsBackToAll();
  testParsesRenderedSectionStructure();
  testParserFallbackForUnstructuredBody();
  testParserEmpty();
  testScreeningStepOnlyWhenRequired();
  testStaleOrderNoteStepIsRedAndNeedsAttention();
  testFullTimelineOrderAndReachedFlags();
  testBillingBlockersRaiseAttention();
  testEngagementSummary();
  console.log("orderNoteLifecycle.test.ts: all tests passed");
}

run();

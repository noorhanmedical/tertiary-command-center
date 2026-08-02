// Phase 2H — behavioral component test for the flag-ON mock REPLACEMENT.
//
// Renders the REAL canonical section renderer (CanonicalSectionView — exactly
// what the three tiles render when the Phase 2H flag is ON) via react-dom/server
// with a crafted server DTO, and asserts:
//   • canonical bounded ROWS render (not counts alone),
//   • NO mock/prototype operational data appears (revenue, claims, invoices,
//     splits, call outcomes, conversions, outreach history),
//   • truthful states (unavailable / migration / empty) never show zero counts
//     under an error.
// Static file checks alone are insufficient (§8) — this is a real render.
//
//   npx tsx tests/unit/clinicianPortalCanonicalReplacement.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicianPortalCanonicalOverview } from "../../shared/clinicianPortalOverview";
import { disabledClinicianPortalOverview } from "../../shared/clinicianPortalOverview";

(globalThis as unknown as { React: typeof React }).React = React;
const panel = await import("@/components/physician/CanonicalOverviewPanel");
const D = "2027-06-10T09:00:00.000Z";

// A fully-populated, available overview (all three sections have rows).
function overview(over: Partial<ClinicianPortalCanonicalOverview> = {}): ClinicianPortalCanonicalOverview {
  return {
    disabled: false, generatedAt: D, dataVersion: "clinician_portal_overview_v1", clinicScoped: true,
    finance: {
      availability: "available", warnings: [],
      counts: { evaluated: 1, readyToGenerate: 1, missingRequirements: 0, billingDocumentPending: 0, billingDocumentGenerated: 1, claimBlockedOnly: 0, supersededOrInvalidated: 0 },
      billingBlockersByCode: [], claimBlockersByCode: [], lastEvaluatedAt: D,
      rows: [{ ancillaryCaseId: 5, serviceType: "BrainWave", patientDisplay: null, readinessStatus: "ready_to_generate", billingDocumentStatus: "generated", billingBlockerCount: 0, claimBlockerCount: 1, evaluatedAt: D }],
    },
    ordersNotes: {
      availability: "available", warnings: [],
      counts: { currentOrderNotes: 1, currentProcedureNotes: 1, currentReports: 1, pendingSignatures: 1, returnedForCorrection: 0, generatedNotes: 1, missingEvidence: 0 },
      rows: [{ ancillaryCaseId: 5, serviceType: "BrainWave", patientDisplay: null, documentKind: "order_note", documentStatus: "signed", signedAt: D, effectiveClinicalDate: D, actualCreatedAt: D }],
    },
    engagement: {
      availability: "available", warnings: [],
      counts: { activeCases: 1, approved: 1, needsInformation: 0, pending: 0, rejected: 0 },
      rows: [{ ancillaryCaseId: 5, serviceType: "BrainWave", patientDisplay: null, adminReviewStatus: "approved", lifecycleStatus: "active", engagementListId: 100, engagementListName: "Batch A", lastSentAt: D, memberships: [{ engagementMembershipId: 200, engagementListId: 100, engagementListDisplayName: "Batch A", engagementListSourceType: "admin_review", engagementListSourceId: "s-100", serviceType: "BrainWave", sentToEngagementAt: D }] }],
    },
    ...over,
  };
}

function render(section: "finance" | "ordersNotes" | "engagement", data: ClinicianPortalCanonicalOverview): string {
  return renderToStaticMarkup(React.createElement(panel.CanonicalSectionView, { section, data }));
}

// Mock/prototype tokens that must NEVER appear in canonical mode.
const MOCK_FINANCE = ["Ancillary Revenue", "Claims Paid", "Plexus Split", "Payer Mix", "Provider Financials", "Clinic Net", "Revenue by Service Line", "Outstanding"];
const MOCK_ORDERS = ["Linked Documents", "Bulk Sign", "Version History", "Needs Signature", "SOAP", "Amendment"];
const MOCK_ENGAGEMENT = ["Call List", "Left Voicemail", "Do Not Contact", "Conversion", "Qualifications Completed", "Escalations", "RingCentral", "Callback"];

// (3/4) flag ON Finance renders canonical rows, NO mock revenue/claims/invoices/splits
async function testFinanceReplacesMock() {
  const html = render("finance", overview());
  assert.ok(html.includes("canonical-finance-rows"), "(7) canonical finance ROWS rendered");
  assert.ok(html.includes("ready_to_generate"), "readiness status rendered from DTO");
  const low = html.toLowerCase();
  for (const tok of MOCK_FINANCE) assert.ok(!low.includes(tok.toLowerCase()), `(3/4) Finance canonical mode must not render mock token: ${tok}`);
  assert.ok(!/\$\d/.test(html), "(4) no dollar figures in canonical finance mode");
}

// (5) flag ON Orders & Notes renders canonical rows, NO mock notes/orders
async function testOrdersReplacesMock() {
  const html = render("ordersNotes", overview());
  assert.ok(html.includes("canonical-orders-rows"), "(7) canonical document ROWS rendered");
  assert.ok(html.includes("order_note"), "document kind rendered from DTO");
  const low = html.toLowerCase();
  for (const tok of MOCK_ORDERS) assert.ok(!low.includes(tok.toLowerCase()), `(5) Orders canonical mode must not render mock token: ${tok}`);
}

// (6) flag ON Engagement renders canonical rows, NO mock calls/conversions
async function testEngagementReplacesMock() {
  const html = render("engagement", overview());
  assert.ok(html.includes("canonical-engagement-rows"), "(7) canonical engagement ROWS rendered");
  assert.ok(html.includes("Batch A"), "engagement list display name rendered from DTO");
  assert.ok(html.includes("engagement-membership-200"), "distinct membership identity rendered");
  const low = html.toLowerCase();
  for (const tok of MOCK_ENGAGEMENT) assert.ok(!low.includes(tok.toLowerCase()), `(6) Engagement canonical mode must not render mock token: ${tok}`);
}

// (7) rows, not counts alone — the row tables carry per-record data
async function testRowsNotCountsAlone() {
  for (const section of ["finance", "ordersNotes", "engagement"] as const) {
    const html = render(section, overview());
    assert.ok(html.includes(`canonical-${section === "ordersNotes" ? "orders" : section}-rows`) || html.includes("canonical-finance-rows"), `${section} renders a row table`);
    assert.ok(html.includes("#5"), `${section} renders the exact ancillary case identity in a row`);
  }
}

// (33-analog) a failed/unavailable section shows the unavailable note, NEVER zero counts
async function testUnavailableNeverZero() {
  const data = overview({ finance: { ...overview().finance, availability: "unavailable", warnings: ["finance_read_failed"], counts: { evaluated: 0, readyToGenerate: 0, missingRequirements: 0, billingDocumentPending: 0, billingDocumentGenerated: 0, claimBlockedOnly: 0, supersededOrInvalidated: 0 }, rows: [] } });
  const html = render("finance", data);
  assert.ok(html.includes("canonical-section-unavailable"), "unavailable state shown");
  assert.ok(!html.includes("canonical-counts"), "no zero count grid under an unavailable section");
  assert.ok(!html.includes("canonical-finance-rows"), "no rows under an unavailable section");
}

// disabled contract renders the disabled note (upstream flag off), never rows
async function testDisabledContract() {
  const html = render("finance", disabledClinicianPortalOverview(D));
  assert.ok(html.includes("canonical-section-unavailable"), "disabled contract shows a truthful note");
  assert.ok(!html.includes("canonical-finance-rows"), "disabled contract shows no rows");
}

// empty (available, zero rows) shows the empty state, not an error
async function testEmptyState() {
  const data = overview({ ordersNotes: { availability: "available", warnings: [], counts: { currentOrderNotes: 0, currentProcedureNotes: 0, currentReports: 0, pendingSignatures: 0, returnedForCorrection: 0, generatedNotes: 0, missingEvidence: 0 }, rows: [] } });
  const html = render("ordersNotes", data);
  assert.ok(html.includes("canonical-empty"), "empty available section shows the empty state");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(3/4) Finance replaces mock, canonical rows only", testFinanceReplacesMock],
  ["(5) Orders & Notes replaces mock", testOrdersReplacesMock],
  ["(6) Engagement replaces mock", testEngagementReplacesMock],
  ["(7) rows rendered, not counts alone", testRowsNotCountsAlone],
  ["unavailable never shows zero counts", testUnavailableNeverZero],
  ["disabled contract truthful, no rows", testDisabledContract],
  ["empty available state", testEmptyState],
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

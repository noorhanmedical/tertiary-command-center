// Phase 2E-B — canonical Ancillary Documents portal integration.
//
// Renders the REAL components via react-dom/server with a pre-seeded React
// Query cache (so useQuery resolves synchronously), and asserts the shared
// contract renders identical reference/source ids across surfaces, with the
// correct status distinctions and NO upload / generation / billing controls.
//
//   npx tsx tests/unit/ancillaryDocumentsPortalIntegration.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AncillaryDocumentContractItem } from "../../shared/schema/ancillaryDocuments";

(globalThis as unknown as { React: typeof React }).React = React;
const comp = await import("@/components/ancillary-documents/CanonicalAncillaryDocuments");
const api = await import("@/lib/ancillaryDocumentsApi");
const flag = await import("@/lib/unifiedAncillaryDocumentsFlag");

const ROOT = process.cwd();
const D1 = "2027-06-01T10:00:00.000Z";
const D2 = "2027-06-02T10:00:00.000Z";

function item(over: Partial<AncillaryDocumentContractItem> = {}): AncillaryDocumentContractItem {
  return {
    ancillaryDocumentReferenceId: 42, ancillaryCaseId: 5, serviceType: "EchoWave",
    documentKind: "order_note", sourceSystem: "x", sourceTable: "procedure_notes", sourceId: 900,
    documentStatus: "pending_signature", effectiveClinicalDate: null, actualCreatedAt: D1,
    signedAt: null, supersededAt: null, isCurrent: true, downloadReference: "procedure_notes:900",
    readiness: "pending", warnings: [], ...over,
  };
}

function renderWithData(
  element: React.ReactElement,
  params: api.AncillaryDocumentsListParams,
  items: AncillaryDocumentContractItem[],
): string {
  const qc = new QueryClient();
  qc.setQueryData(["/api/ancillary-documents", params], { items, nextCursor: null });
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, element));
}

// ─── (1) EHR card renders canonical records + same ids ────────────
async function testEhrCardRenders() {
  const params = { patientScreeningId: 77 };
  const items = [
    item({ ancillaryDocumentReferenceId: 42, sourceId: 900, documentKind: "order_note", documentStatus: "signed", signedAt: D2, isCurrent: true }),
    item({ ancillaryDocumentReferenceId: 43, sourceId: 3001, documentKind: "report", documentStatus: "uploaded", isCurrent: true, sourceTable: "case_document_readiness", downloadReference: "case_document_readiness:3001" }),
  ];
  const html = renderWithData(
    React.createElement(comp.AncillaryDocumentsCard, { params, enabled: true }),
    params, items,
  );
  assert.ok(html.includes('data-reference-id="42"'), "renders reference id 42");
  assert.ok(html.includes('data-source-id="900"'), "renders source id 900");
  assert.ok(html.includes('data-reference-id="43"') && html.includes('data-source-id="3001"'));
  assert.ok(html.includes("Order Note") && html.includes("Report"));
  // Signed vs uploaded are distinct.
  assert.ok(html.includes("Signed") && html.includes("Uploaded"));
  // No editing/upload/generation/billing controls in the EHR card.
  const low = html.toLowerCase();
  for (const forbidden of ["<button", "upload report", "generate note", "billing document", "generate procedure note"]) {
    assert.ok(!low.includes(forbidden), `EHR card must not contain: ${forbidden}`);
  }
}

// ─── (2) different services stay separate; history is history ─────
async function testServicesAndHistory() {
  const params = { patientScreeningId: 88 };
  const items = [
    item({ ancillaryDocumentReferenceId: 50, ancillaryCaseId: 5, serviceType: "EchoWave", sourceId: 900 }),
    item({ ancillaryDocumentReferenceId: 51, ancillaryCaseId: 6, serviceType: "SleepWave", sourceId: 901 }),
    item({ ancillaryDocumentReferenceId: 52, ancillaryCaseId: 5, serviceType: "EchoWave", sourceId: 902, isCurrent: false, supersededAt: D1, documentStatus: "superseded" }),
  ];
  const html = renderWithData(
    React.createElement(comp.AncillaryDocumentsCard, { params, enabled: true }),
    params, items,
  );
  assert.ok(html.includes("EchoWave") && html.includes("SleepWave"), "distinct services shown");
  assert.ok(html.includes("case #5") && html.includes("case #6"), "grouped by ancillary case");
  // Superseded row is rendered as history (distinct marker).
  assert.ok(html.includes("(superseded)") || html.includes("History"), "history is distinct");
}

// ─── (3) ACS/PCS summary renders current status per kind ──────────
async function testAcsPcsSummary() {
  const params = { patientScreeningId: 77, includeHistory: false };
  const items = [
    item({ documentKind: "order_note", documentStatus: "signed", isCurrent: true }),
    item({ ancillaryDocumentReferenceId: 43, documentKind: "report", documentStatus: "uploaded", isCurrent: true }),
  ];
  const html = renderWithData(
    React.createElement(comp.AncillaryDocumentsSummary, { params, enabled: true }),
    params, items,
  );
  assert.ok(html.includes("Order Note") && html.includes("Report"), "summary lists both kinds");
  assert.ok(html.includes("signed") || html.includes("Signed"));
  // Same source contract — no fetch/derivation divergence, no controls.
  assert.ok(!html.toLowerCase().includes("<button"), "summary is read-only");
}

// ─── (4) feature OFF → renders nothing, ZERO canonical requests ───
async function testFeatureOffZeroRequests() {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = () => { fetchCalls++; return Promise.resolve(new Response("[]")); };
  try {
    const cardHtml = renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(comp.AncillaryDocumentsCard, { params: { patientScreeningId: 77 }, enabled: false })),
    );
    const summaryHtml = renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(comp.AncillaryDocumentsSummary, { params: { patientScreeningId: 77 }, enabled: false })),
    );
    assert.equal(cardHtml, "", "disabled card renders nothing");
    assert.equal(summaryHtml, "", "disabled summary renders nothing");
    assert.equal(fetchCalls, 0, "zero canonical requests when disabled");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  }
}

// ─── (5) pure contract helpers: status buckets are distinct ───────
async function testStatusBuckets() {
  assert.equal(api.documentStatusBucket(item({ documentStatus: "signed", isCurrent: true })), "signed");
  assert.equal(api.documentStatusBucket(item({ documentStatus: "pending_signature", isCurrent: true })), "pending_signature");
  assert.equal(api.documentStatusBucket(item({ documentStatus: "uploaded", isCurrent: true })), "uploaded");
  assert.equal(api.documentStatusBucket(item({ isCurrent: false, supersededAt: D1 })), "history");
  assert.equal(api.documentKindLabel("screening_form"), "Screening Form");
}

// ─── (6) query builder: allowlisted filters only, no identity search ─
async function testQueryBuilder() {
  const q = api.buildAncillaryDocumentsQuery({ patientScreeningId: 77, documentKind: "report", documentStatus: "uploaded", serviceType: "EchoWave", includeHistory: false, limit: 50 });
  assert.ok(q.startsWith("/api/ancillary-documents?"));
  assert.ok(q.includes("patientScreeningId=77") && q.includes("documentKind=report") && q.includes("documentStatus=uploaded") && q.includes("serviceType=EchoWave"));
  // No patient-name / mrn / global-identity params are ever emitted.
  const low = q.toLowerCase();
  for (const forbidden of ["name=", "mrn=", "globalsearch=", "patientname="]) {
    assert.ok(!low.includes(forbidden), `query must not carry identity param: ${forbidden}`);
  }
}

// ─── (7) flag default OFF; ON only when explicitly set ────────────
async function testFlagDefaults() {
  const saved = process.env.VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS;
  try {
    delete process.env.VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS;
    // The helper reads import.meta.env, which tsx does not populate from
    // process.env — so it is OFF by default in this runtime regardless.
    assert.equal(flag.isUnifiedAncillaryDocumentsEnabled(), false, "default OFF");
  } finally {
    if (saved !== undefined) process.env.VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS = saved;
  }
}

// ─── (8) wiring: surfaces gate on the flag + reuse the components ──
async function testSurfaceWiring() {
  const page = readFileSync(join(ROOT, "client/src/pages/documents.tsx"), "utf8");
  assert.ok(/isUnifiedAncillaryDocumentsEnabled/.test(page) && /CanonicalAncillaryDocumentsList/.test(page), "page uses canonical component behind the flag");
  assert.ok(/enabled:\s*!canonical/.test(page), "legacy queries disabled in canonical mode (no dup render)");
  const ehr = readFileSync(join(ROOT, "client/src/components/patient-directory/PatientChartSections.tsx"), "utf8");
  assert.ok(/AncillaryDocumentsCard/.test(ehr) && /isUnifiedAncillaryDocumentsEnabled/.test(ehr), "EHR renders canonical card behind the flag");
  const acs = readFileSync(join(ROOT, "client/src/components/portal/CaseOverview.tsx"), "utf8");
  assert.ok(/AncillaryDocumentsSummary/.test(acs) && /isUnifiedAncillaryDocumentsEnabled/.test(acs), "ACS/PCS case panel renders read-only summary behind the flag");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) EHR card renders canonical records + same ids", testEhrCardRenders],
  ["(2) different services separate; history distinct", testServicesAndHistory],
  ["(3) ACS/PCS summary renders current status", testAcsPcsSummary],
  ["(4) feature OFF → nothing rendered, zero requests", testFeatureOffZeroRequests],
  ["(5) status buckets distinct", testStatusBuckets],
  ["(6) query builder: no identity search", testQueryBuilder],
  ["(7) flag default OFF", testFlagDefaults],
  ["(8) surfaces gate on flag + reuse components", testSurfaceWiring],
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

await run();

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

// ─── (3/22) ACS/PCS summary is PURE: renders each case status from items ─
async function testAcsPcsSummary() {
  const items = [
    item({ documentKind: "order_note", documentStatus: "signed", isCurrent: true }),
    item({ ancillaryDocumentReferenceId: 43, documentKind: "report", documentStatus: "uploaded", isCurrent: true }),
    item({ ancillaryDocumentReferenceId: 44, documentKind: "consent", documentStatus: "superseded", isCurrent: false }), // excluded
  ];
  // Pure component: no QueryClientProvider needed, no fetch — items only.
  const html = renderToStaticMarkup(React.createElement(comp.AncillaryDocumentsSummary, { items }));
  assert.ok(html.includes("Order Note") && html.includes("Report"), "renders current kinds from batched items");
  assert.ok(!html.includes("Consent"), "non-current (superseded) item excluded from summary");
  assert.ok(html.includes("signed") || html.includes("Signed"));
  assert.ok(!html.toLowerCase().includes("<button"), "summary is read-only");
}

// ─── (21/23) summary + CaseOverview are presentation-only (no fetch) ─
async function testPresentationOnlyNoPerCardFetch() {
  const src = readFileSync(join(ROOT, "client/src/components/ancillary-documents/CanonicalAncillaryDocuments.tsx"), "utf8");
  // AncillaryDocumentsSummary must be pure: extract its body and prove it does
  // NOT call useQuery/useAncillaryDocuments/fetch.
  const summaryBody = src.slice(src.indexOf("export function AncillaryDocumentsSummary"));
  const summaryOnly = summaryBody.slice(0, summaryBody.indexOf("export function", 1) >>> 0 || summaryBody.length);
  assert.ok(!/useQuery|useAncillaryDocuments|fetch\(/.test(summaryOnly), "AncillaryDocumentsSummary must not fetch");
  const caseOverview = readFileSync(join(ROOT, "client/src/components/portal/CaseOverview.tsx"), "utf8");
  assert.ok(!/useAncillaryDocuments|fetchAncillaryDocuments/.test(caseOverview), "(23) CaseOverview must not fetch canonical documents");
  assert.ok(/ancillaryDocuments\?:/.test(caseOverview), "CaseOverview receives documents as a prop");
  // The single fetch is centralized in the selected-case detail wrapper.
  const wrapper = readFileSync(join(ROOT, "client/src/components/portal/SelectedCaseOverview.tsx"), "utf8");
  assert.equal((wrapper.match(/useAncillaryDocuments\(/g) ?? []).length, 1, "(21) exactly one canonical query in the selected-case panel");
  // Behavioral: rendering MANY summaries needs no query client and no fetch.
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = () => { fetchCalls++; return Promise.resolve(new Response("[]")); };
  try {
    for (let i = 0; i < 5; i++) {
      renderToStaticMarkup(React.createElement(comp.AncillaryDocumentsSummary, { items: [item({ ancillaryDocumentReferenceId: i })] }));
    }
    assert.equal(fetchCalls, 0, "(21) many summary cards issue zero canonical requests");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  }
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
    // Pure summary with no items → renders nothing.
    const summaryHtml = renderToStaticMarkup(React.createElement(comp.AncillaryDocumentsSummary, { items: [] }));
    assert.equal(cardHtml, "", "disabled card renders nothing");
    assert.equal(summaryHtml, "", "empty summary renders nothing");
    assert.equal(fetchCalls, 0, "zero canonical requests");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  }
}

// ─── (24/25) download action renders only for valid pointers ──────
async function testDownloadActionRendering() {
  const params = { patientScreeningId: 77 };
  // (24) a valid authorized internal route → a real "View" link (href), not raw text.
  const withDl = [item({ ancillaryDocumentReferenceId: 70, downloadReference: "/api/documents-library/123/file" })];
  const html = renderWithData(React.createElement(comp.AncillaryDocumentsCard, { params, enabled: true }), params, withDl);
  assert.ok(/href="\/api\/documents-library\/123\/file"/.test(html), "renders an actionable authorized link");
  assert.ok(html.includes(">View<"), "labelled View");
  // (25) null pointer → NO action.
  const noDl = [item({ ancillaryDocumentReferenceId: 71, downloadReference: null })];
  const html2 = renderWithData(React.createElement(comp.AncillaryDocumentsCard, { params, enabled: true }), params, noDl);
  assert.ok(!/doc-download-71/.test(html2), "no download action when pointer is null");
  // A non-/api pointer (should never reach the client, but defend) → no action.
  const badDl = [item({ ancillaryDocumentReferenceId: 72, downloadReference: "s3://bucket/key" as any })];
  const html3 = renderWithData(React.createElement(comp.AncillaryDocumentsCard, { params, enabled: true }), params, badDl);
  assert.ok(!/doc-download-72/.test(html3), "unsafe pointer renders no action");
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

// ─── Global-list Load More (keyset pagination consumption) ────────
// The list's initial filter state is all-empty → these params.
const LIST_PARAMS = { patientScreeningId: undefined, serviceType: undefined, documentKind: undefined, documentStatus: undefined };
function renderInfiniteList(pages: Array<{ items: AncillaryDocumentContractItem[]; nextCursor: string | null }>, enabled = true): string {
  const qc = new QueryClient();
  qc.setQueryData(
    ["/api/ancillary-documents", "infinite", LIST_PARAMS],
    { pages, pageParams: pages.map((_, i) => (i === 0 ? undefined : "cursor")) },
  );
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(comp.CanonicalAncillaryDocumentsList, { enabled })),
  );
}

// ─── (25/29) first page renders; Load More visibility tracks nextCursor ─
async function testFirstPageAndLoadMore() {
  const withMore = renderInfiniteList([{ items: [item({ ancillaryDocumentReferenceId: 1 }), item({ ancillaryDocumentReferenceId: 2 })], nextCursor: "c2" }]);
  assert.ok(withMore.includes('data-reference-id="1"') && withMore.includes('data-reference-id="2"'), "(25) first page rendered");
  assert.ok(/data-testid="load-more"/.test(withMore), "Load More shown when nextCursor exists");
  // (29) no nextCursor → no Load More.
  const noMore = renderInfiniteList([{ items: [item({ ancillaryDocumentReferenceId: 1 })], nextCursor: null }]);
  assert.ok(!/data-testid="load-more"/.test(noMore), "(29) Load More hidden when no nextCursor");
}

// ─── (26/27) second page appends without duplicates ──────────────
async function testAppendWithoutDuplicates() {
  const html = renderInfiniteList([
    { items: [item({ ancillaryDocumentReferenceId: 1 }), item({ ancillaryDocumentReferenceId: 2 })], nextCursor: "c2" },
    { items: [item({ ancillaryDocumentReferenceId: 2 }), item({ ancillaryDocumentReferenceId: 3 })], nextCursor: null }, // 2 is a dup
  ]);
  for (const id of [1, 2, 3]) assert.ok(html.includes(`data-reference-id="${id}"`), `ref ${id} present`);
  // ref 2 appears exactly once (deduped).
  assert.equal((html.match(/data-reference-id="2"/g) ?? []).length, 1, "(27) duplicate reference id appended once");
  assert.ok(!/data-testid="load-more"/.test(html), "no Load More on the last page");
}

// ─── (28/30) reset-on-filter + loading disables the button ───────
async function testResetAndLoadingGuard() {
  const src = readFileSync(join(ROOT, "client/src/components/ancillary-documents/CanonicalAncillaryDocuments.tsx"), "utf8");
  // (28) the infinite queryKey carries the filter params → a filter change is a
  // new query (pages reset to page one). And params are derived from state.
  assert.ok(/useAncillaryDocumentsInfinite\(params/.test(src), "list uses the infinite query keyed by filter params");
  assert.ok(/queryKey:\s*\["\/api\/ancillary-documents",\s*"infinite",\s*params\]/.test(src), "(28) queryKey includes params → filter change resets pages");
  // (30) the Load More button is disabled while a page is fetching.
  assert.ok(/disabled=\{query\.isFetchingNextPage\}/.test(src), "(30) repeated click while loading is prevented");
  // Error state does not discard loaded records.
  assert.ok(/query\.isError && items\.length > 0/.test(src), "error keeps already-loaded records");
}

// ─── (31) feature OFF → list makes zero canonical requests ───────
async function testListFeatureOff() {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = () => { fetchCalls++; return Promise.resolve(new Response('{"items":[],"nextCursor":null}')); };
  try {
    const html = renderToStaticMarkup(
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(comp.CanonicalAncillaryDocumentsList, { enabled: false })),
    );
    assert.ok(html.includes("canonical-ancillary-documents"), "list still renders shell");
    assert.equal(fetchCalls, 0, "(31) feature OFF issues zero canonical requests");
    assert.ok(!/data-testid="load-more"/.test(html), "no Load More when disabled");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
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
  ["(3/22) ACS/PCS summary is pure; renders case status from items", testAcsPcsSummary],
  ["(21/23) summary + CaseOverview presentation-only; no per-card fetch", testPresentationOnlyNoPerCardFetch],
  ["(4) feature OFF → nothing rendered, zero requests", testFeatureOffZeroRequests],
  ["(24/25) download action renders only for valid pointers", testDownloadActionRendering],
  ["(5) status buckets distinct", testStatusBuckets],
  ["(6) query builder: no identity search", testQueryBuilder],
  ["(7) flag default OFF", testFlagDefaults],
  ["(25/29) first page renders; Load More tracks nextCursor", testFirstPageAndLoadMore],
  ["(26/27) second page appends without duplicates", testAppendWithoutDuplicates],
  ["(28/30) reset-on-filter + loading disables Load More", testResetAndLoadingGuard],
  ["(31) feature OFF → list zero canonical requests", testListFeatureOff],
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

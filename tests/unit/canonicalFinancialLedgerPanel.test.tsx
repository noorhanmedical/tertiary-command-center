// Phase 2J — behavioral render test for the canonical financial ledger panel.
// Verifies: flag OFF ⇒ renders nothing and issues NO request; populated ⇒ claim /
// invoice / payment rows render the server truth as-is (no client recompute);
// per-section unavailable ⇒ explicit note (never a zero); disabled envelope ⇒
// nothing. Uses react-test-renderer (DOM-free) with a seeded QueryClient.
//
//   npx tsx tests/unit/canonicalFinancialLedgerPanel.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanonicalFinancialLedgerPanel } from "../../client/src/components/physician/canonical/CanonicalFinancialLedgerPanel";
import { CANONICAL_FINANCIAL_VIEW_QUERY_KEY } from "../../client/src/components/physician/canonical/useCanonicalFinancialView";
import {
  disabledCanonicalFinancialView, type CanonicalFinancialView, type FinancialSection,
} from "../../shared/canonicalFinancialView";
import { deriveBalance } from "../../server/services/canonicalFinancial/balance";

function sect<Row>(rows: Row[], availability: FinancialSection<Row>["availability"] = "available"): FinancialSection<Row> {
  return { availability, warnings: [], rows, pageInfo: { limit: 25, nextCursor: null, returned: rows.length } };
}
const bal = deriveBalance({ currency: "USD", originalAmountCents: 42000, ledger: [{ currency: "USD", amount: "100.00", eventType: "payment", status: "posted", claimId: 700, invoiceId: 800 } as never] });
function view(over: Partial<CanonicalFinancialView> = {}): CanonicalFinancialView {
  return {
    disabled: false, generatedAt: "2027-06-10T09:00:00.000Z", dataVersion: "canonical_financial_view_v1", clinicScoped: true,
    claims: sect([{ claimId: 700, ancillaryCaseId: 5, serviceType: "BrainWave", patientDisplay: null, status: "ready", claimReady: true, attemptNumber: 1, supersedesClaimId: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", currency: "USD", chargeAmount: "420.00", submissionBlockers: [], warnings: [], submittedAt: null, submissionSource: null, integrity: "resolved", evaluatedAt: null }]),
    invoices: sect([{ invoiceId: 800, ancillaryCaseId: 5, serviceType: "BrainWave", patientDisplay: null, invoiceType: "patient", recipientType: "patient_membership", status: "issued", invoiceNumber: "INV-1", claimId: 700, currency: "USD", totalAmount: "420.00", balance: bal, issuedAt: "2027-06-10T09:00:00.000Z", deliveredAt: null, warnings: [], integrity: "resolved" }]),
    payments: sect([{ paymentId: 900, ancillaryCaseId: 5, claimId: 700, invoiceId: 800, eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "100.00", externalTransactionId: null, reversesPaymentId: null, postedAt: "2027-06-10T09:00:00.000Z", warnings: [] }]),
    ...over,
  };
}

function textOf(json: unknown): string {
  if (json == null) return "";
  if (typeof json === "string") return json;
  if (Array.isArray(json)) return json.map(textOf).join(" ");
  const node = json as { children?: unknown };
  return textOf(node.children ?? "");
}
function findByTestId(root: TestRenderer.ReactTestRenderer, id: string): boolean {
  return root.root.findAll((n) => (n.props as { ["data-testid"]?: string })["data-testid"] === id).length > 0;
}

async function render(enabledOverride: boolean | undefined, seed?: CanonicalFinancialView) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  // Stub fetch: the hook owns its queryFn (builds the URL with cursor params).
  (globalThis as { fetch: unknown }).fetch = async (u: string) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => seed ?? view(), text: async () => "" } as unknown as Response; };
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => { root = TestRenderer.create(React.createElement(QueryClientProvider, { client: qc }, React.createElement(CanonicalFinancialLedgerPanel, { enabledOverride }))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const click = async (testId: string) => { const btn = root.root.findAll((n) => (n.props as { ["data-testid"]?: string })["data-testid"] === testId)[0]; assert.ok(btn, `control ${testId} present`); await act(async () => { (btn.props as { onClick: () => void }).onClick(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const restore = () => { (globalThis as { fetch: unknown }).fetch = realFetch; };
  return { root, fetches: () => urls.length, urls, click, restore };
}

async function testFlagOffRendersNothing() {
  const { root, fetches } = await render(false);
  assert.equal(root.toJSON(), null, "flag OFF ⇒ renders nothing");
  assert.equal(fetches(), 0, "flag OFF ⇒ NO request issued");
}
async function testPopulatedRendersRows() {
  const { root } = await render(true, view());
  assert.ok(findByTestId(root, "canonical-financial-ledger"), "ledger renders");
  const txt = textOf(root.toJSON());
  assert.ok(txt.includes("USD 420.00"), "claim charge shown with currency, as-is");
  assert.ok(txt.includes("INV-1"), "invoice number shown");
  assert.ok(txt.includes("USD 320.00"), "server-derived outstanding balance shown (not recomputed)");
  assert.ok(txt.includes("posted"), "payment event status shown");
  // No revenue-share / profit / card fields anywhere.
  for (const bad of ["revenue share", "profit", "card", "routing"]) assert.ok(!txt.toLowerCase().includes(bad), `no ${bad}`);
}
async function testSectionUnavailableNote() {
  const { root } = await render(true, view({ claims: sect([], "unavailable") }));
  assert.ok(findByTestId(root, "canonical-financial-unavailable"), "unavailable section shows explicit note (never a zero)");
}
async function testUpstreamFlagOffNote() {
  const { root } = await render(true, view({ payments: sect([], "upstream_flag_off") }));
  const txt = textOf(root.toJSON());
  assert.ok(txt.includes("Upstream canonical data is not enabled"), "upstream_flag_off shown truthfully");
}
async function testDisabledEnvelopeRendersNothing() {
  const { root } = await render(true, disabledCanonicalFinancialView("2027-06-10T09:00:00.000Z"));
  assert.equal(root.toJSON(), null, "disabled envelope ⇒ nothing rendered");
}
async function testIndependentCursorControls() {
  // Claims section has a next cursor; clicking Next must issue ONE request carrying
  // ONLY the claims cursor (invoices/payments untouched).
  const paged = view({ claims: { availability: "available", warnings: [], rows: view().claims.rows, pageInfo: { limit: 25, nextCursor: "Y2xhaW1z", returned: 1 } } });
  const { urls, click, restore } = await render(true, paged);
  const initial = urls.length;
  assert.ok(initial >= 1, "initial fetch issued");
  await click("financial-next-claims");
  assert.equal(urls.length, initial + 1, "(70/71) exactly one request per Next click");
  const last = urls[urls.length - 1];
  assert.ok(last.includes("claimsCursor=Y2xhaW1z"), "(69) claims Next carries the claims cursor");
  assert.ok(!last.includes("invoicesCursor") && !last.includes("paymentsCursor"), "independent — other sections' cursors not sent");
  restore();
}

const tests: Array<[string, () => Promise<void>]> = [
  ["flag OFF renders nothing, zero requests", testFlagOffRendersNothing],
  ["populated renders server truth as-is", testPopulatedRendersRows],
  ["section unavailable shows explicit note", testSectionUnavailableNote],
  ["upstream_flag_off shown truthfully", testUpstreamFlagOffNote],
  ["disabled envelope renders nothing", testDisabledEnvelopeRendersNothing],
  ["(69-71) independent cursor controls", testIndependentCursorControls],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();

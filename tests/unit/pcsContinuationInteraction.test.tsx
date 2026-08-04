// Phase 2I — REAL PCS continuation-control interaction (§3).
//
// Renders the ACTUAL production CanonicalLifecycleSection (which mounts the real
// PcsSection used inside WorkspaceWorkQueueComposition) via react-test-renderer
// (DOM-free, runs hooks + effects), mocks global fetch to observe requests, and
// CLICKS the real onClick handlers — asserting each control issues exactly one
// request with the correct typed params and the continuation response renders the
// exact next records. No test-only imitation; production uses the same component
// and handlers exercised here.
//
//   npx tsx tests/unit/pcsContinuationInteraction.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PcsCanonicalView } from "../../shared/pcsCanonicalView";
import type { CaseStageVector, StageStatus } from "../../shared/canonicalStageVector";

(globalThis as unknown as { React: typeof React }).React = React;
const section = await import("@/components/careSpecialist/CanonicalLifecycleSection");

const D = "2027-06-10T09:00:00.000Z";
const st = (o: Partial<StageStatus> = {}): StageStatus => ({ status: o.status ?? null, availability: "available", available: (o.status ?? null) != null, integrity: (o.status ?? null) != null ? "resolved" : "missing", sourceId: null, at: null, warnings: [] });
function vector(id: number): CaseStageVector {
  return { ancillaryCaseId: id, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved",
    identity: { globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", available: true, warnings: [] },
    adminReview: st({ status: "approved" }), engagement: { ...st(), memberships: [], lastSentAt: null },
    appointment: st(), orderNote: st(), procedure: st(), report: st(), procedureNote: st(), signature: st(),
    billingReadiness: { ...st(), billingBlockers: [], claimBlockers: [] }, billingDocument: st(),
    currentStage: "engagement", currentStageIntegrity: "resolved" };
}
function verifiedGroup(membershipId: number, gpp: number, caseIds: number[], episodesNextCursor: string | null = null): PcsCanonicalView["rows"][number] {
  return { globalPlexusPatientId: gpp, patientClinicMembershipId: membershipId, patientDisplay: "Jane Doe", patientDob: null, clinicMrn: "MRN-1", identityAvailable: true, identityWarnings: [], episodes: caseIds.map(vector), episodesNextCursor };
}
function baseView(over: Partial<PcsCanonicalView> = {}): PcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [],
    rows: [], pageInfo: { limit: 25, nextCursor: null, returned: 0 }, unresolved: { rows: [], pageInfo: { limit: 50, nextCursor: null, returned: 0 } }, ...over };
}

// Mock server: the response depends on the exact query params the control sent.
function responseFor(url: string): PcsCanonicalView {
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  if (q.get("episodeMembershipId") === "800" && q.get("episodeCursor") === "EP2") {
    return baseView({ rows: [verifiedGroup(800, 900, [205, 206])], pageInfo: { limit: 25, nextCursor: null, returned: 1 } });
  }
  if (q.get("cursor") === "V2") {
    return baseView({ rows: [verifiedGroup(801, 901, [50])], pageInfo: { limit: 25, nextCursor: null, returned: 1 } });
  }
  if (q.get("unresolvedCursor") === "U2") {
    return baseView({ unresolved: { rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_membership_inactive"], episodes: [vector(999)], episodesNextCursor: null }], pageInfo: { limit: 50, nextCursor: null, returned: 1 } } });
  }
  // initial verified page
  return baseView({
    rows: [verifiedGroup(800, 900, [5, 9], "EP2")], pageInfo: { limit: 25, nextCursor: "V2", returned: 1 },
    unresolved: { rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_membership_missing"], episodes: [vector(700)], episodesNextCursor: null }], pageInfo: { limit: 50, nextCursor: "U2", returned: 1 } },
  });
}

type Harness = { root: TestRenderer.ReactTestRenderer; calls: string[]; click: (testId: string) => Promise<void>; has: (testId: string) => boolean; restore: () => void };
async function mount(enabledOverride: boolean | undefined): Promise<Harness> {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input); calls.push(url);
    return { ok: true, status: 200, text: async () => "", json: async () => responseFor(url) } as Response;
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(section.CanonicalLifecycleSection, { workspaceRole: "patientCareSpecialist", enabledOverride })),
    );
  });
  // Flush the async query result → re-render with data (react-query settles on a
  // microtask; give act a real tick to apply the state update).
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const find = (testId: string) => root.root.findAll((n) => !!n.props && (n.props as Record<string, unknown>)["data-testid"] === testId);
  return {
    root, calls,
    click: async (testId: string) => { const btn = find(testId)[0]; assert.ok(btn, `control ${testId} present`); await act(async () => { (btn.props as { onClick: () => void }).onClick(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    has: (testId: string) => find(testId).length > 0,
    restore: () => { (globalThis as { fetch: unknown }).fetch = realFetch; },
  };
}
const q = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");

// (1-3, 6-9, 11-12) full click journey against the REAL section
async function testInteraction() {
  const h = await mount(true);
  try {
    // (1) initial render → exactly one request, no continuation params
    assert.equal(h.calls.length, 1, "(1) exactly one initial request");
    assert.equal(q(h.calls[0]).toString(), "", "(1) initial request has no continuation params");
    assert.ok(h.has("stage-vector-5") && h.has("stage-vector-9"), "initial verified episodes rendered");

    // (2) Next patients → one request with cursor=V2
    await h.click("pcs-verified-next");
    assert.equal(h.calls.length, 2, "(12) exactly one additional request per click");
    assert.equal(q(h.calls[1]).get("cursor"), "V2", "(2) Next patients sends cursor=V2");
    assert.ok(h.has("stage-vector-50"), "next verified page rendered");

    // (3) First patients → initial verified page (no cursor)
    await h.click("pcs-verified-first");
    assert.equal(h.calls.length, 3);
    assert.equal(q(h.calls[2]).get("cursor"), null, "(3) First patients requests the initial verified page");

    // (4) Next unavailable → unresolvedCursor=U2
    await h.click("pcs-unresolved-next");
    assert.equal(h.calls.length, 4);
    assert.equal(q(h.calls[3]).get("unresolvedCursor"), "U2", "(4) Next unavailable sends unresolvedCursor=U2");
    assert.equal(q(h.calls[3]).get("cursor"), null, "(11) unresolved request carries no verified cursor");

    // (5) First unavailable → first unresolved page
    await h.click("pcs-unresolved-first");
    assert.equal(h.calls.length, 5);
    assert.equal(q(h.calls[4]).get("unresolvedCursor"), null, "(5) First unavailable requests the first unresolved page");

    // (6/7) Load next episodes for patient 800 → episode params + renders next records
    await h.click("pcs-episodes-next-800");
    assert.equal(h.calls.length, 6);
    assert.equal(q(h.calls[5]).get("episodeMembershipId"), "800", "(6) episode continuation carries the exact membership id");
    assert.equal(q(h.calls[5]).get("episodeCursor"), "EP2", "(6) episode continuation carries the exact episode cursor");
    assert.equal(q(h.calls[5]).get("cursor"), null, "(11) episode mode sends ONLY episode params");
    assert.ok(h.has("stage-vector-205") && h.has("stage-vector-206"), "(7) continuation response renders the exact next ancillaryCaseIds");

    // (8) Back to patients → returns to verified page, no incorrect continuation param
    await h.click("pcs-episodes-back");
    assert.equal(h.calls.length, 7);
    assert.equal(q(h.calls[6]).get("episodeMembershipId"), null, "(8) Back to patients issues no episode continuation");
  } finally { h.restore(); }
}

// (9) merely displaying continuation buttons issues no request beyond the initial
async function testNoRequestFromDisplay() {
  const h = await mount(true);
  try {
    assert.ok(h.has("pcs-verified-next") && h.has("pcs-episodes-next-800"), "continuation controls are displayed");
    assert.equal(h.calls.length, 1, "(9) displaying controls does not issue a continuation request");
  } finally { h.restore(); }
}

// (10) flag OFF → no canonical section, zero requests
async function testFlagOffZeroRequests() {
  const h = await mount(false);
  try {
    assert.equal(h.calls.length, 0, "(10) flag OFF performs zero canonical requests");
    assert.ok(!h.has("canonical-lifecycle-pcs"), "(10) no canonical section rendered when OFF");
  } finally { h.restore(); }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1-8,11,12) real continuation click journey", testInteraction],
  ["(9) display alone issues no request", testNoRequestFromDisplay],
  ["(10) flag OFF zero requests", testFlagOffZeroRequests],
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

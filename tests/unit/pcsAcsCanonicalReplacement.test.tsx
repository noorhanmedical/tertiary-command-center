// Phase 2I retrievability closeout — REAL production composition + PCS continuation
// controls (behavioral) + canonical rendering + shell preservation.
//
//   npx tsx tests/unit/pcsAcsCanonicalReplacement.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CaseStageVector, StageStatus } from "../../shared/canonicalStageVector";
import type { PcsCanonicalView } from "../../shared/pcsCanonicalView";
import type { AcsCanonicalView } from "../../shared/acsCanonicalView";
import { disabledPcsCanonicalView } from "../../shared/pcsCanonicalView";
import {
  pcsPaginationReducer, pcsRequestParams, pcsQueryKey, pcsQueryString, INITIAL_PCS_PAGINATION,
} from "../../client/src/components/careSpecialist/pcsPagination";

(globalThis as unknown as { React: typeof React }).React = React;
const pcsComp = await import("@/components/careSpecialist/CanonicalPcsPage");
const acsComp = await import("@/components/careSpecialist/CanonicalAcsPage");
const comp = await import("@/components/careSpecialist/WorkspaceWorkQueueComposition");
const section = await import("@/components/careSpecialist/CanonicalLifecycleSection");
const modeSwitcher = await import("@/components/portal/WorkspaceModeSwitcher");
const pcsFlag = await import("@/lib/pcsCanonicalViewFlag");
const acsFlag = await import("@/lib/acsCanonicalViewFlag");

const ROOT = process.cwd();
const D = "2027-06-10T09:00:00.000Z";
const st = (o: Partial<StageStatus> = {}): StageStatus => ({ status: o.status ?? null, availability: o.availability ?? "available", available: o.available ?? ((o.availability ?? "available") === "available" && (o.status ?? null) != null), integrity: o.integrity ?? ((o.status ?? null) != null ? "resolved" : "missing"), sourceId: o.sourceId ?? null, at: o.at ?? null, warnings: o.warnings ?? [] });
function vector(over: Partial<CaseStageVector> = {}): CaseStageVector {
  return {
    ancillaryCaseId: 5, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved",
    identity: { globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", available: true, warnings: [] },
    adminReview: st({ status: "approved" }), engagement: { ...st({ status: "member" }), memberships: [], lastSentAt: D },
    appointment: st({ status: "scheduled", at: D }), orderNote: st({ status: "signed", at: D }),
    procedure: st({ status: "complete", at: D }), report: st({ status: "uploaded" }),
    procedureNote: st({ status: "signed" }), signature: st({ status: "signed" }),
    billingReadiness: { ...st({ status: "ready_to_generate" }), billingBlockers: [], claimBlockers: [] },
    billingDocument: st({ status: "generated" }),
    currentStage: null, currentStageIntegrity: "resolved", ...over,
  };
}
function group(over: Partial<PcsCanonicalView["rows"][number]> = {}): PcsCanonicalView["rows"][number] {
  return { globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", identityAvailable: true, identityWarnings: [], episodes: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })], episodesNextCursor: null, ...over };
}
function pcsView(over: Partial<PcsCanonicalView> = {}): PcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 1 },
    rows: [group()], unresolved: { rows: [], pageInfo: { limit: 50, nextCursor: null, returned: 0 } }, ...over };
}
function acsView(over: Partial<AcsCanonicalView> = {}): AcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 2 }, rows: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })], ...over };
}
const MOCK = ["RingCentral", "Left Voicemail", "Invoice", "Revenue", "Claim", "Payment"];
function assertNoMock(html: string, label: string) { const low = html.toLowerCase(); for (const tok of MOCK) assert.ok(!low.includes(tok.toLowerCase()), `${label} must not render mock token: ${tok}`); assert.ok(!/\$\d/.test(html), `${label} no dollar figures`); }

// Render the REAL production composition (mode switcher header + canonical section
// in the scrollable body + mode-body children) exactly as TeamPortalShell does.
function renderComposition(opts: { role: "patientCareSpecialist" | "ancillaryCareSpecialist"; canonicalEnabled?: boolean; pcs?: PcsCanonicalView; acs?: AcsCanonicalView }): string {
  const qc = new QueryClient();
  if (opts.pcs) qc.setQueryData(pcsQueryKey(pcsRequestParams(INITIAL_PCS_PAGINATION)), opts.pcs);
  if (opts.acs) qc.setQueryData(["/api/acs/canonical-view", ""], opts.acs);
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(comp.WorkspaceWorkQueueComposition, {
      header: React.createElement(modeSwitcher.WorkspaceModeSwitcher, { activeMode: opts.role === "patientCareSpecialist" ? "callList" : "clinicSchedule", onModeChange: () => {}, counts: { callList: 3, clinicSchedule: 2, ancillarySchedule: 1 } }),
      canonicalSection: React.createElement(section.CanonicalLifecycleSection, { workspaceRole: opts.role, enabledOverride: opts.canonicalEnabled }),
      children: React.createElement("div", { "data-testid": "mode-body" }, "existing mode body"),
    }) as React.ReactElement));
}

// (1/2/4/5/6/7) real composition renders switcher + section (ON) / nothing (OFF) +
// mode body; section is in the scrollable body, not the sticky header.
async function testRealCompositionPcs() {
  const on = renderComposition({ role: "patientCareSpecialist", canonicalEnabled: true, pcs: pcsView() });
  assert.ok(on.includes("workspace-mode-switcher"), "(1) real WorkspaceModeSwitcher renders");
  assert.ok(on.includes("workspace-work-queue-body"), "canonical section is in the scrollable body");
  assert.ok(on.includes("canonical-lifecycle-pcs") && on.includes("stage-vector-5"), "(4) canonical section renders in the same production composition when ON");
  assert.ok(on.includes("mode-body"), "(6) existing mode body remains mounted through the composition");
  assert.ok(!/min-h-screen/.test(on), "(7) no standalone/min-h-screen page");
  // section must NOT be inside the sticky header
  const sticky = on.split("workspace-work-queue-body")[0];
  assert.ok(!sticky.includes("canonical-lifecycle-pcs"), "(§4) canonical list is NOT inside the sticky mode header");
  assertNoMock(on, "PCS composition");
  const off = renderComposition({ role: "patientCareSpecialist", canonicalEnabled: false });
  assert.ok(off.includes("workspace-mode-switcher") && off.includes("mode-body"), "(OFF) switcher + mode body preserved");
  assert.ok(!off.includes("canonical-lifecycle-pcs") && !off.includes("stage-vector-"), "(5) canonical section renders nothing when OFF");
}
async function testRealCompositionAcs() {
  const on = renderComposition({ role: "ancillaryCareSpecialist", canonicalEnabled: true, acs: acsView() });
  assert.ok(on.includes("workspace-mode-switcher") && on.includes("canonical-lifecycle-acs") && on.includes("stage-vector-5") && on.includes("mode-body"), "(2) ACS composition renders switcher + section + mode body");
}

// (§2) PCS continuation controls: the pure pagination logic issues the correct
// request params for each control action (behavioral, not static).
async function testPaginationControls() {
  const base = pcsRequestParams(INITIAL_PCS_PAGINATION);
  assert.deepEqual(base, { cursor: null, unresolvedCursor: null, episodeMembershipId: null, episodeCursor: null }, "initial params");
  const vNext = pcsRequestParams(pcsPaginationReducer(INITIAL_PCS_PAGINATION, { type: "verifiedNext", cursor: "V2" }));
  assert.equal(vNext.cursor, "V2"); assert.equal(vNext.episodeMembershipId, null, "verified next → cursor only");
  const uNext = pcsRequestParams(pcsPaginationReducer(INITIAL_PCS_PAGINATION, { type: "unresolvedNext", cursor: "U2" }));
  assert.equal(uNext.unresolvedCursor, "U2"); assert.equal(uNext.cursor, null, "unresolved next → unresolvedCursor only");
  const ep = pcsPaginationReducer(INITIAL_PCS_PAGINATION, { type: "episodeNext", membershipId: 800, cursor: "E2" });
  const epParams = pcsRequestParams(ep);
  assert.equal(epParams.episodeMembershipId, 800); assert.equal(epParams.episodeCursor, "E2");
  assert.equal(epParams.cursor, null); assert.equal(epParams.unresolvedCursor, null, "episode mode sends ONLY episode params");
  assert.equal(pcsQueryString(epParams), "?episodeMembershipId=800&episodeCursor=E2", "episode continuation query string");
  assert.equal(pcsQueryString(vNext), "?cursor=V2");
  const back = pcsRequestParams(pcsPaginationReducer(ep, { type: "episodeBack" }));
  assert.equal(back.episodeMembershipId, null, "episode back → exits continuation mode");
  // distinct states produce distinct query keys (one request per state)
  const keys = new Set([base, vNext, uNext, epParams].map((p) => pcsQueryKey(p).join("|")));
  assert.equal(keys.size, 4, "(§2) every continuation contract is a distinct request key");
}

// (§2) the real PCS section renders each continuation control + episode button
async function testControlsRender() {
  const qc = new QueryClient();
  const data = pcsView({ rows: [group({ patientClinicMembershipId: 800, episodesNextCursor: "EP2" })], pageInfo: { limit: 25, nextCursor: "V2", returned: 1 }, unresolved: { rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_membership_inactive"], episodes: [vector({ ancillaryCaseId: 7 })], episodesNextCursor: null }], pageInfo: { limit: 50, nextCursor: "U2", returned: 1 } } });
  qc.setQueryData(pcsQueryKey(pcsRequestParams(INITIAL_PCS_PAGINATION)), data);
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(section.CanonicalLifecycleSection, { workspaceRole: "patientCareSpecialist", enabledOverride: true })));
  for (const id of ["pcs-verified-next", "pcs-unresolved-next", "pcs-episodes-next-800"]) assert.ok(html.includes(id), `${id} control rendered`);
  assert.ok(html.includes("Identity unavailable (1)"), "(§6) unresolved count shows returned rows (1), not scanned");
}

// canonical continuation view renders the next exact records
async function testContinuationViewRenders() {
  const cont = pcsView({ rows: [group({ patientClinicMembershipId: 800, episodes: [vector({ ancillaryCaseId: 205 }), vector({ ancillaryCaseId: 206 })], episodesNextCursor: null })] });
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: cont }));
  assert.ok(html.includes("stage-vector-205") && html.includes("stage-vector-206"), "continuation renders the next exact episodes");
}
async function testAcsViewRenders() {
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("current-stage-5")); assertNoMock(html, "ACS view");
}
async function testFlagsDefaultOff() { assert.equal(pcsFlag.isPcsCanonicalViewEnabled(), false); assert.equal(acsFlag.isAcsCanonicalViewEnabled(), false); }
async function testShellUsesComposition() {
  const shell = readFileSync(join(ROOT, "client/src/components/portal/TeamPortalShell.tsx"), "utf8");
  assert.ok(/<WorkspaceWorkQueueComposition/.test(shell), "shell uses the real composition");
  assert.ok(/canonicalSection=\{<CanonicalLifecycleSection/.test(shell), "shell passes the canonical section to the composition");
  assert.ok(/<WorkspaceModeSwitcher/.test(shell), "shell keeps the sticky WorkspaceModeSwitcher");
  assert.ok(/activeWorkspaceMode === "clinicSchedule"/.test(shell) && /workspace-mode-body-callList/.test(shell), "shell mode bodies preserved (passed as children)");
  const pcsPage = readFileSync(join(ROOT, "client/src/pages/patient-care-specialist-portal.tsx"), "utf8");
  assert.ok(/return <ClinicWorkflowPortal role="patientCareSpecialist"/.test(pcsPage) && !/min-h-screen/.test(pcsPage), "PCS page always mounts the shell, no standalone page");
}
// Phase 2J owns migration 0056 (canonical claim/invoice/payment lifecycle); the
// forbidden-next boundary is now 0057.
async function testNoMigration0057() { const { readdirSync } = await import("node:fs"); assert.ok(!readdirSync(join(ROOT, "migrations")).some((f) => f.startsWith("0057")), "no migration 0057"); }

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/4/5/6/7) real composition PCS", testRealCompositionPcs],
  ["(2) real composition ACS", testRealCompositionAcs],
  ["(§2) pagination control params", testPaginationControls],
  ["(§2/§6) continuation controls render", testControlsRender],
  ["continuation view renders next records", testContinuationViewRenders],
  ["ACS view renders, no mock", testAcsViewRenders],
  ["flags default OFF", testFlagsDefaultOff],
  ["shell uses production composition", testShellUsesComposition],
  ["no migration 0057", testNoMigration0057],
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

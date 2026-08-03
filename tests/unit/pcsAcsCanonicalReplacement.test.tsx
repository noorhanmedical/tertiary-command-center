// Phase 2I final acceptance — REAL shell-composition behavioral coverage (§7) +
// canonical rendering + shell preservation.
//
// Renders the REAL production WorkspaceCanonicalHeader (WorkspaceModeSwitcher +
// CanonicalLifecycleSection + mode-body children) — the exact composition
// TeamPortalShell uses — via react-dom/server with a seeded React Query cache, and
// proves: the mode switcher + its modes render, the canonical section renders
// INSIDE the same composition when ON (nothing when OFF), the mode body stays
// mounted, and no standalone/min-h-screen page appears. Also renders the pure
// canonical views (no mock content) and checks shell-preservation structurally.
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

(globalThis as unknown as { React: typeof React }).React = React;
const pcsComp = await import("@/components/careSpecialist/CanonicalPcsPage");
const acsComp = await import("@/components/careSpecialist/CanonicalAcsPage");
const header = await import("@/components/careSpecialist/WorkspaceCanonicalHeader");
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
function pcsView(over: Partial<PcsCanonicalView> = {}): PcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 1 },
    rows: [{ globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", identityAvailable: true, identityWarnings: [], episodes: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })], episodesNextCursor: null }],
    unresolved: { rows: [], pageInfo: { limit: 50, nextCursor: null, returned: 0 } }, ...over };
}
function acsView(over: Partial<AcsCanonicalView> = {}): AcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 2 }, rows: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })], ...over };
}
// Financial / legacy-call mock tokens the canonical path must never render. NB:
// "Call List"/"Clinic Schedule" are REAL WorkspaceModeSwitcher labels (the
// preserved shell) and are intentionally NOT treated as mock.
const MOCK = ["RingCentral", "Left Voicemail", "Invoice", "Revenue", "Claim", "Payment"];
function assertNoMock(html: string, label: string) { const low = html.toLowerCase(); for (const tok of MOCK) assert.ok(!low.includes(tok.toLowerCase()), `${label} must not render mock token: ${tok}`); assert.ok(!/\$\d/.test(html), `${label} no dollar figures`); }

function renderHeader(opts: { role: "patientCareSpecialist" | "ancillaryCareSpecialist"; canonicalEnabled?: boolean; pcs?: PcsCanonicalView; acs?: AcsCanonicalView }): string {
  const qc = new QueryClient();
  if (opts.pcs) qc.setQueryData(["/api/pcs/canonical-view", ""], opts.pcs);
  if (opts.acs) qc.setQueryData(["/api/acs/canonical-view", ""], opts.acs);
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(header.WorkspaceCanonicalHeader, {
      activeMode: opts.role === "patientCareSpecialist" ? "callList" : "clinicSchedule",
      onModeChange: () => {}, counts: { callList: 3, clinicSchedule: 2, ancillarySchedule: 1 },
      workspaceRole: opts.role, canonicalEnabled: opts.canonicalEnabled,
      children: React.createElement("div", { "data-testid": "mode-body" }, "existing mode body"),
    }) as React.ReactElement));
}

// (1/3/5/6/8) PCS flag ON: mode switcher + modes render, canonical section renders
// INSIDE the same composition, mode body stays mounted, no standalone page.
async function testRealShellCompositionPcsOn() {
  const html = renderHeader({ role: "patientCareSpecialist", canonicalEnabled: true, pcs: pcsView() });
  assert.ok(html.includes("workspace-mode-switcher"), "(1) real WorkspaceModeSwitcher rendered");
  assert.ok(html.includes("workspace-canonical-header"), "composition boundary rendered");
  assert.ok(/Calls?|Call List|Outreach/i.test(html) || html.includes("mode-callList") || html.includes("PhoneCall"), "(3) callList mode present in switcher");
  assert.ok(html.includes("canonical-lifecycle-pcs") && html.includes("stage-vector-5"), "(5) canonical section renders inside the composition");
  assert.ok(html.includes("mode-body"), "(6) existing mode body remains mounted");
  assert.ok(!/min-h-screen/.test(html), "(8) no standalone/min-h-screen page");
  assertNoMock(html, "PCS composition");
}
// (2/4) ACS flag ON
async function testRealShellCompositionAcsOn() {
  const html = renderHeader({ role: "ancillaryCareSpecialist", canonicalEnabled: true, acs: acsView() });
  assert.ok(html.includes("workspace-mode-switcher"), "(2) mode switcher rendered");
  assert.ok(html.includes("canonical-lifecycle-acs") && html.includes("stage-vector-5"), "canonical section inside composition");
  assert.ok(html.includes("mode-body"), "mode body mounted");
}
// (7/9) flag OFF: section renders NOTHING, mode switcher + mode body preserved
async function testRealShellCompositionOff() {
  const html = renderHeader({ role: "patientCareSpecialist", canonicalEnabled: false });
  assert.ok(html.includes("workspace-mode-switcher"), "mode switcher preserved when canonical OFF");
  assert.ok(html.includes("mode-body"), "(9) existing mode body not replaced");
  assert.ok(!html.includes("canonical-lifecycle-pcs") && !html.includes("stage-vector-"), "(7) canonical section renders nothing when OFF");
}

// canonical views render (no mock), episodes preserved
async function testPcsViewRenders() {
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: pcsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("stage-vector-9") && html.includes("Jane Doe"));
  assertNoMock(html, "PCS view");
}
async function testAcsViewRenders() {
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("current-stage-5"));
  assertNoMock(html, "ACS view");
}
async function testUnresolvedIdentityRenders() {
  const data = pcsView({ rows: [], unresolved: { rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_membership_inactive"], episodes: [vector({ ancillaryCaseId: 5 })], episodesNextCursor: null }], pageInfo: { limit: 50, nextCursor: null, returned: 1 } } });
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data }));
  assert.ok(html.includes("pcs-identity-unavailable") && html.includes("identity_membership_inactive"), "unresolved identity surfaced without PHI");
}
async function testFlagsDefaultOff() {
  assert.equal(pcsFlag.isPcsCanonicalViewEnabled(), false); assert.equal(acsFlag.isAcsCanonicalViewEnabled(), false);
}

// shell preservation (structural, supplemental): pages always mount the shell; the
// shell composes via WorkspaceCanonicalHeader; no standalone canonical page.
async function testShellPreservedStructural() {
  for (const [f, role] of [["patient-care-specialist-portal.tsx", "patientCareSpecialist"], ["ancillary-care-specialist-portal.tsx", "ancillaryCareSpecialist"]] as const) {
    const src = readFileSync(join(ROOT, "client/src/pages", f), "utf8");
    assert.ok(new RegExp(`return <ClinicWorkflowPortal role="${role}"`).test(src), `${f} always mounts the shell`);
    assert.ok(!/CanonicalPcsPage|CanonicalAcsPage|min-h-screen|isPcsCanonicalViewEnabled|isAcsCanonicalViewEnabled/.test(src), `${f} no standalone canonical page/branch`);
  }
  const shell = readFileSync(join(ROOT, "client/src/components/portal/TeamPortalShell.tsx"), "utf8");
  assert.ok(/<WorkspaceCanonicalHeader/.test(shell), "shell composes canonical via WorkspaceCanonicalHeader");
  assert.ok(/activeWorkspaceMode === "clinicSchedule"/.test(shell) && /workspace-mode-body-callList/.test(shell), "shell mode bodies preserved");
  const section = readFileSync(join(ROOT, "client/src/components/careSpecialist/CanonicalLifecycleSection.tsx"), "utf8");
  assert.ok(/if \(!enabled\) return null/.test(section) && !/mockData|usePortalData/.test(section), "section self-gates, no mock source");
}
async function testNoMigration0056() {
  const { readdirSync } = await import("node:fs");
  assert.ok(!readdirSync(join(ROOT, "migrations")).some((f) => f.startsWith("0056")), "no migration 0056");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/3/5/6/8) real shell composition PCS ON", testRealShellCompositionPcsOn],
  ["(2/4) real shell composition ACS ON", testRealShellCompositionAcsOn],
  ["(7/9) real shell composition canonical OFF", testRealShellCompositionOff],
  ["PCS view renders, no mock", testPcsViewRenders],
  ["ACS view renders, no mock", testAcsViewRenders],
  ["unresolved identity surfaced without PHI", testUnresolvedIdentityRenders],
  ["flags default OFF", testFlagsDefaultOff],
  ["shell preserved (structural)", testShellPreservedStructural],
  ["no migration 0056", testNoMigration0056],
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

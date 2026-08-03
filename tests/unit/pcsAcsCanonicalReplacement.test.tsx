// Phase 2I truth closeout — behavioral canonical rendering + shell-preservation.
//
// Renders the REAL pure canonical views (what the in-shell CanonicalLifecycleSection
// renders when its flag is ON) via react-dom/server with a crafted DTO, and asserts
// canonical stage-vector rows render with no mock content and truthful states.
// Shell PRESERVATION (§2/§8): the two portal pages ALWAYS mount ClinicWorkflowPortal
// (no standalone canonical page); TeamPortalShell mounts the CanonicalLifecycleSection
// AND still renders the WorkspaceModeSwitcher + its modes; the section self-gates on
// the flag.
//
// NOTE: the portal shell subtree imports assets/CSS the tsx runner cannot transform
// (the repo has no jsdom runner), so the full 3,961-line shell cannot be
// server-rendered here; shell preservation is verified against the real shell source
// composition PLUS a behavioral render of the canonical content it embeds.
//
//   npx tsx tests/unit/pcsAcsCanonicalReplacement.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CaseStageVector, StageStatus } from "../../shared/canonicalStageVector";
import type { PcsCanonicalView } from "../../shared/pcsCanonicalView";
import type { AcsCanonicalView } from "../../shared/acsCanonicalView";
import { disabledPcsCanonicalView } from "../../shared/pcsCanonicalView";
import { disabledAcsCanonicalView } from "../../shared/acsCanonicalView";

(globalThis as unknown as { React: typeof React }).React = React;
const pcsComp = await import("@/components/careSpecialist/CanonicalPcsPage");
const acsComp = await import("@/components/careSpecialist/CanonicalAcsPage");
const pcsFlag = await import("@/lib/pcsCanonicalViewFlag");
const acsFlag = await import("@/lib/acsCanonicalViewFlag");

const ROOT = process.cwd();
const D = "2027-06-10T09:00:00.000Z";
const st = (o: Partial<StageStatus> = {}): StageStatus => ({ status: o.status ?? null, availability: o.availability ?? "available", available: o.available ?? ((o.availability ?? "available") === "available" && (o.status ?? null) != null), sourceId: o.sourceId ?? null, at: o.at ?? null, warnings: o.warnings ?? [] });
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
    rows: [{ globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", identityAvailable: true, identityWarnings: [], episodes: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })] }], ...over };
}
function acsView(over: Partial<AcsCanonicalView> = {}): AcsCanonicalView {
  return { disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true, availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 2 }, rows: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })], ...over };
}
const MOCK = ["Call List", "Outreach", "Clinic Schedule", "RingCentral", "Left Voicemail", "Invoice", "Revenue", "Claim"];
function assertNoMock(html: string, label: string) {
  const low = html.toLowerCase();
  for (const tok of MOCK) assert.ok(!low.includes(tok.toLowerCase()), `${label} must not render mock token: ${tok}`);
  assert.ok(!/\$\d/.test(html), `${label} must not render dollar figures`);
}

// (8) canonical stage vectors render (PCS grouped episodes, no mock)
async function testPcsRenders() {
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: pcsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("stage-vector-9"), "both episodes render");
  assert.ok(html.includes("Jane Doe") && html.includes("stage-billingDocument-5"), "full stage vector + display render");
  assertNoMock(html, "PCS canonical");
}
async function testAcsRenders() {
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("stage-vector-9"), "one row per case");
  assert.ok(html.includes("current-stage-5"), "currentStage rendered");
  assertNoMock(html, "ACS canonical");
}
async function testNoFalseCurrentStage() {
  const v = vector({ ancillaryCaseId: 5, appointment: st({ availability: "available", status: null, warnings: ["duplicate_current_evidence"] }), currentStage: null, currentStageIntegrity: "conflicting" });
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ rows: [v] }) }));
  assert.ok(html.includes("(integrity)"), "conflicting integrity shown, not a false stage");
}
async function testTruthfulStates() {
  const off = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [] }) }));
  assert.ok(off.includes("acs-upstream-off") && !off.includes("stage-vector-"), "upstream-off, no rows");
  const empty = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ rows: [] }) }));
  assert.ok(empty.includes("acs-empty"));
  assert.ok(renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: disabledPcsCanonicalView(D, 25) })).includes("pcs-disabled"));
  assert.ok(renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: disabledAcsCanonicalView(D, 25) })).includes("acs-disabled"));
}
async function testPcsMissingIdentity() {
  const data = pcsView({ rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_membership_missing"], episodes: [vector({ ancillaryCaseId: 5 })] }] });
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data }));
  assert.ok(html.includes("pcs-identity-unavailable") && html.includes("identity_membership_missing"), "identity-unavailable surfaced, no demographic fallback");
}
async function testFlagsDefaultOff() {
  assert.equal(pcsFlag.isPcsCanonicalViewEnabled(), false, "PCS client flag default OFF");
  assert.equal(acsFlag.isAcsCanonicalViewEnabled(), false, "ACS client flag default OFF");
}

// (1/2/10) shell PRESERVED: pages ALWAYS mount ClinicWorkflowPortal — NO standalone
// canonical page; NO flag branch removing the shell.
async function testShellPreserved() {
  const pcsPage = readFileSync(join(ROOT, "client/src/pages/patient-care-specialist-portal.tsx"), "utf8");
  const acsPage = readFileSync(join(ROOT, "client/src/pages/ancillary-care-specialist-portal.tsx"), "utf8");
  for (const [name, src, roleAttr] of [["PCS", pcsPage, "patientCareSpecialist"], ["ACS", acsPage, "ancillaryCareSpecialist"]] as const) {
    assert.ok(new RegExp(`return <ClinicWorkflowPortal role="${roleAttr}"`).test(src), `(1/2) ${name} page always mounts ClinicWorkflowPortal`);
    assert.ok(!/CanonicalPcsPage|CanonicalAcsPage|min-h-screen|isPcsCanonicalViewEnabled|isAcsCanonicalViewEnabled/.test(src), `(9/10) ${name} page has no standalone canonical page / flag branch`);
  }
  // the removed standalone pages must not re-appear as exported page containers
  for (const f of ["CanonicalPcsPage.tsx", "CanonicalAcsPage.tsx"]) {
    const src = readFileSync(join(ROOT, "client/src/components/careSpecialist", f), "utf8");
    assert.ok(!/min-h-screen/.test(src), `(9) ${f} is a pure in-shell view, not a standalone min-h-screen page`);
    assert.ok(!/export function Canonical\w+Page\b/.test(src), `(9) ${f} exports no standalone Page container`);
  }
}

// (3/6/8) shell still renders WorkspaceModeSwitcher + modes AND mounts the canonical
// section (integrated inside the shell, not a parallel page).
async function testShellMountsSectionAndModes() {
  const shell = readFileSync(join(ROOT, "client/src/components/portal/TeamPortalShell.tsx"), "utf8");
  assert.ok(/<CanonicalLifecycleSection\s+workspaceRole=/.test(shell), "(8) shell mounts CanonicalLifecycleSection inside itself");
  assert.ok(/<WorkspaceModeSwitcher/.test(shell), "(3) shell still renders WorkspaceModeSwitcher");
  assert.ok(/activeWorkspaceMode === "clinicSchedule"/.test(shell) && /workspace-mode-body-callList/.test(shell), "(4/5) callList + clinicSchedule modes preserved");
  // the section self-gates on the flag (zero render / zero request when OFF)
  const section = readFileSync(join(ROOT, "client/src/components/careSpecialist/CanonicalLifecycleSection.tsx"), "utf8");
  assert.ok(/if \(!enabled\) return null/.test(section), "(10/11) section self-gates on the flag (no render/request when OFF)");
  assert.ok(!/mockData|usePortalData/.test(section), "section imports no mock operational source");
}
async function testNoMigration0056() {
  const { readdirSync } = await import("node:fs");
  assert.ok(!readdirSync(join(ROOT, "migrations")).some((f) => f.startsWith("0056")), "(42) no migration 0056");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(8) PCS canonical renders, no mock", testPcsRenders],
  ["(8) ACS canonical renders, no mock", testAcsRenders],
  ["conflict → no false current stage", testNoFalseCurrentStage],
  ["truthful states", testTruthfulStates],
  ["PCS missing identity truthful", testPcsMissingIdentity],
  ["flags default OFF", testFlagsDefaultOff],
  ["(1/2/9/10) shell preserved, no standalone page", testShellPreserved],
  ["(3/4/5/8) shell mounts section + modes", testShellMountsSectionAndModes],
  ["(42) no migration 0056", testNoMigration0056],
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

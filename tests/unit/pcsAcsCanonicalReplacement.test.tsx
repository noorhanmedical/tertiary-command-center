// Phase 2I — behavioral component test for the PCS/ACS flag-ON canonical
// replacement + flag-OFF legacy preservation.
//
// Renders the REAL canonical views (CanonicalPcsView / CanonicalAcsView — exactly
// what the surfaces render when their flag is ON) via react-dom/server with a
// crafted server DTO, and asserts canonical stage-vector ROWS render, no mock
// content appears, and truthful states never show a false current stage. Also
// asserts the flag libs default OFF and the page files branch on the flag.
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
const st = (o: Partial<StageStatus> = {}): StageStatus => ({ status: o.status ?? null, availability: o.availability ?? "available", available: (o.availability ?? "available") === "available", sourceId: o.sourceId ?? null, at: o.at ?? null, warnings: o.warnings ?? [] });

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
    currentStage: "billingDocument", currentStageIntegrity: "resolved", ...over,
  };
}
function pcsView(over: Partial<PcsCanonicalView> = {}): PcsCanonicalView {
  return {
    disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true,
    availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 1 },
    rows: [{ globalPlexusPatientId: 900, patientClinicMembershipId: 800, patientDisplay: "Jane Doe", patientDob: "1980-01-01", clinicMrn: "MRN-1", identityAvailable: true, identityWarnings: [], episodes: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })] }],
    ...over,
  };
}
function acsView(over: Partial<AcsCanonicalView> = {}): AcsCanonicalView {
  return {
    disabled: false, generatedAt: D, dataVersion: "canonical_stage_vector_v1", clinicScoped: true,
    availability: "available", warnings: [], pageInfo: { limit: 25, nextCursor: null, returned: 2 },
    rows: [vector({ ancillaryCaseId: 5 }), vector({ ancillaryCaseId: 9 })],
    ...over,
  };
}

// Mock/prototype tokens from the legacy TeamPortalShell workspace — must NEVER
// appear in canonical mode.
const MOCK = ["Call List", "Outreach", "Clinic Schedule", "Ancillary Schedule", "RingCentral", "Left Voicemail", "Invoice", "Revenue", "Claim", "$"];

function assertNoMock(html: string, label: string) {
  const low = html.toLowerCase();
  for (const tok of MOCK) if (tok !== "$") assert.ok(!low.includes(tok.toLowerCase()), `${label} must not render mock token: ${tok}`);
  assert.ok(!/\$\d/.test(html), `${label} must not render dollar figures`);
}

// (14/15/16/17) canonical PCS renders stage-vector rows, no mock, episodes preserved
async function testPcsCanonicalRenders() {
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: pcsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("stage-vector-9"), "(14) both episode stage vectors rendered");
  assert.ok(html.includes("Jane Doe"), "authorized display rendered");
  assert.ok(html.includes("stage-adminReview-5") && html.includes("stage-billingDocument-5"), "(58) full stage vector rendered");
  assertNoMock(html, "(12/17) PCS canonical");
}

// (13/15/16) canonical ACS renders one row per case, no mock
async function testAcsCanonicalRenders() {
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView() }));
  assert.ok(html.includes("stage-vector-5") && html.includes("stage-vector-9"), "(15/61) one row per exact case");
  assert.ok(html.includes("current-stage-5"), "(63) currentStage rendered");
  assertNoMock(html, "(13) ACS canonical");
}

// (52/53) a conflicting/failed stage renders no false current stage
async function testNoFalseCurrentStage() {
  const v = vector({ ancillaryCaseId: 5, procedure: st({ availability: "unavailable", warnings: ["procedure_read_failed"] }), currentStage: null, currentStageIntegrity: "conflicting" });
  const html = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ rows: [v] }) }));
  assert.ok(html.includes("(integrity)"), "conflicting integrity shown, not a false stage");
  assert.ok(!/current: Billing Document/.test(html), "no advanced current stage under conflict");
}

// upstream_flag_off / unavailable / empty / disabled truthful states (no zero rows implied as success)
async function testTruthfulStates() {
  const off = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ availability: "upstream_flag_off", warnings: ["ancillary_case_flag_off"], rows: [] }) }));
  assert.ok(off.includes("acs-upstream-off"), "upstream_flag_off shown");
  assert.ok(!off.includes("stage-vector-"), "no rows under upstream-off");
  const empty = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: acsView({ rows: [] }) }));
  assert.ok(empty.includes("acs-empty"), "empty available state shown");
  const disabledP = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data: disabledPcsCanonicalView(D, 25) }));
  assert.ok(disabledP.includes("pcs-disabled"), "disabled contract shown");
  const disabledA = renderToStaticMarkup(React.createElement(acsComp.CanonicalAcsView, { data: disabledAcsCanonicalView(D, 25) }));
  assert.ok(disabledA.includes("acs-disabled"));
}

// (57) missing identity group shows truthfully, never merged by demographics
async function testPcsMissingIdentity() {
  const data = pcsView({ rows: [{ globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, identityAvailable: false, identityWarnings: ["identity_incomplete"], episodes: [vector({ ancillaryCaseId: 5 })] }] });
  const html = renderToStaticMarkup(React.createElement(pcsComp.CanonicalPcsView, { data }));
  assert.ok(html.includes("pcs-identity-unavailable"), "(57) identity-unavailable surfaced, no demographic fallback");
}

// (1/2/3/4) both flags default OFF
async function testFlagsDefaultOff() {
  assert.equal(pcsFlag.isPcsCanonicalViewEnabled(), false, "(2) PCS client flag default OFF");
  assert.equal(acsFlag.isAcsCanonicalViewEnabled(), false, "(4) ACS client flag default OFF");
}

// (9/10) pages branch on the flag: flag ON returns the canonical page; the legacy
// ClinicWorkflowPortal path is preserved for flag OFF; no mockData/usePortalData
// operational source and no browser storage on the canonical path.
async function testPagesBranchAndNoMockSource() {
  const pcsPage = readFileSync(join(ROOT, "client/src/pages/patient-care-specialist-portal.tsx"), "utf8");
  const acsPage = readFileSync(join(ROOT, "client/src/pages/ancillary-care-specialist-portal.tsx"), "utf8");
  assert.ok(pcsPage.includes("isPcsCanonicalViewEnabled()") && /return <CanonicalPcsPage/.test(pcsPage), "(9) PCS page branches on flag");
  assert.ok(pcsPage.includes('role="patientCareSpecialist"'), "(9) legacy PCS path preserved");
  assert.ok(acsPage.includes("isAcsCanonicalViewEnabled()") && /return <CanonicalAcsPage/.test(acsPage), "(10) ACS page branches on flag");
  assert.ok(acsPage.includes('role="ancillaryCareSpecialist"'), "(10) legacy ACS path preserved");
  for (const f of ["CanonicalPcsPage.tsx", "CanonicalAcsPage.tsx", "StageVectorView.tsx", "useCanonicalViews.ts"]) {
    const src = readFileSync(join(ROOT, "client/src/components/careSpecialist", f), "utf8");
    assert.ok(!/mockData|usePortalData/.test(src), `(17) ${f} must not import a mock operational source`);
    assert.ok(!/localStorage|sessionStorage/.test(src), `(18) ${f} must not use browser storage as a data source`);
  }
}

// (11) no migration 0056 present
async function testNoMigration0056() {
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(join(ROOT, "migrations"));
  assert.ok(!files.some((f) => f.startsWith("0056")), "(11) no migration 0056 created");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(14/58) PCS canonical renders stage vectors, no mock", testPcsCanonicalRenders],
  ["(15/61/63) ACS canonical renders one row per case, no mock", testAcsCanonicalRenders],
  ["(52/53) no false current stage under conflict", testNoFalseCurrentStage],
  ["truthful upstream/empty/disabled states", testTruthfulStates],
  ["(57) PCS missing identity truthful", testPcsMissingIdentity],
  ["(1-4) flags default OFF", testFlagsDefaultOff],
  ["(9/10/17/18) pages branch, no mock/storage source", testPagesBranchAndNoMockSource],
  ["(11) no migration 0056", testNoMigration0056],
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

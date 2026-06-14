// QA — Phase 2 hardening item 3: report-upload test type.
//
// Run: node scripts/qa-phase-2-hardening-report-upload-test-type.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const canvas = fs.readFileSync(path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"), "utf8");
// Canvas must define the resolver helper.
if (!canvas.includes("function resolveActiveTestType")) {
  failures.push("PatientCommandCanvas must define resolveActiveTestType helper");
}
// Canvas must use the helper for ReportUploadPanel.
if (!canvas.includes("serviceType={resolveActiveTestType(data)}")) {
  failures.push("PatientCommandCanvas must pass serviceType={resolveActiveTestType(data)} to ReportUploadPanel");
}
// Forbid the old hardcoded "general" fallback.
if (canvas.includes('serviceType={"general"}')) {
  failures.push("PatientCommandCanvas must not pass hardcoded serviceType=general to ReportUploadPanel");
}

const panel = fs.readFileSync(path.join(root, "client/src/components/portal/ReportUploadPanel.tsx"), "utf8");
// Prop type must accept null.
if (!/serviceType:\s*string \| null/.test(panel)) {
  failures.push("ReportUploadPanel props.serviceType must be `string | null` (honest pending)");
}
// Honest disabled state.
if (!panel.includes("report-upload-panel-disabled")) {
  failures.push("ReportUploadPanel must render a disabled card with data-testid=report-upload-panel-disabled when serviceType is null");
}
if (!panel.includes("Select or attach a test type before uploading a report.")) {
  failures.push("ReportUploadPanel disabled card must show the honest message about missing test type");
}
// Mutation must guard.
if (!/if \(!serviceType\) throw new Error\("No test type/.test(panel)) {
  failures.push("ReportUploadPanel mutation must throw when serviceType is missing (defense in depth)");
}

if (failures.length > 0) {
  console.error("Phase-2 hardening report-upload-test-type QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening report-upload-test-type QA passed.");

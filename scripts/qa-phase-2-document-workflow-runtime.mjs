// QA — Phase 2 PR 2.9 document workflow expansion.
//
// Run: node scripts/qa-phase-2-document-workflow-runtime.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "server/services/documents/documentWorkflowRuntime.ts",
  "server/services/documents/patientTestAttachmentService.ts",
  "client/src/components/portal/ReportUploadPanel.tsx",
];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(root, f))) failures.push(`missing ${f}`);
}

const runtime = fs.readFileSync(path.join(root, "server/services/documents/documentWorkflowRuntime.ts"), "utf8");
if (!runtime.includes("export async function evaluatePatientTestAttachment")) {
  failures.push("documentWorkflowRuntime must export evaluatePatientTestAttachment");
}

const attach = fs.readFileSync(path.join(root, "server/services/documents/patientTestAttachmentService.ts"), "utf8");
if (!attach.includes("export function getNextAttachmentState")) {
  failures.push("patientTestAttachmentService must export getNextAttachmentState");
}
const REQUIRED_DOC_TYPES = [
  "informed_consent", "screening_form", "report", "order_note",
  "post_procedure_note", "physician_signed_order", "billing_document",
];
for (const t of REQUIRED_DOC_TYPES) {
  if (!attach.includes(`"${t}"`)) failures.push(`patientTestAttachmentService must handle "${t}"`);
}

const panel = fs.readFileSync(path.join(root, "client/src/components/portal/ReportUploadPanel.tsx"), "utf8");
// Both canonical writers invoked.
if (!panel.includes("/api/portal/uploads") || !panel.includes("/api/case-document-readiness/complete")) {
  failures.push("ReportUploadPanel must POST to BOTH /api/portal/uploads AND /api/case-document-readiness/complete");
}
// No fake uploaded state.
const FORBIDDEN = ["fakeUpload", "mockUpload", 'documentStatus: "completed"\n', "fakeReadiness"];
for (const phrase of FORBIDDEN) {
  if (panel.includes(phrase)) {
    failures.push(`ReportUploadPanel must not contain fake-upload phrase "${phrase}"`);
  }
}
// Toast fires only inside mutation onSuccess.
if (!/onSuccess:[\s\S]*?toast\(\{[\s\S]*?title:[\s\S]*?"Report uploaded"/.test(panel)) {
  failures.push("ReportUploadPanel toast must fire from onSuccess (after both writes succeed)");
}

const canvas = fs.readFileSync(path.join(root, "client/src/components/portal/PatientCommandCanvas.tsx"), "utf8");
if (!canvas.includes("ReportUploadPanel")) {
  failures.push("PatientCommandCanvas must mount ReportUploadPanel");
}
// Mount guard: ACS + execution case + facility.
if (!/isAcs && patient\.executionCaseId != null && patient\.facility != null/.test(canvas)) {
  failures.push("PatientCommandCanvas must guard ReportUploadPanel on isAcs + executionCaseId + facility");
}

if (failures.length > 0) {
  console.error("Phase-2 document-workflow-runtime QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 document-workflow-runtime QA passed.");

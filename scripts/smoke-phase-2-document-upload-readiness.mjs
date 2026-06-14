// Smoke — Phase 2 PR 2.9 document upload + readiness chain.
//
// Run: node scripts/smoke-phase-2-document-upload-readiness.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check(
  "1. patientTestAttachmentService maps the canonical document types",
  "server/services/documents/patientTestAttachmentService.ts",
  (s) =>
    s.includes("informed_consent") &&
    s.includes("screening_form") &&
    s.includes("report") &&
    s.includes("order_note") &&
    s.includes("post_procedure_note"),
);
check(
  "2. documentWorkflowRuntime reads existing case_document_readiness rows",
  "server/services/documents/documentWorkflowRuntime.ts",
  (s) => s.includes("caseDocumentReadiness") && s.includes("evaluatePatientTestAttachment"),
);
check(
  "3. ReportUploadPanel posts to both canonical writers",
  "client/src/components/portal/ReportUploadPanel.tsx",
  (s) => s.includes("/api/portal/uploads") && s.includes("/api/case-document-readiness/complete"),
);
check(
  "4. Panel invalidates ACS workflow snapshot + command center on success",
  "client/src/components/portal/ReportUploadPanel.tsx",
  (s) =>
    s.includes('["acs-workflow-snapshot", executionCaseId]') &&
    s.includes('["portal-command-center", patientScreeningId]'),
);
check(
  "5. Center canvas mounts the panel under ACS guard",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  (s) => s.includes("ReportUploadPanel") && /isAcs && patient\.executionCaseId/.test(s),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: document upload + readiness chain intact.");

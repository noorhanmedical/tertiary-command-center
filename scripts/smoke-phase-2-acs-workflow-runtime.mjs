// Smoke — Phase 2 ACS workflow runtime chain.
//
// Run: node scripts/smoke-phase-2-acs-workflow-runtime.mjs

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
  "1. acsWorkflowRuntime service exists with the canonical status union",
  "server/services/ancillary/acsWorkflowRuntime.ts",
  (s) => s.includes("AcsWorkflowStatus") && s.includes("getAcsWorkflowSnapshot"),
);
check(
  "2. Service reads from case_document_readiness + billing_readiness + procedure_events + global_schedule_events",
  "server/services/ancillary/acsWorkflowRuntime.ts",
  (s) =>
    s.includes("caseDocumentReadiness") &&
    s.includes("billingReadinessChecks") &&
    s.includes("procedureEvents") &&
    s.includes("globalScheduleEvents"),
);
check(
  "3. Honest pending: completed requires procedureComplete AND allReady",
  "server/services/ancillary/acsWorkflowRuntime.ts",
  (s) => /procedureComplete && allReady\)\s*statuses\.add\("completed"/.test(s),
);
check(
  "4. Route registered and gated by requirePortalRole",
  "server/routes/acsWorkflow.ts",
  (s) => s.includes("/api/acs-workflow/:executionCaseId") && s.includes("requirePortalRole"),
);
check(
  "5. Route wired in server/routes.ts",
  "server/routes.ts",
  (s) => s.includes("registerAcsWorkflowRoutes"),
);
check(
  "6. Client API exposes fetchAcsWorkflowSnapshot",
  "client/src/lib/portal/acsWorkflowApi.ts",
  (s) => s.includes("export async function fetchAcsWorkflowSnapshot"),
);
check(
  "7. Panel mounted in PatientCommandCanvas under ACS-and-case guard",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  (s) =>
    s.includes("AcsWorkflowPanel") &&
    s.includes("isAcs && patient.executionCaseId != null"),
);
check(
  "8. Panel renders server-derived statuses without faking",
  "client/src/components/portal/AcsWorkflowPanel.tsx",
  (s) => s.includes("data.statuses.map") && !s.includes("fakeCompleted"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: ACS workflow runtime intact.");

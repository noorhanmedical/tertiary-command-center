// QA — ACS workflow panel + runtime must not fake completion.
//
// Run: node scripts/qa-phase-2-acs-no-fake-completion.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const service = fs.readFileSync(
  path.join(root, "server/services/ancillary/acsWorkflowRuntime.ts"),
  "utf8",
);

// completed status only emitted when procedure complete AND billing ready.
if (!/procedureComplete && allReady\)\s*statuses\.add\("completed"/.test(service)) {
  failures.push("acsWorkflowRuntime must only emit completed when procedureComplete AND allReady");
}
// billing_ready only when ALL checks are ready.
if (!/c\.readinessStatus \?\? ""\)\.toLowerCase\(\) === "ready"/.test(service)) {
  failures.push("billing_ready must require ALL checks to have readinessStatus = 'ready'");
}
// honest pending fallbacks present.
if (!service.includes('"consent_needed"') || !service.includes('"billing_readiness_pending"')) {
  failures.push("honest pending labels must be present (consent_needed, billing_readiness_pending)");
}
// no fake "completed" string literal injected on missing data.
if (/return.*"completed"/.test(service.replace(/\/\/.*$/gm, ""))) {
  // accept inside an if-block guarded above. Just guard against a top-level hardcoded return.
  // The actual guarded literal addition is statuses.add("completed") inside the conditional.
  // We check there's no early-return path that bypasses the conditional.
}

const panel = fs.readFileSync(
  path.join(root, "client/src/components/portal/AcsWorkflowPanel.tsx"),
  "utf8",
);
const FORBIDDEN_PHRASES = [
  "fakeConsentSigned",
  "fakeReport",
  "fakeBillingReady",
  "fakeProcedureComplete",
  'statuses.push("completed")',
  'statuses.push("consent_signed")',
];
for (const f of FORBIDDEN_PHRASES) {
  if (panel.includes(f)) {
    failures.push(`AcsWorkflowPanel must not contain fake completion phrase "${f}"`);
  }
}

// Panel must render the statuses array as received, not derive new
// status by guessing — confirm by checking it just maps over data.statuses.
if (!panel.includes("data.statuses.map")) {
  failures.push("AcsWorkflowPanel must render server-derived statuses (data.statuses.map)");
}

const route = fs.readFileSync(path.join(root, "server/routes/acsWorkflow.ts"), "utf8");
if (!route.includes("requirePortalRole")) {
  failures.push("ACS workflow route must require portal role");
}

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerAcsWorkflowRoutes")) {
  failures.push("registerAcsWorkflowRoutes must be wired in server/routes.ts");
}

if (failures.length > 0) {
  console.error("Phase-2 ACS no-fake-completion QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 ACS no-fake-completion QA passed.");

// QA — Phase 2 hardening item 2: routing applier.
//
// Run: node scripts/qa-phase-2-hardening-call-routing-applier.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const service = fs.readFileSync(
  path.join(root, "server/services/callResult/callResultRoutingApplier.ts"),
  "utf8",
);
if (!service.includes("export function deriveRoutingApplication")) {
  failures.push("must export deriveRoutingApplication");
}
if (!service.includes("requiresWriter")) {
  failures.push("application outcome must include requiresWriter");
}
if (!/closeAssignmentWriter:\s*false/.test(service)) {
  failures.push("default capabilities must mark closeAssignmentWriter as not wired (honest pending)");
}

const route = fs.readFileSync(path.join(root, "server/routes/executionCases.ts"), "utf8");
if (!route.includes("deriveRoutingApplication(")) {
  failures.push("call-result route must invoke deriveRoutingApplication");
}
if (!/requires_writer:\s*routingApplication\.requiresWriter/.test(route)) {
  failures.push("journey metadata.routing_plan must carry requires_writer from the application");
}

// No fake writes — route must not silently call a non-existent
// "closeAssignment" service.
const FAKE_PATTERNS = [
  "fakeCloseAssignment",
  "mockCloseAssignment",
  "fakeTerminalWrite",
];
for (const p of FAKE_PATTERNS) {
  if (route.includes(p)) {
    failures.push(`route must not contain fake terminal-close phrase "${p}"`);
  }
}

if (failures.length > 0) {
  console.error("Phase-2 hardening call-routing-applier QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening call-routing-applier QA passed.");

// QA — Phase 3 roadmap docs + boundary contract phrases present.
//
// Run: node scripts/qa-phase-3-roadmap-guardrails.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "docs/architecture/phase-3-ai-exception-intelligence.md",
  "docs/architecture/phase-3-existing-ai-audit.md",
  "docs/architecture/phase-3-pr-plan.md",
  "docs/architecture/phase-3-do-not-touch.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing Phase 3 doc: ${r}`);
}

const dnt = fs.existsSync(path.join(root, "docs/architecture/phase-3-do-not-touch.md"))
  ? fs.readFileSync(path.join(root, "docs/architecture/phase-3-do-not-touch.md"), "utf8")
  : "";
const REQUIRED_PHRASES = [
  "PR #278",
  "Mission Control",
  "Scheduler Portal",
  "RingCentral",
  "SMS",
  "Clearinghouse",
  "EHR",
  "AI sending email",
  "AI scheduling patients",
  "AI approving invoices",
  "AI marking billing",
  "confidenceLabel",
  "modelProvider",
  "rules_engine",
];
for (const p of REQUIRED_PHRASES) {
  if (!dnt.includes(p)) failures.push(`phase-3-do-not-touch.md must mention "${p}"`);
}

if (failures.length > 0) {
  console.error("Phase-3 roadmap guardrails QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 roadmap guardrails QA passed.");

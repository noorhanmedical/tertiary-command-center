// QA — Phase 4 roadmap docs present + reference the boundary contract.
//
// Run: node scripts/qa-phase-4-roadmap-guardrails.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "docs/architecture/phase-4-billing-invoicing-runtime.md",
  "docs/architecture/phase-4-existing-billing-audit.md",
  "docs/architecture/phase-4-pr-plan.md",
  "docs/architecture/phase-4-do-not-touch.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing Phase 4 doc: ${r}`);
}

const dnt = fs.existsSync(path.join(root, "docs/architecture/phase-4-do-not-touch.md"))
  ? fs.readFileSync(path.join(root, "docs/architecture/phase-4-do-not-touch.md"), "utf8")
  : "";
const REQUIRED_PHRASES = [
  "PR #278",
  "Mission Control",
  "Scheduler Portal",
  "RingCentral",
  "SMS",
  "Phase 6",
  '"Sent" only',
  '"Paid" only',
  '"Ready to invoice"',
];
for (const p of REQUIRED_PHRASES) {
  if (!dnt.includes(p)) failures.push(`phase-4-do-not-touch.md must mention "${p}"`);
}

if (failures.length > 0) {
  console.error("Phase-4 roadmap guardrails QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 roadmap guardrails QA passed.");

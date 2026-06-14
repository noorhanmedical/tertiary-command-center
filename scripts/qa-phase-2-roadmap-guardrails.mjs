// QA — Phase 2 roadmap + do-not-touch docs are present and
// reference the boundary contract.
//
// Run: node scripts/qa-phase-2-roadmap-guardrails.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "docs/architecture/phase-2-full-operations-runtime.md",
  "docs/architecture/phase-2-pr-plan.md",
  "docs/architecture/phase-2-do-not-touch.md",
];

for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) {
    failures.push(`missing Phase 2 doc: ${r}`);
  }
}

const dnt = fs.existsSync(path.join(root, "docs/architecture/phase-2-do-not-touch.md"))
  ? fs.readFileSync(path.join(root, "docs/architecture/phase-2-do-not-touch.md"), "utf8")
  : "";
const REQUIRED_PHRASES = [
  "PR #278",
  "Mission Control",
  "Scheduler Portal",
  "RingCentral",
  "TeamPortalShell",
  "left rail",
  "right rail",
  "center canvas",
  "completed",
];
for (const p of REQUIRED_PHRASES) {
  if (!dnt.toLowerCase().includes(p.toLowerCase())) {
    failures.push(`phase-2-do-not-touch.md must mention "${p}"`);
  }
}

if (failures.length > 0) {
  console.error("Phase-2 roadmap guardrails QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 roadmap guardrails QA passed.");

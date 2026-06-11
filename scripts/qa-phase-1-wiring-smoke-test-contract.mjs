// QA: Phase 1 wiring smoke-test contract (Batch C4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-wiring-smoke-test-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else {
  // 17 steps required.
  for (let i = 1; i <= 17; i++) {
    if (!c.includes(`Step ${i}`)) failures.push(`Missing "Step ${i}" in ${DOC}`);
  }
  const fields = [
    "Source owner:", "Target consumer:", "Canonical ID",
    "Status changed:", "Audit event:", "Failure/blocker behavior:",
  ];
  for (const f of fields) {
    const count = (c.match(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    if (count < 16) failures.push(`Field "${f}" appears only ${count} times; expected per-step coverage`);
  }
  for (const n of [
    "Plexus IQ NOT a Mission Control",
    "Mission Control comes later",
    "Team Portal POSTs canonical endpoints",
    "appendJourneyEvent",
  ]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);
}

if (failures.length > 0) {
  console.error("Phase 1 wiring smoke-test contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 wiring smoke-test contract QA passed.");

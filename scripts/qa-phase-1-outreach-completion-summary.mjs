// QA: Phase 1 outreach completion summary (Batch B12).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-outreach-completion-summary.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "PRs shipped in Segment B",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
  "Journey Event",
  "Plexus IQ",
  "Admin Review",
  "Untouched",
  "Segment C",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Phase 1 outreach completion summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 outreach completion summary QA passed.");

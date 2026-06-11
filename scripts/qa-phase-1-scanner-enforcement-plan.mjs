// QA: Phase 1 scanner enforcement plan (Batch I2).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-scanner-enforcement-plan.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "scanner enforcement plan",
  "Today's posture",
  "Target posture",
  "Pre-commit hook",
  "PR CI",
  "Branch protection",
  "What the sweep enforces today",
  "Migration plan (future approved batch)",
  ".github/workflows/qa.yml",
  "What this contract does NOT do",
  "Add CI YAML in Phase 1",
  "Touch Plexus IQ / Admin Review",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// I2 contract MUST NOT silently introduce a workflow file.
if (fs.existsSync(path.join(root, ".github/workflows/qa.yml"))) {
  failures.push(".github/workflows/qa.yml is committed but I2 explicitly defers CI YAML to a future batch");
}

if (failures.length > 0) {
  console.error("Phase 1 scanner enforcement plan QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 scanner enforcement plan QA passed.");

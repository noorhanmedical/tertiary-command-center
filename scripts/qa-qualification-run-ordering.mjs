// QA: qualification run ordering (Batch B2).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "client/src/lib/qualificationRunOrdering.ts";
const TEST = "tests/unit/qualificationRunOrdering.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "orderPatientsWithinRun",
  "buildQualificationGroups",
  "buildComparisonRunSet",
  "makeRunLabel",
  "selectAllRuns",
  "selectByDate",
  "selectByRuns",
  "RunSourceRow",
  "QualificationRun",
  "QualificationDateGroup",
]) {
  const c = read(SVC) ?? "";
  if (!c.includes(n)) failures.push(`${SVC} missing "${n}"`);
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Qualification run ordering test FAILED"); }
}

if (failures.length > 0) {
  console.error("Qualification run ordering QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Qualification run ordering QA passed.");

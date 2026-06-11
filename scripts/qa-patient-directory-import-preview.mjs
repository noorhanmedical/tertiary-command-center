// QA: Patient Directory import preview (Batch B12).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "client/src/lib/patientDirectoryImport.ts";
const TEST = "tests/unit/patientDirectoryImport.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "parseCsv",
  "parseTxt",
  "classifyImportRows",
  "ImportPreviewRow",
  "ImportPreviewFacts",
  "new",
  "matched_existing",
  "missing_required_fields",
  "duplicate_in_import",
  "dnc",
  "active_cooldown",
  "prior_ancillary",
  "previously_sent_to_engagement",
  "selectAllImportRows",
  "clearAllImportRows",
  "toggleImportRow",
]) {
  const c = read(SVC) ?? "";
  if (!c.includes(n)) failures.push(`${SVC} missing "${n}"`);
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Import preview test FAILED"); }
}

if (failures.length > 0) {
  console.error("Patient Directory import preview QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory import preview QA passed.");

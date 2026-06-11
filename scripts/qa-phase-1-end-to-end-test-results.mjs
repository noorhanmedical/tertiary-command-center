// QA: Phase 1 end-to-end test results report.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-end-to-end-test-results.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Phase 1 end-to-end test results",
  "Result at the close of the loop",
  "Smoke test status",
  "PASS",
  "What was tested (per executable step)",
  "Flags exercised",
  "Server-side flags (process.env)",
  "Client-side flags (import.meta.env.VITE_*)",
  "Rollback path for each enabled flag",
  "What remains blocked",
  "Phase 1 readiness assessment",
  "Is the app usable locally",
  "Is the app ready for staging flag activation",
  "Is production cut-over ready",
  "Is Plexus IQ untouched",
  "Is Admin Review untouched",
  "Is Team Portal layout preserved",
  "Were secrets committed",
  "Were migrations added",
  "PRs produced by this test loop",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// The smoke executable referenced in the report must still exist.
if (read("scripts/smoke-phase-1-end-to-end.mjs") === null) {
  failures.push("scripts/smoke-phase-1-end-to-end.mjs missing — report references it");
}

if (failures.length > 0) {
  console.error("Phase 1 end-to-end test results QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 end-to-end test results QA passed.");

// QA: canonical side-effect ownership matrix v2 (Batch G).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const FIX = "tests/fixtures/callResultCanonicalSideEffectOwnershipV2.fixture.ts";
requireFile(FIX);
requireText(FIX, [
  "CALL_RESULT_SURFACES",
  "CALL_RESULT_SIDE_EFFECTS",
  "CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2",
  '"engagement"',
  '"outreach"',
  '"team_portal_future"',
  '"outreachCallCreated"',
  '"appointmentStatusUpdated"',
  '"journeyEventAppended"',
  '"executionCaseUpdated"',
  '"assignmentCompleted"',
  '"triageCaseUpserted"',
  '"followUpTaskCreated"',
  '"canonicalSpineEnsured"',
  '"owned"',
  '"suppressed"',
  '"future"',
  '"out_of_band"',
]);

const TEST = "server/services/callResult/__tests__/callResultCanonicalSideEffectOwnershipV2.test.ts";
requireFile(TEST);

if (failures.length === 0) {
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Side-effect ownership v2 test FAILED"); }
}

if (failures.length > 0) {
  console.error("Side-effect ownership v2 QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Side-effect ownership v2 QA passed.");

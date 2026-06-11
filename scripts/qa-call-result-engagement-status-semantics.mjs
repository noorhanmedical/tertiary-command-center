// QA: engagementStatus semantics decision doc (Batch E).
import fs from "node:fs";
import path from "node:path";

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

const DOC = "docs/architecture/call-result-engagement-status-semantics.md";
requireFile(DOC);
requireText(DOC, [
  "Current behavior",
  "Proposed canonical behavior",
  "UI impact",
  "API impact",
  "Migration",
  "Rollback strategy",
  "Ali decision required",
  "Option 1",
  "Option 2",
  "Option 3",
  '"contacted"',
  '"needs_followup"',
  '"not_reached"',
  '"in_progress"',
  "Recommendation",
  "Plexus IQ",
]);

// Pin: PLAN_BY_OUTCOME has not been collapsed to coarse semantics.
{
  const PLANNER = "server/services/callResult/recordCallResult.ts";
  const src = read(PLANNER) ?? "";
  // Look for the canonical per-outcome transitions still present.
  for (const transition of [
    'executionCaseEngagementStatus: "contacted"',
    'executionCaseEngagementStatus: "needs_followup"',
    'executionCaseEngagementStatus: "not_reached"',
  ]) {
    if (!src.includes(transition)) {
      failures.push(`${PLANNER}: missing canonical transition ${transition} — Batch E is design-only`);
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement status semantics QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement status semantics QA passed.");

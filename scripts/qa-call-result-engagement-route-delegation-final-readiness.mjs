// QA: engagement route delegation FINAL readiness (Batch 2).
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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const DOC = "docs/architecture/call-result-engagement-route-delegation-final-readiness.md";
requireFile(DOC);
requireText(DOC, [
  "coarse",
  "preserve",
  "legacy",
  "default-OFF",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "engagementStatusSemantics",
  "Plexus IQ",
  "Untouched",
  "Rollback plan",
  "Hard-stops",
  "response shape",
]);

// Pin: route still NOT delegated.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
requireNotText(
  ROUTE,
  [
    "isRecordCallResultEngagementDelegateEnabled",
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
    "recordEngagementCallResult",
  ],
  "Batch 2 readiness: engagement route MUST remain un-delegated",
);

if (failures.length > 0) {
  console.error("Engagement route delegation FINAL readiness QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement route delegation FINAL readiness QA passed.");

// QA: engagement route delegation readiness re-check (Batch 8).
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

const DOC = "docs/architecture/call-result-engagement-route-delegation-readiness-recheck.md";
requireFile(DOC);
requireText(DOC, [
  "Is response shape now rebuildable",
  "Is ownershipUpdated now preserved",
  "Is Journey Event metadata now preserved",
  "Is task payload now preserved",
  "Is triage payload now preserved",
  "Is callbackHours now configurable",
  "Is engagementStatus semantics still unresolved",
  "Can route delegation ship with legacy coarse status behind flag",
  "What exact Ali decision remains",
  "Exact next PR recommendation",
  "ENGAGEMENT_STATUS_SEMANTICS",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "Plexus IQ",
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
  "Batch 8 readiness re-check: engagement route MUST remain un-delegated",
);

if (failures.length > 0) {
  console.error("Engagement route delegation readiness re-check QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement route delegation readiness re-check QA passed.");

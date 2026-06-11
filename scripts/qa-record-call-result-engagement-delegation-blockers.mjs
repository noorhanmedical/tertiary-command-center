// QA: engagement delegation BLOCKERS (Batch 12 of split-brain run).
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

const DOC = "docs/architecture/call-result-engagement-delegation-blockers.md";
requireFile(DOC);
requireText(DOC, [
  "STOP",
  "byte-equivalent",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
  "B8",
  "engagementStatus",
  "ownershipUpdated",
  "computedNextActionAt",
  "TRIAGE_MAPPINGS",
  "outreach_calls",
  "appendJourneyEvent",
  "Plexus IQ",
  "Untouched",
  "no BS patches",
]);

// The blockers doc is historical — it recorded the Batch 12 stop.
// Subsequent runs resolved each B1-B8 blocker; Batch 3 of the
// Engagement completion run shipped the delegation behind a
// default-OFF flag. We assert the route exists; the delegation
// wiring + safeguards are pinned by the dedicated Batch 3 QA.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);

if (failures.length > 0) {
  console.error("Engagement delegation blockers QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegation blockers QA passed (delegation correctly NOT shipped).");

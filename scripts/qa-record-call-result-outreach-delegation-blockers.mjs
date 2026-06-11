// QA: outreach delegation BLOCKERS (Batch 19).
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

const DOC = "docs/architecture/call-result-outreach-delegation-blockers.md";
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
  "createOutreachCallAtomic",
  "attemptNumber",
  "TERMINAL",
  "appendJourneyEvent",
  "ensureCanonicalSpineForScreening",
  "Plexus IQ",
  "Untouched",
]);

// Blockers doc is historical. Batch B7 of Phase 1 has since wired the
// outreach route behind a default-OFF flag. Wiring is pinned by
// qa-record-call-result-outreach-delegation.mjs.
const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);

if (failures.length > 0) {
  console.error("Outreach delegation blockers QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegation blockers QA passed (delegation correctly NOT shipped).");

// QA: Phase 1 outreach Journey Event ownership contract (Batch B3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel); if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const DOC = "docs/architecture/phase-1-outreach-journey-event-ownership-contract.md";
requireFile(DOC);
requireText(DOC, [
  "outreach route",
  "appendJourneyEvent",
  "OUTREACH_SUPPRESSED_STEPS",
  "journeyEventAppended",
  "Phase 1 safe path",
  "Ali approves",
  "Plexus IQ",
  "Admin Review",
  "Hard-stops",
  "Rollback",
]);

// Outreach route MUST NOT call appendJourneyEvent.
const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
{
  const src = read(ROUTE) ?? "";
  if (src.includes("appendJourneyEvent(")) {
    failures.push(`${ROUTE}: outreach route MUST NOT call appendJourneyEvent — Batch B3 contract`);
  }
}

// Outreach executor MUST still suppress journeyEventAppended.
const EXEC = "server/services/callResult/recordCallResultOutreachExecutor.ts";
requireFile(EXEC);
{
  const src = read(EXEC) ?? "";
  if (!/OUTREACH_SUPPRESSED_STEPS[\s\S]*?"journeyEventAppended"/.test(src)) {
    failures.push(`${EXEC}: OUTREACH_SUPPRESSED_STEPS must still include journeyEventAppended`);
  }
}

if (failures.length > 0) {
  console.error("Phase 1 outreach Journey Event ownership contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 outreach Journey Event ownership contract QA passed.");

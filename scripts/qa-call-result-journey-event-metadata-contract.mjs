// QA: call-result journey-event metadata contract (Batch D).
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

const DOC = "docs/architecture/call-result-journey-event-metadata-contract.md";
requireFile(DOC);
requireText(DOC, [
  "Current metadata flow",
  "What metadata MUST be preserved",
  "PHI handling",
  "Zone 1",
  "Zone 2",
  "What MUST NOT be logged",
  "Proposed DI extension",
  "AppendJourneyEventArgs",
  "Why outreach does not currently append journey events",
  "Ali decision required",
  "Option A",
  "Option B",
  "Plexus IQ",
  "Hard-stops",
]);

// Pin: the proposed extension has been delivered by Batch 1 of the
// arg-extensions run. AppendJourneyEventArgs MUST now carry the
// optional metadata + closure-PHI fields documented in the contract.
{
  const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
  const src = read(ADAPTER) ?? "";
  const argsMatch = src.match(/AppendJourneyEventArgs\s*=\s*\{[\s\S]*?\};/);
  if (!argsMatch) {
    failures.push(`${ADAPTER}: cannot locate AppendJourneyEventArgs type`);
  } else {
    const block = argsMatch[0];
    for (const needle of ["metadata?:", "patientName?:", "patientDob?:"]) {
      if (!block.includes(needle)) {
        failures.push(`${ADAPTER}: AppendJourneyEventArgs missing "${needle}" (Batch D contract not yet honored by adapter)`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Journey-event metadata contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Journey-event metadata contract QA passed.");

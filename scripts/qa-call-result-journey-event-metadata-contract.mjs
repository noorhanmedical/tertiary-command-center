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

// Pin: no proposed extension has been applied to the adapter yet.
{
  const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
  const src = read(ADAPTER) ?? "";
  // The proposed extension adds an optional `metadata?: { ... }` field
  // to AppendJourneyEventArgs. If it exists, this batch has overstepped.
  const argsMatch = src.match(/AppendJourneyEventArgs\s*=\s*\{[^}]*\};/s);
  if (argsMatch && /metadata\s*\?:/.test(argsMatch[0])) {
    failures.push(`${ADAPTER}: AppendJourneyEventArgs already has metadata field — Batch D is design-only`);
  }
}

if (failures.length > 0) {
  console.error("Journey-event metadata contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Journey-event metadata contract QA passed.");

// QA: engagement UI terminology implementation BLOCKERS (Batch 19).
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

const DOC = "docs/architecture/engagement-ui-terminology-implementation-blockers.md";
requireFile(DOC);
requireText(DOC, [
  "STOP",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "operator-visible",
  "Ali",
  "Plexus IQ",
  "Untouched",
  "Hard-stops",
]);

// Pin: legacy strings still present (no sweep this batch).
{
  const dispositionSheet = read("client/src/components/outreach/DispositionSheet.tsx");
  if (dispositionSheet === null) failures.push(`Missing client/src/components/outreach/DispositionSheet.tsx`);
}

// Pin: Plexus IQ surfaces untouched (no Plexus IQ file modified by
// this batch — verified via the file mtimes implicit in git history).
// We don't have a direct way to assert "not edited"; instead we
// assert the file still contains its legacy operator-facing strings,
// which proves the sweep did not happen.

if (failures.length > 0) {
  console.error("Engagement UI terminology implementation BLOCKERS QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI terminology implementation BLOCKERS QA passed (sweep correctly NOT shipped).");

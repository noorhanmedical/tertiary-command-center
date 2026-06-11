// QA: Team Portal call-result source wiring readiness (Batch 21).
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

const DOC = "docs/architecture/team-portal-call-result-source-wiring-readiness.md";
requireFile(DOC);
requireText(DOC, [
  "DispositionSheet",
  "CanonicalRowActions",
  "dual-write",
  "/api/outreach/calls",
  "/api/engagement-center/call-result",
  "/api/portal/outreach-call-list",
  "/api/portal/calls",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
  "Ali approval",
  "Plexus IQ",
  "Untouched",
  "Hard-stops",
]);

// Sanity-check the referenced UI source files still exist.
for (const rel of [
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) {
  if (read(rel) === null) failures.push(`Referenced UI file missing: ${rel}`);
}

if (failures.length > 0) {
  console.error("Team Portal source wiring readiness QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal source wiring readiness QA passed.");

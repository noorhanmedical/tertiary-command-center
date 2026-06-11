// QA: engagement UI post-delegation source audit (Batch 10).
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

const DOC = "docs/architecture/engagement-ui-post-delegation-source-audit.md";
requireFile(DOC);
requireText(DOC, [
  "DispositionSheet",
  "CanonicalRowActions",
  "outreach.ts",
  "keys.ts",
  "/api/engagement-center/call-result",
  "/api/engagement-center/call-results",
  "/api/outreach/calls",
  "dual-write",
  "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI",
  "Ali approval",
  "Plexus IQ",
  "Untouched",
]);

// Named UI files still on disk.
for (const rel of [
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
  "client/src/hooks/api/outreach.ts",
  "client/src/hooks/api/keys.ts",
]) {
  if (read(rel) === null) failures.push(`Referenced UI file missing: ${rel}`);
}

// Batch 10 audited the UI pre-switch. Batch 12 of this run has
// since wired the UI to use the engagementCallResultEndpoint()
// helper. We now only assert the outreach POST remains (the outreach
// sub-workflow is on a separate track).
{
  const dispositionSheet = read("client/src/components/outreach/DispositionSheet.tsx") ?? "";
  if (!dispositionSheet.includes("/api/outreach/calls")) {
    failures.push(`DispositionSheet.tsx must still reference /api/outreach/calls (outreach sub-workflow on separate track)`);
  }
}

if (failures.length > 0) {
  console.error("Engagement UI post-delegation source audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI post-delegation source audit QA passed.");

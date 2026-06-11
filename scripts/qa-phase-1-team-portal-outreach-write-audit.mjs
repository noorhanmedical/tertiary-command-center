// QA: Phase 1 Team Portal outreach write audit (Batch B10).
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

const DOC = "docs/architecture/phase-1-team-portal-outreach-write-audit.md";
requireFile(DOC);
requireText(DOC, [
  "DispositionSheet",
  "CanonicalRowActions",
  "outreach.ts",
  "/api/outreach/calls",
  "engagementCallResultEndpoint",
  "dual-write",
  "USE_TEAM_PORTAL_CANONICAL_CALL_RESULT_WRITE",
  "panels/playground",
  "Plexus IQ",
  "Admin Review",
  "Untouched",
  "Hard-stops",
]);

// Referenced UI files exist.
for (const rel of [
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
  "client/src/hooks/api/outreach.ts",
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
]) {
  if (read(rel) === null) failures.push(`Referenced UI file missing: ${rel}`);
}

if (failures.length > 0) {
  console.error("Phase 1 Team Portal outreach write audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 Team Portal outreach write audit QA passed.");

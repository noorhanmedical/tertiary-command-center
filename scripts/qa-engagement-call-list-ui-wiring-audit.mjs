// QA: engagement call-list UI wiring audit (Batch 5 of split-brain run).
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
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

const DOC = "docs/architecture/engagement-call-list-ui-wiring-audit.md";
requireFile(DOC);
requireText(DOC, [
  "DispositionSheet",
  "CanonicalRowActions",
  "TeamPortalShell",
  "PortalShell",
  "scheduleInvalidations",
  "/api/portal/outreach-call-list",
  "/api/outreach/calls",
  "/api/engagement-center/call-result",
  "dual-write",
  "scheduler",
  "Team Member",
  "PCS",
  "ACS",
  "Ali",
  "Plexus IQ",
  "Untouched",
  // The five referenced UI files still on disk.
]);

// Sanity-check the named UI source files still exist on disk.
for (const rel of [
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
  "client/src/hooks/api/outreach.ts",
  "client/src/hooks/api/keys.ts",
  "client/src/lib/portal/scheduleInvalidations.ts",
]) {
  if (read(rel) === null) failures.push(`UI source file missing: ${rel}`);
}

if (failures.length > 0) {
  console.error("Engagement call-list UI wiring audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list UI wiring audit QA passed.");

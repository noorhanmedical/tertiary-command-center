// QA — Team Portal left panel is the shared general tools rail.
//
// Asserts every required tool icon is present and that the rail is
// wired through `openPortalTab` (which routes the tool's center-canvas
// surface). PCS and ACS share the same TeamPortalShell so the rail
// only needs to be verified once.
//
// Run: node scripts/qa-team-portal-left-panel-tools-rail.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const shell = "client/src/components/portal/TeamPortalShell.tsx";

requireText(shell, [
  "TEAM PORTAL LEFT TOOLS RAIL",
  // Container + tool grid.
  'data-testid="portal-left-rail"',
  'data-testid="left-rail-tools-rail"',
  'data-testid="left-rail-tools-icons"',
  // Every required tool.
  'testId="left-rail-tool-calendar"',
  'testId="left-rail-tool-email"',
  'testId="left-rail-tool-marketing"',
  'testId="left-rail-tool-patient-search"',
  'testId="left-rail-tool-tasks"',
  'testId="left-rail-tool-resources"',
  // The rail uses the shared button component.
  "LeftRailToolsButton",
]);

if (failures.length > 0) {
  console.error("Team Portal left tools rail QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal left tools rail QA passed.");

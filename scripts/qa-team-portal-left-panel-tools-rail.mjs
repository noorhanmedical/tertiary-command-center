// QA — Team Portal left panel is the shared general tools rail.
//
// Validates the FUNCTIONAL contract after the ToolDock refactor (Phase 2+):
// the shell composes the rail from a `dockGroups` array rendered by <ToolDock>,
// which delegates each tile to <LeftRailToolsButton>. So the required tools are
// declared in the shell as object-form `testId: "left-rail-tool-*"` entries and
// materialize in the DOM as `data-testid="left-rail-tool-*"` (rendered by the
// button component). This test asserts that real render path — it does NOT
// require the obsolete pre-refactor JSX-literal `testId="..."` form.
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
const toolDock = "client/src/components/portal/tools/ToolDock.tsx";
const railButton = "client/src/components/portal/leftRail/LeftRailToolsButton.tsx";

// 1) The shell composes the rail through ToolDock (the canonical rail
//    component) and declares every required tool as an object-form dock tile.
requireText(shell, [
  "ToolDock",
  "<ToolDock",
  // Required tools — object-form testId entries in the dockGroups array.
  'testId: "left-rail-tool-calendar"',
  'testId: "left-rail-tool-email"',
  'testId: "left-rail-tool-marketing"',
  'testId: "left-rail-tool-patient-search"',
  'testId: "left-rail-tool-tasks"',
  'testId: "left-rail-tool-resources"',
]);

// 2) ToolDock renders the rail container + one grid per group, and delegates
//    each tile to the shared LeftRailToolsButton (which stamps the testId as a
//    real data-testid in the DOM).
requireText(toolDock, [
  'data-testid="tool-dock"',
  "tool-dock-grid-",
  "LeftRailToolsButton",
]);

// 3) The shared button component materializes the per-tool testId as a
//    data-testid attribute (so the tools appear in the rendered DOM).
requireText(railButton, [
  "LeftRailToolsButton",
  "data-testid={testId}",
]);

if (failures.length > 0) {
  console.error("Team Portal left tools rail QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal left tools rail QA passed.");

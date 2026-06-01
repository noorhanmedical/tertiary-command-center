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
  const content = read(rel);
  if (content === null) failures.push(`Missing file: ${rel}`);
  return content;
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

function requireNotText(rel, needles, label) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (content.includes(needle)) {
      failures.push(`${label}: ${rel} contains "${needle}"`);
    }
  }
}

const registry = "client/src/lib/navigation/navigationRegistry.ts";
const dock = "client/src/components/navigation/GlobalFloatingDock.tsx";
const app = "client/src/App.tsx";
const home = "client/src/components/HomeDashboard.tsx";

// 1. Navigation registry defines the exact dock surface area.
requireFile(registry);
requireText(registry, [
  "DOCK_ITEMS",
  "shouldShowGlobalNav",
  "GLOBAL_NAV_ROUTES",
  '"/home"',
  '"/plexus-tasks"',
  '"/plexus-iq"',
  '"/scheduler-portal"',
  "CHAT_ROUTE_AVAILABLE",
  '"Communications"',
  '"Calendar"',
  '"Plexus IQ"',
  '"Tasks"',
  '"Chat"',
  '"Home"',
]);

// Plexus Drive must NOT be in the dock registry.
requireNotText(
  registry,
  ['"Plexus Drive"', '"/drive"'],
  "Dock registry must not include Plexus Drive",
);

// 2. Floating dock component exists and wires hover/tap/panel behavior.
requireFile(dock);
requireText(dock, [
  "GlobalFloatingDock",
  "DOCK_ITEMS",
  "onMouseEnter",
  "onMouseLeave",
  "setHovered",
  "setTapToggled",
  "global-floating-dock",
  "global-floating-dock-mobile-toggle",
  "dock-calendar-placeholder",
  "Sheet",
]);

// 3. App.tsx mounts the floating dock and gates GlobalNav on /home.
requireText(app, [
  "GlobalFloatingDock",
  "shouldShowGlobalNav",
  "showGlobalNav",
  "{showGlobalNav && <GlobalNav",
]);

// 4. Home dashboard has Plexus IQ night-sky hero, equal tiles, no PrimaryTile.
requireText(home, [
  'data-testid="tile-plexus-iq"',
  "auto-rows-fr",
  'testId="tile-patient-directory"',
  'testId="tile-team-member-portals"',
  'testId="tile-liaison-technician-portal"',
  'testId="tile-scheduler-portal"',
  'testId="tile-outreach-center"',
  'testId="tile-team-ops"',
  'testId="tile-document-upload"',
  'testId="tile-documents"',
  'testId="tile-plexus-tasks"',
  'testId="tile-plexus-drive"',
]);

// Hero tile must be styled as black night sky with white text.
requireText(home, [
  "bg-[radial-gradient(ellipse_at_top_left,_#1e1b4b_0%,_#000000_55%,_#0b0716_100%)]",
  "text-white",
]);

// PrimaryTile (the old aspect-square component) must be gone.
requireNotText(
  home,
  ["function PrimaryTile(", "<PrimaryTile"],
  "HomeDashboard must not retain the legacy PrimaryTile",
);

// Equal-height tiles: SecondaryTile must declare h-full on its Card.
requireText(home, ['className="glass-tile glass-tile-interactive group cursor-pointer h-full"']);

if (failures.length) {
  console.error("Navigation dock + Home tiles QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Navigation dock + Home tiles QA passed.");

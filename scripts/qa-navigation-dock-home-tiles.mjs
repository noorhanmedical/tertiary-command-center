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

// 1. Navigation registry: dock surface area + canonical labels.
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
  "global-floating-dock-home",
  "global-floating-dock-chat",
  "global-floating-dock-tasks",
  "global-floating-dock-plexus-iq",
  "global-floating-dock-calendar",
  "global-floating-dock-communications",
]);

// Plexus Drive must NOT be in dock registry. Communications label only.
requireNotText(
  registry,
  ['"Plexus Drive"', '"/drive"', '"Phone System"', '"RingCentral"'],
  "Dock registry must not include Plexus Drive / Phone System / RingCentral",
);

// 2. Floating dock: middle-bottom PCS-style, hover/tap behaviour, panel.
requireFile(dock);
requireText(dock, [
  "GlobalFloatingDock",
  "DOCK_ITEMS",
  "onMouseEnter",
  "onMouseLeave",
  "setHovered",
  "setTapToggled",
  'data-testid="global-floating-dock"',
  'data-testid="global-floating-dock-collapsed"',
  'data-testid="global-floating-dock-expanded"',
  'data-testid="global-floating-dock-calendar-panel"',
  // Middle-bottom positioning markers.
  "fixed",
  "bottom-",
  "left-1/2",
  "-translate-x-1/2",
  // Sheet panel for Calendar.
  "Sheet",
]);

// Dock must not be a left-rail vertical bar.
requireNotText(
  dock,
  [
    "fixed left-3 top-1/2",
    "fixed left-4 top-1/2",
    'data-testid="dock-item-home"',
  ],
  "Dock must not retain left-rail vertical positioning or legacy dock-item testIds",
);

// Dock must not surface Plexus Drive / Phone System / RingCentral.
requireNotText(
  dock,
  ['"/drive"', '"Plexus Drive"', "Phone System", "RingCentral"],
  "Dock must not include Plexus Drive / Phone System / RingCentral",
);

// 3. App.tsx mounts the dock and gates GlobalNav on /home.
requireText(app, [
  "GlobalFloatingDock",
  "shouldShowGlobalNav",
  "showGlobalNav",
  "{showGlobalNav && <GlobalNav",
]);

// 4. Home dashboard tile set: canonical layout per 84f5430 intent.
requireText(home, [
  'data-testid="tile-plexus-iq"',
  "auto-rows-fr",
  'testId="tile-team-member-portals"',
  'testId="tile-engagement-center"',
  'href="/engagement-center"',
  'label="Outreach / Engagement Center"',
  'testId="tile-team-ops"',
  'testId="tile-patient-directory"',
  'testId="tile-document-upload"',
  'testId="tile-documents"',
  'testId="tile-plexus-tasks"',
  'testId="tile-plexus-drive"',
]);

// Plexus IQ hero is the black night-sky.
requireText(home, [
  "bg-[radial-gradient(ellipse_at_top_left,_#1e1b4b_0%,_#000000_55%,_#0b0716_100%)]",
  "text-white",
]);

// Removed standalone tiles (consolidated into Team Member Portals).
requireNotText(
  home,
  [
    'testId="tile-liaison-technician-portal"',
    'testId="tile-scheduler-portal"',
    'testId="tile-outreach-center"',
    'testId="tile-visit-patients"',
    'testId="tile-outreach-patients"',
    'testId="tile-patient-care-specialist-portal"',
    'testId="tile-ancillary-care-specialist-portal"',
  ],
  "Home dashboard must not retain standalone portal duplicates",
);

// Legacy PrimaryTile (the old aspect-square hero) must be gone.
requireNotText(
  home,
  ["function PrimaryTile(", "<PrimaryTile"],
  "HomeDashboard must not retain the legacy PrimaryTile",
);

// Equal-height tiles.
requireText(home, ['className="glass-tile glass-tile-interactive group cursor-pointer h-full"']);

if (failures.length) {
  console.error("Navigation dock + Home tiles QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Navigation dock + Home tiles QA passed.");

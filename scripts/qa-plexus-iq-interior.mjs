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

const page = "client/src/pages/plexus-iq.tsx";
const hub = "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx";
const workspace = "client/src/components/plexus-iq/PlexusIQWorkspace.tsx";
const dashboardRow = "client/src/components/plexus-iq/PlexusIQDashboardRow.tsx";
const dayModal = "client/src/components/plexus-iq/PlexusIQDayModal.tsx";
const addModal = "client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx";
const bulkModal = "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx";

// 1-2. Hub + Workspace + the page must exist and wire them up.
requireFile(hub);
requireFile(workspace);
requireFile(dashboardRow);
requireFile(dayModal);

requireText(page, [
  "PlexusIQAddPatientHub",
  "PlexusIQWorkspace",
  "PlexusIQDashboardRow",
  "<PlexusIQAddPatientHub",
  "<PlexusIQWorkspace",
]);

// 3. The 3 choices must be on the hub: Visit, Outreach, Plexus BatchFlow.
requireText(hub, [
  ">Visit<",
  ">Outreach<",
  "Plexus BatchFlow",
  "onPickVisit",
  "onPickOutreach",
  "onPickBatchFlow",
  "button-plexus-iq-add-patient-tile-visit",
  "button-plexus-iq-add-patient-tile-outreach",
  "button-plexus-iq-add-patient-tile-batchflow",
]);

// 4. BatchFlow must reach the canonical bulk-import modal.
requireText(page, [
  "PlexusIQBulkImportModal",
  "onPickBatchFlow",
  "setBulkOpen(true)",
]);

requireFile(bulkModal);

// 4b. Page must wire the hub state to the modal's defaultPatientType:
// each tile picks a kind, closes the hub, and opens the single modal
// with the right default.
requireText(page, [
  "defaultPatientType",
  'setDefaultPatientType("visit")',
  'setDefaultPatientType("outreach")',
]);

// 4c. Hub itself must NOT be wired into the command-center popup /
// playground layer. Visit / Outreach inside the hub are direct
// actions, not panel previews.
const hubContent = read(hub) ?? "";
const forbiddenInHub = [
  "PanelPopupCard",
  "CommandPlayground",
  "promoteToPlayground",
  "popup={true}",
  'componentType: "visit"',
  'componentType: "outreach"',
];
for (const needle of forbiddenInHub) {
  if (hubContent.includes(needle)) {
    failures.push(
      `Hub must not use popup/panel behavior: "${needle}" present in ${hub}`,
    );
  }
}

// 4d. Home / dashboard must not advertise Visit/Outreach as standalone
// tiles anymore — those live inside the Plexus IQ Add Patient(s)
// hub. Plexus IQ launcher tile stays.
const homeDashboard = "client/src/components/HomeDashboard.tsx";
const homeContent = read(homeDashboard) ?? "";
const forbiddenOnHome = [
  "<VisitCommandTile",
  "<OutreachCommandTile",
  'label="Visit Patients"',
  'label="Outreach Patients"',
  'testId="tile-visit-patients"',
  'testId="tile-outreach-patients"',
];
for (const needle of forbiddenOnHome) {
  if (homeContent.includes(needle)) {
    failures.push(
      `Home dashboard must not render Visit/Outreach standalone tiles: "${needle}" present in ${homeDashboard}`,
    );
  }
}
if (homeContent && !homeContent.includes('data-testid="tile-plexus-iq"')) {
  failures.push(
    `Home dashboard must keep the Plexus IQ launcher tile (data-testid="tile-plexus-iq") in ${homeDashboard}`,
  );
}

// 5. Facility-card / worklist group test IDs must exist on the workspace.
requireText(workspace, [
  "plexus-iq-worklist-group-",
  "button-plexus-iq-worklist-toggle-",
  "button-plexus-iq-worklist-action-",
  "facility",
]);

// 6. Visit/Outreach must stay canonical inside the add-patient modal.
requireText(addModal, [
  "VisitOutreachKindToggle",
  "@/features/command-center/tiles",
  'surface="plexusIq"',
  "defaultPatientType",
]);

// 7. No Plexus-only Visit/Outreach tile/card files anywhere in the repo.
const forbiddenPatterns = [
  /Plexus(IQ|Iq)?VisitTile\.tsx$/,
  /Plexus(IQ|Iq)?OutreachTile\.tsx$/,
  /Plexus(IQ|Iq)?VisitCard\.tsx$/,
  /Plexus(IQ|Iq)?OutreachCard\.tsx$/,
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === "tmp_recovery" ||
      entry.name === "artifacts"
    ) {
      continue;
    }
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(next));
    } else if (entry.isFile()) {
      out.push(next);
    }
  }
  return out;
}

const allFiles = walk(root);
for (const file of allFiles) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(file)) {
      failures.push(
        `Forbidden Plexus-only tile/card file: ${path.relative(root, file)}`,
      );
    }
  }
}

// 8. Page must not be the calendar-first stats/day-panel/right-calendar
// dashboard layout we just replaced.
requireText(page, [
  "PlexusIQDashboardRow",
]);
const pageContent = read(page) ?? "";
if (pageContent.includes("PlexusIQStatsRow")) {
  failures.push(
    `Page still references PlexusIQStatsRow — the canonical replacement is PlexusIQDashboardRow`,
  );
}
if (pageContent.includes("PlexusIQDayPanel")) {
  failures.push(
    `Page still references PlexusIQDayPanel — the canonical replacement is PlexusIQDayModal`,
  );
}

if (failures.length) {
  console.error("Plexus IQ interior QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ interior QA passed.");

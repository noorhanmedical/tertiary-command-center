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
      failures.push(`${label}: ${rel} still contains "${needle}"`);
    }
  }
}

const tileTypes = "client/src/features/command-center/tiles/commandTileTypes.ts";
const tileProfiles = "client/src/features/command-center/tiles/commandTileProfiles.ts";
const tileBase = "client/src/features/command-center/tiles/CommandTile.tsx";
const visitTile = "client/src/features/command-center/tiles/VisitCommandTile.tsx";
const outreachTile = "client/src/features/command-center/tiles/OutreachCommandTile.tsx";
const kindToggle = "client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx";
const tileIndex = "client/src/features/command-center/tiles/index.ts";
const playground = "client/src/features/command-center/playground/CommandPlayground.tsx";
const qualification = "client/src/pages/qualification.tsx";
const plexusIqAddPatientModal =
  "client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx";

requireFile(tileBase);
requireFile(tileIndex);

requireText(tileTypes, [
  "CommandTileKind",
  "CommandTileSurface",
  "CommandTileContext",
  '"visit"',
  '"outreach"',
  '"pcs"',
  '"acs"',
  '"plexusIq"',
  '"dashboard"',
]);

requireText(tileProfiles, [
  "commandTileProfiles",
  '"pcs"',
  '"acs"',
  '"plexusIq"',
  '"dashboard"',
  '"tile-qualification-visit"',
  '"tile-qualification-outreach"',
]);

requireText(visitTile, [
  "VisitCommandTile",
  "commandTileProfiles",
  "CalendarDays",
  "CommandTileSurface", // surface union (incl. plexusIq) consumed via type import
  "surface:",
  "popup",
  "PanelPopupCard",
  'componentType: "visit"',
]);

requireText(outreachTile, [
  "OutreachCommandTile",
  "commandTileProfiles",
  "Phone",
  "CommandTileSurface",
  "surface:",
  "popup",
  "PanelPopupCard",
  'componentType: "outreach"',
]);

// qualification.tsx is no longer the canonical Plexus IQ Add Patient
// surface — that role now belongs to PlexusIQAddPatientHub +
// PlexusIQAddPatientModal inside /plexus-iq. The canonical Visit /
// Outreach contract still has to exist (tile components + profile
// configuration) but the qualification page is allowed to use, ignore,
// or omit it. The QA stops asserting qualification.tsx specifically
// and instead asserts the Plexus IQ Add Patient flow consumes the
// canonical control (handled below via plexusIqAddPatientModal).
void qualification;

requireText(playground, [
  'componentType === "visit"',
  'componentType === "outreach"',
  "VisitWorkspace",
  "OutreachWorkspace",
]);

requireText(kindToggle, [
  "VisitOutreachKindToggle",
  "CommandTileSurface",
  "CommandTileKind",
  '"visit"',
  '"outreach"',
  "value",
  "onChange",
  "surface",
]);

requireText(tileIndex, [
  "VisitOutreachKindToggle",
]);

requireText(plexusIqAddPatientModal, [
  "VisitOutreachKindToggle",
  '@/features/command-center/tiles',
  '<VisitOutreachKindToggle',
  'surface="plexusIq"',
]);

requireNotText(
  plexusIqAddPatientModal,
  [
    '`button-plexus-iq-add-type-${t}`',
    '(["visit", "outreach"] as const).map',
    '{t === "visit" ? "Visit" : "Outreach"}',
  ],
  "Inline Visit/Outreach segmented toggle still present (must use canonical VisitOutreachKindToggle)"
);

// Verify canonical testIds live in the shared profile, not duplicated elsewhere.
const profilesContent = read(tileProfiles) ?? "";
if (!profilesContent.includes('"tile-qualification-visit"')) {
  failures.push(
    `Canonical visit testId "tile-qualification-visit" must live in ${tileProfiles}`
  );
}
if (!profilesContent.includes('"tile-qualification-outreach"')) {
  failures.push(
    `Canonical outreach testId "tile-qualification-outreach" must live in ${tileProfiles}`
  );
}

// Forbid Plexus-only tile/card duplicate files.
const forbiddenPatterns = [
  /Plexus(IQ|Iq)?VisitTile\.tsx$/,
  /Plexus(IQ|Iq)?OutreachTile\.tsx$/,
  /Plexus(IQ|Iq)?VisitCard\.tsx$/,
  /Plexus(IQ|Iq)?OutreachCard\.tsx$/,
];

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build" || entry.name === "tmp_recovery" || entry.name === "artifacts") {
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
        `Forbidden Plexus-only tile/card file: ${path.relative(root, file)}`
      );
    }
  }
}

// Verify CommandTileSurface accepts plexusIq specifically (signal in the types
// file that the surface union includes the string token).
const typesContent = read(tileTypes) ?? "";
if (!typesContent.match(/CommandTileSurface\s*=\s*[^;]*"plexusIq"/)) {
  failures.push(
    `CommandTileSurface union in ${tileTypes} must include "plexusIq"`
  );
}

if (failures.length) {
  console.error("Visit/Outreach tile parity QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Visit/Outreach tile parity QA passed.");

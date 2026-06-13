// QA — Patient Directory single-source UI.
//
// Phase 1 guardrail: exactly one Patient Directory route, one nav
// entry, one page component. The previous `/patient-directory/live`
// duplicate route + "Patient Directory · Live" nav item are
// forbidden. The /live URL must still resolve (redirect to the
// canonical /patient-directory) so bookmarks don't 404.
//
// Run: node scripts/qa-phase-1-patient-directory-single-source-ui.mjs

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
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) {
    if (src.includes(n)) failures.push(`${label}: forbidden "${n}" still present in ${rel}`);
  }
}

const app = "client/src/App.tsx";
const nav = "client/src/components/GlobalNav.tsx";

// 1) App.tsx must NOT mount PatientDirectoryLiveRoute as a component
//    on /patient-directory/live. The redirect form is required.
requireNotText(
  app,
  [
    'path="/patient-directory/live" component=',
    "import PatientDirectoryLiveRoute",
  ],
  "App.tsx must not mount /patient-directory/live as a component route",
);

// 2) The /patient-directory/live URL must still redirect to the
//    canonical /patient-directory so bookmarks survive.
requireText(app, [
  '<Route path="/patient-directory/live">',
  '<Redirect to="/patient-directory" />',
  '<Route path="/patient-directory" component={PatientDatabasePage}',
]);

// 3) Sidebar / global nav must not list the "Patient Directory · Live"
//    entry. The canonical "Patient Directory" entry stays.
requireNotText(
  nav,
  [
    '"Patient Directory · Live"',
    '"/patient-directory/live"',
  ],
  "GlobalNav must not list a second Patient Directory entry",
);
requireText(nav, [
  '"/patient-directory"',
  '"Patient Directory"',
]);

if (failures.length > 0) {
  console.error("Patient Directory single-source UI QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory single-source UI QA passed.");

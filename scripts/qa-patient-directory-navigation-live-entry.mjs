// QA: Patient Directory navigation (Phase 1 Slice 1.5 update).
//
// Originally written in Part 7 to enforce the existence of a separate
// /patient-directory/live route + sidebar entry. Phase 1 Slice 1.5
// (Patient Directory single-source UI) consolidated that surface back
// into the canonical /patient-directory route, so this QA was updated
// to reflect the new contract:
//
//   - /patient-directory/live URL still resolves (redirects to
//     /patient-directory) so existing bookmarks don't 404.
//   - The PatientDirectoryLiveRoute / PatientDirectoryLivePage code
//     stays in place for component reuse inside the canonical page.
//   - The "Patient Directory · Live" GlobalNav item is removed.
//
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — Live page component still exists (preserved for reuse).
const LIVE = "client/src/pages/patient-directory-live.tsx";
const c = read(LIVE);
if (c === null) failures.push(`Missing file: ${LIVE}`);
else for (const n of [
  "PatientDirectoryLiveRoute",
  "PatientDirectoryLivePage",
  "Patient Directory (live)",
]) if (!c.includes(n)) failures.push(`${LIVE} missing "${n}"`);

// §2 — Route consolidation: /patient-directory/live REDIRECTS to the
//      canonical route; the canonical /patient-directory still serves
//      PatientDatabasePage.
const APP = read("client/src/App.tsx") ?? "";
for (const n of [
  '<Route path="/patient-directory/live">',
  '<Redirect to="/patient-directory" />',
  'component={PatientDatabasePage}',
  'path="/patient-directory"',
]) if (!APP.includes(n)) failures.push(`App.tsx missing "${n}"`);
// Forbid the prior component mount form.
for (const n of [
  'component={PatientDirectoryLiveRoute}',
  'import PatientDirectoryLiveRoute',
]) if (APP.includes(n)) failures.push(`App.tsx must not mount the duplicate live route: "${n}"`);

// §3 — Sidebar / global nav must list the canonical Patient Directory
//      entry and MUST NOT list a separate "· Live" entry.
const NAV = read("client/src/components/GlobalNav.tsx") ?? "";
for (const n of [
  '"/patient-directory"',
  '"Patient Directory"',
]) if (!NAV.includes(n)) failures.push(`GlobalNav missing canonical "${n}"`);
for (const n of [
  '"/patient-directory/live"',
  '"Patient Directory · Live"',
]) if (NAV.includes(n)) failures.push(`GlobalNav must not list the duplicate "${n}"`);

// §4 — Legacy PatientDirectoryView untouched (no removal).
if (read("client/src/components/PatientDirectoryView.tsx") === null) {
  failures.push("Legacy PatientDirectoryView removed — P7 must not delete it");
}

if (failures.length > 0) {
  console.error("Patient Directory navigation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory navigation QA passed.");

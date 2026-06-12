// QA: Patient Directory navigation live entry (Part 7).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — Live page exists.
const LIVE = "client/src/pages/patient-directory-live.tsx";
const c = read(LIVE);
if (c === null) failures.push(`Missing file: ${LIVE}`);
else for (const n of [
  "PatientDirectoryLiveRoute",
  "PatientDirectoryLivePage",
  "Patient Directory (live)",
]) if (!c.includes(n)) failures.push(`${LIVE} missing "${n}"`);

// §2 — Route registered + legacy /patient-directory still points to PatientDatabasePage.
const APP = read("client/src/App.tsx") ?? "";
for (const n of [
  'import PatientDirectoryLiveRoute from "@/pages/patient-directory-live"',
  'path="/patient-directory/live"',
  'component={PatientDirectoryLiveRoute}',
  // Legacy intact.
  'component={PatientDatabasePage}',
  'path="/patient-directory"',
]) if (!APP.includes(n)) failures.push(`App.tsx missing "${n}"`);

// §3 — Sidebar / global nav has an entry.
const NAV = read("client/src/components/GlobalNav.tsx") ?? "";
for (const n of [
  "/patient-directory/live",
  "Patient Directory · Live",
]) if (!NAV.includes(n)) failures.push(`GlobalNav missing "${n}"`);

// §4 — Legacy PatientDirectoryView untouched (no removal).
if (read("client/src/components/PatientDirectoryView.tsx") === null) {
  failures.push("Legacy PatientDirectoryView removed — P7 must not delete it");
}

if (failures.length > 0) {
  console.error("Patient Directory navigation live entry QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory navigation live entry QA passed.");

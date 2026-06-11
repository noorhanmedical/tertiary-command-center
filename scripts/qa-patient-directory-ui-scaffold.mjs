// QA: Patient Directory UI scaffold (Batch B11).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const FILES = [
  "client/src/components/patient-directory/PatientDirectoryPage.tsx",
  "client/src/components/patient-directory/PatientProfileDrawer.tsx",
];
for (const rel of FILES) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

const page = read(FILES[0]) ?? "";
for (const n of [
  "PatientDirectoryPage",
  "patient-directory-page",
  "patient-directory-search-input",
  "patient-directory-add-patient",
  "patient-directory-bulk-import",
  "patient-directory-rows",
  "patient-directory-empty",
  "PatientProfileDrawer",
  "PatientAuditTrailModal",
]) if (!page.includes(n)) failures.push(`Missing "${n}" in PatientDirectoryPage`);

const drawer = read(FILES[1]) ?? "";
for (const n of [
  "PatientProfileDrawer",
  "patient-profile-drawer",
  "patient-profile-tab-demographics",
  "patient-profile-tab-prior-tests",
  "patient-profile-tab-contact-restrictions",
  "patient-profile-tab-cooldown",
  "patient-profile-tab-engagement-history",
  "patient-profile-tab-call-history",
  "patient-profile-tab-admin-review-history",
  "patient-profile-tab-imports",
  "patient-profile-tab-audit-trail",
  "patient-profile-header-badges",
  "Do Not Contact",
  "Active cooldown",
  "Previously sent to Engagement",
  "prior ancillary test",
]) if (!drawer.includes(n)) failures.push(`Missing "${n}" in PatientProfileDrawer`);

// Existing legacy PatientDirectoryView unchanged.
if (read("client/src/components/PatientDirectoryView.tsx") === null) {
  failures.push("Legacy PatientDirectoryView missing — B11 must not remove it");
}

if (failures.length > 0) {
  console.error("Patient Directory UI scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory UI scaffold QA passed.");

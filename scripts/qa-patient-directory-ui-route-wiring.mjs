// QA: Patient Directory UI ↔ API wiring (Batch E).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const LIVE = "client/src/components/patient-directory/PatientDirectoryLivePage.tsx";
const c = read(LIVE);
if (c === null) failures.push(`Missing file: ${LIVE}`);
else for (const n of [
  "PatientDirectoryLivePage",
  "searchPatientDirectory",
  "getPatientDirectorySnapshot",
  "getPatientDirectoryAudit",
  "isPatientDirectoryActivationReachable",
  "auditEndpointUnavailable",
  "snapshotToProfile",
  "PatientDirectoryPage",
]) if (!c.includes(n)) failures.push(`${LIVE} missing "${n}"`);

// Existing scaffold + drawer + modal are still on disk and unmodified.
for (const rel of [
  "client/src/components/patient-directory/PatientDirectoryPage.tsx",
  "client/src/components/patient-directory/PatientProfileDrawer.tsx",
  "client/src/components/patient-directory/PatientAuditTrailModal.tsx",
  "client/src/components/patient-directory/DuplicateWarningBadge.tsx",
  "client/src/lib/patientDirectoryApi.ts",
]) if (read(rel) === null) failures.push(`Required surface missing: ${rel}`);

// Drawer + modal already render an endpointUnavailable / source-unavailable
// fallback — the live page wires the flag in.
{
  const modal = read("client/src/components/patient-directory/PatientAuditTrailModal.tsx") ?? "";
  if (!modal.includes("endpointUnavailable")) {
    failures.push("PatientAuditTrailModal must accept endpointUnavailable prop");
  }
}

if (failures.length > 0) {
  console.error("Patient Directory UI wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory UI wiring QA passed.");

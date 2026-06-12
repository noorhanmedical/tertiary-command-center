// QA: Patient Directory live audit trail wiring (Part 6).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — GET /:patientId/audit is served by the route file.
const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/:patientId/audit"',
  "deps.loadEvents",
]) if (!RT.includes(n)) failures.push(`patient-directory route missing "${n}"`);

// §2 — Client API helper exposes getPatientDirectoryAudit.
const API = read("client/src/lib/patientDirectoryApi.ts") ?? "";
for (const n of [
  "getPatientDirectoryAudit",
  "/api/patient-directory/${id}/audit",
]) if (!API.includes(n)) failures.push(`client API missing "${n}"`);

// §3 — Modal is reachable from at least three surfaces (Plexus IQ panel,
//      Engagement banner, Team Portal call-list banner) + the Patient
//      Directory live page consumes endpointUnavailable so OFF flag
//      shows the source-unavailable state.
{
  const surfaces = [
    "client/src/components/plexus-iq/PlexusIQRunOrganizationPanel.tsx",
    "client/src/components/engagement/EngagementDuplicateBanner.tsx",
    "client/src/components/outreach/CallListDuplicateBanner.tsx",
  ];
  for (const rel of surfaces) {
    const c = read(rel) ?? "";
    if (!c.includes("PatientAuditTrailModal")) failures.push(`${rel} must render PatientAuditTrailModal`);
  }
  const live = read("client/src/components/patient-directory/PatientDirectoryLivePage.tsx") ?? "";
  if (!live.includes("auditEndpointUnavailable")) failures.push("PatientDirectoryLivePage missing auditEndpointUnavailable wiring");
}

// §4 — Writer emits events with each kind expected by the modal.
{
  const writer = read("server/services/patientDirectory/patientDirectoryWriter.ts") ?? "";
  for (const kind of [
    "patient_created", "imported", "profile_updated",
    "dnc_set", "dnc_cleared", "cooldown_set", "cooldown_cleared",
    "prior_test_added",
  ]) if (!writer.includes(`"${kind}"`)) failures.push(`writer missing kind "${kind}"`);
}

if (failures.length > 0) {
  console.error("Patient Directory live audit-trail wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory live audit-trail wiring QA passed.");

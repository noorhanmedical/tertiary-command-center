// QA: Patient Audit Trail modal (Batch B10).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const MODAL = "client/src/components/patient-directory/PatientAuditTrailModal.tsx";
const TYPES = "client/src/lib/patientDirectoryAuditTypes.ts";

for (const rel of [MODAL, TYPES]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "PatientAuditTrailModal",
  "endpointUnavailable",
  "patient-audit-trail-modal",
  "patient-audit-trail-list",
  "patient-audit-trail-empty",
  "patient-audit-trail-endpoint-unavailable",
  "patient_created",
  "imported",
  "qualification_generated",
  "admin_review_approved",
  "admin_review_rejected",
  "admin_review_needs_info",
  "sent_to_engagement",
  "added_to_call_list",
  "call_completed",
  "dnc_set",
  "dnc_cleared",
  "cooldown_set",
  "cooldown_cleared",
  "prior_test_logged",
  "packet_generated",
  "document_uploaded",
  "soft_deleted",
  "restored",
]) {
  const c = read(MODAL) ?? "";
  if (!c.includes(n)) failures.push(`Missing "${n}" in ${MODAL}`);
}

if (failures.length > 0) {
  console.error("Patient audit trail modal QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient audit trail modal QA passed.");

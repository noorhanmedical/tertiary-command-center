// QA: PDF/packet patient selection dialog (Batch B15).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DIALOG = "client/src/components/plexus-iq/PacketPatientSelectionDialog.tsx";
const c = read(DIALOG);
if (c === null) failures.push(`Missing file: ${DIALOG}`);
else for (const n of [
  "PacketPatientSelectionDialog",
  "PacketPatient",
  "orderPatientsWithinRun",
  "Select all",
  "Clear all",
  "packet-patient-selection-dialog",
  "packet-select-all",
  "packet-clear-all",
  "packet-confirm",
  "packet-cancel",
  "packet-section-outreach",
  "packet-section-visit",
  "Print selected",
  "Save selected",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DIALOG}`);

// Existing PDF libraries unchanged.
for (const rel of [
  "client/src/lib/pdfGeneration.ts",
  "client/src/lib/pdfPacketGrouping.ts",
]) if (read(rel) === null) failures.push(`PDF library missing: ${rel}`);

if (failures.length > 0) {
  console.error("PDF packet patient selection dialog QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PDF packet patient selection dialog QA passed.");

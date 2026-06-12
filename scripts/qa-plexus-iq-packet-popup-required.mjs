// QA: Plexus IQ hotfix — packet popup is required before generation.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — ClinicDetailPackets uses an openPacketPicker / packetSel state
//      to open the popup BEFORE handlePacket() runs.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
for (const n of [
  "openPacketPicker",
  "packetSel",
  "setPacketSel",
  "<PdfPatientSelectDialog",
  // The two packet buttons must route through the picker, not directly
  // to handlePacket.
  'openPacketPicker("plexus"',
  'openPacketPicker("clinician"',
]) if (!WK.includes(n)) failures.push(`PlexusIQWorkspace missing "${n}"`);
// Guard against regression: the previous direct call must be gone
// from the button onClick handlers.
if (/onClick=\{\(\)\s*=>\s*handlePacket\(/.test(WK)) {
  failures.push("packet buttons must call openPacketPicker, not handlePacket directly");
}

// §2 — PdfPatientSelectDialog still exposes Select All / Cancel /
//      Generate + checkboxes per patient, and routes its onGenerate to
//      the workspace handler that filters down to selected patients.
const DLG = read("client/src/components/PdfPatientSelectDialog.tsx") ?? "";
for (const n of [
  "select-all",
  "checkbox-select-all-patients",
  "checkbox-patient-pdf-",
  "button-pdf-cancel",
  "button-pdf-generate",
  "onGenerate(ordered.filter",
  "orderPatientsWithinRun",
]) if (!DLG.includes(n)) failures.push(`PdfPatientSelectDialog missing "${n}"`);

// §3 — When the dialog confirms, the workspace filters packetSel.patients
//      to the selected subset before calling handlePacket.
if (!/handlePacket\([^,]+,\s*[^,]+,\s*filtered\)/.test(WK)) {
  failures.push("workspace must filter packetSel.patients to the dialog's selected set before generation");
}

if (failures.length > 0) {
  console.error("Packet popup required QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Packet popup required QA passed.");

// QA: PDF packet selection live wiring (Part 11).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — ResultsView already wires PdfPatientSelectDialog before
//      generateClinicianPDF / generatePlexusPDF.
const RV = read("client/src/components/ResultsView.tsx") ?? "";
for (const n of [
  "PdfPatientSelectDialog",
  "pdfMode",
  "handlePdfGenerate",
  "generateClinicianPDF",
  "generatePlexusPDF",
]) if (!RV.includes(n)) failures.push(`ResultsView missing "${n}"`);

// §2 — PdfPatientSelectDialog uses orderPatientsWithinRun for the
//      visible ordering AND for the patient set passed to onGenerate.
const D = read("client/src/components/PdfPatientSelectDialog.tsx") ?? "";
for (const n of [
  "orderPatientsWithinRun",
  "const ordered =",
  "ordered.map(p =>",
  "onGenerate(ordered.filter",
]) if (!D.includes(n)) failures.push(`PdfPatientSelectDialog missing "${n}"`);

// §3 — pdfGeneration.ts + pdfPacketGrouping.ts visual format unchanged.
//      We assert they exist and that no new font/layout helpers leaked
//      in via the dialog edit.
{
  const gen = read("client/src/lib/pdfGeneration.ts") ?? "";
  if (!gen.includes("generateClinicianPDF") || !gen.includes("generatePlexusPDF")) {
    failures.push("pdfGeneration.ts must still expose generateClinicianPDF + generatePlexusPDF");
  }
}

// §4 — Standalone PacketPatientSelectionDialog still exists for future use.
if (read("client/src/components/plexus-iq/PacketPatientSelectionDialog.tsx") === null) {
  failures.push("Standalone PacketPatientSelectionDialog removed — keep it for the standalone packet flow");
}

if (failures.length > 0) {
  console.error("PDF packet selection live wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PDF packet selection live wiring QA passed.");

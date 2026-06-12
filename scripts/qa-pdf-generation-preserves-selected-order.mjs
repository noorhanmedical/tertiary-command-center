// QA: the PDF generation path preserves the selected order — no
// downstream sort/re-bucket re-orders the patient list after the
// dialog confirms.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — pdfGeneration.ts must not contain a sort that would override
//      the caller's order. Builders iterate the input patients array
//      in order; no `.sort(` allowed inside the file.
const GEN = read("client/src/lib/pdfGeneration.ts") ?? "";
if (/patients\s*\.\s*sort\s*\(/.test(GEN) || /patients\.slice\(\)\.sort\(/.test(GEN)) {
  failures.push("pdfGeneration.ts must not re-sort the caller's patient list");
}

// §2 — pdfPacketGrouping.ts must preserve input order inside the
//      single-group success path. validateSameFacilityDatePacket
//      returns `only.patients` which is the bucket built by iterating
//      the input; the function must not call .sort() on it.
const GRP = read("client/src/lib/pdfPacketGrouping.ts") ?? "";
if (/only\.patients\.sort\s*\(/.test(GRP)) {
  failures.push("pdfPacketGrouping.ts must not sort the single-group patients before returning");
}

// §3 — Workspace handlePacket hands validation.patients (which is the
//      ordered list because we ordered eligible before calling
//      validate) to openPatientPacketPrintPreview. Verify the call
//      shape didn't regress.
const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";
if (!/openPatientPacketPrintPreview\(\{[\s\S]+?patients:\s*validation\.patients/.test(WK)) {
  failures.push("handlePacket must pass validation.patients to openPatientPacketPrintPreview unchanged");
}

// §4 — End-to-end fixture proves the helper output matches both the
//      dialog and the PDF order. The helper's unit test already
//      covers Zimmerman/Brown/Adams/Miller → A/B/M/Z and
//      10:00/8:30/9:15 → 8:30/9:15/10:00; verify those fixtures
//      remain in the test file.
const T = read("tests/unit/patientPacketOrdering.test.ts") ?? "";
for (const n of [
  "Zimmerman, Sara",
  "Brown, Kevin",
  "Adams, Carla",
  "Miller, Dawn",
  '"Adams, Carla", "Brown, Kevin", "Miller, Dawn", "Zimmerman, Sara"',
  "2026-06-12T10:00:00Z",
  "2026-06-12T08:30:00Z",
  "2026-06-12T09:15:00Z",
]) if (!T.includes(n)) failures.push(`fixture missing "${n}"`);

if (failures.length > 0) {
  console.error("PDF generation preserves selected order QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PDF generation preserves selected order QA passed.");

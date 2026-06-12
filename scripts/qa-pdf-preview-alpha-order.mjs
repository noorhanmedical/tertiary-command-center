// QA: PDF preview / saved PDF receives the ordered selection — the
// dialog's onGenerate handler must NOT pass raw filtered patients.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";

// §1 — onGenerate must order the filtered selection before calling
//      handlePacket. Specifically: filteredRaw → orderPacketPatientsFor
//      DisplayAndPdf(filteredRaw) → handlePacket(..., filtered).
if (!/orderPacketPatientsForDisplayAndPdf\(filteredRaw\)/.test(WK)) {
  failures.push("dialog onGenerate must wrap the filtered list with orderPacketPatientsForDisplayAndPdf before handPacket");
}

// §2 — Regression guard: the old "filtered" name without ordering
//      must not be the handoff. The line that previously called
//      handlePacket(packetSel.mode, packetSel.scheduleDate, filtered)
//      where `filtered` was raw — must no longer exist.
//
// We enforce this by requiring the file to define both `filteredRaw`
// and `filtered` AND for `filtered` to come from the helper.
{
  if (!/const filteredRaw\s*=\s*packetSel\.patients\.filter/.test(WK)) {
    failures.push("dialog onGenerate must keep filteredRaw separate from the ordered hand-off variable");
  }
  if (!/const filtered\s*=\s*orderPacketPatientsForDisplayAndPdf\(filteredRaw\)/.test(WK)) {
    failures.push("dialog onGenerate must compute `filtered` via orderPacketPatientsForDisplayAndPdf(filteredRaw)");
  }
}

// §3 — handlePacket itself orders the eligible roster before
//      validateSameFacilityDatePacket so non-popup callers are also
//      covered.
if (!/const orderedEligible\s*=\s*orderPacketPatientsForDisplayAndPdf\(/.test(WK)) {
  failures.push("handlePacket must compute orderedEligible via orderPacketPatientsForDisplayAndPdf(...)");
}

if (failures.length > 0) {
  console.error("PDF preview alpha-order QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PDF preview alpha-order QA passed.");

// QA: Plexus IQ completed-section visible list uses the ordered
// helper, not raw rows.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WK = read("client/src/components/plexus-iq/PlexusIQWorkspace.tsx") ?? "";

// §1 — clinicDetailFiltered must call the helper before returning.
if (!/clinicDetailFiltered\s*=\s*useMemo\([\s\S]+?orderPacketPatientsForDisplayAndPdf\(filtered\)/.test(WK)) {
  failures.push("clinicDetailFiltered must end with orderPacketPatientsForDisplayAndPdf(filtered)");
}

// §2 — The old raw "return rows.filter(isFinalized)" return must be gone.
if (/return rows\.filter\(isFinalized\);/.test(WK)) {
  failures.push("clinicDetailFiltered must not return raw rows.filter(isFinalized); the visible list must be ordered");
}

// §3 — Workspace imports the helper.
if (!WK.includes('from "@/lib/patientPacketOrdering"')) {
  failures.push("workspace must import orderPacketPatientsForDisplayAndPdf from @/lib/patientPacketOrdering");
}

// §4 — Helper exists and is the canonical helper.
const HELP = read("client/src/lib/patientPacketOrdering.ts") ?? "";
for (const n of [
  "orderPacketPatientsForDisplayAndPdf",
  "orderPatientsWithinRun",
  "PatientScreening",
]) if (!HELP.includes(n)) failures.push(`helper missing "${n}"`);

// §5 — Run the unit test.
try {
  execSync(`npx tsx tests/unit/patientPacketOrdering.test.ts`, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
} catch {
  failures.push("patientPacketOrdering unit test FAILED");
}

if (failures.length > 0) {
  console.error("Plexus IQ completed-preview alpha-order QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Plexus IQ completed-preview alpha-order QA passed.");

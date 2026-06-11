// QA: Team Portal Patient Directory wiring contract (Batch E2).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/team-portal-patient-directory-wiring-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Patient Directory wiring contract",
  "read-only and additive",
  "GET /api/engagement/patient-directory/:patientId",
  "demographics",
  "qualification",
  "engagement",
  "ancillaryBlockers",
  "callHistoryRef",
  "OPTIONAL in Phase 1",
  "VITE_USE_PATIENT_DIRECTORY_WIRING",
  "USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT",
  "default-OFF",
  "MUST NOT",
  "Admin Review territory",
  "Mission Control",
  "No NEW route file",
  "No NEW client component file",
  "No migration",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// E2 is docs+QA only — confirm no endpoint/client file added under that name yet.
// (Dormancy check: the VITE flag and endpoint env var MUST NOT appear in code yet.)
{
  const ROOTS = ["server", "client", "shared"];
  const PATTERNS = [
    "VITE_USE_PATIENT_DIRECTORY_WIRING",
    "USE_ENGAGEMENT_PATIENT_DIRECTORY_ENDPOINT",
  ];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      for (const p of PATTERNS) {
        if (src.includes(p)) failures.push(`E2 is docs+QA only: ${rel} already references ${p}`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Team Portal Patient Directory wiring contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal Patient Directory wiring contract QA passed.");

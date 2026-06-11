// QA: RingCentral adapter contract (Batch E5).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/ringcentral-adapter-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "RingCentral adapter contract",
  "ONLY a telephony adapter",
  "IN scope (Phase 1)",
  "OUT of scope (Phase 1)",
  "Recording / playback / transcription",
  "SMS / messaging",
  "Auto-dialing",
  "server/services/ringCentral",
  "ringCentralClient.ts",
  "ringCentralAdapter.ts",
  "InitiateCallInput",
  "InitiateCallResult",
  "ringCentralCallId",
  "RINGCENTRAL_CLIENT_ID",
  "RINGCENTRAL_CLIENT_SECRET",
  "RINGCENTRAL_JWT",
  "RINGCENTRAL_SERVER_URL",
  "USE_RINGCENTRAL_ADAPTER",
  "VITE_USE_RINGCENTRAL_CLICK_TO_CALL",
  "All flags default OFF",
  "does NOT call `recordCallResult`",
  "callMetadata.ringCentralCallId",
  "does NOT touch",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// E5 is docs+QA only — flags + module must NOT exist in code yet.
{
  const ROOTS = ["server", "client", "shared"];
  const FORBIDDEN_PATTERNS = [
    "USE_RINGCENTRAL_ADAPTER",
    "VITE_USE_RINGCENTRAL_CLICK_TO_CALL",
    "RINGCENTRAL_CLIENT_ID",
    "RINGCENTRAL_JWT",
    "ringCentralAdapter",
    "ringCentralClient",
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
      for (const p of FORBIDDEN_PATTERNS) {
        if (src.includes(p)) failures.push(`E5 is docs+QA only: ${rel} already references "${p}"`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("RingCentral adapter contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("RingCentral adapter contract QA passed.");

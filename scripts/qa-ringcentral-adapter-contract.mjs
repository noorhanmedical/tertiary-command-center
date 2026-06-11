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

// Authorized references to the RingCentral adapter scaffold.
// Batch E6 introduces the scaffold module + its own test; nothing else
// may reference the flag or module identifiers yet. Update this
// allowlist alongside each new authorized batch.
{
  const ALLOWED = new Set([
    "server/services/ringCentral/ringCentralAdapter.ts",
    "server/services/ringCentral/ringCentralClient.ts",
    "server/services/ringCentral/__tests__/ringCentralAdapter.test.ts",
  ]);
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
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(abs, "utf8");
      for (const p of FORBIDDEN_PATTERNS) {
        if (src.includes(p)) failures.push(`Unauthorized reference: ${rel} references "${p}"`);
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

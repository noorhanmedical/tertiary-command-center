// QA: Phase 1 environment variable inventory (Batch H2).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-env-var-inventory.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "environment variable inventory",
  "DATABASE_URL",
  "SESSION_SECRET",
  "OPENAI_API_KEY",
  "USE_PORTAL_CALL_HISTORY_READ",
  "USE_RINGCENTRAL_ADAPTER",
  "USE_ANCILLARY_READ_MODEL",
  "USE_ANCILLARY_SIGNING_SERVICE",
  "USE_BILLING_READINESS_AGGREGATOR_V2",
  "USE_INVOICING_SCAFFOLD_V2",
  "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
  "VITE_USE_LEGACY_DISPOSITION_WRITE",
  "VITE_USE_PATIENT_CALL_HISTORY_READ",
  "VITE_USE_INVOICE_UI",
  "Secrets handling",
  "Never from a committed file",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// .gitignore still blocks .env* and no .env file is committed.
{
  const gi = read(".gitignore") ?? "";
  if (!/\.env/.test(gi)) failures.push(".gitignore must continue to ignore .env*");
  for (const candidate of [".env", ".env.local", ".env.production", ".env.staging"]) {
    if (fs.existsSync(path.join(root, candidate))) failures.push(`Secret file present: ${candidate} must not be committed`);
  }
}

// Cross-check: every flag the inventory says exists is either
// (a) referenced in code already, or (b) explicitly noted as
// "Future ..." in the inventory. The list below holds the ones we
// expect to be live in code right now.
{
  const LIVE_FLAGS = [
    // Server flags currently wired.
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
    "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
    "USE_PORTAL_CALL_HISTORY_READ",
    "USE_RINGCENTRAL_ADAPTER",
    "USE_ANCILLARY_READ_MODEL",
    "USE_ANCILLARY_SIGNING_SERVICE",
    "USE_BILLING_READINESS_AGGREGATOR_V2",
    "USE_INVOICING_SCAFFOLD_V2",
    // VITE flags currently wired.
    "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
    "VITE_USE_LEGACY_DISPOSITION_WRITE",
    "VITE_USE_PATIENT_CALL_HISTORY_READ",
    "VITE_USE_INVOICE_UI",
  ];
  // Spot-check: each must appear at least once somewhere under server/ or client/.
  const ROOTS = ["server", "client", "shared"];
  const found = new Set();
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(abs, "utf8");
      for (const flag of LIVE_FLAGS) {
        if (src.includes(flag)) found.add(flag);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
  for (const flag of LIVE_FLAGS) {
    if (!found.has(flag)) failures.push(`Inventory claims live flag "${flag}" but no code reference found`);
  }
}

if (failures.length > 0) {
  console.error("Phase 1 env var inventory QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 env var inventory QA passed.");

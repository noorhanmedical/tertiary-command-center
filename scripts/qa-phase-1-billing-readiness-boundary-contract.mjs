// QA: Phase 1 billing readiness boundary contract (Batch G1).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-billing-readiness-boundary-contract.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "billing readiness boundary contract",
  "READ-ONLY aggregator",
  "What billing readiness owns in Phase 1",
  "billing_readiness_checks",
  "What billing readiness does NOT own",
  "Invoice rows or amounts",
  "Claims submission. (NOT Phase 1.)",
  "ERA / remittance ingestion. (NOT Phase 1.)",
  "Denial routing. (NOT Phase 1.)",
  "Payment posting. (NOT Phase 1.)",
  "Mission Control",
  "Inputs (read-only)",
  "ancillary_appointments.procedureStatus",
  "F5 signing state",
  "Output shape (G2 scaffold target)",
  "BillingReadinessSnapshot",
  "USE_BILLING_READINESS_AGGREGATOR_V2",
  "Default OFF",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Existing schema billing_readiness_checks table still present.
{
  const br = read("shared/schema/billingReadiness.ts") ?? "";
  if (!br.includes('"billing_readiness_checks"') && !br.includes("billingReadinessChecks")) {
    failures.push("shared/schema/billingReadiness.ts missing billing_readiness_checks table");
  }
}

// G1 is docs+QA only — the new V2 flag must not appear in code yet.
{
  const ROOTS = ["server", "client", "shared"];
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
      if (src.includes("USE_BILLING_READINESS_AGGREGATOR_V2")) {
        failures.push(`G1 is docs+QA only: ${rel} already references USE_BILLING_READINESS_AGGREGATOR_V2`);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
}

if (failures.length > 0) {
  console.error("Phase 1 billing readiness boundary contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 billing readiness boundary contract QA passed.");

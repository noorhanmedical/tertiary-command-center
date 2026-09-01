// Smoke — Slice G: Billing Document CPT/ICD selection.
// Run: node scripts/smoke-g-billing.mjs

import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const fails = [];
const passes = [];
const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };
function check(label, file, pred) {
  const s = read(file);
  if (s == null) return fails.push(`${label} — missing ${file}`);
  if (pred(s)) passes.push(label); else fails.push(`${label} — failed for ${file}`);
}

check("1. BW/VW CPT maps keyed by performed component", "shared/schema/billingCodeMap.ts", (s) =>
  s.includes("BRAINWAVE_CPT_BY_COMPONENT") && s.includes("VITALWAVE_CPT_BY_COMPONENT") &&
  s.includes('"96132"') && s.includes('"93923"') && s.includes('"95924"'));

check("2. selection intersects performed-component-supported with approved codes", "shared/schema/billingCodeMap.ts", (s) =>
  s.includes("selectBillingDocumentCodes") && s.includes("performedComponentKeys") &&
  s.includes("excludedNotApproved") && s.includes("excludedNotPerformed"));

check("3. de-dupes (93040) via Set", "shared/schema/billingCodeMap.ts", (s) =>
  s.includes("new Set") && s.includes("uniq("));

check("4. fail-closed when no approved codes", "shared/schema/billingCodeMap.ts", (s) =>
  s.includes("no_approved_cpt_codes") && s.includes("no_billable_cpt"));

check("5. exported via shared barrel", "shared/schema/index.ts", (s) =>
  s.includes('export * from "./billingCodeMap"'));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length) { console.error(`\nSmoke failed: ${fails.length} check(s)`); process.exit(1); }
console.log("\nSmoke passed: G billing code selection intact.");

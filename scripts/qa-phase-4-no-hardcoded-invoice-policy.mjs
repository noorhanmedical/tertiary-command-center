// QA — Phase 4 must not hardcode invoice timing, recipients, cutoffs,
// or pricing where an admin setting should drive behavior.
//
// Run: node scripts/qa-phase-4-no-hardcoded-invoice-policy.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const SCAN_DIRS = [
  "server/services/billing",
  "server/routes",
];

// Hardcoded facility checks like `if (facility === "X")` in billing
// code, or hardcoded cutoff times like `15` / "Wednesday" in the new
// Phase 4 services.
const FORBIDDEN_PATTERNS = [
  /if\s*\(\s*facility\s*===\s*"[^"]+"\s*\)/,
  /const\s+INVOICE_CUTOFF_DAY\s*=\s*\d+/,
  /const\s+INVOICE_RECIPIENT\s*=\s*"[^"]+"/,
  /const\s+INVOICE_CC\s*=\s*"[^"]+"/,
];

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name));
    else if (/\.ts$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const rx of FORBIDDEN_PATTERNS) {
        if (rx.test(src)) {
          failures.push(`${dir}/${entry.name} contains hardcoded invoice policy pattern ${rx}`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

if (failures.length > 0) {
  console.error("Phase-4 no-hardcoded-invoice-policy QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 no-hardcoded-invoice-policy QA passed.");

// QA — Phase 4 must not fake "sent" / "paid" / "ready" / "approved" /
// "signed" billing states.
//
// Run: node scripts/qa-phase-4-no-fake-billing-states.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const SCAN_DIRS = [
  "server/services/billing",
  "server/services/invoicing",
  "server/routes",
  "client/src/components/billing",
  "client/src/pages",
];

const FORBIDDEN_PHRASES = [
  "fakeInvoiceSent",
  "mockInvoiceSent",
  "fakePaid",
  "mockPaid",
  "fakeBillingReady",
  "mockBillingReady",
  "fakeApproved",
  "fakeRemittance",
  "fakeDenial",
];

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const p of FORBIDDEN_PHRASES) {
        if (src.includes(p)) {
          failures.push(`${dir}/${entry.name} contains forbidden phrase "${p}"`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

if (failures.length > 0) {
  console.error("Phase-4 no-fake-billing-states QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 no-fake-billing-states QA passed.");

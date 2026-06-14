// QA — Phase 3 must not hardcode thresholds where an admin setting
// should drive behavior.
//
// Run: node scripts/qa-phase-3-no-hardcoded-exception-rules.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const SCAN_DIRS = [
  "server/services/exceptionIntelligence",
];

// Forbid hardcoded threshold constants. The detector code must
// read from the policy bundle.
const FORBIDDEN_PATTERNS = [
  /const\s+MISSING_REPORT_HOURS\s*=\s*\d+/,
  /const\s+CALLBACK_OVERDUE_HOURS\s*=\s*\d+/,
  /const\s+NO_ANSWER_STALE_HOURS\s*=\s*\d+/,
  /const\s+LVM_STALE_HOURS\s*=\s*\d+/,
  /const\s+PAYMENT_OVERDUE_DAYS\s*=\s*\d+/,
  /const\s+DENIAL_FOLLOWUP_DAYS\s*=\s*\d+/,
];

function walk(dir, fn) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), fn);
    else if (/\.ts$/.test(entry.name)) fn(path.join(dir, entry.name), fs.readFileSync(path.join(full, entry.name), "utf8"));
  }
}

for (const d of SCAN_DIRS) {
  walk(d, (file, src) => {
    for (const rx of FORBIDDEN_PATTERNS) {
      if (rx.test(src)) failures.push(`${file} hardcodes a threshold (${rx}) — read from admin_settings.exception_intelligence`);
    }
  });
}

if (failures.length > 0) {
  console.error("Phase-3 no-hardcoded-exception-rules QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 no-hardcoded-exception-rules QA passed.");

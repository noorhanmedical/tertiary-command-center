// QA: Phase 1 end-to-end smoke test contract (executable).
// Source-invariant check that the executable smoke test exists, exports
// all 22 contract steps + the boot probe + the flag-default probe, and
// stays decoupled from the live DB (so it runs in any CI lane).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SCRIPT = "scripts/smoke-phase-1-end-to-end.mjs";
const src = read(SCRIPT);
if (src === null) failures.push(`Missing file: ${SCRIPT}`);
else {
  // 22 numbered Phase 1 steps + 2 bonus steps = 24 step() calls.
  const stepCalls = (src.match(/step\(\d+/g) ?? []).length;
  if (stepCalls < 24) failures.push(`Expected at least 24 step() calls; found ${stepCalls}`);

  for (const n of [
    "Batch Flow intake route present",
    "Plexus IQ workspace",
    "Admin Review dialog intact",
    "Engagement assignment runtime route present",
    "Engagement call-list read flag accessor present",
    "Outreach compatibility route present",
    "Engagement canonical call-result endpoint flag accessor present",
    "Team Portal assigned-work surface present",
    "Structured call-result selector flag-gated",
    "Call-history panel flag-gated",
    "RingCentral adapter test runs",
    "Canonical call-result fixture",
    "Callback / task / triage payload extension args",
    "Per-surface step suppression",
    "Ancillary read-model test",
    "Physician signing service transition table test",
    "Billing readiness aggregator test",
    "Invoicing scaffold test",
    "AWS deploy/backup/smoke runbooks",
    "no Mission Control / billing dashboard markers",
    "Admin Review dialog contains no redesign markers",
    "Team Portal protected surfaces still on disk",
    "Live HTTP probe",
    "All Phase 1 server flag accessors default OFF",
  ]) if (!src.includes(n)) failures.push(`${SCRIPT}: missing step description "${n}"`);

  // The smoke MUST be DB-agnostic — never importing db / drizzle / schema.
  for (const forbidden of [
    'from "drizzle-orm"',
    'from "../server/db"',
    'from "../../server/db"',
    'import("../server/db")',
    'import("./server/db")',
  ]) {
    if (src.includes(forbidden)) failures.push(`${SCRIPT}: unexpected DB import "${forbidden}"`);
  }
}

if (failures.length > 0) {
  console.error("Phase 1 smoke test contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 smoke test contract QA passed.");

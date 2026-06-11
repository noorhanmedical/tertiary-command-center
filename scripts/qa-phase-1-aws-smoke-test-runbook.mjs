// QA: Phase 1 AWS smoke-test runbook (Batch H5).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-aws-smoke-test-runbook.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "AWS smoke-test runbook",
  "Pre-conditions",
  "Smoke sequence",
  "Service health",
  "Plexus IQ (protected — no behavior change expected)",
  "Admin Review (protected — no behavior change expected)",
  "Team Portal cockpit",
  "Disposition flow (E9 invariant)",
  "VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR",
  "USE_PORTAL_CALL_HISTORY_READ",
  "Rollback escape valve",
  "VITE_USE_LEGACY_DISPOSITION_WRITE",
  "What this runbook does NOT do",
  "Test claims / remittance / ERA / denial / payment-posting flows",
  "Test PDF generation behavior",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Phase 1 AWS smoke-test runbook QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 AWS smoke-test runbook QA passed.");

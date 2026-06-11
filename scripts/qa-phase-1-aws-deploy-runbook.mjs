// QA: Phase 1 AWS deploy runbook (Batch H3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-aws-deploy-runbook.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "AWS deploy runbook",
  "Prerequisites",
  "Steps",
  "Build locally",
  "Provision (first time only)",
  "Bundle and ship",
  "Inject secrets at process start",
  "NEVER write secrets to a",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE=0",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE=0",
  "USE_PORTAL_CALL_HISTORY_READ=0",
  "USE_RINGCENTRAL_ADAPTER=0",
  "Roll back",
  "What this runbook does NOT do",
  "Run a production deploy",
  "Flip any production flag truthy",
  "Modify Plexus IQ or Admin Review surfaces",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// No IaC committed yet.
{
  const forbiddenPaths = ["infra", "terraform", "cdk", "cloudformation"];
  for (const p of forbiddenPaths) {
    if (fs.existsSync(path.join(root, p))) {
      failures.push(`Unexpected IaC directory committed: ${p}/ — H3 forbids in Phase 1`);
    }
  }
}

if (failures.length > 0) {
  console.error("Phase 1 AWS deploy runbook QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 AWS deploy runbook QA passed.");

// QA: Phase 1 status ownership registry (Batch C3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-status-ownership-registry.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else {
  const statuses = [
    "Visit vs Outreach",
    "Qualification / reasoning status",
    "Admin Review status",
    "Engagement status",
    "Assignment status",
    "Call result status",
    "Next action",
    "Task status",
    "Triage status",
    "Ancillary status",
    "Document status",
    "Signature status",
    "Billing readiness status",
    "Invoice status",
  ];
  for (const s of statuses) if (!c.includes(s)) failures.push(`Missing status "${s}" in ${DOC}`);
  const fields = [
    "Source owner:", "Allowed writer:", "Read consumers:",
    "Forbidden writers:", "Audit event:", "No-split-brain rule:",
  ];
  for (const f of fields) {
    const count = (c.match(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    if (count < 14) failures.push(`Field "${f}" appears only ${count} times; expected per-status coverage`);
  }
  for (const n of [
    "Plexus IQ READS every status",
    "Plexus IQ READS only",
    "Admin Review writes approval/commit only",
    "Team Portal POSTs canonical write endpoints",
    "Invoicing is NOT claims submission",
  ]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);
}

if (failures.length > 0) {
  console.error("Phase 1 status ownership registry QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 status ownership registry QA passed.");

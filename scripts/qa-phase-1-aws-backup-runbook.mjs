// QA: Phase 1 AWS backup/restore runbook (Batch H4).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-aws-backup-runbook.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "AWS backup / restore runbook",
  "Backup posture",
  "pg_dump",
  "S3 SSE-KMS",
  "Backups CONTAIN PHI",
  "Backup procedure",
  "Restore procedure (staging only)",
  "NEVER prod without explicit Ali",
  "What this runbook does NOT do",
  "Auto-schedule backups",
  "Run a destructive restore against production",
  "Disaster matrix",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Phase 1 AWS backup runbook QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 AWS backup runbook QA passed.");

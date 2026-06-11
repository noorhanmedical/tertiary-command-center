// QA: no-split-brain architecture summary (Batch 25 of split-brain run).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const DOC = "docs/architecture/no-split-brain-architecture-summary.md";
requireFile(DOC);
requireText(DOC, [
  "Index of PRs shipped in this run",
  "Split-brain areas found",
  "What was fixed",
  "What was only documented",
  "What remains unsafe",
  "Ali approval",
  "Canonical ownership model",
  "Engagement / Outreach consolidation status",
  "Plexus IQ split-brain status",
  "Exact next PR recommendation",
  "No-BS-patch policy",
  "Rollback plan",
  "Stop conditions",
  "per-surface step suppression",
]);

if (failures.length > 0) {
  console.error("No-split-brain architecture summary QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No-split-brain architecture summary QA passed.");

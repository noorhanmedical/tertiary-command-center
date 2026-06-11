// QA: engagement canonical call-result endpoint contract (Batch 6).
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
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

const DOC = "docs/architecture/engagement-canonical-call-result-endpoint-contract.md";
requireFile(DOC);
requireText(DOC, [
  "POST /api/engagement-center/call-results",
  "canonical write endpoint",
  "backward-compatible alias adapter",
  "/api/outreach/calls",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "default-OFF",
  "byte-equivalent",
  "Rollback strategy",
  "Plexus IQ",
  "read-only/intelligence-only",
  "ownershipUpdated",
  "executionCase",
  "journeyEvent",
  "triageCase",
  "outreachCall",
  "planned",
  "Out of scope",
]);

// Batch 6 of the split-brain run shipped this contract; Batch 8 of the
// Engagement completion run shipped the route. We now allow the route
// to exist in server/routes/executionCases.ts (the designated handler
// file) and forbid the path string anywhere else in runtime code.
{
  const ROOTS = ["server"];
  function walk(dir, files) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, files);
      else if (/\.(ts|mts|cts)$/.test(e.name)) files.push(abs);
    }
  }
  const files = [];
  for (const r of ROOTS) walk(path.join(root, r), files);
  for (const abs of files) {
    const rel = path.relative(root, abs);
    if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
    if (rel === "server/routes/executionCases.ts") continue;
    const src = fs.readFileSync(abs, "utf8");
    if (/['"]\/api\/engagement-center\/call-results['"]/.test(src)) {
      failures.push(
        `${rel}: contains '/api/engagement-center/call-results' (plural) — only executionCases.ts may serve this endpoint`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement canonical call-result endpoint contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement canonical call-result endpoint contract QA passed.");

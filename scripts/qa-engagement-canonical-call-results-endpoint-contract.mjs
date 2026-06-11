// QA: engagement canonical plural endpoint contract (Batch 7).
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

const DOC = "docs/architecture/engagement-canonical-call-results-endpoint-implementation-contract.md";
requireFile(DOC);
requireText(DOC, [
  "POST /api/engagement-center/call-results",
  "canonical write endpoint",
  "compatibility route",
  "USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT",
  "byte-equivalent",
  "404",
  "/api/outreach/calls",
  "Rollback strategy",
  "Team Portal",
  "Plexus IQ",
  "Untouched",
  "Hard-stops",
]);

// Batch 7 of this run shipped the contract; Batch 8 shipped the route.
// Only server/routes/executionCases.ts may serve the plural endpoint.
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
      failures.push(`${rel}: contains '/api/engagement-center/call-results' (plural) — only executionCases.ts may serve this endpoint`);
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement canonical call-results endpoint contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement canonical call-results endpoint contract QA passed.");

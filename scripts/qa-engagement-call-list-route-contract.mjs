// QA: engagement call-list route contract (Batch 16).
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

const DOC = "docs/architecture/engagement-call-list-route-contract.md";
requireFile(DOC);
requireText(DOC, [
  "GET /api/engagement-center/call-list",
  "USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ",
  "Default: OFF",
  "Team Portal",
  "Operational Queue",
  "Plexus IQ",
  "No split-brain",
  "Rollback",
  "Hard-stops",
]);

// Pin: route does not yet exist (Batch 17 ships it).
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
    const src = fs.readFileSync(abs, "utf8");
    if (/['"]\/api\/engagement-center\/call-list['"]/.test(src)) {
      failures.push(`${rel}: contains '/api/engagement-center/call-list' — Batch 16 is contract-only; route ships in Batch 17`);
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement call-list route contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list route contract QA passed.");

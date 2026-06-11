// QA: engagement executor triage payload extension (Batch 4).
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

const EXEC = "server/services/callResult/recordCallResultEngagementExecutor.ts";
requireFile(EXEC);
requireText(EXEC, [
  "triageMainType?",
  "triageSubtype?",
  "triagePriority?",
  "triageAssignedUserId?",
  "triageDueAt?",
  "triageNote?",
  "triageMetadata?",
  "upsertTriageCase: (args)",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(TEST);
requireText(TEST, [
  "§3.11",
  "§3.12",
  "triageMainType",
  "triagePriority",
  "triageNote",
]);

// No route imports / no Plexus IQ.
{
  for (const dir of ["server/routes", "server/services/plexusIq"]) {
    const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementExecutor(?:\.\w+)?['"]/;
    function walk(d) {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) { walk(abs); continue; }
        if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
        const rel = path.relative(root, abs);
        if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
        const src = fs.readFileSync(abs, "utf8");
        if (RE.test(src)) failures.push(`${rel} imports engagement executor — Batch 4 does not wire routes`);
      }
    }
    walk(path.join(root, dir));
  }
}

if (failures.length > 0) {
  console.error("Engagement triage payload extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement triage payload extension QA passed.");

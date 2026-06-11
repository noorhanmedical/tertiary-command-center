// QA: engagement executor task payload extension (Batch 5).
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
  "taskTitle?",
  "taskDescription?",
  "taskPriority?",
  "taskUrgency?",
  "taskAssignedToUserId?",
  "taskDueAt?",
  "taskMetadata?",
  "createFollowUpTask: (args)",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(TEST);
requireText(TEST, ["§3.13", "§3.14", "taskTitle", "taskUrgency"]);

// Designated route consumer is server/routes/executionCases.ts
// (Batch 3 of Engagement completion run). No Plexus IQ touched.
{
  const ALLOWED_ROUTE = "server/routes/executionCases.ts";
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
        if (rel === ALLOWED_ROUTE) continue;
        if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
        const src = fs.readFileSync(abs, "utf8");
        if (RE.test(src)) failures.push(`${rel} unauthorized importer of engagement executor — only the designated route may`);
      }
    }
    walk(path.join(root, dir));
  }
}

if (failures.length > 0) {
  console.error("Engagement task payload extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement task payload extension QA passed.");

// QA: engagement executor journey-event metadata extension (Batch 3).
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
  "journeyEventMetadata?",
  "patientName?",
  "patientDob?",
]);

// PHI rule: the executor MUST NOT console.log anything; PHI flows
// through DI boundary only.
{
  const src = read(EXEC) ?? "";
  for (const log of ["console.log", "console.info", "console.warn", "console.error"]) {
    if (src.includes(log)) failures.push(`${EXEC}: executor must not ${log}`);
  }
  // Strip the EngagementCallResultInput type block before checking
  // for bare PHI identifiers — they're permitted ONLY there as DI
  // passthrough fields.
  const stripped = src.replace(/EngagementCallResultInput\s*=\s*\{[\s\S]*?\};/, "");
  for (const phi of ["patientName", "patientDob"]) {
    // Allow appearance in the wrappedDeps block (`patientName: input.patientName`).
    // We strip the wrappedDeps block too.
    const stripped2 = stripped.replace(/const\s+wrappedDeps[\s\S]*?\};\s*\n/g, "");
    if (stripped2.includes(phi)) {
      failures.push(`${EXEC}: PHI identifier "${phi}" appears outside DI-passthrough zones`);
    }
  }
}

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(TEST);
requireText(TEST, [
  "§3.9",
  "§3.10",
  "journeyEventMetadata",
  "patientName",
  "patientDob",
]);

const DRY = "server/services/callResult/__tests__/recordCallResultEngagementDelegateDryRun.test.ts";
requireFile(DRY);
requireText(DRY, [
  "§2.7",
  "journeyEventMetadata",
  "patientName",
  "patientDob",
]);

// No route imports / no Plexus IQ touched.
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
        if (RE.test(src)) failures.push(`${rel} imports engagement executor — Batch 3 does not wire routes`);
      }
    }
    walk(path.join(root, dir));
  }
}

if (failures.length > 0) {
  console.error("Engagement journey metadata extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement journey metadata extension QA passed.");

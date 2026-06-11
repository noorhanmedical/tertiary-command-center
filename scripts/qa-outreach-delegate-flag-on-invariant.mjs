// QA: outreach delegate flag-ON invariant (Batch B9).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }

const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
const src = read(ROUTE) ?? "";

const guardIdx = src.indexOf("isRecordCallResultOutreachDelegateEnabled()");
const legacyMarkerIdx = src.indexOf("Legacy code path");
if (guardIdx === -1) failures.push(`${ROUTE}: delegate guard not found`);
if (legacyMarkerIdx === -1) failures.push(`${ROUTE}: legacy marker not found`);
const branch = guardIdx >= 0 && legacyMarkerIdx >= 0 ? src.slice(guardIdx, legacyMarkerIdx) : "";

// §1 — branch calls recordOutreachCallResult.
if (!branch.includes("recordOutreachCallResult(")) failures.push(`${ROUTE}: branch must call recordOutreachCallResult()`);

// §2 — branch injects deps for the four primary outreach effects.
for (const d of ["createOutreachCall:", "updateAppointmentStatus:", "markAssignmentCompleted:"]) {
  if (!branch.includes(d)) failures.push(`${ROUTE}: delegation branch must inject ${d}`);
}

// §3 — engagement-only deps are no-op closures (suppressed).
for (const d of ["appendJourneyEvent:", "updateExecutionCaseEngagement:", "upsertTriageCase:", "createFollowUpTask:"]) {
  if (!branch.includes(d)) failures.push(`${ROUTE}: delegation branch must declare no-op ${d}`);
}

// §4 — branch preserves canonical-spine sync (executed by route after the executor).
//      Search the FULL route, not just the branch, for the spine sync call.
if (!src.includes("ensureCanonicalSpineForScreening(")) {
  failures.push(`${ROUTE}: route must still call ensureCanonicalSpineForScreening`);
}

// §5 — branch reconstructs call-object response via res.status(201).json(call).
if (!src.includes("res.status(201).json(call)")) {
  failures.push(`${ROUTE}: route must still return res.status(201).json(call)`);
}

// §6 — no Plexus IQ / Admin Review changes.
{
  const DIR = path.join(root, "server/services/plexusIq");
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const s = fs.readFileSync(abs, "utf8");
      if (s.includes("recordOutreachCallResult") || s.includes("isRecordCallResultOutreachDelegateEnabled")) {
        failures.push(`Plexus IQ ${rel} references outreach delegation`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Outreach delegate flag-ON invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegate flag-ON invariant QA passed.");

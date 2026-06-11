// QA: outreach-only canonical outcomes (Batch B2 of Phase 1 run).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel); if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const PLANNER = "server/services/callResult/recordCallResult.ts";
requireFile(PLANNER);
requireText(PLANNER, [
  '"completed"',
  '"dnc"',
  '"do_not_contact"',
  '"deceased"',
  '"cancelled"',
]);

const FIX = "tests/fixtures/callResultCanonicalization.fixture.ts";
requireFile(FIX);
requireText(FIX, [
  'outcome: "completed"',
  'outcome: "dnc"',
  'outcome: "do_not_contact"',
  'outcome: "deceased"',
  'outcome: "cancelled"',
]);

// Each new outcome is terminal=true + assignmentCompleted=true.
{
  const src = read(FIX) ?? "";
  for (const o of ["completed", "dnc", "do_not_contact", "deceased", "cancelled"]) {
    // Find the per-outcome block in the fixture.
    const re = new RegExp(`outcome:\\s*"${o}"[\\s\\S]*?terminal:\\s*(true|false)`, "m");
    const m = re.exec(src);
    if (!m) failures.push(`${FIX}: cannot find terminal field for outcome "${o}"`);
    else if (m[1] !== "true") failures.push(`${FIX}: outcome "${o}" must be terminal:true (got ${m[1]})`);
    const re2 = new RegExp(`outcome:\\s*"${o}"[\\s\\S]*?assignmentCompleted:\\s*(true|false)`, "m");
    const m2 = re2.exec(src);
    if (!m2) failures.push(`${FIX}: cannot find assignmentCompleted for outcome "${o}"`);
    else if (m2[1] !== "true") failures.push(`${FIX}: outcome "${o}" must be assignmentCompleted:true (got ${m2[1]})`);
  }
}

// No route delegation wired beyond what was already in place.
// The outreach route still has the legacy code path.
const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
requireText(ROUTE, ["res.status(201).json(call)"]);

if (failures.length > 0) {
  console.error("Outreach-only canonical outcomes QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach-only canonical outcomes QA passed.");

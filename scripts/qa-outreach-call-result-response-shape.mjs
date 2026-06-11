// QA: outreach response-shape (Batch 15 of split-brain run).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

const FIX = "tests/fixtures/outreachCallResultResponseShape.fixture.ts";
requireFile(FIX);
requireText(FIX, [
  "OUTREACH_CALL_RESULT_RESPONSE_CONTRACT",
  "OUTREACH_ONLY_OUTCOMES",
  '"raw_row"',
  "201",
  '"wants_more_info"',
  '"reached"',
]);

const TEST = "server/services/callResult/__tests__/outreachCallResultResponseShape.test.ts";
requireFile(TEST);

// The legacy route still returns res.status(201).json(call).
const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
requireText(ROUTE, [
  "res.status(201).json(call)",
]);

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Outreach response-shape test FAILED"); }
}

if (failures.length > 0) {
  console.error("Outreach response-shape QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach response-shape QA passed.");

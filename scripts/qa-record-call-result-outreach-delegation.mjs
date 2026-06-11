// QA: outreach route delegation (Batch B7 of Phase 1 run).
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
function requireNotText(rel, needles, label) {
  const c = read(rel); if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
requireText(ROUTE, [
  "isRecordCallResultOutreachDelegateEnabled",
  "recordOutreachCallResult",
  "OUTREACH_DELEGATION_CANONICAL_OUTCOMES",
  // Guard expression.
  "isRecordCallResultOutreachDelegateEnabled() &&",
  "OUTREACH_DELEGATION_CANONICAL_OUTCOMES.has(parsed.data.outcome)",
  // Captured row pattern.
  "captured = await storage.createOutreachCallAtomic",
  // Legacy code path preserved.
  "Legacy code path",
  "call = await storage.createOutreachCallAtomic",
  // Response shape.
  "res.status(201).json(call)",
]);

// Engagement-only deps wired as no-ops (suppressed).
requireText(ROUTE, [
  "Engagement-suppressed on outreach surface per Batch B3 contract",
]);

// No journey-event append from the outreach route.
requireNotText(ROUTE, ["appendJourneyEvent("], "outreach route must not call appendJourneyEvent");

if (failures.length > 0) {
  console.error("Outreach route delegation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach route delegation QA passed.");

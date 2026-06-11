// QA: outreach atomic args extension (Batch B4 of Phase 1 run).
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

const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER);
requireText(ADAPTER, [
  "desiredAppointmentStatus?: string | null",
  "schedulerUserId?: string | null",
  "callMetadata?: Record<string, unknown>",
  "terminalCompletionReason?: string | null",
  "canonicalSpineRequired?: boolean",
]);

const EXEC = "server/services/callResult/recordCallResultOutreachExecutor.ts";
requireFile(EXEC);
requireText(EXEC, [
  "desiredAppointmentStatus?",
  "schedulerUserId?",
  "callMetadata?",
  "terminalCompletionReason?",
  "wrappedDeps",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultOutreachExecutor.test.ts";
requireFile(TEST);
requireText(TEST, ["§2.7", "desiredAppointmentStatus", "schedulerUserId", "callMetadata", "terminalCompletionReason"]);

// Route NOT yet wired to extension fields beyond existing flag-OFF.
const ROUTE = "server/routes/outreach.ts";
requireFile(ROUTE);
// Outreach route still does its legacy code path.
requireText(ROUTE, ["res.status(201).json(call)"]);

if (failures.length > 0) {
  console.error("Outreach atomic args extension QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach atomic args extension QA passed.");

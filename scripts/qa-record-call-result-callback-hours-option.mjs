// QA: callbackHours option (Batch 6 of arg extensions run).
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

const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER);
requireText(ADAPTER, [
  "callbackHours?: number",
  "requiresCallbackDefault",
  "callbackHoursOpt * 60 * 60 * 1000",
]);

const ADAPTER_TEST = "server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts";
requireFile(ADAPTER_TEST);
requireText(ADAPTER_TEST, ["§13", "§14", "§15", "callbackHours"]);

const EXEC_TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(EXEC_TEST);
requireText(EXEC_TEST, ["§3.15", "callbackHours"]);

if (failures.length > 0) {
  console.error("callbackHours option QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("callbackHours option QA passed.");

// QA: execution adapter argument extensions (Batch 1 of arg-extensions run).
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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER);
requireText(ADAPTER, [
  // UpdateExecutionCaseEngagementArgs extension.
  "assignedTeamMemberId?: string | null",
  "assignedRole?: string | null",
  "forceReassign?: boolean",
  // AppendJourneyEventArgs extension.
  "metadata?: Record<string, unknown>",
  "patientName?: string | null",
  "patientDob?: string | null",
  // UpsertTriageCaseArgs extension.
  "mainType?: string | null",
  "subtype?: string | null",
  "priority?: string | null",
  "assignedUserId?: string | null",
  "dueAt?: string | null",
  "note?: string | null",
  // CreateFollowUpTaskArgs extension.
  "title?: string | null",
  "description?: string | null",
  "urgency?: string | null",
  "assignedToUserId?: string | null",
  // RecordCallResultExecutionOptions extension.
  "callbackHours?: number",
]);

// Adapter must still stay pure — no DB/Express/storage/route imports.
requireNotText(ADAPTER, [
  'from "../../db"',
  'from "../../../db"',
  'from "express"',
  'from "@shared/schema"',
  'from "drizzle-orm"',
  'from "../storage"',
  'from "../../storage"',
  'from "../../routes/',
  'from "../routes/',
], "adapter must stay pure after arg extensions");

// Designated route consumer is server/routes/executionCases.ts
// (Batch 3 of Engagement completion run) — it imports adapter TYPES
// for the dep closures it supplies to the engagement executor.
{
  const ROUTES = path.join(root, "server/routes");
  const ALLOWED_ROUTES = new Set([
    "server/routes/executionCases.ts",
    "server/routes/outreach.ts",
  ]);
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultExecutionAdapter(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (ALLOWED_ROUTES.has(rel)) continue;
      if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} unauthorized importer of adapter`);
    }
  }
  walk(ROUTES);
}

// No Plexus IQ file touched.
{
  const DIR = path.join(root, "server/services/plexusIq");
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultExecutionAdapter(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Plexus IQ ${rel} imports adapter — must remain read-model`);
    }
  }
  walk(DIR);
}

// Test exercises the new optional fields.
const TEST = "server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts";
requireFile(TEST);
requireText(TEST, [
  "§12",
  "assignedTeamMemberId",
  "forceReassign",
  "callbackHours",
  "mainType",
  "patientName",
]);

if (failures.length === 0) {
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Adapter test FAILED — arg-extension §12 did not pass"); }
}

if (failures.length > 0) {
  console.error("Execution adapter arg extensions QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Execution adapter arg extensions QA passed.");

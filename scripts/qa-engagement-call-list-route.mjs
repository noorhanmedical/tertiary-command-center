// QA: engagement call-list route (Batch 17).
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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

// §1 — Flag accessor module exists + pure.
const FLAG = "server/services/engagement/engagementCanonicalCallListReadFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "isEngagementCanonicalCallListReadEnabled",
  "USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ",
  '"1"',
  '"true"',
  '"yes"',
]);
requireNotText(FLAG, [
  'from "../../db"',
  'from "../../../db"',
  'from "express"',
  'from "@shared/schema"',
  'from "drizzle-orm"',
], "engagement call-list read flag accessor must stay pure");

// §2 — Route exists and gates on the flag.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
requireText(ROUTE, [
  '"/api/engagement-center/call-list"',
  "isEngagementCanonicalCallListReadEnabled",
  "getEngagementCallList",
  "EngagementCallListDependencies",
  // 404 returned when flag OFF.
  "404",
]);

// §3 — Route is READ-ONLY (no writes in the route handler block for
//      the call-list endpoint).
{
  const src = read(ROUTE) ?? "";
  // Find the call-list route block.
  const startMarker = '"/api/engagement-center/call-list"';
  const startIdx = src.indexOf(startMarker);
  // Next route comment for the call-result one.
  const endMarker = "POST /api/engagement-center/call-result";
  const endIdx = src.indexOf(endMarker, startIdx);
  const block = startIdx >= 0 && endIdx >= 0 ? src.slice(startIdx, endIdx) : "";
  for (const v of [
    "db.insert(",
    "db.update(",
    "db.delete(",
    "storage.create",
    "storage.update",
    "storage.delete",
    "appendJourneyEvent(",
    "upsertOpenSchedulingTriageCase(",
  ]) {
    if (block.includes(v)) {
      failures.push(`${ROUTE}: call-list route block must be read-only; contains "${v}"`);
    }
  }
}

// §4 — No UI yet references the new endpoint.
{
  const ROOTS = [path.join(root, "client/src")];
  function walk(dir, results) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, results); continue; }
      if (!/\.(ts|tsx|mts|cts|js|jsx)$/.test(e.name)) continue;
      results.push(abs);
    }
  }
  const files = [];
  for (const r of ROOTS) walk(r, files);
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("/api/engagement-center/call-list") && !src.includes("/api/engagement-center/call-list-")) {
      failures.push(`${path.relative(root, abs)} references the call-list endpoint — no UI switch this batch`);
    }
  }
}

// §5 — No Plexus IQ file touched.
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
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("isEngagementCanonicalCallListReadEnabled") || src.includes("getEngagementCallList")) {
        failures.push(`Plexus IQ ${rel} references the call-list flag / service`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement call-list route QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement call-list route QA passed.");

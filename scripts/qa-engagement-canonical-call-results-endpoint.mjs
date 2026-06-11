// QA: engagement canonical plural endpoint (Batch 8).
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

// §1 — Flag accessor module present + default-OFF accessor pattern.
const FLAG = "server/services/callResult/engagementCanonicalCallResultsEndpointFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "isEngagementCanonicalCallResultsEndpointEnabled",
  "USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT",
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
], "endpoint flag accessor must stay pure");

// §2 — Plural endpoint exists in the engagement route file AND gates
//      on the flag accessor.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
requireText(ROUTE, [
  '"/api/engagement-center/call-results"',
  "isEngagementCanonicalCallResultsEndpointEnabled",
  "callResultHandler",
  // Disabled response when flag OFF.
  '404',
  // Same handler shared with the singular route.
  '"/api/engagement-center/call-result", callResultHandler',
]);

// §3 — Singular endpoint still exists (proves we did not remove it).
requireText(ROUTE, [
  '"/api/engagement-center/call-result", callResultHandler',
]);

// §4 — Plural endpoint reuses the SAME handler as the singular route
//      (no duplication of business logic). We assert by counting
//      `recordEngagementCallResult(` calls — should be exactly ONE
//      across both routes (inside the shared handler).
{
  const src = read(ROUTE) ?? "";
  const matches = src.match(/recordEngagementCallResult\(/g) ?? [];
  if (matches.length !== 1) {
    failures.push(`${ROUTE}: expected ONE recordEngagementCallResult call (shared handler), found ${matches.length}`);
  }
}

// §5 — No UI references the canonical plural endpoint yet.
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
    if (src.includes("/api/engagement-center/call-results")) {
      failures.push(`${path.relative(root, abs)} references plural endpoint — UI must not consume it yet`);
    }
  }
}

// §6 — Plexus IQ untouched.
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
      if (src.includes("isEngagementCanonicalCallResultsEndpointEnabled") || src.includes("/api/engagement-center/call-results")) {
        failures.push(`Plexus IQ ${rel} references plural endpoint`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement canonical plural endpoint QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement canonical plural endpoint QA passed.");

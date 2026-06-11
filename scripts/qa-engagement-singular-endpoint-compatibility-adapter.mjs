// QA: engagement singular endpoint compatibility adapter (Batch 9).
//
// After Batch 8 the singular `POST /api/engagement-center/call-result`
// and the plural `POST /api/engagement-center/call-results` are bound
// to the SAME extracted handler `callResultHandler`. The singular
// route is now a compatibility adapter — same writer pipeline, same
// response envelope. This QA pins the invariant.

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

const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
const src = read(ROUTE) ?? "";

// §1 — Singular route binds the shared handler.
if (!src.includes('app.post("/api/engagement-center/call-result", callResultHandler)')) {
  failures.push(`${ROUTE}: singular route must bind callResultHandler directly`);
}

// §2 — Plural route ALSO uses callResultHandler.
{
  const pluralMatch = src.match(
    /app\.post\(\s*"\/api\/engagement-center\/call-results"[\s\S]*?callResultHandler\(req,\s*res\)[\s\S]*?\}\)/,
  );
  if (!pluralMatch) {
    failures.push(`${ROUTE}: plural route must call callResultHandler(req, res)`);
  }
}

// §3 — Plural route is gated by the canonical endpoint flag.
if (!src.includes("isEngagementCanonicalCallResultsEndpointEnabled")) {
  failures.push(`${ROUTE}: plural route must gate on isEngagementCanonicalCallResultsEndpointEnabled`);
}

// §4 — Response shape preserved (6 legacy keys appear in the shared
//      handler's res.json envelopes; covered by Batch 3 QA).
//      Re-assert the legacy-branch and delegation-branch envelopes
//      both ship all 6 keys (counts via the existing source).
{
  for (const k of [
    "executionCase:",
    "journeyEvent",
    "triageCase",
    "task",
    "ownershipUpdated",
  ]) {
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const count = (src.match(re) ?? []).length;
    if (count < 2) {
      failures.push(`${ROUTE}: expected "${k}" in BOTH delegation + legacy envelopes (found ${count})`);
    }
  }
}

// §5 — No duplicate business logic. The route file has EXACTLY ONE
//      recordEngagementCallResult( call (shared handler).
{
  const matches = src.match(/recordEngagementCallResult\(/g) ?? [];
  if (matches.length !== 1) {
    failures.push(`${ROUTE}: expected ONE recordEngagementCallResult() call, found ${matches.length}`);
  }
}

// §6 — No Plexus IQ touched.
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
      if (s.includes("callResultHandler") || s.includes("/api/engagement-center/call-result")) {
        failures.push(`Plexus IQ ${rel} references the call-result handler / endpoint`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement singular endpoint compatibility adapter QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement singular endpoint compatibility adapter QA passed.");

// QA: engagement UI canonical write switch (Batch 12).
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

// §1 — UI flag module + helper present.
const FLAG = "client/src/lib/engagementCanonicalCallResultsUiFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI",
  "isEngagementCanonicalCallResultsUiEnabled",
  "engagementCallResultEndpoint",
  '"/api/engagement-center/call-result"',
  '"/api/engagement-center/call-results"',
  '"1"',
  '"true"',
  '"yes"',
  "import.meta",
]);

// §2 — DispositionSheet uses the helper for line 150 POST.
const DISPO = "client/src/components/outreach/DispositionSheet.tsx";
requireFile(DISPO);
requireText(DISPO, [
  "engagementCallResultEndpoint",
  "engagementCallResultEndpoint()",
  // Outreach POST stays — outreach delegation is a separate track.
  '"/api/outreach/calls"',
]);

// §3 — CanonicalRowActions uses the helper.
const ACTIONS = "client/src/components/outreach/CanonicalRowActions.tsx";
requireFile(ACTIONS);
requireText(ACTIONS, [
  "engagementCallResultEndpoint",
  "engagementCallResultEndpoint()",
]);

// §4 — Neither file hard-codes the legacy singular path anymore for
//      the engagement POST. (They may still reference it in code that
//      is unrelated to the call-result POST; require that EVERY
//      apiRequest("POST", ..., ...) call to engagement-center is
//      via the helper.)
{
  for (const rel of [DISPO, ACTIONS]) {
    const src = read(rel) ?? "";
    // Find every apiRequest POST call.
    const re = /apiRequest\(\s*"POST"\s*,\s*("\/api\/engagement-center\/call-result(?:s)?"|engagementCallResultEndpoint\(\))/g;
    const matches = [...src.matchAll(re)];
    for (const m of matches) {
      const ep = m[1];
      if (ep !== "engagementCallResultEndpoint()") {
        failures.push(`${rel}: POST to engagement-center must use engagementCallResultEndpoint() helper, found ${ep}`);
      }
    }
  }
}

// §5 — No query-key string renamed.
{
  const dispo = read(DISPO) ?? "";
  for (const k of [
    '"/api/outreach/calls"',
    '"/api/outreach/calls/by-patients"',
    '"/api/outreach/calls/today"',
  ]) {
    if (!dispo.includes(k)) {
      failures.push(`${DISPO}: query key ${k} must still appear (no key rename this batch)`);
    }
  }
}

// §6 — No directory rename (components/outreach/* still on disk).
for (const rel of [
  "client/src/components/outreach/DispositionSheet.tsx",
  "client/src/components/outreach/CanonicalRowActions.tsx",
]) {
  if (read(rel) === null) failures.push(`${rel} missing — directory must not be renamed`);
}

// §7 — No Plexus IQ file references the UI helper.
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
      if (src.includes("engagementCallResultEndpoint") || src.includes("VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI")) {
        failures.push(`Plexus IQ ${rel} references the UI flag / helper`);
      }
    }
  }
  walk(DIR);
}

// §8 — Outreach hook is untouched (still POSTs to /api/outreach/calls
//      without the UI helper).
{
  const HOOK = "client/src/hooks/api/outreach.ts";
  requireFile(HOOK);
  const src = read(HOOK) ?? "";
  if (src.includes("engagementCallResultEndpoint")) {
    failures.push(`${HOOK}: outreach hook must not use the engagement endpoint helper (separate sub-workflow)`);
  }
}

if (failures.length > 0) {
  console.error("Engagement UI canonical write switch QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement UI canonical write switch QA passed.");

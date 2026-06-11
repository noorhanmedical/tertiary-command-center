// QA: call-result preview parity readiness (Batch H Step 4).
//
// Source-code invariant pinning the readiness doc + the
// no-route-delegation-yet posture between the preview-flag
// PRs (Step 2 + Step 3) and any future route-delegation PR.
//
// What this asserts:
//   1. The readiness doc exists at the canonical path.
//   2. The doc references both preview flags by name.
//   3. The doc states both flags default OFF.
//   4. The doc states preview-only.
//   5. The doc states no production flag flip.
//   6. The doc states no response shape change.
//   7. The doc states no PHI in logs.
//   8. The doc references staging verification.
//   9. The doc references pass criteria.
//  10. The doc references stop conditions.
//  11. The engagement-center preview QA script exists.
//  12. The outreach preview QA script exists.
//  13. The recordCallResult dormancy QA exists.
//  14. The repo source still contains both preview flag accessors.
//  15. The two surface preview helpers remain SEPARATE modules
//      (no consolidation has happened yet).
//  16. No route-delegation flag exists yet — searches the tree for
//      any USE_RECORD_CALL_RESULT_*_DELEGATE identifier.
//
// No DB. No app boot. No network. No PHI.

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
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

// 1-10. Readiness doc + load-bearing concepts.
const DOC_REL = "docs/architecture/call-result-preview-parity-readiness.md";
requireFile(DOC_REL);
requireText(DOC_REL, [
  // Both flag names appear.
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
  "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW",
  // Default OFF + preview-only.
  "default OFF",
  "preview-only",
  // No production flag flip.
  "Do NOT enable in production",
  // No response shape change.
  "No response shape change",
  // No PHI in logs.
  "PHI-safe",
  "No PHI",
  // Staging verification.
  "Staging verification plan",
  "staging",
  // Pass criteria.
  "Pass criteria",
  // Stop conditions.
  "Stop conditions",
  // Required observation window.
  "Required observation window",
  // Next runtime PR section.
  "Next runtime PR",
  // Surface labels referenced — keeps the doc grep-stable.
  "engagement_center_route",
  "outreach_call_route",
  // The canonical service this readiness plan gates on.
  "recordCallResult",
  // Surface-isolated helpers stay separate (Step 4 invariant).
  "surface-isolated",
]);

// 11. Engagement-center preview QA script present.
requireFile("scripts/qa-record-call-result-engagement-preview.mjs");

// 12. Outreach preview QA script present.
requireFile("scripts/qa-record-call-result-outreach-preview.mjs");

// 13. recordCallResult dormancy QA present.
requireFile("scripts/qa-record-call-result-dormancy.mjs");

// 14. Source still contains both preview flag accessors.
{
  const engRel = "server/services/callResult/recordCallResultEngagementPreviewFlag.ts";
  const outRel = "server/services/callResult/recordCallResultOutreachPreviewFlag.ts";
  requireFile(engRel);
  requireFile(outRel);
  requireText(engRel, [
    "isRecordCallResultEngagementPreviewEnabled",
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
  ]);
  requireText(outRel, [
    "isRecordCallResultOutreachPreviewEnabled",
    "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW",
  ]);
}

// 15. The two surface helpers remain separate — neither preview
//     module imports the other (no consolidation has happened).
{
  const eng = read("server/services/callResult/recordCallResultEngagementPreviewFlag.ts") ?? "";
  const out = read("server/services/callResult/recordCallResultOutreachPreviewFlag.ts") ?? "";
  const ENG_IMPORT = /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementPreviewFlag['"]/;
  const OUT_IMPORT = /(?:from|import)\s+['"][^'"]*\/recordCallResultOutreachPreviewFlag['"]/;
  if (OUT_IMPORT.test(eng)) {
    failures.push(
      "engagement preview module must not import the outreach preview module (surface-isolated)",
    );
  }
  if (ENG_IMPORT.test(out)) {
    failures.push(
      "outreach preview module must not import the engagement preview module (surface-isolated)",
    );
  }
}

// 16. No route-delegation flag exists yet in RUNTIME code. The flag
//     name MAY appear in contract docs and QA scripts (the split-brain
//     run's Batch 6 / Batch 10 explicitly contract this flag before any
//     accessor module ships). The hard-stop is on runtime adoption.
{
  const ROOTS = ["server", "shared", "client"];
  const DELEGATION_FLAG_RE =
    /USE_RECORD_CALL_RESULT_(?:ENGAGEMENT|OUTREACH|PORTAL)_DELEGATE/;
  const offenders = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".next" ||
        e.name === "build"
      ) {
        continue;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      // Test files anywhere are allowed to mention the flag for
      // dry-run harness purposes.
      if (rel.includes("/__tests__/")) continue;
      if (rel.includes("/test/") || rel.includes("/tests/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (DELEGATION_FLAG_RE.test(src)) {
        offenders.push(rel);
      }
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));

  if (offenders.length > 0) {
    for (const o of offenders) {
      failures.push(
        `Premature route-delegation flag found in runtime ${o} — accessor module must ship via Batch H Step 5+ delegation flag PR with proper safeguards`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Call-result preview parity readiness QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Call-result preview parity readiness QA passed.");

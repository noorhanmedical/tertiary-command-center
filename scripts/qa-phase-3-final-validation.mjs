#!/usr/bin/env node
// QA — Phase 3 PR 3.9: live DB probes + final validation runner.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

// 7 live probe scripts must exist
const probes = [
  "script/livePhase3ExceptionSettingsProbe.ts",
  "script/livePhase3ExceptionSnapshotsProbe.ts",
  "script/livePhase3ExceptionReviewProbe.ts",
  "script/livePhase3AiRecommendationLogProbe.ts",
  "script/livePhase3RecommendationEngineProbe.ts",
  "script/livePhase3CallPriorityProbe.ts",
  "script/livePhase3OperationalSummaryProbe.ts",
];
for (const p of probes) mustExist(p);
mustExist("script/livePhase3FinalValidation.ts");
mustExist("docs/architecture/phase-3-final-validation.md");

if (failures.length) {
  console.error("[qa-phase-3-final-validation] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

// Every probe must honest-skip when DATABASE_URL is unset
for (const p of probes) {
  const text = read(p);
  if (!/DATABASE_URL/.test(text) || !/(SKIP|skipped)/i.test(text)) {
    fail(`${p} must honest-skip when DATABASE_URL is unset`);
  }
}

// package.json must register all 7 probe scripts + master runner
const pkg = read("package.json");
const expected = [
  "probe:phase3-exception-settings",
  "probe:phase3-exception-snapshots",
  "probe:phase3-exception-review",
  "probe:phase3-ai-recommendation-log",
  "probe:phase3-recommendation-engine",
  "probe:phase3-call-priority",
  "probe:phase3-operational-summary",
  "phase3:final-validation",
];
for (const s of expected) {
  if (!new RegExp(`"${s}"\\s*:`).test(pkg)) fail(`package.json missing npm script: ${s}`);
}

// Final validation runner must iterate all 7 probes
const runner = read("script/livePhase3FinalValidation.ts");
for (const p of expected.filter((s) => s.startsWith("probe:"))) {
  if (!runner.includes(p)) fail(`final validation runner missing entry: ${p}`);
}

if (failures.length) {
  console.error("[qa-phase-3-final-validation] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-final-validation] PASS");

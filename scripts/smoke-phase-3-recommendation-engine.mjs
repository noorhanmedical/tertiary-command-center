#!/usr/bin/env node
// Smoke — Phase 3 PR 3.5. Cross-file coherence.

import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const engine = read("server/services/exceptionIntelligence/recommendationEngine.ts");
if (!/getEffectiveExceptionPolicy/.test(engine)) fail("engine must read exception policy");
if (!/getEffectiveAiSafetyPolicy/.test(engine)) fail("engine must read AI safety policy");

const rules = read("server/services/exceptionIntelligence/recommendationRules.ts");
if (!/RECOMMENDATION_RULES/.test(rules) || !/getRuleForExceptionType/.test(rules)) {
  fail("recommendationRules must export the registry and lookup helper");
}

const api = read("client/src/lib/exceptionsApi.ts");
if (!/postRecommend\(/.test(api)) fail("exceptionsApi must export postRecommend()");

if (failures.length) {
  console.error("[smoke-phase-3-recommendation-engine] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-recommendation-engine] PASS");

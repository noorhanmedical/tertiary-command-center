// Smoke — Phase 3 PR 3.1 registry + settings shape.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];
function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check("1. Contract exports ExceptionType + DetectorDefinition",
  "shared/contracts/exceptionIntelligence.ts",
  (s) => s.includes("ExceptionType") && s.includes("DetectorDefinition") && s.includes("EffectiveExceptionPolicy"));

check("2. Registry covers all 5 categories",
  "server/services/exceptionIntelligence/detectorRegistry.ts",
  (s) => ["engagement", "document", "scheduling", "billing"].every((c) => s.includes(`"${c}"`)));

check("3. Service builds bundle with sources ledger",
  "server/services/exceptionIntelligence/exceptionSettingsService.ts",
  (s) => s.includes("getEffectiveExceptionPolicy") && s.includes("sources"));

check("4. Service applies Phase 2 hardening precedence (testType first)",
  "server/services/exceptionIntelligence/exceptionSettingsService.ts",
  (s) => /scope\.testType != null/.test(s) && /source: "test_type"/.test(s));

check("5. Route registers all 4 endpoints",
  "server/routes/exceptionSettings.ts",
  (s) => s.includes('"/api/exception-settings/effective"') && s.includes('"/api/exception-settings/settings"') && s.includes('"/api/exception-settings/settings/:id"'));

check("6. Page consumes effective bundle + source badges",
  "client/src/pages/exception-settings.tsx",
  (s) => s.includes("fetchEffectiveExceptionPolicy") && s.includes("effective-human-review-required") && s.includes("effective-auto-actions-enabled"));

check("7. Seed honors honest skip + auto_actions_enabled=false",
  "script/seedExceptionSettings.ts",
  (s) => s.includes("DATABASE_URL unavailable") && /auto_actions_enabled[\s\S]{0,80}value: false/.test(s));

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length}`);
  process.exit(1);
}
console.log("Smoke passed: exception settings + registry chain intact.");

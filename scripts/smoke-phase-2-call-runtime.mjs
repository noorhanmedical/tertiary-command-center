// Smoke — Phase 2 call runtime: settings → plan → metadata → audit.
//
// Run: node scripts/smoke-phase-2-call-runtime.mjs

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

check(
  "1. applyCallResultRouting service exists with typed plan",
  "server/services/callResult/applyCallResultRouting.ts",
  (s) => s.includes("CallResultRoutingPlan") && s.includes("appliedSettings"),
);

check(
  "2. Plan honors max_call_attempts → unable-to-reach transition",
  "server/services/callResult/applyCallResultRouting.ts",
  (s) => /currentAttemptCount \+ 1 >= cr\.maxCallAttempts/.test(s),
);

check(
  "3. Plan honors queue_reentry_enabled before scheduling re-action",
  "server/services/callResult/applyCallResultRouting.ts",
  (s) => /cr\.queueReentryEnabled/.test(s),
);

check(
  "4. Audit identity service exists",
  "server/services/callResult/callResultAuditIdentity.ts",
  (s) => s.includes("export type CallResultAuditIdentity") && s.includes("actor_user_id"),
);

check(
  "5. Route loads effective settings before journey-event write",
  "server/routes/executionCases.ts",
  (s) => s.includes("getEffectiveAdminSettings(") && s.includes("applyCallResultRouting("),
);

check(
  "6. Route's journey metadata carries routing_plan + audit identity",
  "server/routes/executionCases.ts",
  (s) =>
    /routing_plan:\s*\{/.test(s) &&
    /callResultAuditMetadata\(auditIdentity\)/.test(s),
);

check(
  "7. Both delegation + legacy paths spread audit metadata",
  "server/routes/executionCases.ts",
  (s) => (s.match(/\.\.\.callResultAuditMetadata\(auditIdentity\)/g) || []).length >= 2,
);

check(
  "8. Audit identity drops view-as for non-admins",
  "server/services/callResult/callResultAuditIdentity.ts",
  (s) => /actorIsAdmin\s*\?\s*\(rawViewAsTeamMemberId/.test(s),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: Phase 2 call runtime intact.");

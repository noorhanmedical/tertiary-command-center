#!/usr/bin/env node
// Smoke — Phase 3 PR 3.9. Sanity-check the validator can be invoked
// (without a live DB it should skip gracefully).

import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["tsx", "script/livePhase3FinalValidation.ts"], {
  encoding: "utf8", env: { ...process.env, DATABASE_URL: "" },
});
if (r.status !== 0) {
  console.error("[smoke-phase-3-final-validation] FAIL — runner did not exit 0 with DATABASE_URL unset");
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
if (!/phase3-final-validation\] SKIP/.test(r.stdout)) {
  console.error("[smoke-phase-3-final-validation] FAIL — expected SKIP message in stdout");
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
console.log("[smoke-phase-3-final-validation] PASS");

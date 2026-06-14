// Smoke — Phase 2 hardening item 4: physician signing chain.
//
// Run: node scripts/smoke-phase-2-hardening-physician-signing.mjs

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
  "1. signingService stays dormant + USE_ANCILLARY_SIGNING_SERVICE env-gated",
  "server/services/ancillary/signingService.ts",
  (s) => s.includes("DORMANT") && s.includes("USE_ANCILLARY_SIGNING_SERVICE"),
);

check(
  "2. acsWorkflowRuntime derives physician_signature_pending honestly",
  "server/services/ancillary/acsWorkflowRuntime.ts",
  (s) => /orderPresent && !physicianSigned/.test(s),
);

check(
  "3. AcsWorkflowPanel renders the explicit pending block (data-testid)",
  "client/src/components/portal/AcsWorkflowPanel.tsx",
  (s) => s.includes("acs-physician-signing-pending-block"),
);

check(
  "4. Hardening doc documents the missing pieces",
  "docs/architecture/phase-2-hardening-physician-signing.md",
  (s) =>
    s.includes("/api/portal/sign-order") &&
    s.includes("Future enablement path"),
);

// No /api/portal/sign-order route exists.
const portal = fs.readFileSync(path.join(root, "server/routes/portal.ts"), "utf8");
if (portal.includes("/api/portal/sign-order")) {
  fails.push("/api/portal/sign-order route exists — should remain absent");
} else {
  passes.push("5. /api/portal/sign-order route remains absent (honest deferral)");
}

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: physician signing honesty intact.");

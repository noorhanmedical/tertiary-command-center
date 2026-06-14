// QA — Phase 2 hardening item 4: physician signing honesty.
//
// Run: node scripts/qa-phase-2-hardening-physician-signing-honesty.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const doc = fs.existsSync(path.join(root, "docs/architecture/phase-2-hardening-physician-signing.md"))
  ? fs.readFileSync(path.join(root, "docs/architecture/phase-2-hardening-physician-signing.md"), "utf8")
  : "";
if (!doc) failures.push("phase-2-hardening-physician-signing.md must exist");
else {
  if (!doc.includes("physician_signed_order")) failures.push("doc must reference physician_signed_order");
  if (!doc.includes("/api/portal/sign-order")) failures.push("doc must reference the missing /api/portal/sign-order route");
}

// signingService remains dormant.
const sigService = fs.readFileSync(path.join(root, "server/services/ancillary/signingService.ts"), "utf8");
if (!sigService.includes("DORMANT")) {
  failures.push("signingService must remain DORMANT");
}
if (!sigService.includes("USE_ANCILLARY_SIGNING_SERVICE")) {
  failures.push("signingService must require explicit env opt-in");
}

// No /api/portal/sign-order route added.
const portal = fs.readFileSync(path.join(root, "server/routes/portal.ts"), "utf8");
if (portal.includes("/api/portal/sign-order")) {
  failures.push("a /api/portal/sign-order route was added — needs explicit honesty review + ACS panel update");
}

// AcsWorkflowPanel renders the explicit pending block.
const panel = fs.readFileSync(path.join(root, "client/src/components/portal/AcsWorkflowPanel.tsx"), "utf8");
if (!panel.includes("acs-physician-signing-pending-block")) {
  failures.push("AcsWorkflowPanel must render the explicit physician-signing pending block (data-testid)");
}
if (!panel.includes("physician_signature_pending")) {
  failures.push("AcsWorkflowPanel must gate the block on the physician_signature_pending status");
}
// No fake signed badge.
const FORBIDDEN_FAKE = [
  "fakePhysicianSigned",
  "mockPhysicianSigned",
  'statuses.add("signed_by_physician")',
];
for (const phrase of FORBIDDEN_FAKE) {
  if (panel.includes(phrase)) failures.push(`AcsWorkflowPanel must not contain "${phrase}"`);
}

// acsWorkflowRuntime must still derive physician_signature_pending honestly.
const runtime = fs.readFileSync(path.join(root, "server/services/ancillary/acsWorkflowRuntime.ts"), "utf8");
if (!/orderPresent && !physicianSigned/.test(runtime)) {
  failures.push("acsWorkflowRuntime must emit physician_signature_pending only when (orderPresent AND not physicianSigned)");
}
// Forbid a hardcoded "physician_signed" assertion elsewhere.
if (/statuses\.add\("signed_by_physician"\)/.test(runtime)) {
  failures.push("acsWorkflowRuntime must not assert signed_by_physician without a canonical writer");
}

if (failures.length > 0) {
  console.error("Phase-2 hardening physician-signing-honesty QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening physician-signing-honesty QA passed.");

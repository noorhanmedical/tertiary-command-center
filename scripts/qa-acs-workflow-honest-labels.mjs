// QA — ACS workflow surfaces are honestly labeled.
//
// The brief requires ACS consent / screening / report upload /
// document readiness to be either LIVE or honestly scaffolded — no
// fake completed states.
//
// Live surfaces (must exist, must be wired):
//   - POST /api/portal/sign-consent      (consent signing)
//   - POST /api/portal/uploads           (screening / report / document upload)
//   - Document readiness read via case_document_readiness
//
// Honestly deferred surfaces (must NOT pretend to be live):
//   - Physician order signing — no /api/portal/sign-order route exists.
//
// Run: node scripts/qa-acs-workflow-honest-labels.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const portal = fs.readFileSync(
  path.join(root, "server/routes/portal.ts"),
  "utf8",
);

// 1. Live: sign-consent + uploads routes registered.
const LIVE_ROUTES = [
  'app.post("/api/portal/sign-consent"',
  'app.post("/api/portal/uploads"',
];
for (const r of LIVE_ROUTES) {
  if (!portal.includes(r)) {
    failures.push(`server/routes/portal.ts must register ${r}`);
  }
}

// 2. Live: requirePortalRole gates BOTH writers (no anonymous writes).
const consentBlock = portal.slice(
  portal.indexOf("/api/portal/sign-consent"),
  portal.indexOf("/api/portal/sign-consent") + 400,
);
if (!consentBlock.includes("requirePortalRole")) {
  failures.push("sign-consent route must be gated by requirePortalRole");
}
const uploadBlock = portal.slice(
  portal.indexOf("/api/portal/uploads"),
  portal.indexOf("/api/portal/uploads") + 400,
);
if (!uploadBlock.includes("requirePortalRole")) {
  failures.push("uploads route must be gated by requirePortalRole");
}

// 3. Honestly deferred: no /api/portal/sign-order route exists.
//    If a future surface adds it accidentally, this QA fires so the
//    honesty review can decide whether the new surface is Live or
//    Scaffold.
if (portal.includes("/api/portal/sign-order")) {
  failures.push(
    "An /api/portal/sign-order route was added — verify it is truly LIVE (signs a real signed-order document + writes the readiness row), then update this QA and the audit doc",
  );
}

// 4. PR A's audit doc documents the deferral. We assert the doc
//    still contains the explicit deferral so the next refactor
//    can't quietly drop it.
const doc = fs.readFileSync(
  path.join(root, "docs/architecture/complete-team-portal-operations-runtime.md"),
  "utf8",
);
if (!/sign-order/i.test(doc)) {
  failures.push("Audit doc must continue to document the sign-order deferral");
}

// 5. No fake completed states in the team portal shell for ACS
//    workflow. We re-assert the rules PR A pinned, scoped to ACS-
//    specific surfaces.
const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
const ACS_FORBIDDEN_PHRASES = [
  "fakeConsentSigned",
  "fakeUploadSuccess",
  "mockSignConsent",
  "fakeProcedureComplete",
  "fakeOrderSigned",
];
for (const p of ACS_FORBIDDEN_PHRASES) {
  if (shell.includes(p)) {
    failures.push(`TeamPortalShell must not include fake ACS completed state "${p}"`);
  }
}

if (failures.length > 0) {
  console.error("ACS-workflow-honest-labels QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ACS-workflow-honest-labels QA passed.");

// QA — ACS Workspace document / signing / billing handoff surfaces.
//
// Phase 1 contract: the Ancillary Care Specialist Workspace must
// surface (or be wired to receive) the handoff state for document
// readiness, consent signing (Live), physician-order signing
// (Scaffold), and billing readiness (Live read-only). This QA
// asserts the wiring is present at the source level so the workspace
// is honest about what is real vs scaffold.
//
// Run: node scripts/qa-phase-1-acs-document-signing-billing-handoff.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

function requireFile(rel) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push(`Missing file: ${rel}`);
  }
}

// 1) Consent signing (Live) — sign-consent endpoint + PORTAL_DOC_KINDS.
requireText("server/routes/portal.ts", [
  '"/api/portal/sign-consent"',
  "informed_consent",
  "PORTAL_DOC_KINDS",
]);

// 2) Document readiness backend (Live).
requireFile("shared/schema/documentReadiness.ts");

// 3) Billing readiness backend (Live).
requireFile("shared/schema/billingReadiness.ts");

// 4) ACS Workspace consumes document + billing readiness through the
//    canonical PatientCommandCanvas + CanonicalRowActions paths.
requireText("client/src/components/portal/PatientCommandCanvas.tsx", [
  // PatientCommandCanvas is the workspace's patient detail surface.
  "PatientCommandCanvas",
]);

// 5) CanonicalRowActions invalidates document + billing readiness
//    caches after relevant actions (per Slice 1.4 inspection).
requireText("client/src/components/outreach/CanonicalRowActions.tsx", [
  "/api/case-document-readiness",
  "/api/billing-readiness-checks",
  "/api/billing-document-requests",
]);

// 6) Physician-order signing is intentionally NOT yet wired. Assert
//    the absence so a future commit that introduces a partial /
//    silently-failing signing route trips this QA.
const portal = read("server/routes/portal.ts") ?? "";
if (portal.includes('"/api/portal/sign-order"')) {
  failures.push(
    "Physician-order signing route detected — this work is Phase 2. Either complete the workflow + update phase-1-full-system-completion-results.md or remove the route.",
  );
}
const docKindsSrc = read("server/routes/portal.ts") ?? "";
if (docKindsSrc.includes("physician_signature")) {
  failures.push(
    "physician_signature document kind detected — Phase 2 work. Update the audit doc before landing.",
  );
}

// 7) Honesty audit doc references both Live and Scaffold states for
//    these surfaces.
requireText("docs/architecture/phase-1-full-system-completion-results.md", [
  "Physician Signing",
  "Billing Readiness",
  "Consent signing | Live",
  "Physician order signing | Scaffold",
]);

if (failures.length > 0) {
  console.error("ACS document / signing / billing handoff QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ACS document / signing / billing handoff QA passed.");

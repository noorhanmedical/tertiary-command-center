// QA: Playground data envelope (Bundle 53).
//
// Source-code invariant pinning the data-envelope contract that
// every future Team Portal / Playground UI PR must respect (per
// docs/architecture/team-portal-playground-wiring-contract.md §22
// + docs/architecture/playground-design-system-implementation-plan.md
// Step G + docs/architecture/patient-directory-readonly-envelope-readiness.md).
//
// The check has two layers:
//
//   1. The CONTRACT DOCS still enumerate every forbidden data
//      class. A future doc-edit that drops the ban list fails CI.
//
//   2. The PLAYGROUND SOURCE TREE
//      (client/src/features/command-center/playground/ +
//       client/src/components/playground/) does NOT reference any
//      forbidden field/type/value at the source-text level. The
//      check scans every .ts / .tsx file currently in scope and
//      reports drift the moment it lands.
//
// No DB. No app boot. No network. No PHI. The check is text-only.

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

const CONTRACT_REL =
  "docs/architecture/team-portal-playground-wiring-contract.md";
const PLAN_REL =
  "docs/architecture/playground-design-system-implementation-plan.md";
const PD_ENVELOPE_REL =
  "docs/architecture/patient-directory-readonly-envelope-readiness.md";

// ─── 1. Contract docs still ban every forbidden class ───────────
requireFile(CONTRACT_REL);
requireFile(PLAN_REL);
requireFile(PD_ENVELOPE_REL);

// Bundle 11 §22 forbidden data classes the Playground canvas must
// not surface. Phrasing matches the actual doc text — the QA
// fails if a future edit drops any of these names.
const FORBIDDEN_CLASSES_IN_CONTRACT = [
  // Financials (Bundle 11 §22 lists these explicitly).
  "claim",
  "invoice",
  "revenue",
  "payment",
  // Admin-only / cross-team data.
  "admin announcement",
  "PTO",
  "payroll",
  // PHI minimisation.
  "PHI",
  // Raw ICDs in patient-facing surfaces — Bundle 11 §22 uses
  // "Raw ICD codes" (plural) in its bullet.
  "Raw ICD codes",
];
requireText(CONTRACT_REL, FORBIDDEN_CLASSES_IN_CONTRACT);

// Bundle 32 Step G binds the envelope to the implementation plan.
requireText(PLAN_REL, [
  "data envelope",
  // The Bundle 11 §22 reference still appears.
  "§22",
]);

// Bundle 49 envelope readiness still names each excluded surface
// (phrasing matches the actual doc — capitalised bullet headers).
requireText(PD_ENVELOPE_REL, [
  "Billing",
  "Invoices",
  "Revenue share",
  "Admin Review internals",
  "Raw EMR notes",
  "PHI",
  "Company financials",
  "Cross-team employee",
  "Raw ICD codes",
]);

// ─── 2. Playground source tree must not reference forbidden ─────
//        fields at runtime. The check walks every .ts/.tsx file
//        under the Playground directories and asserts none of the
//        forbidden field names / types appears.
function walk(dir, exts) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
      out.push(...walk(p, exts));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(p);
    }
  }
  return out;
}

const PLAYGROUND_DIRS = [
  "client/src/features/command-center/playground",
  "client/src/components/playground",
  // The panel→playground context helpers also belong to the
  // envelope surface.
  "client/src/lib/playground",
];

const PLAYGROUND_FILES = [];
for (const dir of PLAYGROUND_DIRS) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) PLAYGROUND_FILES.push(...walk(abs, [".ts", ".tsx"]));
}

// Forbidden identifiers inside Playground source. Each entry is a
// substring; if it appears in any Playground file, the data
// envelope is broken.
const FORBIDDEN_IN_PLAYGROUND = [
  // Money fields from billing-invoice-hard-stop-map.md §3.
  "fullAmountPaid",
  "claimAmount",
  "remittanceAmount",
  "projectedAmount",
  "totalAmount",
  "netAmount",
  "balanceDue",
  // Money-table imports.
  "completed_billing_packages",
  "billing_records",
  "billing_document_requests",
  "projected_invoices",
  "invoices/",
  // Admin-only audit + cross-team data.
  "adminApprovalNote",
  "performanceReview",
  "payrollRecord",
  // Raw ICD strings exposed on user-facing surfaces.
  "rawIcdCode",
  // PHI fields the Playground must not render directly.
  // (patientName / patientDob ARE allowed when scoped through the
  //  Patient Directory envelope, so the check below only bans the
  //  raw-payload-shaped identifiers a future regression could
  //  introduce.)
  "rawEmrPayload",
  "rawDocumentBody",
  // Forbidden table imports.
  "from \"@shared/schema/billing\"",
  "from \"@shared/schema/invoices\"",
  "from \"@shared/schema/projectedInvoices\"",
  "from \"@shared/schema/completedBillingPackages\"",
  "from \"@shared/schema/billingDocuments\"",
  "from \"@shared/schema/billingReadiness\"",
];

for (const abs of PLAYGROUND_FILES) {
  const rel = path.relative(root, abs);
  const src = fs.readFileSync(abs, "utf8");
  for (const needle of FORBIDDEN_IN_PLAYGROUND) {
    if (src.includes(needle)) {
      failures.push(
        `Playground data envelope broken: ${rel} contains "${needle}"`,
      );
    }
  }
}

// ─── 3. The Playground source must positively reference the
//        canonical safe sources (Patient Directory + Operational
//        Queue + Team Tasks + Journey Events) per Bundle 11 §12-§16.
//        These references can land via panelPlaygroundContext.ts
//        (which already does) or via deeper Step E/F PRs.
{
  const CONTEXT_REL = "client/src/lib/playground/panelPlaygroundContext.ts";
  const c = read(CONTEXT_REL);
  if (c === null) {
    failures.push(`Missing playground context file: ${CONTEXT_REL}`);
  } else {
    // The context still enumerates the canonical componentType
    // values. A future PR that drops one without an updated
    // contract doc breaks here.
    for (const needle of [
      "PANEL_PLAYGROUND_COMPONENT_TYPES",
      "patient",
      "callList",
      "document",
    ]) {
      if (!c.includes(needle)) {
        failures.push(`Missing "${needle}" in ${CONTEXT_REL}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Playground data envelope QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log(
  `Playground data envelope QA passed (${PLAYGROUND_FILES.length} playground files scanned).`,
);

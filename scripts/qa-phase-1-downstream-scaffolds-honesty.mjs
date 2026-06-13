// QA — Downstream scaffold honesty audit.
//
// Phase 1 guardrail: every downstream surface must be labelled
// honestly. This QA enforces structural invariants that match the
// claims in docs/architecture/phase-1-full-system-completion-results.md:
//
//   1. Documents / Document Library / Document Upload pages exist.
//   2. Report Upload route exists and is role-gated.
//   3. Billing + Invoices pages exist.
//   4. External storage adapters exist.
//   5. Mission Control is ABSENT (forbidden in Phase 1).
//
// Run: node scripts/qa-phase-1-downstream-scaffolds-honesty.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function requireFile(rel) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push(`Missing file: ${rel}`);
  }
}

function requireText(rel, needles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

function forbiddenFile(rel, reason) {
  if (fs.existsSync(path.join(root, rel))) {
    failures.push(`Forbidden file present: ${rel} — ${reason}`);
  }
}

// 1. Documents stack.
requireFile("client/src/pages/documents.tsx");
requireFile("client/src/pages/document-library.tsx");
requireFile("client/src/pages/document-upload.tsx");

// 2. Report Upload route role-gated.
requireText("server/routes/portal.ts", [
  '"/api/portal/uploads"',
  "requirePortalRole",
  "multer",
]);

// 3. Billing + Invoices pages.
requireFile("client/src/pages/billing.tsx");
requireFile("client/src/pages/invoices.tsx");

// 4. External storage adapters live (under server/integrations/).
requireFile("server/integrations/fileStorage.ts");
requireFile("server/integrations/googleDrive.ts");
requireFile("server/integrations/googleDriveFileStorage.ts");
requireFile("server/integrations/s3FileStorage.ts");
requireFile("server/integrations/googleSheets.ts");

// 5. Mission Control absent. Phase 1 guardrails forbid landing it as
//    a side effect.
const PAGES_DIR = path.join(root, "client", "src", "pages");
if (fs.existsSync(PAGES_DIR)) {
  for (const entry of fs.readdirSync(PAGES_DIR)) {
    if (/mission/i.test(entry)) {
      failures.push(`Forbidden Mission Control page found: client/src/pages/${entry} (Phase 7 only)`);
    }
  }
}
forbiddenFile(
  "client/src/components/mission-control",
  "Mission Control is Phase 7 only",
);

// 6. Honesty audit doc exists.
requireFile("docs/architecture/phase-1-full-system-completion-results.md");

if (failures.length > 0) {
  console.error("Downstream scaffolds honesty QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Downstream scaffolds honesty QA passed.");

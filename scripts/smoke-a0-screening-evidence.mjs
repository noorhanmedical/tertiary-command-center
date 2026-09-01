// Smoke — Slice A0: structured screening evidence wiring + honesty.
//
// Source-level checks (no DB): the contract exists and exports the expected
// surface, the barrel re-exports it, the route is registered, the service
// exposes the read primitive, and A0 introduced NO signing behavior.
//
// Run: node scripts/smoke-a0-screening-evidence.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function read(file) {
  try {
    return fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    return null;
  }
}
function check(label, file, predicate) {
  const src = read(file);
  if (src == null) return fails.push(`${label} — missing file ${file}`);
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

// 1. Contract file exports the core surface.
check("1. screeningEvidence contract exports registry + schema + completion + version", "shared/schema/screeningEvidence.ts", (s) =>
  s.includes("export const SCREENING_REGISTRY") &&
  s.includes("export const ancillaryScreeningEvidenceSchema") &&
  s.includes("export function evaluateCompletion") &&
  s.includes("export function canonicalScreeningEvidenceString"),
);

// 2. Taxonomy includes the new event-history class.
check("2. taxonomy includes patient_reported_event_history", "shared/schema/screeningEvidence.ts", (s) =>
  s.includes('"patient_reported_event_history"'),
);

// 3. Capture carries source-form provenance distinct from questionnaireVersion.
check("3. capture.sourceForm provenance present", "shared/schema/screeningEvidence.ts", (s) =>
  s.includes("sourceForm") && s.includes("transcription") && s.includes("transcribed_from_paper"),
);

// 4. Crosswalk defined + explicitly A1-only / never auto-promote.
check("4. SCREENING_CONCEPT_CROSSWALK defined + corroboration-only note", "shared/schema/screeningEvidence.ts", (s) =>
  s.includes("SCREENING_CONCEPT_CROSSWALK") && /never auto-promot/i.test(s),
);

// 5. Barrel re-exports the contract.
check("5. shared/schema barrel re-exports screeningEvidence", "shared/schema/index.ts", (s) =>
  s.includes('export * from "./screeningEvidence"'),
);

// 6. Service exposes validate/log + persistence + read primitive + version hash.
check("6. service exposes submit + getCurrent + version", "server/services/screening/screeningEvidenceService.ts", (s) =>
  s.includes("export async function submitScreeningEvidence") &&
  s.includes("export async function getCurrentScreeningEvidence") &&
  s.includes("export function screeningEvidenceVersion") &&
  s.includes("validateOnly"),
);

// 7. Service persists into the EXISTING readiness metadata (no new table).
check("7. service persists to case_document_readiness.metadata", "server/services/screening/screeningEvidenceService.ts", (s) =>
  s.includes("caseDocumentReadiness") && s.includes("screeningEvidence") && s.includes("screeningEvidenceVersion"),
);

// 8. Route file present + env-gated validate/log enforcement.
check("8. route posts + reads current + FEATURE_SCREENING_EVIDENCE_ENFORCE gate", "server/routes/screeningEvidence.ts", (s) =>
  s.includes('"/api/screening-evidence"') &&
  s.includes('"/api/screening-evidence/current"') &&
  s.includes("FEATURE_SCREENING_EVIDENCE_ENFORCE"),
);

// 9. Route registered in routes.ts.
check("9. registerScreeningEvidenceRoutes imported + registered", "server/routes.ts", (s) =>
  s.includes('import { registerScreeningEvidenceRoutes }') && s.includes("registerScreeningEvidenceRoutes(app)"),
);

// 10. Legacy PDF/flag screening path is untouched (still fires the addendum).
check("10. legacy screening_form completion path preserved", "server/routes/documentReadiness.ts", (s) =>
  s.includes("createScreeningAddendumForCase") && s.includes('"/api/case-document-readiness/complete"'),
);

// 11. HONESTY — A0 added no signing behavior anywhere new.
for (const file of [
  "server/routes/screeningEvidence.ts",
  "server/services/screening/screeningEvidenceService.ts",
  "shared/schema/screeningEvidence.ts",
]) {
  const s = read(file) ?? "";
  if (/sign-order|signatureStatus|signProcedureNote|\/api\/portal\/sign-order/.test(s)) {
    fails.push(`11. A0 must not add signing behavior — found signing reference in ${file}`);
  }
}
if (!fails.some((f) => f.startsWith("11."))) passes.push("11. A0 introduces no signing behavior (no /api/portal/sign-order, no signature writes)");

// 12. No new migration was introduced for A0 (JSONB reuse, no schema DDL).
{
  const migDir = path.join(root, "migrations");
  let offenders = [];
  try {
    offenders = fs.readdirSync(migDir).filter((f) => /screening[_-]?evidence/i.test(f));
  } catch { /* ignore */ }
  if (offenders.length === 0) passes.push("12. no A0 migration added (uses existing case_document_readiness.metadata)");
  else fails.push(`12. unexpected A0 migration file(s): ${offenders.join(", ")}`);
}

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`\nSmoke failed: ${fails.length} check(s) broken`);
  process.exit(1);
}
console.log("\nSmoke passed: A0 wiring intact, no signing behavior introduced.");

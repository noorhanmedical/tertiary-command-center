// QA: EMR + Clinical Evidence contracts (Bundle 44).
//
// Source-code invariant. Asserts the five docs that constitute the
// EMR / Clinical Evidence / Ancillary Qualification architecture
// (Bundles 37, 38, 39, 40, 43) all exist on main and still name
// the load-bearing concepts every future runtime PR must respect.
//
// No DB. No app boot. No network. No PHI.
//
// Cross-reference index of the docs this script pins:
//   - emr-integration-clinical-evidence-qualification-contract.md (Bundle 37)
//   - clinical-evidence-store-contract.md                        (Bundle 38)
//   - emr-adapter-interface-design.md                            (Bundle 39)
//   - icd-suggestion-safety-contract.md                          (Bundle 40)
//   - labs-imaging-notes-extraction-contract.md                  (Bundle 43)

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

const ARCH_REL =
  "docs/architecture/emr-integration-clinical-evidence-qualification-contract.md";
const STORE_REL = "docs/architecture/clinical-evidence-store-contract.md";
const ADAPTER_REL = "docs/architecture/emr-adapter-interface-design.md";
const ICD_REL = "docs/architecture/icd-suggestion-safety-contract.md";
const EXTRACT_REL = "docs/architecture/labs-imaging-notes-extraction-contract.md";

// 1. All five docs exist.
requireFile(ARCH_REL);
requireFile(STORE_REL);
requireFile(ADAPTER_REL);
requireFile(ICD_REL);
requireFile(EXTRACT_REL);

// 2. Bundle 37 — anchor concepts that every future runtime PR cites.
requireText(ARCH_REL, [
  // Surfaces / modules.
  "EMR adapter",
  "Patient Directory",
  "Clinical Evidence Store",
  // Engines.
  "ICD Suggestion Engine",
  "Ancillary Qualification Engine",
  // Specific ancillaries (Bundle 37 §12).
  "BrainWave",
  "VitalWave",
  "Ultrasound",
  // Review boundary — Bundle 37 §16 names "human review" and the no-commit posture.
  "human action",
  // Hard-stops — Bundle 37 §16 names the canonical posture without using the exact "no auto-commit" string.
  "NEVER commits",
  "human review",
  // PHI + tenant.
  "PHI-safe logging",
  "tenant isolation",
  "tenant",
  // Source category coverage.
  "demographics",
  "MRN",
  "encounters",
  "labs",
  "imaging",
  "notes",
  // Pipeline structure.
  "raw payload",
  // Vendors named.
  "Epic",
  "eClinicalWorks",
]);

// 3. Bundle 38 — Clinical Evidence Store named entities.
requireText(STORE_REL, [
  "ClinicalEvidence",
  "ClinicalDocument",
  "LabResult",
  "ImagingReport",
  "Encounter",
  "ExtractedCondition",
  "EvidenceSourceReference",
  "EvidenceConfidence",
  "EvidenceReviewStatus",
  "ConflictingEvidence",
  "StaleEvidence",
  "MissingEvidenceItem",
  // Invariants.
  "append-only",
  "Provenance",
  "Tenant isolation",
  // PHI envelope.
  "PHI",
]);

// 4. Bundle 39 — EMR adapter responsibilities.
requireText(ADAPTER_REL, [
  // Vendor list.
  "Epic",
  "Cerner",
  "Athena",
  "NextGen",
  "AdvancedMD",
  "eClinicalWorks",
  "PCC",
  // Capabilities.
  "Patient search",
  "demographics",
  "encounter",
  "labs",
  "imaging",
  "watermark",
  "retry",
  "audit",
  // Hard-stops.
  "MUST NOT",
  "credential",
  "PHI",
]);

// 5. Bundle 40 — ICD suggestion safety.
requireText(ICD_REL, [
  "suggestion-only",
  "NEVER",
  "billing_records",
  // Bundle 40 §8 heading is "No auto-commit to billing".
  "No auto-commit to billing",
  "auto-commit",
  "clinician",
  "admin",
  "supportingEvidence",
  "missingEvidence",
  "contradictingEvidence",
  "confidence",
  "reviewStatus",
  "humanApprovalRequired",
  // Examples (Bundle 40 §12).
  "Diabetes",
  "CKD",
  "CHF",
  "Anemia",
  "Malnutrition",
  "COPD",
  "Stroke",
  "DVT",
  "Infection",
]);

// 6. Bundle 43 — labs / imaging / notes extraction.
requireText(EXTRACT_REL, [
  // Section headings (capitalised in the doc).
  "Labs extraction",
  "Imaging report extraction",
  "Notes / document NLP",
  "abnormal",
  "trend",
  "impression",
  "findings",
  "negation",
  "copied-forward",
  "stale",
  "conflict",
  "source reference",
  "confidence",
  "ICD",
  "ancillary",
  // Hard-stops.
  "MUST NOT",
  "PHI",
]);

if (failures.length > 0) {
  console.error("EMR / Clinical Evidence contracts QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("EMR / Clinical Evidence contracts QA passed.");

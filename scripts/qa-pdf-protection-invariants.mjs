// QA: PDF protection invariants.
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Asserts the contract from docs/architecture/pdf-protection-contract.md §3.4
// plus the surrounding §2 / §3.2 invariants.
//
// Specifically:
//   - Both Clinician + Plexus PDF body builders contain the comment
//     "ICD-10 codes are intentionally not rendered in either PDF".
//   - Both generator functions (generateClinicianPDF, generatePlexusPDF)
//     are still exported from pdfGeneration.ts.
//   - The four required reasoning blob keys are referenced in
//     pdfGeneration.ts.
//
// Pattern intentionally mirrors the existing scripts/qa-*.mjs scripts so
// the matrix doc's claim (§2: "all eight existing scripts are source-code
// invariant checks") generalises to this batch's additions.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

const pdfGen = "client/src/lib/pdfGeneration.ts";

// ─── §3.4: ICD codes intentionally not rendered in EITHER PDF ─────────
//
// Both PDF body builders (buildClinicianPdfBody at line ~387, buildPlexusPdfBody
// at line ~566) contain identical comments. If a future PR removes either
// comment without an explicit clinical sign-off batch, the contract is broken.
// We require the substring to appear at least twice in the file.
const content = read(pdfGen);
if (content === null) {
  failures.push(`Missing file: ${pdfGen}`);
} else {
  const needle = "ICD-10 codes are intentionally not rendered in either PDF";
  const occurrences = content.split(needle).length - 1;
  if (occurrences < 2) {
    failures.push(
      `PDF ICD-omission contract: expected >= 2 occurrences of the comment in ${pdfGen}, found ${occurrences}. ` +
        "Both Clinician and Plexus PDF body builders must carry the comment; removing either breaks the contract.",
    );
  }
}

// ─── §2: required exports + reasoning blob keys ──────────────────────
requireText(pdfGen, [
  // Generators (sync + async) must remain present.
  "export function generateClinicianPDF",
  "export async function generateClinicianPDFAsync",
  "export function generatePlexusPDF",
  "export async function generatePlexusPDFAsync",
  // Body builders must remain present (they are the implementation of
  // the ICD-omission contract).
  "export function buildClinicianPdfBody",
  "export function buildPlexusPdfBody",
  // Print-preview helpers are load-bearing (multi-patient packet freeze
  // avoidance — pdf-protection-contract.md §3.5).
  "export function openPatientPacketPrintPreview",
  "export function openSchedulerPacketPrintPreview",
  // Reasoning blob keys (pdf-protection-contract.md §3.2): all four must
  // be referenced in pdfGeneration.ts so the body builders read them.
  "clinician_understanding",
  "patient_talking_points",
  "qualifying_factors",
  "icd10_codes",
]);

// ─── pdfPacketGrouping.ts: the gating helpers used by callers ────────
requireText("client/src/lib/pdfPacketGrouping.ts", [
  "export function isPatientPdfEligible",
  "export function validateSameFacilityDatePacket",
  "export function splitPatientsByFacilityDate",
  "export function getPatientPdfPacketKey",
]);

if (failures.length > 0) {
  console.error("PDF protection invariants QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("PDF protection invariants QA passed.");
}

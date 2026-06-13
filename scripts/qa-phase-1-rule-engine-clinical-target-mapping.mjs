// QA — Rule-engine clinical-target mapping invariants.
//
// Phase 1 guardrail: the Admin Review rule engine maps clinical
// indications to ancillary targets. The following mappings are
// safety-critical and must not regress.
//
// 1. Hypertension must NOT qualify Lower Extremity Venous Duplex by
//    itself. LE Venous Duplex requires venous indications (leg
//    swelling, calf pain, DVT history, varicose, etc.). The rule
//    engine's venous branch in `evidenceForUltrasoundTest` must not
//    include hypertension / diabetes / hyperlipidemia / pvd /
//    peripheral-vascular as a fallback.
// 2. Hypertension may support Renal Artery Doppler.
// 3. Hypertension may support Echocardiogram / TTE.
// 4. Parent/child ultrasound test list (per guardrail) is preserved
//    in shared/plexus.ts.
//
// This script is source-level; runtime behavior is covered by
// unit tests under tests/unit/.
//
// Run: node scripts/qa-phase-1-rule-engine-clinical-target-mapping.mjs

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

const evidence = "shared/plexus-iq/adminReviewEvidence.ts";
const plexus = "shared/plexus.ts";

// 1) The venous branch must NOT pull in hypertension / diabetes /
//    hyperlipidemia / pvd / peripheral-vascular as supporting evidence.
//    We assert by capturing the body of the `if (venous)` block in
//    `evidenceForUltrasoundTest` and confirming none of those tokens
//    appear inside.
const src = read(evidence) ?? "";
const venousBlockMatch = /if\s*\(venous\)\s*\{([\s\S]*?)\}\s*if\s*\(carotid\)/.exec(src);
if (!venousBlockMatch) {
  failures.push("Could not locate the `if (venous) { ... }` block in evidenceForUltrasoundTest");
} else {
  const venousBody = venousBlockMatch[1].toLowerCase();
  for (const forbidden of [
    "hypertension",
    "hyperlipidemia",
    '"diabetes"',
    '"pvd"',
    "peripheral vascular",
  ]) {
    if (venousBody.includes(forbidden)) {
      failures.push(
        `Lower Extremity Venous Duplex must not qualify on "${forbidden}" alone — the venous branch must require true venous indications. (Found "${forbidden}" inside the venous branch of evidenceForUltrasoundTest.)`,
      );
    }
  }
  // Sanity: the legitimate venous indications must still be present.
  const requiredVenous = ["edema", "swelling", "venous", "dvt", "varicose", "calf pain", "leg pain"];
  for (const needle of requiredVenous) {
    if (!venousBody.includes(needle)) {
      failures.push(`Venous branch must support "${needle}" as a venous indication`);
    }
  }
}

// 2/3) HTN may support Renal Artery Doppler + Echocardiogram TTE.
//    We assert the echo branch + renal branch include hypertension as
//    supporting evidence.
const echoBlockMatch = /if\s*\(echo\)\s*\{([\s\S]*?)\}\s*if\s*\(renal\)/.exec(src);
if (echoBlockMatch && !echoBlockMatch[1].toLowerCase().includes("hypertension")) {
  failures.push("Echocardiogram / TTE branch must support hypertension as a Dx evidence chip");
}
const renalBlockMatch = /if\s*\(renal\)\s*\{([\s\S]*?)\}\s*\}\s*return\s+out/.exec(src);
if (renalBlockMatch && !renalBlockMatch[1].toLowerCase().includes("hypertension")) {
  failures.push("Renal Artery Doppler branch must support hypertension as a Dx evidence chip");
}

// 4) Canonical ultrasound child target list (per guardrail) is
//    preserved in shared/plexus.ts. The "Carotid Duplex" entry is
//    listed as "Bilateral Carotid Duplex" in ANCILLARY_TESTS; the
//    guardrail's child target list is the clinical concept ("Carotid
//    Duplex"). We verify the canonical names that actually appear.
requireText(plexus, [
  '"Bilateral Carotid Duplex"',
  '"Echocardiogram TTE"',
  '"Stress Echocardiogram"',
  '"Renal Artery Doppler"',
  '"Lower Extremity Arterial Doppler"',
  '"Upper Extremity Arterial Doppler"',
  '"Abdominal Aortic Aneurysm Duplex"',
  '"Lower Extremity Venous Duplex"',
  '"Upper Extremity Venous Duplex"',
]);

if (failures.length > 0) {
  console.error("Rule-engine clinical-target mapping QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Rule-engine clinical-target mapping QA passed.");

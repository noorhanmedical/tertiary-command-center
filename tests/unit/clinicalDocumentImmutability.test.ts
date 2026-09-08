// Pure unit test for the signed-clinical-document immutability invariant.
//   npx tsx tests/unit/clinicalDocumentImmutability.test.ts

import {
  isImmutableClinicalDocument,
  IMMUTABLE_CLINICAL_DOCUMENT_KINDS,
} from "../../server/services/documents/clinicalDocumentImmutability";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

// Patient-scoped clinical artifacts → immutable.
for (const kind of ["informed_consent", "report", "clinician_pdf"]) {
  check(`patient-scoped ${kind} is immutable`, isImmutableClinicalDocument({ kind, patientScreeningId: 42 }));
}

// Same kinds WITHOUT a patient (templates) → mutable.
for (const kind of ["informed_consent", "report", "clinician_pdf"]) {
  check(`template ${kind} (no patient) is mutable`, !isImmutableClinicalDocument({ kind, patientScreeningId: null }));
}

// Non-clinical kinds → mutable even when patient-scoped.
for (const kind of ["marketing", "training", "reference", "screening_form", "other"]) {
  check(`${kind} is mutable`, !isImmutableClinicalDocument({ kind, patientScreeningId: 7 }));
}

// Null / undefined document → not immutable (nothing to protect).
check("null document → not immutable", !isImmutableClinicalDocument(null));
check("undefined document → not immutable", !isImmutableClinicalDocument(undefined));

// The canonical kind set is exactly the three clinical artifacts.
check(
  "immutable kind set is {informed_consent, report, clinician_pdf}",
  IMMUTABLE_CLINICAL_DOCUMENT_KINDS.size === 3 &&
    ["informed_consent", "report", "clinician_pdf"].every((k) => IMMUTABLE_CLINICAL_DOCUMENT_KINDS.has(k)),
);

if (failures > 0) {
  console.error(`clinicalDocumentImmutability.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("clinicalDocumentImmutability.test.ts: all tests passed");

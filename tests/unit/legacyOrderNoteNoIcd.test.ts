//
// ICD rule — the legacy note-generation path must NOT embed ICD/CPT codes in
// the Order Note (preProcedureOrder) or Procedure Note (postProcedureNote).
// ICD/CPT belong ONLY in the Billing Document.
//
// The legacy generator (server/services/noteGenerationServer.ts) previously
// appended a `__screening_meta__` section carrying icd10Codes/cptCodes onto
// ALL THREE documents. This guard locks in the fix: the order + procedure
// notes receive an ICD/CPT-FREE meta (selected conditions only), while the
// fully-coded meta is attached to billing alone — for each of BW / VW / US.
//
// Runnable via:
//   npx tsx tests/unit/legacyOrderNoteNoIcd.test.ts

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

const ROOT = process.cwd();
const src = fs.readFileSync(
  path.join(ROOT, "server/services/noteGenerationServer.ts"),
  "utf8",
);

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

// For each service prefix, the order/procedure notes must use the ICD-free
// "<p>OrderExtra" spread, and billing must use the fully-coded "<p>Extra".
for (const p of ["bw", "vw", "us"]) {
  check(`${p}: preProcedureOrder uses ICD-free order meta`, () => {
    assert.ok(
      src.includes(`generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, ...${p}OrderExtra]`),
      `preProcedureOrder must spread ${p}OrderExtra (ICD-free), not ${p}Extra`,
    );
  });
  check(`${p}: postProcedureNote uses ICD-free order meta`, () => {
    assert.ok(
      src.includes(`generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, ...${p}OrderExtra]`),
      `postProcedureNote must spread ${p}OrderExtra (ICD-free), not ${p}Extra`,
    );
  });
  check(`${p}: billing retains the fully-coded meta`, () => {
    assert.ok(
      src.includes(`generated.billing.sections = [...generated.billing.sections, ...${p}Extra]`),
      `billing must spread ${p}Extra (with ICD/CPT)`,
    );
  });
  check(`${p}: the ICD-free order meta carries no icd10/cpt`, () => {
    const re = new RegExp(`const ${p}OrderMetaSection = \\{[^}]*body: JSON\\.stringify\\(\\{([^}]*)\\}\\)`);
    const m = src.match(re);
    assert.ok(m, `${p}OrderMetaSection must be defined`);
    const body = m![1];
    assert.ok(!/icd10Codes/i.test(body), `${p}OrderMetaSection must not include icd10Codes`);
    assert.ok(!/cptCodes/i.test(body), `${p}OrderMetaSection must not include cptCodes`);
  });
}

if (failures > 0) {
  console.error(`legacyOrderNoteNoIcd.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("legacyOrderNoteNoIcd.test.ts: all tests passed");

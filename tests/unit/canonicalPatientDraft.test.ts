import assert from "node:assert/strict";
import { normalizePatientDraft, draftToIdentityInput, isIdentitySensitiveChange } from "../../shared/canonicalPatientDraft";
import { mapHeaderToField } from "../../shared/patientColumnMap";

async function main() {
  // ── normalizePatientDraft: trims, folds empties, combines first/last ──────
  const d1 = normalizePatientDraft({ firstName: "Jane", lastName: "Smith", dob: " 1958-05-14 ", phoneNumber: "" });
  assert.equal(d1.name, "Jane Smith", "first+last combined");
  assert.equal(d1.dob, "1958-05-14", "dob trimmed");
  assert.equal(d1.phoneNumber, null, "empty → null");

  const d2 = normalizePatientDraft({ name: "  Bob Jones ", age: 62, patientType: "Outreach visit" });
  assert.equal(d2.name, "Bob Jones");
  assert.equal(d2.age, 62);
  assert.equal(d2.patientType, "outreach", "patientType normalized (outreach wins)");

  // Never fabricates: absent fields stay null.
  const d3 = normalizePatientDraft({ name: "X Y" });
  assert.equal(d3.mrn, null); assert.equal(d3.insurance, null); assert.equal(d3.dob, null);

  // ── identity projection + sensitivity ─────────────────────────────────────
  const idIn = draftToIdentityInput(normalizePatientDraft({ name: "A B", dob: "1990-01-01", mrn: "M1", facility: "Taylor Family Practice", phoneNumber: "2025550000" }));
  assert.equal(idIn.mrn, "M1");
  assert.equal(isIdentitySensitiveChange(["mrn"]), true);
  assert.equal(isIdentitySensitiveChange(["insurance", "notes"]), false);
  assert.equal(isIdentitySensitiveChange(["dob"]), true);

  // ── column vocabulary: label → canonical field (deterministic mapper) ─────
  assert.equal(mapHeaderToField("Patient Name"), "name");
  assert.equal(mapHeaderToField("Date of Birth"), "dob");
  assert.equal(mapHeaderToField("Medical Record #"), "mrn");
  assert.equal(mapHeaderToField("Account Number"), "mrn", "account number also maps to mrn (this is the ambiguity source)");
  assert.equal(mapHeaderToField("Member ID"), "memberId");
  assert.equal(mapHeaderToField("Carrier"), "insurance");
  assert.equal(mapHeaderToField("Sex"), "gender");
  assert.equal(mapHeaderToField("PMH"), "history");
  assert.equal(mapHeaderToField("Allergies"), "allergies");
  assert.equal(mapHeaderToField("PCP"), "provider");
  assert.equal(mapHeaderToField("random junk column"), null);

  // ── smart-paste deterministic parser (no AI: labeled input) ──────────────
  const { parsePatientDraft } = await import("../../server/services/canonicalPatient/patientDraftParser");

  // 1) clean labeled block → deterministic, correct fields, no fabrication.
  const r1 = await parsePatientDraft(
    "Patient: Jane Smith\nDOB: 1958-05-14\nSex: F\nMedical Record #: 221944\nPhone: 281-555-1000\nCarrier: UnitedHealthcare",
  );
  assert.equal(r1.method, "deterministic", "labeled block parsed without AI");
  assert.equal(r1.draft.name, "Jane Smith");
  assert.equal(r1.draft.dob, "1958-05-14");
  assert.equal(r1.draft.mrn, "221944");
  assert.equal(r1.draft.insurance, "UnitedHealthcare");
  assert.equal(r1.ambiguities.length, 0, "single MRN → no ambiguity");

  // 2) Account # AND Medical Record # both present → MRN ambiguity, NOT guessed.
  const r2 = await parsePatientDraft(
    "Patient: John Roe\nDOB: 1960-02-02\nAccount #: 883912\nMedical Record #: 221944",
  );
  assert.equal(r2.method, "deterministic");
  const mrnAmb = r2.ambiguities.find((a) => a.field === "mrn");
  assert.ok(mrnAmb, "mrn ambiguity surfaced");
  assert.equal(mrnAmb!.candidates.length, 2, "both account# and MRN offered as candidates");
  assert.equal(r2.draft.mrn, null, "MRN not arbitrarily chosen");

  // 3) provider present as its own field → captured as provider, not patient name.
  const r3 = await parsePatientDraft(
    "Patient: Mary Poe\nDOB: 1975-03-03\nPCP: Dr. Alan Grant\nPhone: 555-222-3333",
  );
  assert.equal(r3.draft.name, "Mary Poe", "patient name is the Patient label, not the provider");
  assert.equal(r3.draft.provider, "Dr. Alan Grant");

  console.log("canonicalPatientDraft.test.ts — all assertions passed");
}
main().catch((e) => { console.error(e); process.exit(1); });

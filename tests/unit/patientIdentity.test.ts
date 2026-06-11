import assert from "node:assert/strict";
import {
  buildPatientIdentityIndex,
  buildPatientIdentityKeys,
  explainPatientMatch,
  lookupPatientInIndex,
  matchPatientIdentity,
  normalizeDob,
  normalizeFacility,
  normalizeMrn,
  normalizeName,
  normalizePhone,
} from "../../shared/patientIdentity";

async function main() {
  // Normalizers
  assert.equal(normalizeName(" John   Doe-Smith "), "john doe smith");
  assert.equal(normalizeName(null), "");
  assert.equal(normalizePhone("(202) 555-0101"), "2025550101");
  assert.equal(normalizePhone("+1 202 555 0101"), "2025550101");
  assert.equal(normalizePhone("12025550101"), "2025550101");
  assert.equal(normalizeDob("1980-05-12"), "1980-05-12");
  assert.equal(normalizeDob("5/12/1980"), "1980-05-12");
  assert.equal(normalizeDob("05/12/80"), "2080-05-12");
  assert.equal(normalizeDob("garbage"), "");
  assert.equal(normalizeMrn(" mrn-123_456 "), "MRN123456");
  assert.equal(normalizeFacility(" Plexus  Cary "), "plexus cary");

  // Key builder
  const k = buildPatientIdentityKeys({
    name: "John Doe", facility: "Plexus Cary", mrn: "mrn-123", dob: "1980-05-12", phone: "(202) 555-0101",
  });
  assert.equal(k.facilityMrnDob, "plexus cary|MRN123|1980-05-12");
  assert.equal(k.mrnDob, "MRN123|1980-05-12");
  assert.equal(k.nameDobPhone, "john doe|1980-05-12|2025550101");

  // Tier priority — facility+MRN+DOB beats MRN+DOB which beats name+DOB+phone.
  const left = { name: "John Doe", facility: "Plexus Cary", mrn: "M-1", dob: "1980-05-12", phone: "2025550101" };
  const right = { name: "John Doe", facility: "Plexus Cary", mrn: "M-1", dob: "1980-05-12", phone: "9999999999" };
  const top = matchPatientIdentity(left, right);
  assert.equal(top.matched, true);
  assert.equal(top.tier, "facility_mrn_dob");

  // MRN+DOB tier when facilities differ.
  const t2 = matchPatientIdentity(
    { facility: "Plexus Cary", mrn: "M-1", dob: "1980-05-12" },
    { facility: "Plexus Raleigh", mrn: "m1", dob: "5/12/1980" },
  );
  assert.equal(t2.tier, "mrn_dob");

  // Name+DOB+phone tier when MRN missing.
  const t3 = matchPatientIdentity(
    { name: "Jane Roe", dob: "1985-01-02", phone: "5555555555" },
    { name: "JANE ROE", dob: "1985-01-02", phoneNumber: "(555) 555-5555" },
  );
  assert.equal(t3.tier, "name_dob_phone");

  // No match when only one weak field overlaps.
  const t4 = matchPatientIdentity({ name: "John" }, { name: "John" });
  assert.equal(t4.matched, false);

  // Explain helper renders human-readable string.
  assert.match(explainPatientMatch(top), /Facility \+ MRN \+ DOB/);

  // Index lookup uses the strongest available tier.
  const roster = [
    { id: 1, name: "John Doe", facility: "Plexus Cary", mrn: "M-1", dob: "1980-05-12", phone: "2025550101" },
    { id: 2, name: "Jane Roe", facility: "Plexus Raleigh", mrn: "M-2", dob: "1985-01-02", phone: "5555555555" },
  ];
  const idx = buildPatientIdentityIndex(roster, (r) => r);
  const r1 = lookupPatientInIndex(idx, { mrn: "m-1", dob: "1980-05-12" });
  assert.equal(r1?.row.id, 1);
  assert.equal(r1?.tier, "mrn_dob");
  const r2 = lookupPatientInIndex(idx, { name: "jane roe", dob: "1985-01-02", phone: "5555555555" });
  assert.equal(r2?.row.id, 2);
  const r3 = lookupPatientInIndex(idx, { name: "nobody", dob: "2000-01-01", phone: "1112223333" });
  assert.equal(r3, null);

  console.log("Patient identity helper test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });

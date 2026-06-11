import assert from "node:assert/strict";
import {
  classifyImportRows,
  parseCsv,
  parseTxt,
  selectAllImportRows,
  clearAllImportRows,
  toggleImportRow,
} from "../../client/src/lib/patientDirectoryImport";

const csv = `name,dob,phone,mrn,facility
Jane Doe,1980-05-12,2025550101,M-1,Plexus Cary
John Roe,1975-03-04,5555550000,M-2,Plexus Cary
Jane Doe,1980-05-12,2025550101,M-1,Plexus Cary
Missing Dob,,,,Plexus Cary
`;

async function main() {
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].identity.name, "Jane Doe");
  assert.equal(parsed[0].identity.facility, "Plexus Cary");

  const facts = {
    existing: [{ patientScreeningId: 10, identity: { name: "John Roe", dob: "1975-03-04", phoneNumber: "5555550000", facility: "Plexus Cary", mrn: "M-2" } }],
    dnc: [],
    cooldown: [],
    priorTests: [],
    sentToEngagement: [],
  };
  const rows = classifyImportRows(parsed, facts);
  assert.equal(rows.length, 4);
  // Jane appears twice -> duplicate_in_import
  assert.ok(rows[0].classifications.includes("duplicate_in_import"));
  // John matches existing
  assert.ok(rows[1].classifications.includes("matched_existing"));
  assert.equal(rows[1].matchedExistingId, 10);
  // Missing dob row
  assert.ok(rows[3].classifications.includes("missing_required_fields"));

  // Selection helpers.
  const all = selectAllImportRows(rows);
  assert.ok(all.every((r) => r.selected));
  const none = clearAllImportRows(rows);
  assert.ok(none.every((r) => !r.selected));
  const toggled = toggleImportRow(none, 1);
  assert.equal(toggled[1].selected, true);

  // TXT parsing.
  const txt = parseTxt("Alpha One | 1990-01-01 | 1112223333\nBeta Two | 1985-02-02 | 4445556666");
  assert.equal(txt.length, 2);
  assert.equal(txt[0].identity.name, "Alpha One");
  assert.equal(txt[1].identity.dob, "1985-02-02");

  console.log("Patient Directory import preview test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";

import { detectColumns, normalizeHeader } from "../../shared/patientColumnMap";
import { buildNormalizedRow, validateRow } from "../../shared/patientImportRow";
import {
  parseDelimitedFile,
  parseXlsxFile,
  detectFormat,
} from "../../server/services/largeImport/streamingParsers";
import {
  classifyRows,
  tallyClassifications,
  type ExistingPatientRef,
} from "../../server/services/largeImport/dedupClassifier";
import {
  buildPatientIdentityIndex,
  type PatientIdentityInput,
} from "../../shared/patientIdentity";

const TMP = path.join(os.tmpdir(), "plexus-import-tests");

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const cleanup: string[] = [];

  // ── §1 Column detection — header variants ────────────────────────────────
  {
    const headers = ["Patient Name", "Date of Birth", "Phone", "Sex", "Payer", "Dx", "Rx", "PMH", "MRN", "Clinic", "Referring Provider"];
    const det = detectColumns(headers);
    assert.equal(det.mapping[0], "name", "Patient Name → name");
    assert.equal(det.mapping[1], "dob", "Date of Birth → dob");
    assert.equal(det.mapping[2], "phone", "Phone → phone");
    assert.equal(det.mapping[3], "gender", "Sex → gender");
    assert.equal(det.mapping[4], "insurance", "Payer → insurance");
    assert.equal(det.mapping[5], "diagnoses", "Dx → diagnoses");
    assert.equal(det.mapping[6], "medications", "Rx → medications");
    assert.equal(det.mapping[7], "history", "PMH → history");
    assert.equal(det.mapping[8], "mrn", "MRN → mrn");
    assert.equal(det.mapping[9], "facility", "Clinic → facility");
    assert.equal(det.mapping[10], "provider", "Referring Provider → provider");
    assert.equal(det.ambiguous, false, "has name → not ambiguous");
  }

  // First + Last name split.
  {
    const det = detectColumns(["First Name", "Last Name", "DOB"]);
    assert.equal(det.mapping[0], "firstName");
    assert.equal(det.mapping[1], "lastName");
    assert.equal(det.ambiguous, false, "first+last → not ambiguous");
  }

  // Ambiguous / headerless.
  {
    const det = detectColumns(["col1", "col2", "col3"]);
    assert.equal(det.ambiguous, true, "no name signal → ambiguous");
  }

  assert.equal(normalizeHeader("Date_of-Birth"), "date of birth");

  // ── §2 Row building + validation ─────────────────────────────────────────
  {
    const det = detectColumns(["First Name", "Last Name", "DOB", "Phone", "MRN"]);
    const row = buildNormalizedRow(["Jane", "Roe", "5/12/1980", "(202) 555-0101", "MRN-9"], det.mapping, 1);
    assert.equal(row.name, "Jane Roe", "first+last combined");
    assert.equal(row.dob, "5/12/1980");
    assert.equal(row.mrn, "MRN-9");
    assert.equal(validateRow(row).valid, true);

    const bad = buildNormalizedRow(["", "", "", "", ""], det.mapping, 2);
    assert.equal(validateRow(bad).valid, false, "no name → invalid");

    const provider = buildNormalizedRow(["John Smith, M.D.", "", "", "", ""], detectColumns(["Name"]).mapping, 3);
    // name maps only via first col in this mapping; rebuild with a name mapping:
    const provRow = buildNormalizedRow(["John Smith, M.D."], detectColumns(["Name"]).mapping, 3);
    assert.equal(validateRow(provRow).valid, false, "provider credential → invalid");
    void provider;
  }

  // ── §3 CSV streaming parse ───────────────────────────────────────────────
  {
    const csvPath = path.join(TMP, `${randomUUID()}.csv`);
    cleanup.push(csvPath);
    const lines = ["Name,DOB,Phone,MRN,Insurance"];
    for (let i = 1; i <= 250; i++) {
      lines.push(`Patient ${i},1980-01-${String((i % 28) + 1).padStart(2, "0")},202555${String(1000 + i)},MRN-${i},Medicare`);
    }
    await fsp.writeFile(csvPath, lines.join("\n"), "utf8");

    assert.equal(detectFormat(csvPath), "csv");
    const result = await parseDelimitedFile(csvPath, "csv");
    assert.equal(result.rows.length, 250, "250 CSV rows parsed");
    assert.equal(result.detection.ambiguous, false);
    assert.equal(result.rows[0].name, "Patient 1");
    assert.equal(result.rows[0].mrn, "MRN-1");
    assert.equal(result.rows[249].rowIndex, 250, "rowIndex is 1-based sequential");
  }

  // ── §4 XLSX streaming parse + multi-sheet selection ──────────────────────
  {
    const xlsxPath = path.join(TMP, `${randomUUID()}.xlsx`);
    cleanup.push(xlsxPath);
    const wb = new ExcelJS.Workbook();
    // Decorative first sheet (should NOT be chosen).
    const cover = wb.addWorksheet("Cover");
    cover.addRow(["Report generated", new Date().toISOString()]);
    cover.addRow(["Confidential", "Do not distribute"]);
    // Patient sheet.
    const ws = wb.addWorksheet("Patients");
    ws.addRow(["Patient Name", "DOB", "Phone", "MRN", "Insurance"]);
    for (let i = 1; i <= 120; i++) {
      ws.addRow([`XL Patient ${i}`, "1975-06-15", `303555${1000 + i}`, `X-${i}`, "Aetna"]);
    }
    await wb.xlsx.writeFile(xlsxPath);

    assert.equal(detectFormat(xlsxPath), "xlsx");
    const result = await parseXlsxFile(xlsxPath);
    assert.equal(result.workbookInfo?.chosenSheet, "Patients", "patient-bearing sheet selected over Cover");
    assert.equal(result.workbookInfo?.mediaLoaded, false, "media never loaded");
    assert.equal(result.rows.length, 120, "120 xlsx patient rows");
    assert.equal(result.rows[0].name, "XL Patient 1");
    assert.equal(result.rows[0].mrn, "X-1");
  }

  // ── §5 Dedup classification ──────────────────────────────────────────────
  {
    const existing: ExistingPatientRef[] = [
      { id: 1, name: "Alice Existing", dob: "1990-01-01", mrn: "M-100", facility: "Taylor Family Practice", phone: "2025550001" },
      { id: 2, name: "Bob Weak", dob: "1985-02-02", mrn: null, facility: null, phone: "2025550002" },
    ];
    const idx = buildPatientIdentityIndex<ExistingPatientRef>(existing, (p): PatientIdentityInput => ({
      name: p.name, dob: p.dob, mrn: p.mrn, facility: p.facility, phoneNumber: p.phone,
    }));

    const det = detectColumns(["Name", "DOB", "MRN", "Facility", "Phone"]);
    const rows = [
      buildNormalizedRow(["Alice Existing", "1990-01-01", "M-100", "Taylor Family Practice", "2025550001"], det.mapping, 1), // EXISTING (facility+mrn+dob)
      buildNormalizedRow(["Bob Weak", "1985-02-02", "", "", "2025550002"], det.mapping, 2), // POSSIBLE (name+dob+phone)
      buildNormalizedRow(["Carol New", "2000-03-03", "M-500", "Taylor Family Practice", "2025550003"], det.mapping, 3), // NEW
      buildNormalizedRow(["Carol New", "2000-03-03", "M-500", "Taylor Family Practice", "2025550003"], det.mapping, 4), // dup within file → POSSIBLE
      buildNormalizedRow(["", "", "", "", ""], det.mapping, 5), // INVALID
    ];
    const classified = classifyRows(rows, idx);
    assert.equal(classified[0].classification, "EXISTING_MATCH", "facility+mrn+dob → existing");
    assert.equal(classified[0].matchTier, "facility_mrn_dob");
    assert.equal(classified[1].classification, "POSSIBLE_MATCH", "name+dob+phone → possible");
    assert.equal(classified[2].classification, "NEW", "no match → new");
    assert.equal(classified[3].classification, "POSSIBLE_MATCH", "intra-file dup → possible");
    assert.ok(classified[3].reasons.includes("duplicate_within_file"));
    assert.equal(classified[4].classification, "INVALID", "no name → invalid");

    const counts = tallyClassifications(classified);
    assert.equal(counts.total, 5);
    assert.equal(counts.existing, 1);
    assert.equal(counts.possible, 2);
    assert.equal(counts.new, 1);
    assert.equal(counts.invalid, 1);
    assert.equal(counts.duplicate, 1, "one intra-file duplicate counted");
  }

  // Cleanup temp artifacts.
  for (const p of cleanup) { try { await fsp.unlink(p); } catch { /* gone */ } }

  console.log("largePatientImport.test.ts — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Deterministic regression suite for the Plexus IQ clinical-paste parser.
// Run with: npm run test:plexus-iq-clinical-parser
//
// No DB. No AI. Pure parser assertions over hand-built input fixtures.
// Each test case has a short label and ensures parser output preserves
// long Dx/Hx/Rx text verbatim and never mixes clinical fields.

import {
  parsePlexusIqClinicalImport,
  type PlexusIqClinicalImportRow,
} from "../client/src/lib/plexusIqClinicalImportParser";

let failures = 0;
let passes = 0;

function assert(cond: unknown, msg: string) {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${msg}`);
  }
}

function header(s: string) {
  console.log(`\n--- ${s} ---`);
}

function tab(parts: string[]): string {
  return parts.join("\t");
}

// ─── Case 1: single positional row, no header ─────────────────────────
header("Case 1: single Start/End row, positional");
{
  const text = tab([
    "Start",
    "2026-06-12",
    "09:30",
    "Jane Doe",
    "1950-03-14",
    "76",
    "Female",
    "MRN-123",
    "Hypertension; Type 2 diabetes",
    "HTN x 12y; DM2 x 5y",
    "Metformin 1000mg BID; Losartan 50mg QD",
    "No Record of Plexus Ancillary Screens",
    "Medicare Part A/B",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {
    facility: "NWPG - Spring",
  });
  assert(result.format === "clinical-spreadsheet", "format detected as clinical-spreadsheet");
  assert(result.rows.length === 1, "one row parsed");
  const r = result.rows[0];
  assert(r.name === "Jane Doe", "NAME extracted");
  assert(r.scheduleDate === "2026-06-12", "DATE normalized to ISO");
  assert(r.time === "09:30", "TIME preserved");
  assert(r.dob === "1950-03-14", "DOB normalized");
  assert(r.age === "76", "AGE preserved");
  assert(r.sex === "Female", "SEX preserved");
  assert(r.mrn === "MRN-123", "MRN preserved");
  assert(r.diagnoses === "Hypertension; Type 2 diabetes", "Dx preserved verbatim");
  assert(r.history === "HTN x 12y; DM2 x 5y", "Hx preserved verbatim");
  assert(r.medications === "Metformin 1000mg BID; Losartan 50mg QD", "Rx preserved verbatim");
  assert(r.previousAncillaries === "No Record of Plexus Ancillary Screens", "Ancillaries Completed preserved");
  assert(r.insurance === "Medicare Part A/B", "INSURANCE preserved");
  assert(r.facility === "NWPG - Spring", "facility default applied");
}

// ─── Case 2: header row + two data rows ───────────────────────────────
header("Case 2: header + two rows");
{
  const headerRow = tab([
    "Start",
    "DATE",
    "TIME",
    "NAME",
    "DOB",
    "AGE",
    "SEX",
    "MRN",
    "Dx",
    "Hx",
    "Rx",
    "Ancillaries Completed",
    "INSURANCE",
    "End",
  ]);
  const row1 = tab([
    "Start",
    "06/12/2026",
    "10:00",
    "John Smith",
    "02/02/1948",
    "78",
    "M",
    "X-1",
    "CAD",
    "MI 2019",
    "ASA 81mg",
    "VitalWave 2026-01-04",
    "BCBS",
    "End",
  ]);
  const row2 = tab([
    "Start",
    "06/12/2026",
    "10:30",
    "Maria Garcia",
    "",
    "",
    "F",
    "",
    "Dizziness",
    "",
    "",
    "",
    "Aetna",
    "End",
  ]);
  const text = `${headerRow}\n${row1}\n${row2}`;
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.format === "clinical-spreadsheet", "format detected");
  assert(result.rows.length === 2, "two rows parsed");
  assert(result.rows[0].scheduleDate === "2026-06-12", "US date normalized");
  assert(result.rows[0].dob === "1948-02-02", "US DOB normalized");
  assert(result.rows[1].dob === undefined, "missing DOB tolerated");
  assert(result.rows[1].previousAncillaries === undefined, "missing ancillaries tolerated");
  assert(result.rows[1].name === "Maria Garcia", "second row name");
}

// ─── Case 3: multiline Dx/Hx/Rx cells ─────────────────────────────────
header("Case 3: multiline clinical cells");
{
  const dx = "Hypertension\nType 2 diabetes mellitus\nChronic kidney disease stage 2";
  const hx = "HTN x 15y\nDM2 x 8y\nFamily Hx CAD";
  const rx = "Metformin 1000mg BID\nLosartan 50mg QD\nAtorvastatin 40mg QHS";
  const text = tab([
    "Start",
    "2026-06-12",
    "09:00",
    "Ali Boomaye",
    "1968-05-14",
    "57",
    "Male",
    "ALI-900001",
    dx,
    hx,
    rx,
    "Urinalysis 2026-03-14; VitalWave 2026-02-01",
    "Straight Medicare",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, { facility: "NWPG - Spring" });
  assert(result.rows.length === 1, "one row parsed");
  const r = result.rows[0];
  assert(r.diagnoses === dx, "multiline Dx preserved verbatim");
  assert(r.history === hx, "multiline Hx preserved verbatim");
  assert(r.medications === rx, "multiline Rx preserved verbatim");
  // Ensure no cross-contamination
  assert(
    !(r.history ?? "").includes("Hypertension"),
    "Hx does not contain Dx text",
  );
  assert(
    !(r.medications ?? "").includes("HTN"),
    "Rx does not contain Hx text",
  );
}

// ─── Case 4: missing DOB and ancillaries ──────────────────────────────
header("Case 4: missing DOB and ancillaries");
{
  const text = tab([
    "Start",
    "2026-06-12",
    "11:00",
    "No DOB Patient",
    "",
    "70",
    "F",
    "",
    "Fatigue",
    "",
    "",
    "",
    "Self-pay",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.dob === undefined, "missing DOB returns undefined");
  assert(r.previousAncillaries === undefined, "missing ancillaries returns undefined");
  assert(r.diagnoses === "Fatigue", "Dx extracted with empty siblings");
}

// ─── Case 5: insurance with extra tabs/spaces is preserved ────────────
header("Case 5: insurance whitespace preserved correctly");
{
  // The insurance cell content "  Medicare  Part B  " — extra spaces
  // INSIDE the cell stay; outer ws is trimmed.
  const text = tab([
    "Start",
    "2026-06-12",
    "11:00",
    "Whitespace Test",
    "1950-01-01",
    "75",
    "F",
    "",
    "",
    "",
    "",
    "",
    "  Medicare  Part B  ",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 1, "row parsed");
  assert(
    result.rows[0].insurance === "Medicare  Part B",
    `insurance inner spaces preserved: got ${JSON.stringify(result.rows[0].insurance)}`,
  );
}

// ─── Case 6: "No Record of Plexus Ancillary Screens" tolerated ────────
header("Case 6: 'No Record of Plexus Ancillary Screens' is data, not error");
{
  const text = tab([
    "Start",
    "2026-06-12",
    "11:30",
    "No Record Patient",
    "1948-12-01",
    "78",
    "M",
    "MRN-9",
    "HTN",
    "",
    "",
    "No Record of Plexus Ancillary Screens",
    "Medicare",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 1, "row parsed");
  assert(result.errors.length === 0, "no parser errors");
  assert(
    result.rows[0].previousAncillaries === "No Record of Plexus Ancillary Screens",
    "ancillaries 'no record' text preserved",
  );
}

// ─── Case 7: Multiple rows, default facility/date applied per-row ─────
header("Case 7: multiple rows + defaults applied");
{
  const row1 = tab([
    "Start", "", "09:00", "Patient A", "1950-01-01", "75", "M", "", "", "", "", "", "", "End",
  ]);
  const row2 = tab([
    "Start", "", "09:30", "Patient B", "1955-05-05", "70", "F", "", "", "", "", "", "", "End",
  ]);
  const result = parsePlexusIqClinicalImport(`${row1}\n${row2}`, {
    facility: "NWPG - Spring",
    scheduleDate: "2026-06-12",
  });
  assert(result.rows.length === 2, "two rows parsed");
  assert(
    result.rows.every((r) => r.facility === "NWPG - Spring"),
    "all rows inherit default facility",
  );
  assert(
    result.rows.every((r) => r.scheduleDate === "2026-06-12"),
    "all rows inherit default date when DATE blank",
  );
}

// ─── Case 8: Missing NAME — error not silent insert ───────────────────
header("Case 8: missing NAME yields error, not insert");
{
  const text = tab([
    "Start", "2026-06-12", "09:00", "", "1950-01-01", "75", "M", "", "", "", "", "", "", "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 0, "no rows inserted");
  assert(result.errors.length === 1, "one error reported");
  assert(/missing name/i.test(result.errors[0].reason), "error mentions missing name");
}

// ─── Case 9: Legacy CSV / Start-End-label inputs return 'unknown' ─────
header("Case 9: legacy formats fall through to caller");
{
  // Legacy CSV
  const csv = `facility,date,name,type,time\nNWPG - Spring,2026-06-12,Jane Doe,visit,09:30`;
  const csvResult = parsePlexusIqClinicalImport(csv, {});
  assert(
    csvResult.format === "unknown" && csvResult.rows.length === 0,
    "legacy CSV defers to caller (returns unknown)",
  );

  // Start/End label-block (no tabs anywhere in the marker rows)
  const labelBlock = `Start\nJane Doe\nDOB: 1950-03-14\nDx: HTN\nEnd`;
  const labelResult = parsePlexusIqClinicalImport(labelBlock, {});
  assert(
    labelResult.format === "unknown" && labelResult.rows.length === 0,
    "Start/End label-block defers to caller (returns unknown)",
  );
}

// ─── Case 10: defaults default — scheduleDate default = today ─────────
header("Case 10: scheduleDate falls back to today when undefined");
{
  const text = tab([
    "Start", "", "09:00", "Default Date Patient", "1950-01-01", "75", "M", "", "", "", "", "", "", "End",
  ]);
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 1, "row parsed");
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert(result.rows[0].scheduleDate === iso, `scheduleDate defaulted to today (${iso})`);
}

function summarize(rows: PlexusIqClinicalImportRow[]): string {
  return rows.map((r) => `${r.rowIndex}:${r.name}`).join(", ");
}

console.log(`\n=========================`);
console.log(`PASS ${passes}  FAIL ${failures}`);
console.log(`=========================`);

if (failures > 0) {
  process.exit(1);
}
process.exit(0);

// keep summarize live to avoid unused-export warnings
void summarize;

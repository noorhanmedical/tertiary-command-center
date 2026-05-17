// Deterministic regression suite for the Plexus IQ clinical-paste parser.
// Run with: npm run test:plexus-iq-clinical-parser
//
// No DB. No AI. Pure parser assertions over hand-built input fixtures.
// Each test case has a short label and ensures parser output preserves
// long Dx/Hx/Rx text verbatim and never mixes clinical fields.

import {
  parsePlexusIqClinicalImport,
  normalizeClinicAlias,
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

// ─── Case 10a: two adjacent rows — no Dx/Hx/Rx/Ancillaries cross-bleed ──
header("Case 10a: adjacent rows do not mix Dx/Hx/Rx/Ancillaries");
{
  const r1 = tab([
    "Start",
    "2026-06-12",
    "09:00",
    "Patient One",
    "1950-01-01",
    "75",
    "M",
    "MRN-A",
    "Hypertension",
    "HTN x 10y",
    "Metformin 1000mg",
    "BrainWave 2025-12-01",
    "Medicare",
    "End",
  ]);
  const r2 = tab([
    "Start",
    "2026-06-12",
    "09:30",
    "Patient Two",
    "1955-05-05",
    "70",
    "F",
    "MRN-B",
    "Atrial fibrillation",
    "AFib x 4y",
    "Apixaban 5mg",
    "VitalWave 2025-11-15",
    "BCBS",
    "End",
  ]);
  const result = parsePlexusIqClinicalImport(`${r1}\n${r2}`, {});
  assert(result.rows.length === 2, "two rows parsed");
  const p1 = result.rows[0];
  const p2 = result.rows[1];
  assert(p1.diagnoses === "Hypertension", "p1 Dx clean");
  assert(p2.diagnoses === "Atrial fibrillation", "p2 Dx clean");
  assert(!p1.diagnoses?.includes("Atrial"), "p1 Dx does not contain p2 Dx");
  assert(!p2.diagnoses?.includes("Hypertension"), "p2 Dx does not contain p1 Dx");
  assert(p1.medications === "Metformin 1000mg", "p1 Rx clean");
  assert(p2.medications === "Apixaban 5mg", "p2 Rx clean");
  assert(!p1.medications?.includes("Apixaban"), "p1 Rx does not contain p2 Rx");
  assert(!p2.medications?.includes("Metformin"), "p2 Rx does not contain p1 Rx");
  assert(p1.previousAncillaries === "BrainWave 2025-12-01", "p1 ancillaries clean");
  assert(p2.previousAncillaries === "VitalWave 2025-11-15", "p2 ancillaries clean");
  assert(p1.mrn === "MRN-A" && p2.mrn === "MRN-B", "MRN distinct per row");
  assert(p1.age === "75" && p2.age === "70", "AGE distinct per row");
  assert(p1.sex === "M" && p2.sex === "F", "SEX distinct per row");
}

// ─── Case 10b: 3 rows, middle has multi-line clinical text — outer rows stay clean ──
header("Case 10b: middle row has multi-line clinical cells");
{
  const r1 = tab([
    "Start", "2026-06-12", "09:00", "Alpha", "", "70", "M", "MRN-1",
    "HTN", "HTN x 5y", "Lisinopril", "", "Medicare", "End",
  ]);
  const middleDx = "Hypertension\nType 2 diabetes\nCKD stage 2";
  const middleHx = "HTN x 15y\nDM2 x 8y";
  const middleRx = "Metformin 1000mg BID\nLosartan 50mg";
  const r2 = tab([
    "Start", "2026-06-12", "09:30", "Bravo", "", "72", "F", "MRN-2",
    middleDx, middleHx, middleRx, "BrainWave 2025-01-01", "BCBS", "End",
  ]);
  const r3 = tab([
    "Start", "2026-06-12", "10:00", "Charlie", "", "68", "M", "MRN-3",
    "CAD", "MI 2020", "ASA 81mg", "", "Aetna", "End",
  ]);
  const result = parsePlexusIqClinicalImport(`${r1}\n${r2}\n${r3}`, {});
  assert(result.rows.length === 3, "three rows parsed");
  const [alpha, bravo, charlie] = result.rows;
  assert(alpha.diagnoses === "HTN", "alpha Dx clean (no bravo bleed)");
  assert(charlie.diagnoses === "CAD", "charlie Dx clean (no bravo bleed)");
  assert(bravo.diagnoses === middleDx, "bravo multi-line Dx preserved");
  assert(bravo.history === middleHx, "bravo multi-line Hx preserved");
  assert(bravo.medications === middleRx, "bravo multi-line Rx preserved");
  assert(!alpha.medications?.includes("Metformin"), "alpha Rx unaffected");
  assert(!charlie.medications?.includes("Losartan"), "charlie Rx unaffected");
  assert(alpha.mrn === "MRN-1" && bravo.mrn === "MRN-2" && charlie.mrn === "MRN-3", "MRN preserved across multi-line block");
}

// ─── Case 10c: missing End marker is reported, not silent ─────────
header("Case 10c: missing End marker yields error, not silent partial");
{
  // Two Starts but only one End. The second row is dangling and the
  // parser must report it.
  const orphan = tab([
    "Start", "2026-06-12", "09:00", "Orphan Patient", "", "", "", "", "", "", "", "", "", // no End
  ]);
  const closed = tab([
    "Start", "2026-06-12", "09:30", "Closed Patient", "", "70", "M", "", "HTN", "", "", "", "", "End",
  ]);
  const result = parsePlexusIqClinicalImport(`${closed}\n${orphan}`, {});
  // The parser captures the closed row; the orphan must be reported.
  assert(result.rows.length === 1, "only the closed row is captured");
  assert(result.rows[0].name === "Closed Patient", "closed row name correct");
  assert(
    result.errors.some((e) => /unterminated/i.test(e.reason)),
    "dangling Start surfaced as 'Unterminated' error",
  );
}

// ─── Case 10d: extra blank lines + tabs do not shift columns ──────
header("Case 10d: extra blank lines/tabs do not break alignment");
{
  // Insert blank lines between rows to simulate spreadsheet padding.
  const row = tab([
    "Start", "2026-06-12", "09:00", "Padded Patient", "1950-01-01", "76", "F", "MRN-X",
    "Asthma", "Asthma x 20y", "Albuterol inhaler", "No Record of Plexus Ancillary Screens", "Cigna", "End",
  ]);
  const text = `\n\n\n${row}\n\n\n`;
  const result = parsePlexusIqClinicalImport(text, {});
  assert(result.rows.length === 1, "padded row parsed");
  const r = result.rows[0];
  assert(r.name === "Padded Patient", "name preserved despite padding");
  assert(r.diagnoses === "Asthma", "Dx not shifted by blank lines");
  assert(r.medications === "Albuterol inhaler", "Rx not shifted by blank lines");
  assert(r.previousAncillaries === "No Record of Plexus Ancillary Screens", "ancillaries text preserved");
  assert(r.insurance === "Cigna", "insurance not shifted by blank lines");
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

// ─── Case 11: header-driven, no Start/End, normal order ────────────────
header("Case 11: header-driven without Start/End (normal order)");
{
  const headerRow = tab([
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
  ]);
  const dataRow = tab([
    "2026-06-12",
    "09:30",
    "Header Jane",
    "1950-03-14",
    "76",
    "Female",
    "MRN-A1",
    "Hypertension",
    "HTN x 10y",
    "Metformin 1000mg BID",
    "BrainWave 2025-11-01",
    "Medicare",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.format === "clinical-spreadsheet", "format detected as clinical-spreadsheet");
  assert(result.rows.length === 1, "one row parsed");
  const r = result.rows[0];
  assert(r.name === "Header Jane", "NAME extracted");
  assert(r.diagnoses === "Hypertension", "Dx extracted");
  assert(r.medications === "Metformin 1000mg BID", "Rx extracted");
  assert(r.previousAncillaries === "BrainWave 2025-11-01", "previousAncillaries extracted");
}

// ─── Case 12: header-driven, NAME moved to a later column ───────────
header("Case 12: NAME moved to a later column");
{
  const headerRow = tab([
    "MRN", "DOB", "DATE", "TIME", "AGE", "SEX", "NAME", "Dx", "Hx", "Rx",
    "Ancillaries Completed", "INSURANCE",
  ]);
  const dataRow = tab([
    "MRN-B2", "1955-05-05", "2026-06-12", "10:00", "70", "F",
    "Late Name Lila", "Atrial fibrillation", "AFib x 4y", "Apixaban 5mg",
    "VitalWave 2025-11-15", "BCBS",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.name === "Late Name Lila", "NAME picked from later position");
  assert(r.mrn === "MRN-B2", "MRN picked from first column");
  assert(r.diagnoses === "Atrial fibrillation", "Dx still correct");
  assert(r.medications === "Apixaban 5mg", "Rx still correct");
}

// ─── Case 13: header-driven, Dx/Hx/Rx shuffled ──────────────────────
header("Case 13: Dx/Hx/Rx columns shuffled");
{
  const headerRow = tab([
    "DATE", "TIME", "NAME", "Rx", "Hx", "Dx", "DOB",
    "Ancillaries Completed", "INSURANCE",
  ]);
  const dataRow = tab([
    "2026-06-12", "11:00", "Shuffle Sam",
    "Atorvastatin 40mg", "Diet-controlled HTN", "Hyperlipidemia",
    "1948-02-02", "BrainWave 2025-10-01", "Aetna",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.diagnoses === "Hyperlipidemia", "Dx mapped by header");
  assert(r.history === "Diet-controlled HTN", "Hx mapped by header");
  assert(r.medications === "Atorvastatin 40mg", "Rx mapped by header");
  assert(!r.diagnoses?.includes("Atorvastatin"), "Dx does not contain Rx text");
  assert(!r.medications?.includes("Hyperlipidemia"), "Rx does not contain Dx text");
}

// ─── Case 14: extra irrelevant columns are ignored ──────────────────
header("Case 14: extra irrelevant columns ignored");
{
  const headerRow = tab([
    "Foo", "DATE", "Bar", "NAME", "Dx", "Hx", "Rx", "Baz", "INSURANCE",
  ]);
  const dataRow = tab([
    "junk1", "2026-06-12", "junk2", "Extra Cols Patient", "HTN", "HTN x 5y",
    "Lisinopril", "junk3", "Medicare",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 1, "row parsed");
  assert(result.rows[0].name === "Extra Cols Patient", "NAME correct");
  assert(result.rows[0].diagnoses === "HTN", "Dx correct");
  assert(result.rows[0].insurance === "Medicare", "insurance correct");
}

// ─── Case 15: missing optional DOB/Ancillaries ──────────────────────
header("Case 15: optional DOB and Ancillaries missing");
{
  const headerRow = tab(["DATE", "NAME", "Dx", "Hx", "Rx", "INSURANCE"]);
  const dataRow = tab(["2026-06-12", "No DOB Patient", "Fatigue", "", "", "Self-pay"]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.dob === undefined, "DOB undefined when column absent");
  assert(r.previousAncillaries === undefined, "Ancillaries undefined when column absent");
  assert(r.diagnoses === "Fatigue", "Dx still preserved");
}

// ─── Case 16: header aliases (Patient Name / Diagnoses / Medications / Previous Screens) ─
header("Case 16: alternate header aliases");
{
  const headerRow = tab([
    "Appointment Date", "Patient Name", "Date of Birth", "Diagnoses",
    "Medical History", "Medications", "Previous Screens", "Primary Insurance",
  ]);
  const dataRow = tab([
    "06/12/2026", "Alias Alice", "01/15/1955", "COPD", "Smoker 30 pack-yrs",
    "Albuterol", "VitalWave 2025-10-01", "Humana",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.name === "Alias Alice", "Patient Name → NAME");
  assert(r.scheduleDate === "2026-06-12", "Appointment Date → DATE (normalized)");
  assert(r.dob === "1955-01-15", "Date of Birth → DOB (normalized)");
  assert(r.diagnoses === "COPD", "Diagnoses → Dx");
  assert(r.history === "Smoker 30 pack-yrs", "Medical History → Hx");
  assert(r.medications === "Albuterol", "Medications → Rx");
  assert(r.previousAncillaries === "VitalWave 2025-10-01", "Previous Screens → Ancillaries Completed");
  assert(r.insurance === "Humana", "Primary Insurance → INSURANCE");
}

// ─── Case 17: missing NAME yields visible row error ──────────────────
header("Case 17: missing NAME in header-driven row");
{
  const headerRow = tab(["DATE", "NAME", "Dx", "Hx", "Rx"]);
  const dataRow = tab(["2026-06-12", "", "HTN", "HTN x 5y", "Lisinopril"]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${dataRow}`, {});
  assert(result.rows.length === 0, "no row inserted");
  assert(result.errors.length === 1, "one error reported");
  assert(/missing name/i.test(result.errors[0].reason), "error mentions missing NAME");
}

// ─── Case 18: unquoted ambiguous multiline produces visible error ────
header("Case 18: ambiguous multiline (unquoted) reports an error");
{
  // Header row promises 6 cells per row; the data row spans two physical
  // lines without quotes, so the second line under-fills. Parser should
  // emit a structured error rather than silently mis-assemble.
  const headerRow = tab(["DATE", "NAME", "Dx", "Hx", "Rx", "INSURANCE"]);
  const dataRow1 = tab(["2026-06-12", "Ambig Pat", "HTN", "HTN x 5y", "Lisinopril", "Medicare"]);
  const orphanFragment = "extra fragment without delimiters";
  const result = parsePlexusIqClinicalImport(
    `${headerRow}\n${dataRow1}\n${orphanFragment}`,
    {},
  );
  // The first complete data row should parse; the fragment should error.
  assert(result.rows.length === 1, "complete row still parses");
  assert(
    result.errors.some((e) => /multiline clinical cells/i.test(e.reason)),
    "ambiguous fragment surfaces a multiline-cells error",
  );
}

// ─── Case 19: header-driven adjacent rows do not cross-contaminate ──
header("Case 19: header-driven adjacent rows do not mix Dx/Hx/Rx");
{
  const headerRow = tab([
    "DATE", "TIME", "NAME", "Dx", "Hx", "Rx", "Ancillaries Completed", "INSURANCE",
  ]);
  const row1 = tab([
    "2026-06-12", "09:00", "Patient One",
    "Hypertension", "HTN x 10y", "Metformin 1000mg",
    "BrainWave 2025-12-01", "Medicare",
  ]);
  const row2 = tab([
    "2026-06-12", "09:30", "Patient Two",
    "Atrial fibrillation", "AFib x 4y", "Apixaban 5mg",
    "VitalWave 2025-11-15", "BCBS",
  ]);
  const result = parsePlexusIqClinicalImport(`${headerRow}\n${row1}\n${row2}`, {});
  assert(result.rows.length === 2, "two rows parsed");
  const [p1, p2] = result.rows;
  assert(p1.diagnoses === "Hypertension" && p2.diagnoses === "Atrial fibrillation", "Dx isolated");
  assert(p1.medications === "Metformin 1000mg" && p2.medications === "Apixaban 5mg", "Rx isolated");
  assert(p1.previousAncillaries === "BrainWave 2025-12-01" && p2.previousAncillaries === "VitalWave 2025-11-15", "ancillaries isolated");
  assert(!p1.medications?.includes("Apixaban") && !p2.medications?.includes("Metformin"), "no cross-contamination");
}

// ─── Case 20: Start/End still parses (regression check) ─────────────
header("Case 20: Start/End still parses after header-driven path lands");
{
  const r1 = tab([
    "Start", "2026-06-12", "09:00", "Start End Survivor", "1950-01-01", "75",
    "M", "MRN-S", "HTN", "HTN x 5y", "Lisinopril", "", "Medicare", "End",
  ]);
  const result = parsePlexusIqClinicalImport(r1, {});
  assert(result.format === "clinical-spreadsheet", "Start/End detected");
  assert(result.rows.length === 1, "row parsed");
  assert(result.rows[0].name === "Start End Survivor", "name picked from Start/End row");
}

// ─── Case 21: clinic-first new header format ──────────────────────────
header("Case 21: clinic-first format with Clinic / Clinician / Patient Type");
{
  const head = tab([
    "Clinic", "Clinician", "Patient Type", "Patient Name", "Patient ID",
    "Date Added", "DOB", "Age", "Sex", "Phone Number", "Email",
    "Insurance", "Appointment Date", "Appointment Time", "Hx", "Dx", "Rx",
  ]);
  const row = tab([
    "TFP", "Taylor, Jill, DO", "Visit", "Jane Doe", "ABC-123",
    "05/15/2026", "1950-03-14", "76", "F", "(602) 555-0188",
    "jane@example.com", "Medicare", "05/19/2026", "8:00 AM",
    "HTN x 10y", "Hypertension", "Metformin 500mg BID",
  ]);
  const result = parsePlexusIqClinicalImport(`${head}\n${row}`, {});
  assert(result.format === "clinical-spreadsheet", "format detected");
  assert(result.rows.length === 1, "row parsed");
  const r = result.rows[0];
  assert(r.facility === "Taylor Family Practice", "TFP → Taylor Family Practice");
  assert(r.clinician === "Taylor, Jill, DO", "clinician extracted");
  assert(r.patientType === "visit", "Visit → visit");
  assert(r.name === "Jane Doe", "name");
  assert(r.mrn === "ABC-123", "Patient ID → MRN");
  assert(r.dob === "1950-03-14", "DOB preserved");
  assert(r.phone === "(602) 555-0188", "phone preserved");
  assert(r.email === "jane@example.com", "email preserved");
  assert(r.scheduleDate === "2026-05-19", "Appointment Date normalized to ISO");
  assert(r.time === "8:00 AM", "Appointment Time preserved");
  assert(r.diagnoses === "Hypertension", "Dx");
  assert(r.history === "HTN x 10y", "Hx");
  assert(r.medications === "Metformin 500mg BID", "Rx");
  assert((r.warnings ?? []).length === 0, "no warnings when DOB+phone present");
}

// ─── Case 22: clinic column overrides default facility ─────────────────
header("Case 22: per-row Clinic column overrides default facility");
{
  const head = tab(["Clinic", "Patient Name", "Dx"]);
  const r1 = tab(["TFP", "Patient One", "HTN"]);
  const r2 = tab(["NWPG Spring", "Patient Two", "DM2"]);
  const result = parsePlexusIqClinicalImport(`${head}\n${r1}\n${r2}`, {
    facility: "Should be overridden",
  });
  assert(result.rows.length === 2, "two rows");
  assert(result.rows[0].facility === "Taylor Family Practice", "row 1 → TFP canonical");
  assert(result.rows[1].facility === "NWPG - Spring", "row 2 → NWPG - Spring canonical");
}

// ─── Case 23: missing DOB is a warning, not a fatal error ─────────────
header("Case 23: missing DOB warns, row still parses");
{
  const head = tab(["Clinic", "Patient Name", "Dx", "DOB"]);
  const row = tab(["TFP", "No DOB Patient", "Asthma", ""]);
  const result = parsePlexusIqClinicalImport(`${head}\n${row}`, {});
  assert(result.rows.length === 1, "row parsed");
  assert(result.errors.length === 0, "no fatal errors");
  const r = result.rows[0];
  assert(r.dob === undefined, "dob undefined");
  assert((r.warnings ?? []).some((w) => /missing dob/i.test(w)), "missing DOB warning");
}

// ─── Case 24: missing phone is a warning, not a fatal error ──────────
header("Case 24: missing phone warns, row still parses");
{
  const head = tab(["Clinic", "Patient Name", "Dx", "Phone Number"]);
  const row = tab(["TFP", "No Phone Patient", "CAD", ""]);
  const result = parsePlexusIqClinicalImport(`${head}\n${row}`, {});
  assert(result.rows.length === 1, "row parsed");
  assert(result.errors.length === 0, "no fatal errors");
  const r = result.rows[0];
  assert(r.phone === undefined, "phone undefined");
  assert((r.warnings ?? []).some((w) => /phone/i.test(w)), "missing phone warning");
}

// ─── Case 25: missing DOB + phone both warn, row still parses ─────────
header("Case 25: missing DOB + phone — both warn, no fatal error");
{
  const head = tab(["Clinic", "Patient Name", "Dx", "DOB", "Phone Number"]);
  const row = tab(["TFP", "Missing Both", "AFib", "", ""]);
  const result = parsePlexusIqClinicalImport(`${head}\n${row}`, {});
  assert(result.rows.length === 1, "row parsed");
  assert(result.errors.length === 0, "no fatal errors");
  assert((result.rows[0].warnings ?? []).length === 2, "two warnings");
}

// ─── Case 26: normalizeClinicAlias direct ─────────────────────────────
header("Case 26: normalizeClinicAlias coverage");
{
  assert(normalizeClinicAlias("TFP") === "Taylor Family Practice", "TFP");
  assert(normalizeClinicAlias("tfp") === "Taylor Family Practice", "case-insensitive");
  assert(normalizeClinicAlias("  taylor  ") === "Taylor Family Practice", "alias whitespace trimmed");
  assert(normalizeClinicAlias("NWPG Spring") === "NWPG - Spring", "NWPG Spring");
  assert(normalizeClinicAlias("NWPG - Veterans") === "NWPG - Veterans", "canonical passthrough");
  assert(normalizeClinicAlias("Unknown Clinic") === "Unknown Clinic", "unknown passes through");
  assert(normalizeClinicAlias("") === undefined, "empty → undefined");
  assert(normalizeClinicAlias(null) === undefined, "null → undefined");
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

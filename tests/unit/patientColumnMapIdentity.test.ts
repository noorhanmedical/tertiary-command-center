// P0 parser identity separation — MRN vs Patient ID / External ID, MRI safety,
// and identity-conflict review. Pure, no DB/AI.
//
// Runnable via: npx tsx tests/unit/patientColumnMapIdentity.test.ts

import assert from "node:assert/strict";
import { detectColumns, mapHeaderToField } from "../../shared/patientColumnMap";
import { buildNormalizedRow } from "../../shared/patientImportRow";

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.equal(cond, true, msg);
  passed += 1;
};

// Helper: field for a single header.
const f = (h: string) => mapHeaderToField(h);

// ── CASE A — MRN only ────────────────────────────────────────────────────
{
  const det = detectColumns(["Name", "DOB", "MRN"]);
  ok(det.mapping[2] === "mrn", "A: MRN → mrn");
  ok(!det.identityReviewRequired, "A: no identity review");
  const row = buildNormalizedRow(["Jane Roe", "1980-01-01", "MRN-9"], det.mapping, 1);
  ok(row.mrn === "MRN-9" && row.patientId === null, "A: mrn preserved, no patientId");
}

// ── CASE B — Patient ID only (must NOT become MRN) ───────────────────────
{
  const det = detectColumns(["Name", "DOB", "Patient ID"]);
  ok(det.mapping[2] === "patientId", "B: Patient ID → patientId (NOT mrn)");
  ok(!Object.values(det.mapping).includes("mrn"), "B: no mrn mapping");
  const row = buildNormalizedRow(["Jane Roe", "1980-01-01", "PID-42"], det.mapping, 1);
  ok(row.patientId === "PID-42" && row.mrn === null, "B: patientId preserved, mrn null");
}

// ── CASE C — MRN + Patient ID → both preserved separately ────────────────
{
  const det = detectColumns(["Name", "MRN", "Patient ID"]);
  ok(det.mapping[1] === "mrn" && det.mapping[2] === "patientId", "C: both mapped distinctly");
  ok(!det.identityReviewRequired, "C: no conflict (distinct fields)");
  const row = buildNormalizedRow(["Jane Roe", "MRN-1", "PID-2"], det.mapping, 1);
  ok(row.mrn === "MRN-1" && row.patientId === "PID-2", "C: both values preserved");
}

// ── CASE D — Patient ID column BEFORE MRN → true MRN still becomes mrn ────
{
  const det = detectColumns(["Name", "Patient ID", "MRN"]);
  ok(det.mapping[1] === "patientId", "D: Patient ID → patientId");
  ok(det.mapping[2] === "mrn", "D: true MRN still → mrn regardless of order");
  const row = buildNormalizedRow(["Jane Roe", "PID-2", "MRN-1"], det.mapping, 1);
  ok(row.mrn === "MRN-1" && row.patientId === "PID-2", "D: MRN not overwritten by earlier Patient ID");
}

// ── CASE E — MRI + MRN + Patient ID → MRI never affects identity ─────────
{
  const det = detectColumns(["Name", "MRI", "MRN", "Patient ID"]);
  ok(det.mapping[1] !== "mrn" && det.mapping[1] !== "patientId", "E: MRI is NOT an identity field");
  ok(det.mapping[2] === "mrn", "E: MRN → mrn");
  ok(det.mapping[3] === "patientId", "E: Patient ID → patientId");
}

// ── CASE F — two conflicting true MRN columns → review, no silent pick ────
{
  const det = detectColumns(["Name", "MRN", "Medical Record Number"]);
  ok(det.identityReviewRequired === true, "F: identityReviewRequired set");
  ok((det.identityConflicts ?? []).some((c) => c.field === "mrn"), "F: conflict recorded for mrn");
  // First stays mapped; the SECOND is NOT silently swallowed as a real field —
  // it is surfaced as a conflict (and left unmapped) rather than guessed.
  ok(det.mapping[1] === "mrn", "F: first MRN mapped");
  ok(!Object.prototype.hasOwnProperty.call(det.mapping, 2), "F: second MRN NOT silently mapped");
  ok((det.unmapped ?? []).some((u) => u.index === 2), "F: second MRN surfaced (unmapped + conflict)");
}

// ── CASE G — External ID + MRN → both preserved ──────────────────────────
{
  const det = detectColumns(["Name", "External ID", "MRN"]);
  ok(det.mapping[1] === "patientId", "G: External ID → patientId");
  ok(det.mapping[2] === "mrn", "G: MRN → mrn");
  ok(!det.identityReviewRequired, "G: no conflict");
}

// ── MRI regression — headers that must NEVER map to MRN or patientId ─────
{
  for (const h of ["MRI", "MRI Result", "MRI Study ID", "Imaging ID", "MRI Report"]) {
    const field = f(h);
    ok(field !== "mrn", `MRI-regression: "${h}" must not map to mrn (got ${field})`);
    ok(field !== "patientId", `MRI-regression: "${h}" must not map to patientId (got ${field})`);
  }
  // And MRN itself still resolves.
  ok(f("MRN") === "mrn", "MRN still resolves to mrn");
  ok(f("Medical Record Number") === "mrn", "Medical Record Number → mrn");
}

// ── Account / Chart / EMR ID no longer collapse into MRN ─────────────────
{
  for (const h of ["Account Number", "Chart Number", "EMR ID"]) {
    ok(f(h) !== "mrn", `"${h}" must not be mrn`);
    ok(f(h) === "patientId", `"${h}" → patientId`);
  }
  // Bare "Account" is ambiguous (could be billing) — the only hard requirement
  // is that it is NEVER treated as an MRN.
  ok(f("Account") !== "mrn", `bare "Account" must not be mrn`);
}

console.log(`patientColumnMapIdentity.test.ts: all ${passed} assertions passed`);

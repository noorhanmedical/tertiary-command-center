// Unit tests for the structured bulk-import preview: MRI/MRN/Patient ID
// separation, preview payload identity, ready-only import semantics,
// remove-selected / remove-invalid exclusion + reconciliation, and the
// post-import Plexus IQ progress counts (a failed analysis is Failed, never
// Not Qualified). All assertions use the SHARED PURE functions so no DB is
// needed.

import assert from "node:assert/strict";

import { detectColumns } from "../../shared/patientColumnMap";
import { buildNormalizedRow } from "../../shared/patientImportRow";
import {
  classifyRows,
  toPreviewRow,
  type ExistingPatientRef,
} from "../../server/services/largeImport/dedupClassifier";
import {
  buildPatientIdentityIndex,
  type PatientIdentityInput,
} from "../../shared/patientIdentity";
import {
  reconcileImportCounts,
  tallyRemovedByClass,
  invalidRowIndexes,
  addToExcluded,
  removeFromExcluded,
  isRowImportable,
  summarizeIqScreenings,
  isAnalysisFailure,
  iqPhaseFromJob,
  type PreviewClassification,
} from "../../shared/patientImportPreview";

function main() {
  // ── §1 MRI never maps to MRN or Patient ID ───────────────────────────────
  {
    const headers = ["Name", "MRN", "Patient ID", "MRI", "MRI Date", "MRI Completed", "MRI Brain"];
    const det = detectColumns(headers);
    // Real identity columns map distinctly.
    assert.equal(det.mapping[1], "mrn", "MRN → mrn");
    assert.equal(det.mapping[2], "patientId", "Patient ID → patientId");
    // No MRI-flavored column may ever be treated as an identity field.
    for (const idx of [3, 4, 5, 6]) {
      assert.notEqual(det.mapping[idx], "mrn", `"${headers[idx]}" must NOT map to mrn`);
      assert.notEqual(det.mapping[idx], "patientId", `"${headers[idx]}" must NOT map to patientId`);
    }
    // Even standalone (no MRN/Patient ID present) MRI is not coerced to MRN.
    const solo = detectColumns(["Name", "MRI"]);
    assert.notEqual(solo.mapping[1], "mrn", "standalone MRI must NOT map to mrn");
    assert.notEqual(solo.mapping[1], "patientId", "standalone MRI must NOT map to patientId");
  }

  // ── §2 MRN vs Patient ID stay separate in detection AND normalized row ────
  {
    const det = detectColumns(["Name", "DOB", "MRN", "Patient ID", "Insurance"]);
    assert.equal(det.mapping[2], "mrn");
    assert.equal(det.mapping[3], "patientId");
    assert.notEqual(det.mapping[2], det.mapping[3], "mrn and patientId are distinct fields");

    const row = buildNormalizedRow(["Jane Roe", "1980-05-12", "MRN-100", "EXT-999", "Medicare"], det.mapping, 1);
    assert.equal(row.mrn, "MRN-100", "MRN preserved on normalized row");
    assert.equal(row.patientId, "EXT-999", "Patient ID preserved distinctly on normalized row");
    assert.notEqual(row.mrn, row.patientId, "MRN and Patient ID never collapse");
  }

  // ── §3 Preview builder includes patientId; possible-match carries it ──────
  {
    const existing: ExistingPatientRef[] = [
      { id: 10, name: "Weak Match", dob: "1985-02-02", mrn: null, facility: null, phone: "2025550002" },
    ];
    const idx = buildPatientIdentityIndex<ExistingPatientRef>(existing, (p): PatientIdentityInput => ({
      name: p.name, dob: p.dob, mrn: p.mrn, facility: p.facility, phoneNumber: p.phone,
    }));
    const det = detectColumns(["Name", "DOB", "MRN", "Patient ID", "Phone"]);
    const rows = [
      buildNormalizedRow(["New Person", "2000-01-01", "MRN-1", "EXT-1", "2025550111"], det.mapping, 1), // NEW
      buildNormalizedRow(["Weak Match", "1985-02-02", "", "EXT-77", "2025550002"], det.mapping, 2), // POSSIBLE
    ];
    const classified = classifyRows(rows, idx);
    const preview = classified.map(toPreviewRow);

    assert.ok("patientId" in preview[0], "preview row exposes patientId");
    assert.equal(preview[0].patientId, "EXT-1", "preview patientId preserved");
    assert.equal(preview[0].mrn, "MRN-1", "preview mrn preserved");
    assert.notEqual(preview[0].patientId, preview[0].mrn, "preview keeps mrn and patientId separate");

    const possible = classified.find((c) => c.classification === "POSSIBLE_MATCH");
    assert.ok(possible, "a possible match is detected");
    assert.equal(possible!.row.patientId, "EXT-77", "possible-match incoming carries patientId");
  }

  // ── §4 Ready-only import semantics (INVALID + unresolved POSSIBLE never) ──
  {
    assert.equal(isRowImportable("NEW", undefined), true, "NEW imports");
    assert.equal(isRowImportable("INVALID", undefined), false, "INVALID never imports");
    assert.equal(isRowImportable("EXISTING_MATCH", undefined), false, "EXISTING never imports");
    assert.equal(isRowImportable("POSSIBLE_MATCH", undefined), false, "unresolved POSSIBLE never imports");
    assert.equal(isRowImportable("POSSIBLE_MATCH", "use_existing"), false, "use_existing POSSIBLE never imports");
    assert.equal(isRowImportable("POSSIBLE_MATCH", "import_as_new"), true, "import_as_new POSSIBLE imports");
    assert.equal(isRowImportable("POSSIBLE_MATCH", "skip"), false, "skipped POSSIBLE never imports");
    assert.equal(isRowImportable("NEW", "skip"), false, "a removed READY row is excluded");
  }

  // ── §5 remove-invalid / remove-selected excluded set + reconciliation ─────
  {
    const rows: Array<{ rowIndex: number; classification: PreviewClassification }> = [
      { rowIndex: 1, classification: "NEW" },
      { rowIndex: 2, classification: "INVALID" },
      { rowIndex: 3, classification: "POSSIBLE_MATCH" },
      { rowIndex: 4, classification: "NEW" },
      { rowIndex: 5, classification: "INVALID" },
    ];

    // Remove Invalid → exactly the invalid indexes.
    const inv = invalidRowIndexes(rows).sort((a, b) => a - b);
    assert.deepEqual(inv, [2, 5], "invalidRowIndexes picks only INVALID rows");

    let excluded = addToExcluded(new Set<number>(), inv);
    // Remove Selected → user also removes one READY row (rowIndex 1).
    excluded = addToExcluded(excluded, [1]);
    assert.equal(excluded.size, 3);

    const classOf = new Map<number, PreviewClassification>(rows.map((r) => [r.rowIndex, r.classification]));
    const removedByClass = tallyRemovedByClass(excluded, classOf);
    assert.equal(removedByClass.INVALID, 2, "two invalid removed");
    assert.equal(removedByClass.NEW, 1, "one ready removed");

    const counts = { total: 5, new: 2, existing: 0, possible: 1, invalid: 2 };
    const rec = reconcileImportCounts(counts, removedByClass);
    assert.equal(rec.parsed, 5);
    assert.equal(rec.ready, 1, "ready = 2 NEW - 1 removed");
    assert.equal(rec.invalid, 0, "invalid = 2 - 2 removed");
    assert.equal(rec.possible, 1);
    assert.equal(rec.existing, 0);
    assert.equal(rec.removed, 3);
    assert.equal(rec.balanced, true, "parsed = ready + existing + possible + invalid + removed");
    assert.equal(rec.ready + rec.existing + rec.possible + rec.invalid + rec.removed, rec.parsed);

    // Restoring a row rebalances without going negative.
    const restored = removeFromExcluded(excluded, [1]);
    const rec2 = reconcileImportCounts(counts, tallyRemovedByClass(restored, classOf));
    assert.equal(rec2.ready, 2, "restored READY row is importable again");
    assert.equal(rec2.removed, 2);
    assert.equal(rec2.balanced, true);
  }

  // ── §6 A failed IQ analysis is Failed, NEVER Not Qualified ────────────────
  {
    const screenings = [
      { status: "completed", qualifyingTests: ["MRI Brain"], reasoning: {} }, // qualified
      { status: "completed", qualifyingTests: [], reasoning: {} }, // not qualified
      { status: "error", qualifyingTests: [], reasoning: { __analysisError: { message: "boom" } } }, // failed
      { status: "completed", qualifyingTests: [], reasoning: { __analysisFailure: { category: "ai_error" } } }, // failed (sentinel wins)
      { status: "draft", qualifyingTests: [], reasoning: {} }, // pending
    ];
    const s = summarizeIqScreenings(screenings);
    assert.equal(s.total, 5);
    assert.equal(s.qualified, 1, "one qualified");
    assert.equal(s.notQualified, 1, "one not qualified");
    assert.equal(s.failed, 2, "two failed (status error + sentinel)");
    assert.equal(s.pending, 1, "one pending");
    // The sentinel-carrying completed row must NOT inflate notQualified.
    assert.equal(s.notQualified, 1, "a failed analysis is not counted as Not Qualified");

    assert.equal(isAnalysisFailure({ status: "error" }), true);
    assert.equal(isAnalysisFailure({ status: "completed", reasoning: { __analysisFailure: {} } }), true);
    assert.equal(isAnalysisFailure({ status: "completed", qualifyingTests: [] }), false);
  }

  // ── §7 IQ phase mapping ───────────────────────────────────────────────────
  {
    assert.equal(iqPhaseFromJob(null), "not_started");
    assert.equal(iqPhaseFromJob({ status: "running", completedPatients: 0, totalPatients: 10 }), "queued");
    assert.equal(iqPhaseFromJob({ status: "running", completedPatients: 3, totalPatients: 10 }), "running");
    assert.equal(iqPhaseFromJob({ status: "completed" }), "complete");
    assert.equal(iqPhaseFromJob({ status: "failed" }), "failed");
  }

  console.log("patientImportPreview.test.ts — all assertions passed");
}

main();

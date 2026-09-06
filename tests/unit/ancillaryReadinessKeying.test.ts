// Focused regression tests for the ancillary readiness OWNERSHIP rules.
//
// Runs standalone (no live DB) with:
//   npx tsx tests/unit/ancillaryReadinessKeying.test.ts
//
// Exercises the pure key/scope resolution that buildAncillaryReadinessSummaries
// uses, plus the dated guard (readinessCountsForSchedule), composed exactly as
// the resolver composes them. Each test maps to a numbered case from the spec.

import assert from "node:assert/strict";
import {
  buildReadinessIndex,
  resolveReadinessRow,
  consentScopeForCategory,
  readinessUpsertKey,
  type IndexableReadinessRow,
  type ResolvableAncillaryRow,
  type ResolutionScope,
} from "../../server/services/ancillary/ancillaryReadinessKeying";
import { readinessCountsForSchedule } from "../../server/services/ancillary/ancillaryReadinessRules";
import { getAncillaryCategory } from "../../shared/ancillaryCategory";

const CONSENT = "informed_consent";
const SCREENING = "screening_form";
const REPORT = "report";
const BRAINWAVE_PDF = "brainwave_pdf";

// A persisted readiness row, as case_document_readiness would hold it.
type Row = IndexableReadinessRow & {
  documentStatus: string;
  completedAt?: string | null;
};

function row(r: {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  ancillaryCaseId?: number | null; // stamped into metadata by the write path
  serviceType: string;
  documentType: string;
  documentStatus?: string;
  completedAt?: string | null;
}): Row {
  return {
    executionCaseId: r.executionCaseId ?? null,
    patientScreeningId: r.patientScreeningId ?? null,
    serviceType: r.serviceType,
    documentType: r.documentType,
    documentStatus: r.documentStatus ?? "completed",
    completedAt: r.completedAt ?? null,
    metadata: r.ancillaryCaseId != null ? { ancillaryCaseId: r.ancillaryCaseId } : {},
  };
}

// Compose resolution + dated guard exactly as the resolver does
// (completedOnOrAfterScheduled → readinessCountsForSchedule).
function stateOf(
  rows: Row[],
  occ: ResolvableAncillaryRow,
  docType: string,
  scope: ResolutionScope,
  scheduledDate: string | null = null,
): "complete" | "missing" {
  const idx = buildReadinessIndex(rows);
  const found = resolveReadinessRow(idx, occ, docType, scope);
  const completedAtIso = found?.completedAt ? new Date(found.completedAt).toISOString() : null;
  return readinessCountsForSchedule(found?.documentStatus, completedAtIso, scheduledDate)
    ? "complete"
    : "missing";
}

// Consent uses the resolver's category-driven scope selection.
function consentState(rows: Row[], occ: ResolvableAncillaryRow, scheduledDate: string | null = null) {
  const scope = consentScopeForCategory(getAncillaryCategory(occ.serviceType ?? ""));
  return stateOf(rows, occ, CONSENT, scope, scheduledDate);
}

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ── 1. BrainWave consent — different visits (executionCases) ───────────────
check("1: BrainWave consent does not carry across visits", () => {
  const rows = [
    row({ executionCaseId: 10, ancillaryCaseId: 101, serviceType: "BrainWave", documentType: CONSENT }),
  ];
  const a: ResolvableAncillaryRow = { executionCaseId: 10, ancillaryCaseId: 101, serviceType: "BrainWave" };
  const b: ResolvableAncillaryRow = { executionCaseId: 20, ancillaryCaseId: 201, serviceType: "BrainWave" };
  assert.equal(consentState(rows, a), "complete");
  assert.equal(consentState(rows, b), "missing");
});

// ── 2. VitalWave consent — different occurrences, same service ─────────────
check("2: VitalWave consent isolated by ancillaryCaseId within same case", () => {
  // Both occurrences in the SAME execution case; only 301 has consent stamped.
  const rows = [
    row({ executionCaseId: 30, ancillaryCaseId: 301, serviceType: "VitalWave", documentType: CONSENT }),
  ];
  const c301: ResolvableAncillaryRow = { executionCaseId: 30, ancillaryCaseId: 301, serviceType: "VitalWave" };
  const c302: ResolvableAncillaryRow = { executionCaseId: 30, ancillaryCaseId: 302, serviceType: "VitalWave" };
  assert.equal(consentState(rows, c301), "complete");
  // FIXED (migration 0081 + resolver): 302 carries an occurrence id, so it is
  // resolved ONLY by ac:302 (absent) and NEVER falls back to the occurrence-
  // agnostic executionCase+service key. 301's row can no longer leak into 302.
  assert.equal(
    consentState(rows, c302),
    "missing",
    "occurrence 302 has no row of its own → missing (no fallback to 301's row)",
  );

  // When BOTH occurrences have their own stamped readiness rows (the resolver's
  // intended world), resolution IS isolated:
  const rows2 = [
    row({ executionCaseId: 30, ancillaryCaseId: 301, serviceType: "VitalWave", documentType: CONSENT }),
    row({ executionCaseId: 30, ancillaryCaseId: 302, serviceType: "VitalWave", documentType: CONSENT, documentStatus: "missing" }),
  ];
  assert.equal(consentState(rows2, c301), "complete");
  assert.equal(consentState(rows2, c302), "missing", "302's own row is missing → not satisfied by 301");
});

// ── 3. Ultrasound shared consent — same visit ──────────────────────────────
check("3: one ultrasound consent covers Echo + Carotid + AAA of same case", () => {
  const rows = [
    row({ executionCaseId: 40, ancillaryCaseId: 401, serviceType: "Echocardiogram TTE", documentType: CONSENT }),
  ];
  const echo: ResolvableAncillaryRow = { executionCaseId: 40, ancillaryCaseId: 401, serviceType: "Echocardiogram TTE" };
  const carotid: ResolvableAncillaryRow = { executionCaseId: 40, ancillaryCaseId: 402, serviceType: "Bilateral Carotid Duplex" };
  const aaa: ResolvableAncillaryRow = { executionCaseId: 40, ancillaryCaseId: 403, serviceType: "Abdominal Aortic Aneurysm Duplex" };
  assert.equal(consentState(rows, echo), "complete");
  assert.equal(consentState(rows, carotid), "complete");
  assert.equal(consentState(rows, aaa), "complete");
});

// ── 4. Ultrasound consent — different visit ────────────────────────────────
check("4: ultrasound consent does not carry to a different execution case", () => {
  const rows = [
    row({ executionCaseId: 500, ancillaryCaseId: 5001, serviceType: "Echocardiogram TTE", documentType: CONSENT }),
  ];
  const echo500: ResolvableAncillaryRow = { executionCaseId: 500, serviceType: "Echocardiogram TTE" };
  const echo600: ResolvableAncillaryRow = { executionCaseId: 600, serviceType: "Echocardiogram TTE" };
  assert.equal(consentState(rows, echo500), "complete");
  assert.equal(consentState(rows, echo600), "missing");
});

// ── 5. Report isolation — same visit, different services ───────────────────
check("5: Echo report does not satisfy Carotid report (same case)", () => {
  const rows = [
    row({ executionCaseId: 70, ancillaryCaseId: 701, serviceType: "Echocardiogram TTE", documentType: REPORT, documentStatus: "uploaded" }),
  ];
  const echo: ResolvableAncillaryRow = { executionCaseId: 70, ancillaryCaseId: 701, serviceType: "Echocardiogram TTE" };
  const carotid: ResolvableAncillaryRow = { executionCaseId: 70, ancillaryCaseId: 702, serviceType: "Bilateral Carotid Duplex" };
  assert.equal(stateOf(rows, echo, REPORT, "service"), "complete");
  assert.equal(stateOf(rows, carotid, REPORT, "service"), "missing");
});

// ── 6. BrainWave report isolation — same service, different occurrences ─────
check("6: BrainWave report isolation depends on distinct persisted rows", () => {
  // Only 801's brainwave_pdf exists. Both occurrences share executionCase 80.
  const rows = [
    row({ executionCaseId: 80, ancillaryCaseId: 801, serviceType: "BrainWave", documentType: BRAINWAVE_PDF, documentStatus: "uploaded" }),
  ];
  const bw801: ResolvableAncillaryRow = { executionCaseId: 80, ancillaryCaseId: 801, serviceType: "BrainWave" };
  const bw802: ResolvableAncillaryRow = { executionCaseId: 80, ancillaryCaseId: 802, serviceType: "BrainWave" };
  assert.equal(stateOf(rows, bw801, BRAINWAVE_PDF, "service"), "complete");
  // FIXED (migration 0081 + resolver): 802 is resolved ONLY by ac:802 (absent),
  // never falling back to 801's occurrence-agnostic row → correctly missing.
  assert.equal(
    stateOf(rows, bw802, BRAINWAVE_PDF, "service"),
    "missing",
    "occurrence 802 has no row of its own → missing (no executionCase+service fallback)",
  );
  // With two distinct stamped rows, resolution is isolated:
  const rows2 = [
    row({ executionCaseId: 80, ancillaryCaseId: 801, serviceType: "BrainWave", documentType: BRAINWAVE_PDF, documentStatus: "uploaded" }),
    row({ executionCaseId: 80, ancillaryCaseId: 802, serviceType: "BrainWave", documentType: BRAINWAVE_PDF, documentStatus: "missing" }),
  ];
  assert.equal(stateOf(rows2, bw801, BRAINWAVE_PDF, "service"), "complete");
  assert.equal(stateOf(rows2, bw802, BRAINWAVE_PDF, "service"), "missing");
});

// ── 7. Screening reuse within the current journey (screening scope) ────────
check("7: screening resolves within same journey, not a later unrelated one", () => {
  // Screening evidence persisted for the current execution case / screening.
  const rows = [
    row({ executionCaseId: 90, patientScreeningId: 900, ancillaryCaseId: 901, serviceType: "BrainWave", documentType: SCREENING }),
  ];
  const sameJourney: ResolvableAncillaryRow = { executionCaseId: 90, patientScreeningId: 900, ancillaryCaseId: 901, serviceType: "BrainWave" };
  const laterJourney: ResolvableAncillaryRow = { executionCaseId: 95, patientScreeningId: 950, serviceType: "BrainWave" };
  assert.equal(stateOf(rows, sameJourney, SCREENING, "service"), "complete");
  assert.equal(stateOf(rows, laterJourney, SCREENING, "service"), "missing");
});

// ── 8. Dated guard ─────────────────────────────────────────────────────────
check("8: a completion BEFORE the scheduled date does not satisfy the occurrence", () => {
  const before = [
    row({ executionCaseId: 11, ancillaryCaseId: 1101, serviceType: "BrainWave", documentType: CONSENT, completedAt: "2026-09-01T12:00:00.000Z" }),
  ];
  const occ: ResolvableAncillaryRow = { executionCaseId: 11, ancillaryCaseId: 1101, serviceType: "BrainWave" };
  assert.equal(consentState(before, occ, "2026-09-05"), "missing", "Sep 1 completion must not satisfy a Sep 5 appointment");

  const onOrAfter = [
    row({ executionCaseId: 11, ancillaryCaseId: 1101, serviceType: "BrainWave", documentType: CONSENT, completedAt: "2026-09-05T08:00:00.000Z" }),
  ];
  assert.equal(consentState(onOrAfter, occ, "2026-09-05"), "complete", "Sep 5 completion may satisfy a Sep 5 appointment");
});

// ── 9. Reschedule durability ────────────────────────────────────────────────
check("9: readiness stays attached to the episode across a schedule-event id change", () => {
  // Readiness is keyed by executionCase/ancillaryCase + service, NEVER by the
  // global_schedule_events id. So changing the event id cannot drop readiness.
  const rows = [
    row({ executionCaseId: 12, ancillaryCaseId: 1201, serviceType: "BrainWave", documentType: CONSENT }),
  ];
  const beforeReschedule: ResolvableAncillaryRow = { executionCaseId: 12, ancillaryCaseId: 1201, serviceType: "BrainWave" };
  const afterReschedule: ResolvableAncillaryRow = { executionCaseId: 12, ancillaryCaseId: 1201, serviceType: "BrainWave" }; // new event id, same episode
  assert.equal(consentState(rows, beforeReschedule), "complete");
  assert.equal(consentState(rows, afterReschedule), "complete");
});

// ── 10. Wrong category / wrong service must not match ──────────────────────
check("10: cross-category / cross-service completions never satisfy each other", () => {
  const rows = [
    // BrainWave consent + Echo report present.
    row({ executionCaseId: 13, ancillaryCaseId: 1301, serviceType: "BrainWave", documentType: CONSENT }),
    row({ executionCaseId: 13, ancillaryCaseId: 1302, serviceType: "Echocardiogram TTE", documentType: REPORT, documentStatus: "uploaded" }),
  ];
  // BrainWave consent must NOT satisfy an ultrasound occurrence's consent.
  const echoOcc: ResolvableAncillaryRow = { executionCaseId: 13, ancillaryCaseId: 1302, serviceType: "Echocardiogram TTE" };
  assert.equal(consentState(rows, echoOcc), "missing", "BrainWave consent must not satisfy ultrasound consent");
  // Ultrasound consent must NOT satisfy VitalWave consent.
  const usConsent = [
    row({ executionCaseId: 14, ancillaryCaseId: 1401, serviceType: "Echocardiogram TTE", documentType: CONSENT }),
  ];
  const vwOcc: ResolvableAncillaryRow = { executionCaseId: 14, ancillaryCaseId: 1402, serviceType: "VitalWave" };
  assert.equal(consentState(usConsent, vwOcc), "missing", "ultrasound consent must not satisfy VitalWave consent");
  // Report for one exact service must not satisfy another service.
  const carotidOcc: ResolvableAncillaryRow = { executionCaseId: 13, ancillaryCaseId: 1303, serviceType: "Bilateral Carotid Duplex" };
  assert.equal(stateOf(rows, carotidOcc, REPORT, "service"), "missing", "Echo report must not satisfy Carotid report");
});

// ── FIXED: same executionCase + same serviceType + same docType, DIFFERENT
//    ancillaryCaseId — the occurrence-aware upsert key keeps them distinct ────
check("FIXED: occurrence-aware upsert key isolates two same-service occurrences", () => {
  // Migration 0081 + the occurrence-aware writers key readiness on the canonical
  // occurrence id (ancillary_case_id). Two BrainWave occurrences in one
  // execution case now produce DISTINCT upsert keys → two independent rows.
  const occA = { executionCaseId: 900, ancillaryCaseId: 901, serviceType: "BrainWave", documentType: REPORT };
  const occB = { executionCaseId: 900, ancillaryCaseId: 902, serviceType: "BrainWave", documentType: REPORT };
  assert.notEqual(
    readinessUpsertKey(occA),
    readinessUpsertKey(occB),
    "distinct ancillaryCaseId → distinct upsert key → independent persisted rows",
  );
  // The SAME occurrence maps to the SAME key (idempotent upsert for one occurrence).
  assert.equal(
    readinessUpsertKey(occA),
    readinessUpsertKey({ executionCaseId: 900, ancillaryCaseId: 901, serviceType: "BrainWave", documentType: REPORT }),
  );
  // Distinct services still get distinct keys.
  assert.notEqual(
    readinessUpsertKey({ executionCaseId: 900, ancillaryCaseId: 901, serviceType: "Echocardiogram TTE", documentType: REPORT }),
    readinessUpsertKey({ executionCaseId: 900, ancillaryCaseId: 902, serviceType: "Bilateral Carotid Duplex", documentType: REPORT }),
  );
});

if (failures > 0) {
  console.error(`\nancillaryReadinessKeying.test.ts: ${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("ancillaryReadinessKeying.test.ts: all tests passed");

// Plexus IQ Packet QA Gate — deterministic pre-print audit.
//
// Run this audit before opening any Plexus Packet or Clinician Packet
// preview. Returns a per-patient, per-test missing-data report so the
// caller can either block, or surface the report + offer "Open anyway
// (excludes the N blocked rows)".
//
// SCOPE:
//   - Pure function. No fetch, no React, no toast.
//   - Reads only PatientScreening + reasoning shape; does not mutate.
//   - Never invents reasoning, never auto-regenerates, never silently
//     drops a patient — surfacing is the caller's job.
//
// HONESTY RULE (PLATFORM_OPERATING_MODEL §4):
//   - "missing clinician reasoning" must be CAUGHT before print.
//   - "missing dx/phone/insurance" → warn but do not hard-block unless
//     the existing packet logic already requires them.

import type { PatientScreening } from "@shared/schema";
import type {
  ReasoningBlob,
  TestReasoning,
} from "@shared/contracts/reasoning";

export type PacketMode = "plexus" | "clinician";

export type PacketQaBlockerKind =
  | "missing_name"
  | "missing_dob"
  | "missing_facility"
  | "status_error"
  | "analysis_failure_only"
  | "no_qualifying_tests"
  | "test_missing_clinician_reasoning"
  | "test_missing_talking_points"
  // Admin Review persistence — corrective patch:
  // The operator changed assigned evidence on this ancillary or test
  // (via attach/detach) but has not yet regenerated. The canonical
  // per-test reasoning is therefore older than the staged state.
  // Block printing until regeneration runs to keep packets honest.
  | "stale_admin_review";

export type PacketQaWarningKind =
  | "missing_phone"
  | "missing_email"
  | "missing_insurance"
  | "test_missing_qualifying_factors"
  | "not_completed_status";

export type PacketQaIssue = {
  kind: PacketQaBlockerKind | PacketQaWarningKind;
  /** Set when the issue is per-test. */
  test?: string;
  message: string;
};

export type PacketQaPatientReport = {
  patientId: number;
  patientName: string;
  blockers: PacketQaIssue[];
  warnings: PacketQaIssue[];
  /** True when at least one blocker is present. */
  blocked: boolean;
};

export type PacketQaReport = {
  mode: PacketMode;
  total: number;
  blockedCount: number;
  warningCount: number;
  /** Every patient in input order. Callers iterate to render the table. */
  patients: PacketQaPatientReport[];
  /** Subset of `patients` that has at least one blocker. */
  blockedPatients: PacketQaPatientReport[];
  /** Subset of `patients` that has zero blockers — safe to print. */
  printablePatients: PatientScreening[];
};

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  return value.trim().length === 0;
}

/**
 * Sentinel reasoning keys written by the runtime-hardening runner when a
 * patient fails the AI screening pre-check or the AI call itself. These
 * keys are NOT qualifying-test reasoning entries; a reasoning blob whose
 * only keys are sentinels carries no real content.
 */
const REASONING_SENTINEL_KEYS = new Set([
  "__analysisFailure",
  "__analysisError",
]);

/**
 * True when the reasoning blob exists but every key is a sentinel —
 * i.e. the patient failed AI screening and has no real test reasoning.
 * Distinct from "empty reasoning" because the legacy isPatientPdfEligible
 * check used non-empty reasoning as a green light, which lets sentinel-
 * only rows through.
 */
export function isAnalysisFailureOnly(reasoning: unknown): boolean {
  if (!reasoning || typeof reasoning !== "object") return false;
  const keys = Object.keys(reasoning as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => REASONING_SENTINEL_KEYS.has(k));
}

/**
 * Per-test reasoning lookup. Mirrors the PDF builder's lookup path so
 * the audit catches the exact same cases the builder would silently
 * render as blank. Returns:
 *   - object form: TestReasoning when reasoning[test] is an object
 *   - string form: the raw string when reasoning[test] is a string
 *     (treated by the PDF builder as `clinician_understanding`)
 *   - undefined when missing
 */
function lookupTestReasoning(
  reasoning: ReasoningBlob | null | undefined,
  test: string,
): TestReasoning | string | undefined {
  if (!reasoning) return undefined;
  const raw = reasoning[test];
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") return raw as TestReasoning;
  return undefined;
}

function hasNonBlankClinician(entry: TestReasoning | string): boolean {
  if (typeof entry === "string") return !isBlank(entry);
  return !isBlank(entry.clinician_understanding);
}

function hasNonBlankTalkingPoints(entry: TestReasoning | string): boolean {
  if (typeof entry === "string") return !isBlank(entry);
  return !isBlank(entry.patient_talking_points);
}

function hasQualifyingFactors(entry: TestReasoning | string): boolean {
  if (typeof entry === "string") return false;
  const factors = entry.qualifying_factors;
  return Array.isArray(factors) && factors.some((f) => !isBlank(f));
}

/**
 * Audit a single patient against the given packet mode.
 *
 * Identity blockers are mode-agnostic. Per-test reasoning blockers
 * follow the packet builder's actual requirements:
 *   - Clinician PDF builder reads `clinician_understanding` (or a
 *     string admin override treated as same). Missing => blocker.
 *   - Plexus PDF builder reads `clinician_understanding` AND
 *     `patient_talking_points`. The talking-points slot has a generic
 *     fallback today ("Clinical indicators in this patient's chart
 *     support this study.") — that's the silent-failure case this
 *     gate catches. Missing => blocker.
 *
 * `qualifying_factors` is warned-only because both PDFs handle absent
 * factors by simply omitting the chip row (no fake content rendered).
 */
export function auditPacketPatient(
  patient: PatientScreening,
  mode: PacketMode,
): PacketQaPatientReport {
  const blockers: PacketQaIssue[] = [];
  const warnings: PacketQaIssue[] = [];

  if (isBlank(patient.name)) {
    blockers.push({ kind: "missing_name", message: "patient name is blank" });
  }
  if (isBlank(patient.dob)) {
    blockers.push({ kind: "missing_dob", message: "DOB is blank" });
  }
  if (isBlank(patient.facility)) {
    blockers.push({
      kind: "missing_facility",
      message: "facility is missing — packet header cannot render",
    });
  }
  if (patient.status === "error") {
    blockers.push({
      kind: "status_error",
      message:
        "patient is in status='error' (last qualification attempt failed)",
    });
  }
  const reasoning = (patient.reasoning ?? null) as ReasoningBlob | null;
  if (isAnalysisFailureOnly(reasoning)) {
    blockers.push({
      kind: "analysis_failure_only",
      message:
        "reasoning blob contains only an analysis-failure marker; no real test reasoning",
    });
  }
  const tests = Array.isArray(patient.qualifyingTests)
    ? (patient.qualifyingTests as string[])
    : [];
  if (tests.length === 0) {
    blockers.push({
      kind: "no_qualifying_tests",
      message: "patient has no qualifyingTests",
    });
  }

  // Admin Review persistence — corrective patch:
  // Block if any `reasoning["adminReview:<ancillary>"]` or
  // `reasoning["adminReview:test:<n>"]` block carries `stale: true`.
  // The stale flag is written by attach/detach in AdminReviewDialog
  // and cleared by a successful regenerate. While stale, the
  // canonical test reasoning the PDF would print is older than the
  // operator's staged evidence — the packet would lie.
  if (reasoning && typeof reasoning === "object") {
    const blob = reasoning as Record<string, unknown>;
    for (const key of Object.keys(blob)) {
      if (!key.startsWith("adminReview:")) continue;
      if (key === "adminReview:updates") continue;
      const entry = blob[key];
      if (
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).stale === true
      ) {
        const label = key === "adminReview:brainwave"
          ? "BrainWave"
          : key === "adminReview:vitalwave"
            ? "VitalWave"
            : key === "adminReview:ultrasound"
              ? "Ultrasound"
              : key.startsWith("adminReview:test:")
                ? `Ultrasound · ${key.slice("adminReview:test:".length)}`
                : key.slice("adminReview:".length);
        blockers.push({
          kind: "stale_admin_review",
          message: `${label} has changed evidence and must be regenerated before printing`,
        });
      }
    }
  }

  if (patient.status !== "completed") {
    warnings.push({
      kind: "not_completed_status",
      message: `status is '${patient.status}', expected 'completed'`,
    });
  }
  if (isBlank(patient.phoneNumber)) {
    warnings.push({ kind: "missing_phone", message: "phone is blank" });
  }
  if (isBlank(patient.email)) {
    warnings.push({ kind: "missing_email", message: "email is blank" });
  }
  if (isBlank(patient.insurance)) {
    warnings.push({ kind: "missing_insurance", message: "insurance is blank" });
  }

  // Per-test reasoning audit. We only run this when the patient has
  // tests — a no-tests patient is already blocked above and per-test
  // checks would just multiply that blocker.
  if (tests.length > 0 && !isAnalysisFailureOnly(reasoning)) {
    for (const test of tests) {
      const entry = lookupTestReasoning(reasoning, test);
      if (entry == null || !hasNonBlankClinician(entry)) {
        blockers.push({
          kind: "test_missing_clinician_reasoning",
          test,
          message: `clinician reasoning missing or blank for test "${test}"`,
        });
      }
      if (mode === "plexus") {
        if (entry == null || !hasNonBlankTalkingPoints(entry)) {
          blockers.push({
            kind: "test_missing_talking_points",
            test,
            message: `patient_talking_points missing or blank for test "${test}"`,
          });
        }
      }
      if (entry != null && !hasQualifyingFactors(entry)) {
        warnings.push({
          kind: "test_missing_qualifying_factors",
          test,
          message: `qualifying_factors missing or empty for test "${test}"`,
        });
      }
    }
  }

  return {
    patientId: patient.id,
    patientName: patient.name,
    blockers,
    warnings,
    blocked: blockers.length > 0,
  };
}

export function auditPacketPatients(
  patients: ReadonlyArray<PatientScreening>,
  mode: PacketMode,
): PacketQaReport {
  const reports = patients.map((p) => auditPacketPatient(p, mode));
  const blocked = reports.filter((r) => r.blocked);
  const printablePatients = patients.filter((_, i) => !reports[i].blocked);
  let warningCount = 0;
  for (const r of reports) warningCount += r.warnings.length;
  return {
    mode,
    total: patients.length,
    blockedCount: blocked.length,
    warningCount,
    patients: reports,
    blockedPatients: blocked,
    printablePatients,
  };
}

/**
 * Convenience predicate for places that want a single boolean before
 * showing a print/export button. NOT a substitute for surfacing the
 * full report on confirm — this only collapses the blocker set.
 */
export function isPacketReady(
  patients: ReadonlyArray<PatientScreening>,
  mode: PacketMode,
): boolean {
  const report = auditPacketPatients(patients, mode);
  return report.blockedCount === 0;
}

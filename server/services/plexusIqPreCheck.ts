// Plexus IQ runtime hardening — failure category pre-check.
//
// Before the AI call runs, we classify a patient as one of:
//   - missing_clinical    → no Dx + no Hx + no Rx (AI cannot qualify)
//   - missing_demographic → no DOB AND no insurance (downstream blocker)
//   - ok                  → eligible for AI screening
//
// Pre-check failures never touch the AI provider — they are deterministic
// and persist as `reasoning.__analysisFailure: { category, reason, failedAt }`
// on the patient row. The runner counts them separately from `ai_error`
// and `technical_failed`, so the progress UI can split missing-info
// from actual technical failures.

import type { PlexusIqAnalysisFailure } from "@shared/contracts/plexusIqJobMetadata";

export type PlexusIqPreCheckInput = {
  id: number;
  name: string | null;
  dob: string | null;
  insurance: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
};

export type PlexusIqPreCheckResult =
  | { ok: true }
  | { ok: false; failure: PlexusIqAnalysisFailure };

function isBlank(value: string | null | undefined): boolean {
  if (value == null) return true;
  return value.trim().length === 0;
}

export function classifyPlexusIqPreCheck(p: PlexusIqPreCheckInput): PlexusIqPreCheckResult {
  const noClinical = isBlank(p.diagnoses) && isBlank(p.history) && isBlank(p.medications);
  const noDemographic = isBlank(p.dob) && isBlank(p.insurance);

  // Missing clinical info wins — the AI has nothing to reason about,
  // so we surface that as a clinical-info gap regardless of whether
  // demographics are present.
  if (noClinical) {
    return {
      ok: false,
      failure: {
        category: "missing_clinical",
        reason:
          "Patient has no documented diagnoses, history, or medications — AI cannot qualify any tests.",
        failedAt: new Date().toISOString(),
      },
    };
  }

  if (noDemographic) {
    return {
      ok: false,
      failure: {
        category: "missing_demographic",
        reason:
          "Patient has no DOB and no insurance — cannot route downstream until intake fills this in.",
        failedAt: new Date().toISOString(),
      },
    };
  }

  return { ok: true };
}

export class MissingClinicalInfoError extends Error {
  readonly category = "missing_clinical" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "MissingClinicalInfoError";
  }
}

export class MissingDemographicInfoError extends Error {
  readonly category = "missing_demographic" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "MissingDemographicInfoError";
  }
}

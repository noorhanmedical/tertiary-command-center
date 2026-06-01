import type { PatientScreening } from "@shared/schema";
import {
  buildAdminReviewEvidence,
  type AdminReviewRuleResult,
} from "@shared/plexus-iq/adminReviewEvidence";

export function runAdminReviewRuleEngine(patient: PatientScreening): AdminReviewRuleResult {
  return buildAdminReviewEvidence({
    age: patient.age ?? null,
    hx: patient.history ?? null,
    dx: patient.diagnoses ?? null,
    rx: patient.medications ?? null,
    diagnoses: patient.diagnoses ?? null,
    medications: patient.medications ?? null,
    icdText:
      typeof (patient as { icdCodes?: unknown }).icdCodes === "string"
        ? ((patient as { icdCodes?: string }).icdCodes ?? "")
        : patient.diagnoses ?? "",
    previousTests:
      typeof (patient as { previousTests?: unknown }).previousTests === "string"
        ? ((patient as { previousTests?: string }).previousTests ?? "")
        : "",
  });
}

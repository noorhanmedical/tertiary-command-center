// Ancillary readiness — pure rules.
//
// Zero I/O, zero DB imports. The db-touching parts of the readiness
// summary (batched case_document_readiness reads, library-doc resolvers,
// evaluateCaseReadinessGate) live in ancillaryReadinessSummary.ts.
// Anything here can be unit-tested without a live database.

import { getAncillaryCategory } from "@shared/ancillaryCategory";

// ─── Document type keys persisted in case_document_readiness ────────────────

export const READINESS_DOC_INFORMED_CONSENT = "informed_consent";
export const READINESS_DOC_SCREENING_FORM = "screening_form";
export const READINESS_DOC_BRAINWAVE_PDF = "brainwave_pdf";
export const READINESS_DOC_REPORT = "report";

// ─── Complete-status set (any of these means "the item is done") ────────────

export const COMPLETE_STATUSES = new Set([
  "complete",
  "completed",
  "uploaded",
  "approved",
  "generated",
]);

export type ReadinessItemState = "complete" | "missing" | "not_required";

export function isComplete(status: string | null | undefined): boolean {
  return status != null && COMPLETE_STATUSES.has(status.toLowerCase());
}

/**
 * Dated consent/readiness guard — mirrors the clinic-portal `consentForTest`
 * rule (server/routes/portal.ts): a completed readiness item counts for a
 * given appointment only when it was completed ON/AFTER that appointment's
 * scheduled date. This is NOT an expiry period — there is no upper bound,
 * only the same on/after-scheduledDate lower bound the clinic path enforces.
 *
 * @param documentStatus the readiness row's documentStatus
 * @param completedAtIso the readiness row's completedAt as ISO (or null)
 * @param scheduledDate  the appointment's scheduled date (YYYY-MM-DD) or null
 *
 * Semantics:
 *   - not a complete status            → false
 *   - complete + no scheduledDate      → true  (guard skipped, back-compat)
 *   - complete + no completedAt        → true  (pre-provenance rows not failed
 *                                               retroactively; episode/service
 *                                               keying still isolates them)
 *   - complete + completedAt >= sched  → true
 *   - complete + completedAt <  sched  → false (stale — must not mark ready)
 */
export function readinessCountsForSchedule(
  documentStatus: string | null | undefined,
  completedAtIso: string | null | undefined,
  scheduledDate: string | null | undefined,
): boolean {
  if (!isComplete(documentStatus)) return false;
  if (!scheduledDate) return true;
  if (!completedAtIso) return true;
  return completedAtIso.slice(0, 10) >= scheduledDate;
}

// ─── Per-service requirement flags ─────────────────────────────────────────

/**
 * Which of the readiness items apply to this service? Pure classifier —
 * used by both the summary builder and the SchedulePatientDialog to
 * decide which upload rows to render.
 */
export function requirementsForService(serviceType: string | null | undefined): {
  informedConsent: boolean;
  screeningForm: boolean;
  brainwavePdf: boolean;
  category: ReturnType<typeof getAncillaryCategory>;
} {
  const category = getAncillaryCategory(serviceType ?? "");
  return {
    // Informed consent is required for every ancillary patient.
    informedConsent: true,
    // Screening form is service-specific (BrainWave / VitalWave).
    screeningForm: category === "brainwave" || category === "vitalwave",
    // BrainWave Result PDF only applies to BrainWave.
    brainwavePdf: category === "brainwave",
    category,
  };
}

// Service wrapper for the Admin Review universal ICD search handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 668-738, registered as
//   POST /api/patient-screenings/:id/admin-review/icd-search.
//
// PHI-SAFE LOGGING CONTRACT — CRITICAL INVARIANT
//
//   The catch block's `console.error` in the original handler emitted
//   ONLY the following fields:
//     - patientId        (number; not PHI)
//     - queryLength      (number; not PHI — the count of trimmed chars)
//     - hasAIIntegrationsKey (boolean; not PHI)
//     - hasOpenAIKey     (boolean; not PHI)
//     - hasBaseUrl       (boolean; not PHI)
//     - message          (string; the error message truncated to 240 chars,
//                         from the upstream `Error.message` or stringified
//                         non-Error value)
//
//   The catch block intentionally did NOT log:
//     - the raw query string
//     - the patient name, DOB, phone, or any patient demographics
//     - the patient diagnoses / medications / history (the PHI patient
//       context)
//     - the raw AI prompt or AI response body
//     - any API key or base URL value
//
//   This wrapper preserves that contract by KEEPING THE catch BLOCK IN
//   THE ROUTE. The service does happy-path logic and throws on AI error;
//   it has zero logging side effects. The route's catch handler is
//   unchanged byte-for-byte.
//
// Behavior contract preserved (see
// docs/architecture/backend-route-parity-inventory.md §1.8):
//   - Validation order:
//       1. patientId NaN check     → invalid_id (route → 400 envelope
//                                    { ok: false, error: "OpenAI universal ICD search failed",
//                                      detail: "Invalid patient id" })
//       2. patient lookup          → not_found (route → 404 envelope with
//                                    detail "Patient not found")
//   - Short query short-circuit:
//       `query.length < 2` returns { ok: true, results: [] } without
//       calling the AI. Same JSON shape as the happy path.
//   - Body coercion:
//       - query: String(b.query ?? "").trim()
//       - patientContext.diagnoses / history / medications: typeof string
//         fallback to undefined per field.
//   - AI call: searchAdminReviewIcdCodes({ query, patient, patientContext }).
//   - Happy-path response (route): { ok: true, results }.
//   - Error envelope (route catch): preserved verbatim — see contract above.
//   - The dynamic import of searchAdminReviewIcdCodes remains inside the
//     service so cold-start behavior matches the previous handler.
//
// What this wrapper does NOT change:
//   - No PHI added to any log line.
//   - No prompt/model changes.
//   - No PDF data source change (this handler doesn't touch PDFs).
//   - No DB writes (this handler is read-only at the DB level — only a
//     patient lookup).
//   - No audit-log call (none in original; preserved).
//   - No journey-event write (none in original; preserved).
//   - No scheduler-assignment behavior (handler doesn't touch it).

import type { AdminReviewIcdSuggestion } from "./adminReviewIcdSearch";
import { storage } from "../../storage";

export type AdminReviewIcdSearchFailure =
  | { kind: "invalid_id" }
  | { kind: "not_found" };

export type AdminReviewIcdSearchOutcome =
  | { ok: true; results: AdminReviewIcdSuggestion[] }
  | { ok: false; error: AdminReviewIcdSearchFailure };

/**
 * Run the universal Admin Review ICD-10-CM search. Returns a discriminated
 * union for validation failures; throws on AI/network failures so the route
 * can apply the PHI-safe catch logging contract unchanged.
 *
 * Short queries (`query.length < 2` after trimming) short-circuit to
 * `{ ok: true, results: [] }` without calling the AI, matching the
 * previous inline behavior exactly.
 */
export async function adminReviewIcdSearch(
  patientId: number,
  body: Record<string, unknown> | undefined | null,
): Promise<AdminReviewIcdSearchOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const b = (body ?? {}) as Record<string, any>;
  const query = String(b.query ?? "").trim();
  if (query.length < 2) {
    return { ok: true, results: [] };
  }

  const patientContext = {
    diagnoses:
      typeof b.patientContext?.diagnoses === "string"
        ? b.patientContext.diagnoses
        : undefined,
    history:
      typeof b.patientContext?.history === "string"
        ? b.patientContext.history
        : undefined,
    medications:
      typeof b.patientContext?.medications === "string"
        ? b.patientContext.medications
        : undefined,
  };

  const { searchAdminReviewIcdCodes } = await import("./adminReviewIcdSearch");
  const results = await searchAdminReviewIcdCodes({
    query,
    patient,
    patientContext,
  });
  return { ok: true, results };
}

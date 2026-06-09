// Read-only service wrapper for the Admin Review evidence handler.
//
// SOURCE (canonical handler at the time of extraction):
//   server/routes/patients.ts lines 207-227, registered as
//   GET /api/patient-screenings/:id/admin-review/evidence.
//
// Behavior contract preserved by this wrapper (see
// docs/architecture/backend-route-parity-inventory.md §1.1):
//   - Validation order: id-NaN check → patient lookup.
//   - 400 message: "Invalid patient id".
//   - 404 message: "Patient not found".
//   - Success body: { ok: true, patientId, ...result } — the route is
//     responsible for the spread so the JSON shape stays byte-identical.
//   - The rule engine module load remains lazy (dynamic import) to
//     preserve current cold-start behavior.
//   - No DB writes. No AI calls. No audit log. No journey events.

import type { AdminReviewRuleResult } from "@shared/plexus-iq/adminReviewEvidence";
import { storage } from "../../storage";

export type AdminReviewEvidenceFailure =
  | { kind: "invalid_id" }
  | { kind: "not_found" };

export type AdminReviewEvidenceOutcome =
  | { ok: true; patientId: number; result: AdminReviewRuleResult }
  | { ok: false; error: AdminReviewEvidenceFailure };

/**
 * Returns the deterministic rule-engine evidence for the Admin Review
 * panel. Read-only. Mirrors the previous inline handler in
 * server/routes/patients.ts step-for-step:
 *   1. NaN-check on id  → invalid_id
 *   2. Lookup patient   → not_found
 *   3. Run rule engine  → { ok: true, patientId, result }
 *
 * The caller (the route) is expected to spread `result` onto the
 * top-level JSON response, exactly as the previous inline handler did:
 *   res.json({ ok: true, patientId, ...result }).
 */
export async function getAdminReviewEvidence(
  patientId: number,
): Promise<AdminReviewEvidenceOutcome> {
  if (Number.isNaN(patientId)) {
    return { ok: false, error: { kind: "invalid_id" } };
  }
  const patient = await storage.getPatientScreening(patientId);
  if (!patient) {
    return { ok: false, error: { kind: "not_found" } };
  }
  const { runAdminReviewRuleEngine } = await import("./adminReviewRuleEngine");
  const result = runAdminReviewRuleEngine(patient);
  return { ok: true, patientId, result };
}

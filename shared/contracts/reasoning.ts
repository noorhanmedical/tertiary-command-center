// Patient screening reasoning blob contract.
//
// SOURCE (canonical): shared/schema/screening.ts:114-143
//   - testReasoningSchema  (lines 114-127; per-test reasoning entry)
//   - patientScreeningResultSchema.reasoning (lines 139-142; jsonb shape)
//
// The reasoning blob is stored on patient_screenings.reasoning (jsonb).
// It is keyed by test name. The value is either:
//   - a TestReasoning record (canonical AI/admin output for that test), OR
//   - a string (admin-review free-form override, e.g.,
//     reasoning["adminReview:<ancillary>"]).
//
// Invariants (cross-reference docs/architecture/protected-flows.md):
//   - The Clinician PDF DOES NOT render `icd10_codes` (intentional).
//   - The Plexus PDF DOES render `icd10_codes`.
//   - Both PDFs require `clinician_understanding` and `patient_talking_points`.
//   - `qualifying_factors` may be edited from the Admin Review supporting buttons.
//   - `admin_justification` is persisted in this same blob — no separate store.
//
// This contract mirrors the Zod schema structurally. It is *not* a Zod schema
// itself; consumers that need runtime validation should continue to import the
// Zod schema from shared/schema/screening.ts.

export type ReasoningConfidence = "high" | "medium" | "low";

export type TestReasoning = {
  clinician_understanding: string;
  patient_talking_points: string;
  confidence?: ReasoningConfidence;
  qualifying_factors?: string[];
  icd10_codes?: string[];
  pearls?: string[];
  approvalRequired?: boolean;
  // Admin-authored justification for *this specific* qualifying test.
  // Free-form string, optional. Persists through the canonical
  // patient_screenings.reasoning jsonb column — no separate store.
  admin_justification?: string;
  admin_justification_updated_at?: string;
};

// Top-level reasoning blob shape, keyed by test name.
// Values are either canonical TestReasoning records or admin-review string
// overrides (e.g., reasoning["adminReview:<ancillary>"]).
export type ReasoningBlob = Record<string, TestReasoning | string>;

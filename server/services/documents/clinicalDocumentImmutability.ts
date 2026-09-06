// Canonical signed-clinical-document immutability invariant (P0).
//
// ONE place that answers "is this library document an immutable clinical
// artifact?" so mutation routes don't each re-derive ad-hoc rules. Pure +
// DB-free so it is deterministically unit-testable and reusable.
//
// INVARIANT
//   A per-PATIENT clinical record — a document that both (a) is scoped to a
//   patient (patientScreeningId != null) AND (b) is a clinical artifact kind
//   (informed_consent, report, clinician_pdf) — is IMMUTABLE. It represents a
//   completed/signed clinical fact for that patient. It must never be
//   superseded-in-place or hard/soft-deleted through the ordinary library admin
//   routes. Corrections are made by creating a NEW record (a fresh signed
//   consent / re-uploaded report), which preserves the original artifact and
//   its audit trail — never by mutating or destroying the existing one.
//
//   LIBRARY TEMPLATES (patientScreeningId == null: consent templates, marketing,
//   training, reference, etc.) are NOT clinical records and remain freely
//   versionable via supersede — that is the intended template-update path.
//
// This complements the existing clinical-signature immutability already enforced
// elsewhere (order notes reject mutation once signatureStatus === "signed" — see
// orderNoteLifecycle.repo). Backend enforcement is mandatory; a disabled
// frontend control is never sufficient.

/** Document kinds that are per-patient clinical artifacts when patient-scoped. */
export const IMMUTABLE_CLINICAL_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "informed_consent",
  "report",
  "clinician_pdf",
]);

/** The minimal shape needed to decide immutability (subset of `documents`). */
export interface ImmutabilityCheckableDocument {
  kind: string;
  patientScreeningId?: number | null;
}

/**
 * True when the document is a signed/final per-patient clinical record that must
 * not be superseded or deleted in place. Patient-scoped clinical-artifact kinds
 * only; templates (no patientScreeningId) are mutable.
 */
export function isImmutableClinicalDocument(doc: ImmutabilityCheckableDocument | null | undefined): boolean {
  if (!doc) return false;
  if (doc.patientScreeningId == null) return false;
  return IMMUTABLE_CLINICAL_DOCUMENT_KINDS.has(doc.kind);
}

/** Standard 409 payload for a blocked mutation of an immutable clinical record. */
export const IMMUTABLE_CLINICAL_DOCUMENT_ERROR = {
  status: 409 as const,
  body: {
    error:
      "This is a signed patient clinical record and is immutable. Create a new record (a fresh signed consent or re-uploaded report) instead of superseding or deleting it.",
  },
};

// Service-relevant AUTHORIZATION-MATERIAL projection of the canonical Order
// Note evidence bundle.
//
// The full evidence bundle (assembleOrderNoteEvidenceBundle) answers "what
// evidence did Plexus have?" and is retained for narrative + audit. This module
// answers the DIFFERENT question "what evidence changes require a clinician to
// re-review/re-authorize THIS order?" — i.e. the freshness/authorization signal.
//
// It is a DETERMINISTIC projection (no AI, no fuzzy/semantic inference). It:
//   • ALWAYS keeps the core authorization evidence: canonical service identity,
//     ordered components, qualification reasoning, Admin Review status,
//     qualifying diagnoses + history, and structured screening findings;
//   • keeps patient-level clinical-reference evidence (medications, labs,
//     vitals, prior imaging/results, clinical notes, clinician findings) ONLY
//     when it is RELEVANT to the ordered service, per explicit per-service
//     keyword rules grounded in what Plexus stores for qualification;
//   • keys evidence by stable CONTENT (evidenceClass|concept|value), never by
//     DB row id or top-N sort position, so re-recording the same answer or an
//     unrelated abnormal result reshuffling the bounded set does NOT move the
//     material fingerprint.
//
// A change to ordered components, qualification reasoning, or required
// structured screening is ALWAYS material. An unrelated liver enzyme / renal /
// orthopedic result is NOT material to, say, a carotid order.

import crypto from "node:crypto";
import type { OrderNoteEvidenceBundle, EvidenceFact } from "./orderNoteEvidenceBundle";
import {
  serviceKeyForOrderNoteMateriality,
  isEvidenceRelevantToService,
  type OrderNoteServiceRelevanceKey,
} from "./orderNoteEvidenceRelevance";

/** Deterministic service classification (delegates to the shared registry). */
export function materialityServiceKey(bundle: Pick<OrderNoteEvidenceBundle, "service" | "serviceLabel">): OrderNoteServiceRelevanceKey {
  return serviceKeyForOrderNoteMateriality(bundle.service, bundle.serviceLabel);
}

/** Whether a patient-level evidence fact is RELEVANT to the ordered service. */
function isRelevant(key: OrderNoteServiceRelevanceKey, f: EvidenceFact): boolean {
  return isEvidenceRelevantToService(key, f);
}

/** Stable content key for a fact — NEVER the DB row id or sort position. */
function contentKey(f: EvidenceFact): string {
  return `${f.evidenceClass}|${f.concept}|${String(f.value ?? "")}`;
}

export type MaterialOrderNoteEvidence = {
  service: string;
  orderedComponents: string[];
  qualificationFactors: string[];
  clinicianUnderstanding: string | null;
  adminReviewStatus: string | null;
  diagnoses: string[];
  history: string[];
  screening: string[];
  relevantMedications: string[];
  relevantLabs: string[];
  relevantVitals: string[];
  relevantImaging: string[];
  relevantNotes: string[];
  relevantFindings: string[];
};

/**
 * Deterministic AUTHORIZATION-MATERIAL projection of the canonical bundle.
 * Always-material core + service-relevant patient-level evidence. All arrays
 * are content-keyed and sorted so the projection is stable under re-recording
 * and bounded-set reshuffling.
 */
export function projectMaterialOrderNoteEvidence(bundle: OrderNoteEvidenceBundle): MaterialOrderNoteEvidence {
  const key = materialityServiceKey(bundle);
  const rel = (facts: EvidenceFact[]): string[] =>
    facts.filter((f) => isRelevant(key, f)).map(contentKey).sort();

  return {
    // ── Always material ──
    service: bundle.service,
    orderedComponents: bundle.orderedComponents.map((c) => c.key).sort(),
    qualificationFactors: [...bundle.qualification.factors].sort(),
    clinicianUnderstanding: bundle.qualification.clinicianUnderstanding ?? null,
    adminReviewStatus: bundle.adminReview?.status ?? null,
    diagnoses: bundle.diagnoses.map((f) => f.displayText.toLowerCase()).sort(),
    history: bundle.history.map((f) => f.displayText.toLowerCase()).sort(),
    screening: (bundle.structuredScreening?.findings ?? [])
      .map((f) => `${f.questionId}=${typeof f.value === "boolean" ? (f.value ? "T" : "F") : f.value}`)
      .sort(),
    // ── Service-relevant only ──
    relevantMedications: rel(bundle.medications),
    relevantLabs: rel(bundle.labs),
    relevantVitals: rel(bundle.vitals),
    relevantImaging: rel(bundle.priorImaging),
    relevantNotes: rel(bundle.clinicalNotes),
    relevantFindings: rel(bundle.clinicianFindings),
  };
}

/**
 * The AUTHORIZATION-MATERIAL fingerprint — the deterministic freshness signal
 * persisted on the Order Note (evidence_fingerprint) and recomputed at
 * procedure_start / procedure-note generation. Differs from the FULL bundle
 * fingerprint (orderNoteEvidenceBundleFingerprint), which is retained for audit.
 */
export function materialOrderNoteEvidenceFingerprint(bundle: OrderNoteEvidenceBundle): string {
  const material = projectMaterialOrderNoteEvidence(bundle);
  return crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 40);
}

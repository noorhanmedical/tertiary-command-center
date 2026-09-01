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

type ServiceKey =
  | "brainwave" | "vitalwave" | "echo" | "stress_echo" | "carotid" | "renal"
  | "le_arterial" | "ue_arterial" | "le_venous" | "ue_venous" | "aaa" | "generic";

/** Deterministic service classification from the canonical service identity. */
export function materialityServiceKey(bundle: Pick<OrderNoteEvidenceBundle, "service" | "serviceLabel">): ServiceKey {
  const s = `${bundle.service} ${bundle.serviceLabel}`.toLowerCase();
  if (s.includes("brain")) return "brainwave";
  if (s.includes("vital")) return "vitalwave";
  if (s.includes("stress") && s.includes("echo")) return "stress_echo";
  if (s.includes("echo") || s.includes("tte")) return "echo";
  if (s.includes("carotid")) return "carotid";
  if (s.includes("renal")) return "renal";
  if (s.includes("aort") || s.includes("aaa") || s.includes("aneurysm")) return "aaa";
  if (s.includes("upper extremity") && s.includes("arter")) return "ue_arterial";
  if (s.includes("upper extremity") && s.includes("ven")) return "ue_venous";
  if (s.includes("arter")) return "le_arterial";
  if (s.includes("ven")) return "le_venous";
  return "generic";
}

// Shared risk terms used across multiple vascular/cardiac services.
const VASCULAR_RISK = ["hypertension", "htn", "diabet", "hyperlipid", "cholesterol", "lipid", "smok", "tobacco", "nicotine"];

// Per-service relevance keywords (lowercase substrings). Grounded in the
// symptoms/diagnoses/labs/imaging Plexus uses to qualify each service.
const SERVICE_RELEVANCE: Record<Exclude<ServiceKey, "generic">, string[]> = {
  brainwave: [
    "neuro", "cognit", "memory", "attention", "executive", "concentrat", "dementia", "alzheimer",
    "brain", "cerebr", "headache", "migraine", "dizz", "vertigo", "lighthead", "seizure", "epilep",
    "convuls", "stroke", "tia", "transient ischemic", "parkinson", "tremor", "neuropath", "brain fog",
    "confusion", "encephal", "eeg", "evoked potential", "vep", "aep", "mri brain", "ct head", "ct brain",
    "donepezil", "memantine", "rivastigmine", "galantamine", "levetiracetam", "keppra", "gabapentin",
    "pregabalin", "lamotrigine", "phenytoin", "valproate", "topiramate", "sumatriptan",
    ...VASCULAR_RISK,
  ],
  vitalwave: [
    "autonomic", "dysautonomia", "dizz", "lighthead", "position", "orthostat", "postural", "syncope",
    "presyncope", "faint", "palpitation", "tachycard", "bradycard", "neuropath", "vascular",
    "peripheral arter", "cardiovascular", "blood pressure", "bp", "heart rate", "pots", "diabet",
    ...VASCULAR_RISK,
  ],
  echo: [
    "dyspnea", "shortness of breath", "sob", "edema", "chest pain", "chest discomfort", "angina",
    "heart failure", "chf", "cardiomyopath", "coronary", "cad", "ischem", "valv", "murmur", "stenosis",
    "regurg", "palpitation", "syncope", "bnp", "probnp", "troponin", "echo", "cardiac", "ejection",
    "lvef", "myocard", "arrhythmi", "atrial fib", "afib", "beta blocker", "metoprolol", "carvedilol",
    "furosemide", "lasix", "digoxin", "entresto", "sacubitril",
    ...VASCULAR_RISK,
  ],
  stress_echo: [
    "dyspnea", "shortness of breath", "sob", "chest pain", "chest discomfort", "angina", "coronary",
    "cad", "ischem", "stress", "exercise", "treadmill", "dobutamine", "cardiac", "echo", "ejection",
    "lvef", "arrhythmi", "atrial fib", "afib", "palpitation", "syncope", "valv", "murmur", "bnp",
    "probnp", "troponin", "heart failure", "chf", "cardiomyopath", "myocard", ...VASCULAR_RISK,
  ],
  carotid: [
    "carotid", "cerebrovascular", "stroke", "tia", "transient ischemic", "amaurosis", "bruit", "dizz",
    "vertigo", "vascular", "atheroscler", "stenosis", "plaque", "neuro", "endarterectomy", "cea",
    "cta neck", "mra neck", ...VASCULAR_RISK,
  ],
  renal: [
    "renal", "kidney", "nephro", "creatinine", "egfr", "gfr", "bun", "urinalysis", "proteinuria",
    "albuminuria", "hematuria", "ckd", "aki", "resistant hypertension", "vascular", "stenosis",
    "hydronephro", "ace inhibitor", "arb", "lisinopril", "losartan", ...VASCULAR_RISK,
  ],
  le_arterial: [
    "claudicat", "arter", "pad", "peripheral arterial", "perfusion", "ankle brachial", "abi", "ischem",
    "rest pain", "ulcer", "gangrene", "pulse", "leg pain", "exertion", "cold foot", "cold feet",
    "diabet", "smok", "tobacco",
  ],
  ue_arterial: [
    "claudicat", "arter", "pad", "peripheral arterial", "perfusion", "ischem", "rest pain", "ulcer",
    "arm pain", "hand", "subclavian", "steal", "raynaud", "diabet", "smok", "tobacco",
  ],
  le_venous: [
    "venous", "dvt", "deep vein", "thrombos", "thrombus", "edema", "swelling", "varicose",
    "insufficiency", "reflux", "phleb", "leg swelling", "leg pain", "stasis", "ulcer", "compression",
  ],
  ue_venous: [
    "venous", "dvt", "deep vein", "thrombos", "thrombus", "edema", "swelling", "arm swelling",
    "insufficiency", "reflux", "phleb", "picc", "central line", "port",
  ],
  aaa: [
    "aort", "aneurysm", "aaa", "abdominal aort", "aortoiliac", "iliac", "vascular", "atheroscler",
    "pulsatile", "back pain", ...VASCULAR_RISK,
  ],
};

function factText(f: EvidenceFact): string {
  return `${f.concept ?? ""} ${f.displayText ?? ""}`.toLowerCase();
}

/** Whether a patient-level evidence fact is RELEVANT to the ordered service. */
function isRelevant(key: ServiceKey, f: EvidenceFact): boolean {
  if (key === "generic") return true; // unmapped service → conservative (keep all)
  const kws = SERVICE_RELEVANCE[key];
  const text = factText(f);
  return kws.some((k) => text.includes(k));
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

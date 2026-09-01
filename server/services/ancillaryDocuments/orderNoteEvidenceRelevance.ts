// Canonical, deterministic service-relevance registry for Order Note evidence.
//
// SINGLE SOURCE OF TRUTH for "is this piece of patient-level evidence relevant
// to the authorization/medical-necessity of THIS ordered service?" Used by:
//   • assembleOrderNoteEvidenceBundle — to RETAIN all service-relevant
//     (authorization-material) candidates BEFORE general top-N truncation, so a
//     relevant item can never be displaced by unrelated abnormal evidence; and
//   • projectMaterialOrderNoteEvidence / materialOrderNoteEvidenceFingerprint —
//     to compute the authorization-material freshness fingerprint.
//
// No AI. No fuzzy search. No embeddings. Explicit per-service keyword rules,
// grounded in what Plexus stores for qualification. Both consumers MUST use
// these helpers — the keyword lists must never be duplicated elsewhere.

export type OrderNoteServiceRelevanceKey =
  | "brainwave" | "vitalwave" | "echo" | "stress_echo" | "carotid" | "renal"
  | "le_arterial" | "ue_arterial" | "le_venous" | "ue_venous" | "aaa" | "generic";

/** Deterministic service classification from the canonical service identity. */
export function serviceKeyForOrderNoteMateriality(serviceType: string, serviceLabel?: string): OrderNoteServiceRelevanceKey {
  const s = `${serviceType ?? ""} ${serviceLabel ?? ""}`.toLowerCase();
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
const SERVICE_RELEVANCE: Record<Exclude<OrderNoteServiceRelevanceKey, "generic">, string[]> = {
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

/** A minimal evidence shape sufficient for relevance classification. */
export type RelevanceEvidence = { concept?: string | null; displayText?: string | null };

function evidenceText(e: RelevanceEvidence): string {
  return `${e.concept ?? ""} ${e.displayText ?? ""}`.toLowerCase();
}

/**
 * Whether a patient-level evidence item is RELEVANT to the ordered service.
 * Deterministic keyword match on the item's concept + display text. An unmapped
 * ("generic") service conservatively treats ALL evidence as relevant (fail-safe
 * — never silently drops authorization evidence for an unknown service).
 */
export function isEvidenceRelevantToService(key: OrderNoteServiceRelevanceKey, e: RelevanceEvidence): boolean {
  if (key === "generic") return true;
  const text = evidenceText(e);
  return SERVICE_RELEVANCE[key].some((k) => text.includes(k));
}

/**
 * Retain ALL service-relevant (authorization-material) items, then fill the
 * remaining CONTEXTUAL capacity with the highest-ranked non-relevant items.
 * `ranked` must already be in the desired priority order (abnormal-first /
 * final-first / most-recent). Deduped by the caller-supplied stable CONTENT key
 * (never DB row id / sort position). This is the single selection primitive
 * that prevents unrelated evidence from displacing relevant evidence before the
 * materiality projection — used by assembleOrderNoteEvidenceBundle for every
 * bounded evidence class.
 */
export function retainRelevantFirst<T extends RelevanceEvidence>(
  ranked: T[],
  key: OrderNoteServiceRelevanceKey,
  contextualCap: number,
  contentKey: (item: T) => string,
): T[] {
  const relevant: T[] = [];
  const contextual: T[] = [];
  for (const item of ranked) {
    if (isEvidenceRelevantToService(key, item)) relevant.push(item);
    else if (contextual.length < contextualCap) contextual.push(item);
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...relevant, ...contextual]) {
    const ck = contentKey(item);
    if (seen.has(ck)) continue;
    seen.add(ck);
    out.push(item);
  }
  return out;
}

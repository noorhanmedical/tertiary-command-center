// Order Note standard — SLICE AI-3: deterministic compliance / grounding validator.
//
// Pure (no DB, no AI). Validates the AI narrative against the standard BEFORE it
// is persisted or shown for signature. Fail-closed: any failure => the note is
// not accepted as-is (the caller retries with corrective feedback, then fails
// honestly). Every concrete factual statement must be traceable to the evidence
// bundle; codes, completion/result language, fabricated signatures, certainty
// upgrades, and foreign (un-ordered) components are rejected.

import type { OrderNoteNarrative } from "./orderNoteNarrativeAi";
import type { OrderNoteEvidenceBundle } from "./orderNoteEvidenceBundle";

export type ComplianceFailure = { code: string; message: string };
export type ComplianceResult = { passed: boolean; failures: ComplianceFailure[] };

// ICD-10: a letter (not U), a digit, an alphanumeric, optional .subcode.
const ICD10_RE = /\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/;
// CPT / HCPCS: a bare 5-digit token.
const CPT_RE = /\b\d{5}\b/;
// Completion language (the ordered study has NOT happened yet).
const COMPLETION_RE = /\b(?:was|were)\s+(?:performed|completed|conducted|obtained|acquired|administered)\b|tolerated (?:the|all) procedure|completed successfully|testing was (?:completed|performed)|study was performed/i;
// Result/finding language implying the ordered study already produced results.
const RESULT_RE = /\b(?:results?|findings?)\s+(?:show|showed|reveal|revealed|demonstrat\w*|indicate\w*)\b|the study (?:showed|demonstrated|revealed)/i;
// Fabricated signature / attestation-style artifacts.
const SIGNATURE_RE = /\bsignature:|\bsigned (?:by|on)\b|date\/time:|electronically signed|\bNPI[:#]?\s*\d/i;

const firstName = (full: string) => (full || "").trim().split(/\s+/)[0] || full;
const norm = (s: string) => s.toLowerCase();

// Foreign-component detection: each keyword is valid only for certain service
// keys. If it appears in a note for a different service, it's an un-ordered
// component discussion.
type ServiceKey = "brainwave" | "vitalwave" | "echo" | "carotid" | "renal" | "le_arterial" | "le_venous" | "generic";

function serviceKeyOf(bundle: OrderNoteEvidenceBundle): ServiceKey {
  const s = `${bundle.service} ${bundle.serviceLabel}`.toLowerCase();
  if (s.includes("brain")) return "brainwave";
  if (s.includes("vital")) return "vitalwave";
  if (s.includes("carotid")) return "carotid";
  if (s.includes("renal")) return "renal";
  if (s.includes("venous")) return "le_venous";
  if (s.includes("arterial")) return "le_arterial";
  if (s.includes("echo") || s.includes("tte")) return "echo";
  return "generic";
}

const FOREIGN_COMPONENTS: Array<{ re: RegExp; label: string; validFor: ServiceKey[] }> = [
  { re: /\bEEG\b|electroencephalogra/i, label: "EEG", validFor: ["brainwave"] },
  { re: /neuropsych/i, label: "neuropsychological testing", validFor: ["brainwave"] },
  { re: /\bVEP\b|visual evoked/i, label: "VEP", validFor: ["brainwave"] },
  { re: /\bAEP\b|auditory evoked/i, label: "AEP", validFor: ["brainwave"] },
  { re: /tilt[- ]?table/i, label: "tilt-table", validFor: ["vitalwave"] },
  { re: /autonomic|parasympathetic|sympathetic/i, label: "autonomic testing", validFor: ["vitalwave"] },
  { re: /segmental pressure/i, label: "segmental pressures", validFor: ["vitalwave", "le_arterial"] },
  { re: /echocardiograph|transthoracic|ejection fraction|valvular/i, label: "echocardiography", validFor: ["echo"] },
  { re: /carotid/i, label: "carotid duplex", validFor: ["carotid"] },
  { re: /renal (?:artery|arteries)/i, label: "renal artery duplex", validFor: ["renal"] },
];

// Known lab tokens that, if quoted with a number, must be traceable to labs.
const LAB_TOKENS = ["a1c", "hba1c", "ldl", "hdl", "triglyceride", "cholesterol", "egfr", "creatinine", "glucose", "hemoglobin", "tsh"];

function collectConcepts(bundle: OrderNoteEvidenceBundle): Set<string> {
  const set = new Set<string>();
  const add = (t: string) => { for (const w of norm(t).split(/[^a-z0-9]+/).filter((x) => x.length > 3)) set.add(w); };
  for (const f of [...bundle.diagnoses, ...bundle.history, ...bundle.medications, ...bundle.clinicianFindings, ...bundle.priorImaging]) add(f.displayText);
  for (const f of bundle.structuredScreening?.findings ?? []) add(f.displayText);
  for (const f of bundle.qualification.factors) add(f);
  return set;
}

// Chart-corroborated concept tokens (documented-level). Used to check the AI
// didn't upgrade a patient-reported-only concept to "documented/diagnosed".
function chartConceptTokens(bundle: OrderNoteEvidenceBundle): Set<string> {
  const set = new Set<string>();
  const add = (t: string) => { for (const w of norm(t).split(/[^a-z0-9]+/).filter((x) => x.length > 3)) set.add(w); };
  for (const f of [...bundle.diagnoses, ...bundle.history, ...bundle.clinicianFindings, ...bundle.priorImaging]) add(f.displayText);
  return set;
}

export function validateOrderNoteNarrative(
  narrative: OrderNoteNarrative,
  bundle: OrderNoteEvidenceBundle,
): ComplianceResult {
  const failures: ComplianceFailure[] = [];
  const chi = narrative.clinicalHistoryIndication ?? "";
  const amn = narrative.assessmentMedicalNecessity ?? "";
  const both = `${chi}\n${amn}`;

  // 1/2 — required fields present + substantive.
  if (chi.trim().length < 40) failures.push({ code: "missing_clinical_history", message: "Clinical History / Indication is missing or too short." });
  if (amn.trim().length < 120) failures.push({ code: "missing_assessment", message: "Assessment / Medical Necessity is missing or too short (must be an extensive integrated narrative)." });

  // Patient name present in the narrative (patient-specificity anchor).
  const fn = firstName(bundle.patient.name);
  if (fn && fn.toLowerCase() !== "patient" && !new RegExp(`\\b${escapeRe(fn)}\\b`, "i").test(both)) {
    failures.push({ code: "patient_name_absent", message: `The patient's name (${fn}) does not appear in the narrative.` });
  }

  // 3/4 — no ICD / CPT.
  if (ICD10_RE.test(both)) failures.push({ code: "icd_present", message: "An ICD-10-style code appears in the Order Note narrative. Remove all diagnosis codes." });
  if (CPT_RE.test(both)) failures.push({ code: "cpt_present", message: "A CPT-style 5-digit code appears in the Order Note narrative. Remove all procedure codes." });

  // 5 — no procedure-completion language.
  if (COMPLETION_RE.test(both)) failures.push({ code: "completion_language", message: "The narrative implies the ordered testing was already performed/completed. The study has not occurred yet." });

  // 6 — no result/finding language for the ORDERED study (allow prior-imaging attribution).
  scanResultLanguage(chi, failures, "clinicalHistoryIndication");
  scanResultLanguage(amn, failures, "assessmentMedicalNecessity");

  // 7 — no fabricated signature/date/provider/NPI.
  if (SIGNATURE_RE.test(both)) failures.push({ code: "signature_fabrication", message: "The narrative contains signature/attestation/NPI artifacts. Those are rendered deterministically, not by the model." });

  // 10 — no foreign (un-ordered) component discussion.
  const svc = serviceKeyOf(bundle);
  for (const fc of FOREIGN_COMPONENTS) {
    if (fc.re.test(both) && !fc.validFor.includes(svc)) {
      failures.push({ code: "unordered_component", message: `Discusses "${fc.label}", which is not an ordered component for this service.` });
    }
  }

  // 11 — quoted lab values must be traceable.
  const labText = norm(bundle.labs.map((l) => l.displayText).join(" | "));
  for (const tok of LAB_TOKENS) {
    const re = new RegExp(`${tok}[^.]{0,20}?\\b\\d`, "i");
    if (re.test(both) && !labText.includes(tok)) {
      failures.push({ code: "lab_untraceable", message: `Cites a ${tok.toUpperCase()} value not present in the supplied labs.` });
    }
  }

  // 12 — quoted BP/HR values must be traceable to vitals.
  const vitalText = norm(bundle.vitals.map((v) => v.displayText).join(" | "));
  if (/\b\d{2,3}\s*\/\s*\d{2,3}\b/.test(both) && !/\d{2,3}\s*\/\s*\d{2,3}/.test(vitalText)) {
    failures.push({ code: "vital_untraceable", message: "Cites a blood-pressure value not present in the supplied vitals." });
  }

  // 13 — imaging-finding claims require actual prior imaging in the bundle.
  if (bundle.priorImaging.length === 0 && /\bprior\s+(?:mri|ct|echocardiogram|ultrasound|imaging|duplex|doppler|study)\b[^.]{0,60}(?:document|show|reveal|demonstrat)/i.test(both)) {
    failures.push({ code: "imaging_untraceable", message: "References a prior imaging finding, but no prior imaging result was supplied." });
  }

  // 8 — certainty upgrade: a patient-reported-only concept asserted as documented/diagnosed.
  const chartTokens = chartConceptTokens(bundle);
  for (const f of bundle.structuredScreening?.findings ?? []) {
    const tokens = norm(f.displayText).split(/[^a-z0-9]+/).filter((x) => x.length > 4);
    const corroborated = tokens.some((t) => chartTokens.has(t));
    if (corroborated) continue;
    for (const t of tokens) {
      const re = new RegExp(`(?:documented|diagnosed with|documented history of|known)\\s+(?:[a-z ]{0,20})?${escapeRe(t)}`, "i");
      if (re.test(both)) {
        failures.push({ code: "certainty_upgrade", message: `Patient-reported "${f.displayText}" is asserted as documented/diagnosed without chart corroboration.` });
        break;
      }
    }
  }

  // 16 — generic boilerplate: the assessment must reference actual case evidence.
  const concepts = collectConcepts(bundle);
  if (concepts.size > 0) {
    const amnTokens = new Set(norm(amn).split(/[^a-z0-9]+/).filter((x) => x.length > 3));
    let overlap = 0;
    for (const c of concepts) if (amnTokens.has(c)) overlap++;
    if (overlap === 0) failures.push({ code: "generic_boilerplate", message: "The Assessment does not reference any of this patient's actual evidence (reads generic)." });
  }

  // 17 — the two sections must not substantially duplicate.
  if (jaccardSentences(chi, amn) > 0.6) {
    failures.push({ code: "section_duplication", message: "Clinical History and Assessment substantially duplicate one another." });
  }

  return { passed: failures.length === 0, failures };
}

function scanResultLanguage(text: string, failures: ComplianceFailure[], where: string): void {
  // Split into sentences; allow result-language only when clearly attributed to
  // prior/previous/documented studies.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (RESULT_RE.test(sentence) && !/\b(prior|previous|documented|earlier|past|history)\b/i.test(sentence)) {
      failures.push({ code: "results_language", message: `Result/finding language for the ordered (not-yet-performed) study in ${where}: "${sentence.trim().slice(0, 80)}".` });
      break;
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jaccardSentences(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const s of setA) if (setB.has(s)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

/** Human-readable corrective feedback for a retry. */
export function complianceFeedback(failures: ComplianceFailure[]): string {
  return failures.map((f) => `- (${f.code}) ${f.message}`).join("\n");
}

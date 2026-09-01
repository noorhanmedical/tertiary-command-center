// Slice A0 — Structured ACS/PCS screening evidence contract.
//
// Pure + isomorphic (no DB, no node:crypto) so A0-UI can reuse it for
// pre-submit validation. Models the EXACT BrainWave (2-page) and VitalWave
// (1-page) patient questionnaires.
//
// Scope boundaries (approved):
//   • The FULL response set is always preserved. There is NO >=3 (or any)
//     numeric relevance threshold here.
//   • ORDER NOTE PROJECTION (which findings appear in the physician-facing
//     note) is a SEPARATE A1 policy and is intentionally NOT in this file.
//   • The SCREENING concept layer is distinct from the diagnosis/qualification
//     vocabulary in shared/plexus.ts. SCREENING_CONCEPT_CROSSWALK maps a
//     screening concept to related qualification concepts for A1 corroboration
//     ONLY — it NEVER auto-promotes a patient-reported concept into a
//     diagnosis. A0 functions fully without consuming the crosswalk clinically.

import { z } from "./_common";

export const SCREENING_EVIDENCE_SCHEMA_VERSION = 1 as const;

// ─── Evidence classes ───────────────────────────────────────────────
// Questionnaire answers may ONLY emit the patient_reported_* classes.
// ACS/PCS transcription NEVER turns an answer into staff_documented
// evidence — staff identity is transcription/provenance metadata only.
export const EVIDENCE_CLASSES = [
  "patient_reported_symptom",
  "patient_reported_condition_history",
  "patient_reported_diagnosis_history",
  "patient_reported_event_history",
  "patient_reported_medication_use",
  "chart_documented_diagnosis",
  "chart_documented_history",
  "medication_evidence_from_chart",
  "clinician_entered_finding",
  "staff_documented_screening_response",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

// The only classes a questionnaire response is permitted to carry.
export const QUESTIONNAIRE_EMITTABLE_CLASSES: ReadonlySet<EvidenceClass> = new Set<EvidenceClass>([
  "patient_reported_symptom",
  "patient_reported_condition_history",
  "patient_reported_diagnosis_history",
  "patient_reported_event_history",
  "patient_reported_medication_use",
]);

export const QUESTIONNAIRES = ["brainwave", "vitalwave"] as const;
export type Questionnaire = (typeof QUESTIONNAIRES)[number];

// Plexus electronic/registry schema version (NOT the printed source-form
// revision — see capture.sourceForm.revision, which is distinct).
export const BRAINWAVE_QUESTIONNAIRE_VERSION = "bw_v1" as const;
export const VITALWAVE_QUESTIONNAIRE_VERSION = "vw_v1" as const;

// Scale label maps (exact wording from the PDFs).
export const SEVERITY_MEANINGS = ["n/a", "slight", "mild", "moderate", "severe", "very_severe"] as const;
export const FREQUENCY_MEANINGS = ["n/a", "very_seldom", "seldom", "sometimes", "often", "very_often"] as const;

export type ScreeningResponseType = "severity_scale" | "frequency_scale" | "boolean";

export type ScreeningRegistryItem = {
  questionId: string;
  questionnaire: Questionnaire;
  questionnaireVersion: string;
  // Exact source questionnaire label (for the ACS/PCS UI). Never re-typed.
  label: string;
  section: string;
  // Faithful paper-form location, preserved for audit even when the
  // normalized `section` collapses two visual blocks (e.g. VW medication).
  sourceSection?: string;
  responseType: ScreeningResponseType;
  concept: string;
  evidenceClass: EvidenceClass;
  // control items (e.g. "Other / N/A") are stored but never projected.
  control?: boolean;
  recency?: "recent";
};

// ─── Builders (keep the registry DRY + one entry per exact source item) ──
type Tuple = [slug: string, label: string, concept: string];

function bwDx([slug, label, concept]: Tuple): ScreeningRegistryItem {
  return {
    questionId: `bw_dx_${slug}`,
    questionnaire: "brainwave",
    questionnaireVersion: BRAINWAVE_QUESTIONNAIRE_VERSION,
    label,
    section: "diagnosis_history",
    responseType: "severity_scale",
    concept,
    evidenceClass: "patient_reported_condition_history",
  };
}

// Page-2 items are patient_reported_symptom by default. Explicit source
// "History of" rows are condition history; the time-bounded COVID row is a
// discrete event. The numeric value is stored faithfully but A1 must treat
// these primarily as reported history/event, not a "frequency of a history".
const BW_SYM_CONDITION_HISTORY = new Set([
  "concussion_history", "epilepsy_history", "ptsd_history", "seizures_history", "stroke_history",
]);
const BW_SYM_EVENT_HISTORY = new Set(["covid_positive_6mo"]);
function bwSym([slug, label, concept]: Tuple): ScreeningRegistryItem {
  const evidenceClass: EvidenceClass = BW_SYM_EVENT_HISTORY.has(slug)
    ? "patient_reported_event_history"
    : BW_SYM_CONDITION_HISTORY.has(slug)
      ? "patient_reported_condition_history"
      : "patient_reported_symptom";
  return {
    questionId: `bw_sym_${slug}`,
    questionnaire: "brainwave",
    questionnaireVersion: BRAINWAVE_QUESTIONNAIRE_VERSION,
    label,
    section: "symptoms",
    responseType: "frequency_scale",
    concept,
    evidenceClass,
  };
}

function vw(
  section: string,
  cls: EvidenceClass,
  [slug, label, concept]: Tuple,
  opts: { control?: boolean; recency?: "recent"; sourceSection?: string } = {},
): ScreeningRegistryItem {
  return {
    questionId: `vw_${slug}`,
    questionnaire: "vitalwave",
    questionnaireVersion: VITALWAVE_QUESTIONNAIRE_VERSION,
    label,
    section,
    responseType: "boolean",
    concept,
    evidenceClass: cls,
    ...opts,
  };
}

// ── BrainWave PAGE 1 — DIAGNOSIS / HISTORY (severity 0–5) · 54 items ──
const BW_DX: Tuple[] = [
  ["adhd", "ADHD", "adhd"],
  ["addiction_alcohol", "Addiction – Alcohol", "alcohol_use"],
  ["addiction_drug", "Addiction – Drug", "drug_use"],
  ["addictive_disorder", "Addictive Disorder", "addictive_disorder"],
  ["allergies", "Allergies", "allergies"],
  ["altered_hearing", "Altered Hearing", "altered_hearing"],
  ["alzheimer", "Alzheimer", "alzheimer"],
  ["anxiety", "Anxiety", "anxiety"],
  ["apathy", "Apathy", "apathy"],
  ["atherosclerosis", "Atherosclerosis", "atherosclerosis"],
  ["attention_deficit", "Attention-Deficit", "attention_deficit"],
  ["autism", "Autism", "autism"],
  ["back_pain", "Back Pain", "back_pain"],
  ["balance_problems", "Balance Problems", "balance_problems"],
  ["bipolar_disorder", "Bipolar Disorder", "bipolar_disorder"],
  ["blurry_vision_spots", "Blurry Vision or Spots Before Eyes", "visual_disturbance"],
  ["brain_fog", "Brain Fog", "brain_fog"],
  ["bruxism", "Bruxism", "bruxism"],
  ["cannabis_use", "Cannabis Use", "cannabis_use"],
  ["chronic_fatigue", "Chronic Fatigue", "chronic_fatigue"],
  ["chronic_pain", "Chronic Pain", "chronic_pain"],
  ["concussion_last_month", "Concussion (last month)", "concussion_recent"],
  ["concussion_last_week", "Concussion (last week)", "concussion_recent"],
  ["delusions", "Delusions", "delusions"],
  ["dementia", "Dementia", "dementia"],
  ["dementia_vascular", "Dementia – Vascular", "vascular_dementia"],
  ["depression", "Depression", "depression"],
  ["depression_major", "Depression – Major", "major_depression"],
  ["diabetes", "Diabetes", "diabetes"],
  ["dyslexia", "Dyslexia", "dyslexia"],
  ["epilepsy", "Epilepsy", "epilepsy"],
  ["fear_responses", "Fear Responses", "fear_responses"],
  ["fibromyalgia", "Fibromyalgia", "fibromyalgia"],
  ["headaches", "Headaches", "headaches"],
  ["impulsive_behaviors", "Impulsive Behaviors", "impulsivity"],
  ["insomnia", "Insomnia", "insomnia"],
  ["irritable", "Irritable", "irritability"],
  ["learning_disabilities", "Learning Disabilities", "learning_disability"],
  ["memory_problems", "Memory Problems", "memory_difficulty"],
  ["migraine", "Migraine", "migraine"],
  ["multiple_sclerosis", "Multiple Sclerosis", "multiple_sclerosis"],
  ["narcolepsy", "Narcolepsy", "narcolepsy"],
  ["nausea", "Nausea", "nausea"],
  ["ocd", "Obsessive Compulsive (OCD)", "ocd"],
  ["ptsd", "PTSD", "ptsd"],
  ["panic_attacks", "Panic Attacks", "panic_attacks"],
  ["parkinsons", "Parkinson's", "parkinsons"],
  ["schizophrenia", "Schizophrenia", "schizophrenia"],
  ["seizures", "Seizures", "seizures"],
  ["sleep_apnea", "Sleep Apnea", "sleep_apnea"],
  ["stressed", "Stressed", "stress"],
  ["stroke", "Stroke", "stroke"],
  ["syncope", "Syncope", "syncope"],
  ["tinnitus", "Tinnitus", "tinnitus"],
];

// ── BrainWave PAGE 2 — SYMPTOMS (frequency 0–5) · 55 items ──
const BW_SYM: Tuple[] = [
  ["addiction_substance_use", "Addiction / substance use", "substance_use"],
  ["aggressive_hostile_impulsivity", "Aggressive, or hostile impulsivity", "impulsivity"],
  ["altered_hearing", "Altered Hearing", "altered_hearing"],
  ["altered_smell", "Altered sense of smell", "altered_smell"],
  ["altered_vision", "Altered vision", "visual_disturbance"],
  ["anger_agitation", "Anger / Agitation", "agitation"],
  ["anxiety_worry", "Anxiety, Feelings of worry", "anxiety"],
  ["autism", "Autism", "autism"],
  ["word_finding_speech", "Can't find the correct word to convey in speech", "word_finding_difficulty"],
  ["change_in_handwriting", "Change in handwriting", "handwriting_change"],
  ["chronic_pain", "Chronic Pain", "chronic_pain"],
  ["concussion_last_month", "Concussion (last month)", "concussion_recent"],
  ["concussion_last_week", "Concussion (last week)", "concussion_recent"],
  ["concussion_history", "Concussion, History of", "concussion_history"],
  ["decreased_attention", "Decreased Attention / Distracted", "attention_difficulty"],
  ["depression_sadness", "Depression / Feelings of sadness", "depression"],
  ["difficulty_words", "Difficult to find words or understand words", "word_comprehension_difficulty"],
  ["difficulty_following_directions", "Difficulty following directions", "following_directions_difficulty"],
  ["difficulty_multitasking", "Difficulty multitasking / disorganized", "multitasking_difficulty"],
  ["dizziness_vertigo_imbalance", "Dizziness / vertigo / imbalance", "dizziness_imbalance"],
  ["isolation_distancing", "Do things that result in isolation or distancing from others", "social_isolation"],
  ["sleep_onset_maintenance", "Don't fall asleep or stay asleep at night", "sleep_difficulty"],
  ["anhedonia", "Don't find enjoyment in previously enjoyable activities or events", "anhedonia"],
  ["poor_smell", "Don't have a good sense of smell", "altered_smell"],
  ["low_energy", "Don't have enough energy to get moving in the morning and sustain", "low_energy"],
  ["dont_recall_face", "Don't recall a face", "face_recognition_difficulty"],
  ["dont_recall_day", "Don't recall what day of the week it is", "temporal_orientation_difficulty"],
  ["dont_recall_month", "Don't recall what month it is", "temporal_orientation_difficulty"],
  ["dont_recognize_person", "Don't recognize a person you know you've met before", "face_recognition_difficulty"],
  ["epilepsy_history", "Epilepsy, History of", "epilepsy_history"],
  ["muscle_weakness", "Experience muscle weakness", "muscle_weakness"],
  ["forgetful_poor_memory", "Forgetful / poor memory", "memory_difficulty"],
  ["metallic_taste", "Get a metallic taste in my mouth", "metallic_taste"],
  ["panic_breath", "Get a sense of Panic with difficulty catching a breath", "panic_symptoms"],
  ["dizzy_balance", "Get dizzy or easily lose my balance", "dizziness_imbalance"],
  ["headaches_migraines", "Get headaches or migraines", "headaches"],
  ["get_lost", "Get lost", "getting_lost"],
  ["tinnitus", "Get ringing in ears or tinnitus", "tinnitus"],
  ["lost_familiar_places", "Gets lost in familiar places", "getting_lost"],
  ["hallucinations", "Hallucinations", "hallucinations"],
  ["sloppy_handwriting", "Handwriting is sloppy and difficult to read", "handwriting_change"],
  ["headaches", "Headaches", "headaches"],
  ["nightmares", "Nightmares / Bad dreams", "nightmares"],
  ["ptsd_current", "PTSD, Current symptoms", "ptsd"],
  ["ptsd_history", "PTSD, History of", "ptsd_history"],
  ["schizophrenia", "Schizophrenia", "schizophrenia"],
  ["seizures_history", "Seizures, History of", "seizures_history"],
  ["snoring_sleep_apnea", "Snoring / sleep apnea", "sleep_apnea"],
  ["social_isolation", "Social isolation", "social_isolation"],
  ["sound_sensitivity", "Sounds that are not loud to others do bother me", "sound_sensitivity"],
  ["stroke_history", "Stroke, History of", "stroke_history"],
  ["sudden_fear_reactions", "Sudden Fear Reactions", "fear_responses"],
  ["covid_positive_6mo", "Tested positive for COVID-19 within the past 6 months", "covid_recent"],
  ["unreasonable_thoughts_fears", "Unreasonable thoughts and Fears", "intrusive_thoughts"],
  ["incorrect_words", "Use incorrect words when speaking", "paraphasia"],
];

// ── VitalWave (boolean) · 70 checkboxes (68 clinical + 2 control) ──
const VW_GENERAL: Array<[Tuple, EvidenceClass]> = [
  [["gen_pacemaker_heart_surgery", "Pacemaker or prior heart surgery", "cardiac_device_or_surgery"], "patient_reported_diagnosis_history"],
  [["gen_depression_often", "Often experience depression", "depression"], "patient_reported_symptom"],
  [["gen_stressed_often", "Feel stressed out often", "stress"], "patient_reported_symptom"],
  [["gen_sleep_difficulty", "Difficulty falling asleep / toss and turn / wake unrested", "sleep_difficulty"], "patient_reported_symptom"],
  [["gen_sedentary_inactive", "Sedentary or inactive lifestyle", "sedentary_lifestyle"], "patient_reported_symptom"],
];
const VW_SYMPTOMS: Tuple[] = [
  ["sym_apathy", "Apathy", "apathy"],
  ["sym_back_pain", "Back pain", "back_pain"],
  ["sym_chest_pain", "Chest pain", "chest_pain"],
  ["sym_tingling_fingers", "Tingling in fingers", "paresthesia_fingers"],
  ["sym_blurry_vision_spots", "Blurry vision or spots before eyes", "visual_disturbance"],
  ["sym_fainting", "Fainting", "syncope"],
  ["sym_dizziness_lightheadedness", "Dizziness or lightheadedness", "dizziness_lightheadedness"],
  ["sym_insomnia", "Insomnia", "insomnia"],
  ["sym_anxiety_panic", "Anxiety or panic attacks", "anxiety_panic"],
  ["sym_fibromyalgia", "Fibromyalgia", "fibromyalgia"],
  ["sym_depression", "Depression", "depression"],
  ["sym_migraine_headaches", "Migraine and headaches", "migraine_headaches"],
];
// Two visual "Are you taking medication for" blocks share one clinical
// meaning → normalized section "medication"; sourceSection preserves the
// exact paper-form block for audit.
const VW_MED_BLOCK_1: Tuple[] = [
  ["med_ace_inhibitor_cough", "ACE inhibitor (with cough)", "ace_inhibitor"],
  ["med_antidepressant", "Antidepressant", "antidepressant"],
  ["med_statin_red_yeast_rice", "Statin or red yeast rice", "statin"],
  ["med_hypertension", "High blood pressure (hypertension) medication", "antihypertensive"],
];
const VW_MED_BLOCK_2: Array<[Tuple, boolean?]> = [
  [["med_calcium_channel_blocker", "Calcium channel blockers", "ccb"]],
  [["med_angiotensin_blocker", "Angiotensin blockers", "arb"]],
  [["med_anticholinergic", "Anti-cholinergics", "anticholinergic"]],
  [["med_alpha_adrenergic_agonist", "Alpha adrenergic agonists", "alpha_agonist"]],
  [["med_beta2_agonist", "Beta 2 adrenergic agonists", "beta2_agonist"]],
  [["med_beta1_blocker", "Beta 1 adrenergic blockers", "beta1_blocker"]],
  [["med_other_na", "Other / N/A", "other_or_na"], true],
];
const VW_FEEL: Tuple[] = [
  ["feel_anxious", "Anxious", "anxious"],
  ["feel_irritable", "Irritable", "irritable"],
  ["feel_tense", "Tense", "tense"],
];
const VW_EVER: Tuple[] = [
  ["dx_cancer", "Cancer", "cancer"],
  ["dx_asthma", "Asthma", "asthma"],
  ["dx_parkinsons", "Parkinson's disease", "parkinsons"],
  ["dx_sleep_disorders", "Sleep disorders", "sleep_disorder"],
  ["dx_hiv", "HIV", "hiv"],
  ["dx_syncope", "Syncope", "syncope"],
  ["dx_atherosclerosis", "Atherosclerosis", "atherosclerosis"],
  ["dx_eating_disorders", "Eating disorders", "eating_disorder"],
  ["dx_ulcerative_colitis", "Ulcerative colitis", "ulcerative_colitis"],
  ["dx_heart_attack", "Heart attack", "myocardial_infarction"],
  ["dx_cardiomyopathy_enlarged_heart", "Cardiomyopathy or an enlarged heart", "cardiomyopathy"],
  ["dx_reduced_ejection_fraction", "Diminished ejection time or reduced ejection fraction", "reduced_ejection_fraction"],
  ["dx_diabetes_type1", "Diabetes type 1", "diabetes_type1"],
  ["dx_angina", "Angina", "angina"],
  ["dx_muscular_dystrophy", "Muscular dystrophy", "muscular_dystrophy"],
  ["dx_sleep_apnea", "Sleep apnea", "sleep_apnea"],
  ["dx_toxicity", "Toxicity", "toxicity"],
  ["dx_lung_disease", "Lung disease", "lung_disease"],
  ["dx_arteriosclerosis", "Arteriosclerosis", "arteriosclerosis"],
  ["dx_ibs", "Irritable bowel syndrome (IBS)", "ibs"],
  ["dx_cystic_fibrosis", "Cystic fibrosis", "cystic_fibrosis"],
  ["dx_chf", "Congestive heart failure (CHF)", "chf"],
  ["dx_diabetes_type2", "Diabetes type 2", "diabetes_type2"],
  ["dx_alzheimers", "Alzheimer's disease", "alzheimer"],
  ["dx_periodontitis", "Periodontitis", "periodontitis"],
  ["dx_thyroid_disease", "Thyroid disease", "thyroid_disease"],
  ["dx_nutritional_deficiencies", "Nutritional deficiencies", "nutritional_deficiency"],
  ["dx_orthostatic_hypotension", "Orthostatic hypotension", "orthostatic_hypotension"],
  ["dx_hardening_arteries", "Hardening of the arteries", "arterial_hardening"],
  ["dx_crohns", "Crohn's disease", "crohns"],
  ["dx_thyroid_problems", "Thyroid problems", "thyroid_problem"],
  ["dx_peripheral_vascular_disease", "Peripheral vascular disease", "pvd"],
  ["dx_chronic_venous_insufficiency_varicose", "Chronic venous insufficiency or varicose veins", "cvi_varicose"],
  ["dx_arrhythmia", "Heart arrhythmia / irregular or abnormal heartbeat", "arrhythmia"],
];
const VW_RECENT: Array<[Tuple, boolean?]> = [
  [["recent_high_blood_pressure", "High blood pressure", "hypertension"]],
  [["recent_low_blood_pressure", "Low blood pressure", "hypotension"]],
  [["recent_high_cholesterol", "High cholesterol", "hypercholesterolemia"]],
  [["recent_iron_deficiency_anemia", "Iron deficiency anemia", "iron_deficiency_anemia"]],
  [["recent_other_na", "Other / N/A", "other_or_na"], true],
];

export const SCREENING_REGISTRY: ScreeningRegistryItem[] = [
  ...BW_DX.map(bwDx),
  ...BW_SYM.map(bwSym),
  ...VW_GENERAL.map(([t, cls]) => vw("general", cls, t)),
  ...VW_SYMPTOMS.map((t) => vw("symptoms", "patient_reported_symptom", t)),
  ...VW_MED_BLOCK_1.map((t) => vw("medication", "patient_reported_medication_use", t, { sourceSection: "medication_block_1" })),
  ...VW_MED_BLOCK_2.map(([t, control]) =>
    vw("medication", "patient_reported_medication_use", t, { sourceSection: "medication_block_2", ...(control ? { control: true } : {}) })),
  ...VW_FEEL.map((t) => vw("recent_feelings", "patient_reported_symptom", t)),
  ...VW_EVER.map((t) => vw("ever_diagnosed", "patient_reported_diagnosis_history", t)),
  ...VW_RECENT.map(([t, control]) =>
    vw("recently_diagnosed", "patient_reported_diagnosis_history", t, { recency: "recent", ...(control ? { control: true } : {}) })),
];

export function registryFor(questionnaire: Questionnaire, version: string): Map<string, ScreeningRegistryItem> {
  const m = new Map<string, ScreeningRegistryItem>();
  for (const it of SCREENING_REGISTRY) {
    if (it.questionnaire === questionnaire && it.questionnaireVersion === version) m.set(it.questionId, it);
  }
  return m;
}

// ─── SCREENING → QUALIFICATION crosswalk (A1 corroboration ONLY) ────────
// Maps a screening concept to related diagnosis/qualification concept name(s)
// as they appear in shared/plexus.ts (BRAINWAVE_MAPPING / VITALWAVE_CONFIG /
// ULTRASOUND_CONFIG). This NEVER auto-promotes a patient-reported concept
// into a diagnosis; A1 uses it only to corroborate independently documented
// chart/qualification evidence. A0 does not consume this clinically.
export const SCREENING_CONCEPT_CROSSWALK: Readonly<Record<string, readonly string[]>> = {
  memory_difficulty: ["Memory Loss", "Mild Cognitive Impairment"],
  attention_difficulty: ["ADHD, Predominantly Inattentive"],
  adhd: ["ADHD, Predominantly Inattentive"],
  attention_deficit: ["ADHD, Predominantly Inattentive"],
  depression: ["Depression"],
  major_depression: ["Major Depressive Disorder"],
  anxiety: ["Generalized Anxiety Disorder"],
  panic_symptoms: ["Generalized Anxiety Disorder"],
  anxiety_panic: ["Generalized Anxiety Disorder"],
  dizziness_imbalance: ["Dizziness and Giddiness"],
  dizziness_lightheadedness: ["Dizziness and Giddiness"],
  balance_problems: ["Dizziness and Giddiness"],
  headaches: ["Headache"],
  migraine: ["Headache"],
  migraine_headaches: ["Headache"],
  seizures: ["Seizure Disorder"],
  epilepsy: ["Seizure Disorder"],
  seizures_history: ["Seizure Disorder"],
  epilepsy_history: ["Seizure Disorder"],
  stroke: ["Stroke/TIA History"],
  stroke_history: ["Stroke/TIA History"],
  insomnia: ["Insomnia"],
  sleep_difficulty: ["Insomnia"],
  chronic_pain: ["Chronic Pain"],
  chronic_fatigue: ["Chronic Fatigue"],
  pvd: ["Peripheral Arterial Disease"],
  hypertension: ["Essential Hypertension"],
  antihypertensive: ["Essential Hypertension"],
  diabetes: ["Type 2 Diabetes Mellitus"],
  diabetes_type2: ["Type 2 Diabetes Mellitus"],
  diabetes_type1: ["Type 2 Diabetes Mellitus"],
  atherosclerosis: ["Atherosclerosis of Aorta", "Atherosclerosis"],
  arteriosclerosis: ["Atherosclerosis of Aorta", "Atherosclerosis"],
  arterial_hardening: ["Atherosclerosis of Aorta", "Atherosclerosis"],
  syncope: ["Syncope and Collapse"],
  arrhythmia: ["Cardiac Arrhythmia", "Atrial Fibrillation"],
  cardiomyopathy: ["Cardiomyopathy"],
  reduced_ejection_fraction: ["Chronic Diastolic Heart Failure"],
  orthostatic_hypotension: ["Orthostatic Hypotension"],
  chest_pain: ["Chest Pain"],
  angina: ["Chest Pain / Angina"],
} as const;

// ─── Zod contract ───────────────────────────────────────────────────
export const screeningCaptureSchema = z
  .object({
    origin: z.enum(["direct_entry", "transcribed_from_paper"]),
    // Who keyed/attested the structured record. NOT the source of the
    // answers — the patient remains the source of record.
    documentedByUserId: z.string().min(1),
    documentedByRole: z.enum(["ACS", "PCS", "clinician", "admin"]),
    documentedAt: z.string().datetime(),
    // Distinct from questionnaireVersion (Plexus registry version): this is
    // the printed revision of the source paper/PDF form, when known.
    sourceForm: z.object({
      name: z.string().min(1),
      revision: z.string().nullable(),
    }),
    // Present only when origin === "transcribed_from_paper".
    transcription: z
      .object({
        sourceDocumentReferenceId: z.number().int().optional(),
        sourceReadinessId: z.number().int().optional(),
        transcribedByUserId: z.string().min(1),
        transcribedByRole: z.enum(["ACS", "PCS", "clinician", "admin"]),
        transcribedAt: z.string().datetime(),
        verifiedByUserId: z.string().optional(),
        verifiedAt: z.string().datetime().optional(),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.origin === "transcribed_from_paper" && !c.transcription) {
      ctx.addIssue({ code: "custom", path: ["transcription"], message: "transcription block required when origin=transcribed_from_paper" });
    }
    if (c.origin === "direct_entry" && c.transcription) {
      ctx.addIssue({ code: "custom", path: ["transcription"], message: "transcription block not allowed for origin=direct_entry" });
    }
  });
export type ScreeningCapture = z.infer<typeof screeningCaptureSchema>;

const scaleResponseSchema = z.object({
  questionId: z.string(),
  questionnaire: z.enum(QUESTIONNAIRES),
  section: z.string(),
  questionVersion: z.string(),
  responseType: z.enum(["severity_scale", "frequency_scale"]),
  value: z.number().int().min(0).max(5),
  normalizedMeaning: z.string(),
  concept: z.string(),
  evidenceClass: z.enum(EVIDENCE_CLASSES),
});
const booleanResponseSchema = z.object({
  questionId: z.string(),
  questionnaire: z.enum(QUESTIONNAIRES),
  section: z.string(),
  questionVersion: z.string(),
  responseType: z.literal("boolean"),
  value: z.boolean(),
  concept: z.string(),
  evidenceClass: z.enum(EVIDENCE_CLASSES),
  recency: z.literal("recent").optional(),
});
export const screeningResponseSchema = z.union([scaleResponseSchema, booleanResponseSchema]);
export type ScreeningResponse = z.infer<typeof screeningResponseSchema>;

export const ancillaryScreeningEvidenceSchema = z
  .object({
    schemaVersion: z.literal(SCREENING_EVIDENCE_SCHEMA_VERSION),
    questionnaire: z.enum(QUESTIONNAIRES),
    questionnaireVersion: z.string(),
    ancillaryCaseId: z.number().int(),
    clinicId: z.number().int(),
    serviceType: z.string().min(1),
    screeningReadinessId: z.number().int(),
    completionMode: z.literal("structured_questionnaire"),
    capture: screeningCaptureSchema,
    responses: z.array(screeningResponseSchema).min(1),
    screeningNotes: z.string().optional(),
  })
  .superRefine((ev, ctx) => {
    const reg = registryFor(ev.questionnaire, ev.questionnaireVersion);
    if (reg.size === 0) {
      ctx.addIssue({ code: "custom", message: `unknown questionnaire version ${ev.questionnaire}/${ev.questionnaireVersion}` });
      return;
    }
    const seen = new Set<string>();
    ev.responses.forEach((r, i) => {
      const spec = reg.get(r.questionId);
      if (!spec) {
        ctx.addIssue({ code: "custom", path: ["responses", i, "questionId"], message: `unknown questionId ${r.questionId}` });
        return;
      }
      if (seen.has(r.questionId)) ctx.addIssue({ code: "custom", path: ["responses", i, "questionId"], message: `duplicate ${r.questionId}` });
      seen.add(r.questionId);
      // Closed validation — the registry is the source of truth.
      if (r.questionnaire !== ev.questionnaire) ctx.addIssue({ code: "custom", path: ["responses", i, "questionnaire"], message: "questionnaire mismatch" });
      for (const f of ["section", "concept", "evidenceClass", "responseType"] as const) {
        if ((r as Record<string, unknown>)[f] !== (spec as Record<string, unknown>)[f]) {
          ctx.addIssue({ code: "custom", path: ["responses", i, f], message: `${f} mismatch for ${r.questionId} (registry=${String((spec as Record<string, unknown>)[f])})` });
        }
      }
      if (!QUESTIONNAIRE_EMITTABLE_CLASSES.has(r.evidenceClass)) {
        ctx.addIssue({ code: "custom", path: ["responses", i, "evidenceClass"], message: `class ${r.evidenceClass} is not emittable from a questionnaire response` });
      }
    });
  });
export type AncillaryScreeningEvidence = z.infer<typeof ancillaryScreeningEvidenceSchema>;

// ─── Completion policy (deterministic; reusable by A0-UI) ───────────
export function requiredQuestionIds(questionnaire: Questionnaire, version: string): string[] {
  return SCREENING_REGISTRY
    .filter((i) => i.questionnaire === questionnaire && i.questionnaireVersion === version && !i.control)
    .map((i) => i.questionId);
}

// Complete = every required (non-control) item is present with a valid value.
// A present value of 0 (BW N/A) or false (VW No) COUNTS as answered.
// Missing (absent questionId) is NOT the same as 0/false.
export function evaluateCompletion(ev: AncillaryScreeningEvidence): { complete: boolean; missing: string[] } {
  const required = new Set(requiredQuestionIds(ev.questionnaire, ev.questionnaireVersion));
  for (const r of ev.responses) required.delete(r.questionId);
  const missing = [...required];
  return { complete: missing.length === 0, missing };
}

// ─── FULL screening evidence canonical string (A0 fingerprint input) ─
// Deterministic + order-independent + includes EVERY response value
// (0 and false included). EXCLUDES capture identity/timestamps and notes so
// re-transcription of identical answers does not change the version. This is
// the FULL screening version — distinct from the Order Note evidence
// fingerprint (which A1 computes from the PROJECTED clinical subset).
export function canonicalScreeningEvidenceString(ev: AncillaryScreeningEvidence): string {
  const rows = ev.responses
    .map((r) => `${r.questionId}=${typeof r.value === "boolean" ? (r.value ? "T" : "F") : r.value}`)
    .sort();
  return JSON.stringify({
    q: ev.questionnaire,
    v: ev.questionnaireVersion,
    case: ev.ancillaryCaseId,
    service: ev.serviceType,
    rows,
  });
}

// ─── Legacy normalization (backward-compatible) ─────────────────────
// The current product captures screening only as a PDF upload / readiness
// flag (no structured per-question data). This conservative adapter never
// fabricates structured answers from an arbitrary legacy metadata blob; it
// reports the completion mode so callers keep the legacy uploaded_document
// path working while structured evidence remains the gate-satisfying path.
export type NormalizedLegacyScreening = {
  completionMode: "uploaded_document" | "unknown";
  mappedResponses: ScreeningResponse[]; // intentionally empty unless confidently mappable
  unmapped: unknown;
};
export function normalizeLegacyScreeningMetadata(raw: unknown): NormalizedLegacyScreening {
  const meta = (raw ?? {}) as Record<string, unknown>;
  const looksUploaded = meta.storageKey != null || meta.documentId != null || meta.uploaded === true;
  return {
    completionMode: looksUploaded ? "uploaded_document" : "unknown",
    mappedResponses: [],
    unmapped: raw ?? null,
  };
}

// ─── Screening concept → clinician-readable display text ────────────────
// Used by A1 to render a patient-specific narrative. Falls back to a
// humanized slug when a concept is not explicitly mapped. This is display
// only — it never changes the evidence class or certainty.
export const SCREENING_CONCEPT_DISPLAY: Readonly<Record<string, string>> = {
  memory_difficulty: "memory difficulty",
  attention_difficulty: "difficulty with attention and concentration",
  attention_deficit: "attention deficit",
  adhd: "attention-deficit/hyperactivity concerns",
  depression: "depressive symptoms",
  major_depression: "major depressive symptoms",
  anxiety: "anxiety",
  panic_symptoms: "panic symptoms",
  panic_attacks: "panic attacks",
  anxiety_panic: "anxiety or panic",
  dizziness_imbalance: "dizziness, vertigo, or imbalance",
  dizziness_lightheadedness: "dizziness or lightheadedness",
  balance_problems: "balance problems",
  headaches: "headaches",
  migraine: "migraine",
  migraine_headaches: "migraine and headaches",
  seizures: "seizures",
  epilepsy: "epilepsy",
  seizures_history: "a history of seizures",
  epilepsy_history: "a history of epilepsy",
  stroke: "stroke",
  stroke_history: "a history of stroke",
  concussion_recent: "recent concussion",
  concussion_history: "a history of concussion",
  insomnia: "insomnia",
  sleep_difficulty: "difficulty with sleep",
  sleep_apnea: "sleep apnea",
  sleep_disorder: "a sleep disorder",
  chronic_pain: "chronic pain",
  chronic_fatigue: "chronic fatigue",
  brain_fog: "brain fog",
  word_finding_difficulty: "word-finding difficulty",
  word_comprehension_difficulty: "difficulty finding or understanding words",
  following_directions_difficulty: "difficulty following directions",
  multitasking_difficulty: "difficulty multitasking",
  anhedonia: "loss of enjoyment in previously enjoyable activities",
  low_energy: "low energy",
  face_recognition_difficulty: "difficulty recognizing faces",
  temporal_orientation_difficulty: "difficulty recalling the day or month",
  getting_lost: "getting lost",
  muscle_weakness: "muscle weakness",
  metallic_taste: "a metallic taste",
  handwriting_change: "a change in handwriting",
  nightmares: "nightmares",
  hallucinations: "hallucinations",
  sound_sensitivity: "sensitivity to sound",
  intrusive_thoughts: "unreasonable thoughts and fears",
  paraphasia: "using incorrect words when speaking",
  fear_responses: "sudden fear responses",
  impulsivity: "impulsivity",
  agitation: "anger or agitation",
  altered_hearing: "altered hearing",
  altered_smell: "altered sense of smell",
  visual_disturbance: "blurry vision or visual disturbance",
  tinnitus: "ringing in the ears (tinnitus)",
  nausea: "nausea",
  substance_use: "substance use",
  alcohol_use: "alcohol use",
  drug_use: "drug use",
  cannabis_use: "cannabis use",
  social_isolation: "social isolation",
  covid_recent: "testing positive for COVID-19 within the past six months",
  back_pain: "back pain",
  chest_pain: "chest pain",
  paresthesia_fingers: "tingling in the fingers",
  syncope: "fainting (syncope)",
  fibromyalgia: "fibromyalgia",
  stress: "frequent stress",
  sedentary_lifestyle: "a sedentary or inactive lifestyle",
  anxious: "feeling anxious",
  irritable: "feeling irritable",
  tense: "feeling tense",
  irritability: "irritability",
  // VW diagnosis-history concepts
  pvd: "a history of peripheral vascular disease",
  cvi_varicose: "a history of chronic venous insufficiency or varicose veins",
  arrhythmia: "a history of arrhythmia or irregular heartbeat",
  cardiomyopathy: "a history of cardiomyopathy or an enlarged heart",
  reduced_ejection_fraction: "a history of reduced ejection fraction",
  orthostatic_hypotension: "a history of orthostatic hypotension",
  atherosclerosis: "a history of atherosclerosis",
  arteriosclerosis: "a history of arteriosclerosis",
  arterial_hardening: "a history of hardening of the arteries",
  angina: "a history of angina",
  myocardial_infarction: "a history of heart attack",
  chf: "a history of congestive heart failure",
  hypertension: "high blood pressure",
  hypotension: "low blood pressure",
  hypercholesterolemia: "high cholesterol",
  iron_deficiency_anemia: "iron deficiency anemia",
  diabetes: "diabetes",
  diabetes_type1: "type 1 diabetes",
  diabetes_type2: "type 2 diabetes",
  cardiac_device_or_surgery: "a pacemaker or prior heart surgery",
  // Medication classes (patient-reported use)
  ace_inhibitor: "an ACE inhibitor",
  antidepressant: "an antidepressant",
  statin: "a statin or red yeast rice",
  antihypertensive: "blood pressure medication",
  ccb: "a calcium channel blocker",
  arb: "an angiotensin blocker",
  anticholinergic: "an anticholinergic",
  alpha_agonist: "an alpha-adrenergic agonist",
  beta2_agonist: "a beta-2 adrenergic agonist",
  beta1_blocker: "a beta-1 adrenergic blocker",
};

export function screeningConceptDisplay(concept: string): string {
  return SCREENING_CONCEPT_DISPLAY[concept] ?? concept.replace(/_/g, " ");
}

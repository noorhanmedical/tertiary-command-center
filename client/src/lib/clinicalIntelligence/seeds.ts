// Clinical Intelligence & Governance — seeded prototype content.
//
// Static library content for the governance modules (diagnosis mapping,
// symptom library, medication evidence, findings, reasoning + order-note
// templates, CMS watch, EMR wiring, guardrails, knowledge objects) plus
// the initial seeded rules written into the localStorage store on first
// load. All content is prototype/example material for governance review —
// it does not alter the live qualification engine.

import {
  ciId,
  type CiAncillaryTarget,
  type CiConfidence,
  type CiRule,
} from "./types";

// ───── Diagnosis Mapping ────────────────────────────────────────────────

export type CiDiagnosisMapping = {
  id: string;
  diagnosis: string;
  icdHints: string[];
  symptoms: string[];
  medications: string[];
  findings: string[];
  ancillaries: string[];
  documentationUse: string;
};

export const DIAGNOSIS_MAPPINGS: CiDiagnosisMapping[] = [
  {
    id: "map-diabetes",
    diagnosis: "Diabetes mellitus",
    icdHints: ["E11.9", "E11.40", "E11.42"],
    symptoms: ["Neuropathy", "Burning feet", "Leg pain", "Numbness/tingling"],
    medications: ["Insulin", "Metformin", "Gabapentin"],
    findings: ["Diminished pedal pulses", "Sensory deficit on monofilament"],
    ancillaries: ["VitalWave"],
    documentationUse:
      "Diabetic neuropathy context supports VitalWave medical necessity when paired with symptom or medication evidence.",
  },
  {
    id: "map-stroke",
    diagnosis: "Stroke history / TIA",
    icdHints: ["Z86.73", "I63.9"],
    symptoms: ["Neurologic risk", "Memory change", "Dizziness", "Abnormal gait"],
    medications: ["Clopidogrel", "Aspirin", "Statins"],
    findings: ["Carotid bruit", "Prior imaging with infarct"],
    ancillaries: ["BrainWave", "Bilateral Carotid Duplex (93880)"],
    documentationUse:
      "Cerebrovascular history supports BrainWave and carotid imaging when neurologic symptoms are documented.",
  },
  {
    id: "map-padpvd",
    diagnosis: "PAD / PVD",
    icdHints: ["I73.9", "I70.213"],
    symptoms: ["Leg pain", "Claudication", "Edema", "Vascular risk"],
    medications: ["Cilostazol", "Antihypertensives", "Statins"],
    findings: ["Diminished distal pulses", "Skin changes / hair loss on legs"],
    ancillaries: ["VitalWave", "Lower Extremity Arterial Doppler (93925)"],
    documentationUse:
      "Peripheral vascular concern supports VitalWave and lower-extremity arterial imaging with source-linked symptoms.",
  },
  {
    id: "map-htn",
    diagnosis: "Hypertension",
    icdHints: ["I10"],
    symptoms: ["Dizziness", "Palpitations", "Headache"],
    medications: ["Lisinopril", "Amlodipine", "Losartan", "Metoprolol"],
    findings: ["Elevated BP readings", "LVH on prior ECG"],
    ancillaries: ["VitalWave", "Echocardiogram TTE (93306)"],
    documentationUse:
      "Cardiovascular history context; supports echocardiography when symptoms or exam findings are present.",
  },
  {
    id: "map-dementia",
    diagnosis: "Cognitive decline / memory loss",
    icdHints: ["G31.84", "F03.90"],
    symptoms: ["Memory loss", "Falls", "Abnormal gait", "Confusion"],
    medications: ["Donepezil", "Memantine"],
    findings: ["Abnormal cognitive screen (MoCA/MMSE)"],
    ancillaries: ["BrainWave"],
    documentationUse:
      "Cognitive symptoms plus screening findings support BrainWave with clinician-reviewed necessity language.",
  },
];

// ───── Symptom Library ──────────────────────────────────────────────────

export type CiSymptomCard = {
  id: string;
  symptom: string;
  relatedDiagnoses: string[];
  relatedMedications: string[];
  relatedFindings: string[];
  relatedAncillaries: string[];
  documentationUse: string;
  evidenceStrength: CiConfidence;
  cmsFlags: string[];
};

export const SYMPTOM_LIBRARY: CiSymptomCard[] = [
  {
    id: "sym-dizziness",
    symptom: "Dizziness",
    relatedDiagnoses: ["Stroke history / TIA", "Hypertension", "Arrhythmia"],
    relatedMedications: ["Antihypertensives", "Meclizine"],
    relatedFindings: ["Orthostatic BP change", "Nystagmus"],
    relatedAncillaries: ["BrainWave", "Bilateral Carotid Duplex (93880)"],
    documentationUse: "Neurologic/vestibular symptom; supports cerebrovascular workup context.",
    evidenceStrength: "medium",
    cmsFlags: ["Document frequency and functional impact"],
  },
  {
    id: "sym-syncope",
    symptom: "Syncope",
    relatedDiagnoses: ["Arrhythmia", "Carotid stenosis"],
    relatedMedications: ["Beta blockers"],
    relatedFindings: ["Abnormal ECG", "Carotid bruit"],
    relatedAncillaries: ["BrainWave", "Echocardiogram TTE (93306)", "Bilateral Carotid Duplex (93880)"],
    documentationUse: "High-yield symptom for cardiac and cerebrovascular necessity.",
    evidenceStrength: "high",
    cmsFlags: ["Note witnessed vs unwitnessed", "Rule-out documentation expected"],
  },
  {
    id: "sym-edema",
    symptom: "Edema",
    relatedDiagnoses: ["CHF", "Venous insufficiency", "PAD / PVD"],
    relatedMedications: ["Furosemide", "Amlodipine (drug-induced)"],
    relatedFindings: ["Pitting edema on exam"],
    relatedAncillaries: ["Echocardiogram TTE (93306)", "Lower Extremity Venous Duplex (93971)"],
    documentationUse: "Supports venous imaging and cardiac function assessment.",
    evidenceStrength: "medium",
    cmsFlags: ["Laterality must be documented"],
  },
  {
    id: "sym-dyspnea",
    symptom: "Dyspnea",
    relatedDiagnoses: ["CHF", "COPD", "Valvular disease"],
    relatedMedications: ["Diuretics", "Inhalers"],
    relatedFindings: ["Rales", "Reduced exercise tolerance"],
    relatedAncillaries: ["Echocardiogram TTE (93306)", "VitalWave"],
    documentationUse: "Supports cardiac imaging necessity with exertional detail.",
    evidenceStrength: "high",
    cmsFlags: ["Document exertional vs rest"],
  },
  {
    id: "sym-legpain",
    symptom: "Leg pain",
    relatedDiagnoses: ["PAD / PVD", "Diabetic neuropathy", "Radiculopathy"],
    relatedMedications: ["Gabapentin", "Cilostazol"],
    relatedFindings: ["Diminished pulses", "Sensory deficit"],
    relatedAncillaries: ["Lower Extremity Arterial Doppler (93925)", "VitalWave"],
    documentationUse: "Differentiate vascular vs neuropathic origin in note language.",
    evidenceStrength: "medium",
    cmsFlags: ["Claudication distance strengthens necessity"],
  },
  {
    id: "sym-claudication",
    symptom: "Claudication",
    relatedDiagnoses: ["PAD / PVD"],
    relatedMedications: ["Cilostazol"],
    relatedFindings: ["Diminished distal pulses"],
    relatedAncillaries: ["Lower Extremity Arterial Doppler (93925)"],
    documentationUse: "Classic arterial insufficiency symptom; strong necessity support.",
    evidenceStrength: "high",
    cmsFlags: ["LCD-aligned symptom for arterial duplex"],
  },
  {
    id: "sym-neuropathy",
    symptom: "Neuropathy",
    relatedDiagnoses: ["Diabetes mellitus", "B12 deficiency"],
    relatedMedications: ["Gabapentin", "Pregabalin", "Duloxetine"],
    relatedFindings: ["Monofilament sensory deficit"],
    relatedAncillaries: ["VitalWave"],
    documentationUse: "Supports autonomic/vascular assessment context.",
    evidenceStrength: "medium",
    cmsFlags: ["Link to underlying diagnosis"],
  },
  {
    id: "sym-memoryloss",
    symptom: "Memory loss",
    relatedDiagnoses: ["Cognitive decline / memory loss", "Stroke history / TIA"],
    relatedMedications: ["Donepezil", "Memantine"],
    relatedFindings: ["Abnormal cognitive screen"],
    relatedAncillaries: ["BrainWave"],
    documentationUse: "Supports cognitive/neurologic assessment necessity.",
    evidenceStrength: "medium",
    cmsFlags: ["Objective screen strengthens documentation"],
  },
  {
    id: "sym-falls",
    symptom: "Falls",
    relatedDiagnoses: ["Gait disorder", "Orthostatic hypotension", "Neuropathy"],
    relatedMedications: ["Sedatives (risk factor)"],
    relatedFindings: ["Abnormal gait exam"],
    relatedAncillaries: ["BrainWave", "VitalWave"],
    documentationUse: "Fall-risk workup context; pair with gait/balance findings.",
    evidenceStrength: "medium",
    cmsFlags: ["Document fall history dates"],
  },
  {
    id: "sym-gait",
    symptom: "Abnormal gait",
    relatedDiagnoses: ["Parkinsonism", "Stroke history / TIA", "Neuropathy"],
    relatedMedications: ["Carbidopa-levodopa"],
    relatedFindings: ["Wide-based or shuffling gait on exam"],
    relatedAncillaries: ["BrainWave"],
    documentationUse: "Neurologic exam correlate for balance/cognitive assessment.",
    evidenceStrength: "medium",
    cmsFlags: [],
  },
];

// ───── Medication Evidence Library ──────────────────────────────────────

export type CiMedicationCard = {
  id: string;
  medication: string;
  clinicalClue: string;
  relatedDiagnoses: string[];
  relatedAncillaries: string[];
  evidenceStrength: CiConfidence;
};

export const MEDICATION_LIBRARY: CiMedicationCard[] = [
  {
    id: "med-insulin",
    medication: "Insulin",
    clinicalClue: "Diabetes clue — insulin-dependent disease severity",
    relatedDiagnoses: ["Diabetes mellitus", "Diabetic neuropathy"],
    relatedAncillaries: ["VitalWave"],
    evidenceStrength: "high",
  },
  {
    id: "med-gabapentin",
    medication: "Gabapentin",
    clinicalClue: "Neuropathy clue — neuropathic pain management",
    relatedDiagnoses: ["Diabetic neuropathy", "Peripheral neuropathy"],
    relatedAncillaries: ["VitalWave"],
    evidenceStrength: "medium",
  },
  {
    id: "med-donepezil",
    medication: "Donepezil",
    clinicalClue: "Memory/cognitive diagnosis clue — dementia treatment",
    relatedDiagnoses: ["Cognitive decline / memory loss"],
    relatedAncillaries: ["BrainWave"],
    evidenceStrength: "high",
  },
  {
    id: "med-antihypertensives",
    medication: "Antihypertensives (lisinopril, amlodipine, losartan, metoprolol)",
    clinicalClue: "Hypertension / cardiovascular history clue",
    relatedDiagnoses: ["Hypertension", "CAD"],
    relatedAncillaries: ["VitalWave", "Echocardiogram TTE (93306)"],
    evidenceStrength: "medium",
  },
  {
    id: "med-clopidogrel",
    medication: "Clopidogrel",
    clinicalClue: "Vascular event clue — post-stroke/stent antiplatelet",
    relatedDiagnoses: ["Stroke history / TIA", "PAD / PVD", "CAD"],
    relatedAncillaries: ["BrainWave", "Bilateral Carotid Duplex (93880)"],
    evidenceStrength: "high",
  },
  {
    id: "med-cilostazol",
    medication: "Cilostazol",
    clinicalClue: "Claudication clue — PAD-specific therapy",
    relatedDiagnoses: ["PAD / PVD"],
    relatedAncillaries: ["Lower Extremity Arterial Doppler (93925)"],
    evidenceStrength: "high",
  },
  {
    id: "med-furosemide",
    medication: "Furosemide",
    clinicalClue: "Volume overload clue — CHF/edema management",
    relatedDiagnoses: ["CHF", "Edema"],
    relatedAncillaries: ["Echocardiogram TTE (93306)"],
    evidenceStrength: "medium",
  },
  {
    id: "med-statin",
    medication: "Statins (atorvastatin, rosuvastatin)",
    clinicalClue: "Atherosclerotic risk clue — lipid management",
    relatedDiagnoses: ["Hyperlipidemia", "CAD", "PAD / PVD"],
    relatedAncillaries: ["Bilateral Carotid Duplex (93880)", "VitalWave"],
    evidenceStrength: "low",
  },
];

// ───── Clinical Findings Library ────────────────────────────────────────

export type CiFindingCard = {
  id: string;
  finding: string;
  sourceHint: string;
  relatedDiagnoses: string[];
  relatedAncillaries: string[];
  evidenceStrength: CiConfidence;
};

export const FINDINGS_LIBRARY: CiFindingCard[] = [
  {
    id: "find-bruit",
    finding: "Carotid bruit",
    sourceHint: "Physical exam",
    relatedDiagnoses: ["Carotid stenosis", "Stroke history / TIA"],
    relatedAncillaries: ["Bilateral Carotid Duplex (93880)"],
    evidenceStrength: "high",
  },
  {
    id: "find-pulses",
    finding: "Diminished pedal pulses",
    sourceHint: "Physical exam",
    relatedDiagnoses: ["PAD / PVD", "Diabetes mellitus"],
    relatedAncillaries: ["Lower Extremity Arterial Doppler (93925)"],
    evidenceStrength: "high",
  },
  {
    id: "find-monofilament",
    finding: "Sensory deficit on monofilament",
    sourceHint: "Physical exam / screening",
    relatedDiagnoses: ["Diabetic neuropathy"],
    relatedAncillaries: ["VitalWave"],
    evidenceStrength: "medium",
  },
  {
    id: "find-cogscreen",
    finding: "Abnormal cognitive screen (MoCA/MMSE)",
    sourceHint: "Screening instrument",
    relatedDiagnoses: ["Cognitive decline / memory loss"],
    relatedAncillaries: ["BrainWave"],
    evidenceStrength: "high",
  },
  {
    id: "find-pittingedema",
    finding: "Pitting edema",
    sourceHint: "Physical exam",
    relatedDiagnoses: ["CHF", "Venous insufficiency"],
    relatedAncillaries: ["Lower Extremity Venous Duplex (93971)", "Echocardiogram TTE (93306)"],
    evidenceStrength: "medium",
  },
  {
    id: "find-pulsatilemass",
    finding: "Pulsatile abdominal mass",
    sourceHint: "Physical exam",
    relatedDiagnoses: ["Abdominal aortic aneurysm"],
    relatedAncillaries: ["Abdominal Aortic Aneurysm Duplex (93978)"],
    evidenceStrength: "high",
  },
];

// ───── Ancillary Mapping ────────────────────────────────────────────────

export type CiAncillaryMapCard = {
  id: string;
  ancillary: string;
  target: CiAncillaryTarget;
  supportedBy: string[];
  documentationOutputs: string[];
};

export const ANCILLARY_MAPPING: CiAncillaryMapCard[] = [
  {
    id: "anc-brainwave",
    ancillary: "BrainWave",
    target: "brainwave",
    supportedBy: ["Memory loss", "Dizziness", "Falls", "Stroke history", "Donepezil", "Abnormal cognitive screen"],
    documentationOutputs: ["Medical necessity", "Order note", "Clinician reasoning", "Patient explanation", "Audit support"],
  },
  {
    id: "anc-vitalwave",
    ancillary: "VitalWave",
    target: "vitalwave",
    supportedBy: ["Diabetes", "Neuropathy", "Leg pain", "Insulin", "Gabapentin", "Hypertension history"],
    documentationOutputs: ["Medical necessity", "Order note", "Clinician reasoning", "Patient explanation", "Audit support"],
  },
  {
    id: "anc-ultrasound",
    ancillary: "Ultrasound studies (carotid, echo, arterial, venous, renal, AAA)",
    target: "ultrasound",
    supportedBy: ["Carotid bruit", "Syncope", "Edema", "Claudication", "Pulsatile abdominal mass", "Dyspnea"],
    documentationOutputs: ["Medical necessity", "Order note", "Clinician reasoning", "Patient explanation", "Audit support"],
  },
];

// ───── Reasoning Library ────────────────────────────────────────────────

export type CiReasoningTemplate = {
  id: string;
  section: "clinician" | "patient" | "ancillary_specific" | "approved_language" | "source_linked";
  title: string;
  body: string;
  ancillary?: string;
};

export const REASONING_TEMPLATES: CiReasoningTemplate[] = [
  {
    id: "reas-clin-1",
    section: "clinician",
    title: "Clinician reasoning — vascular risk pattern",
    body: "Documented {diagnosis} with {symptom} and supporting medication evidence ({medication}) establishes a vascular risk pattern. Objective assessment via {ancillary} is clinically indicated to characterize disease burden and guide management.",
  },
  {
    id: "reas-clin-2",
    section: "clinician",
    title: "Clinician reasoning — neurocognitive assessment",
    body: "History of {diagnosis} with reported {symptom} warrants objective neurophysiologic assessment. {ancillary} provides quantifiable baseline data supporting diagnosis-directed care planning.",
  },
  {
    id: "reas-pat-1",
    section: "patient",
    title: "Patient explanation — plain-language vascular",
    body: "Because of your {diagnosis} and the {symptom} you've described, your provider recommends a simple, non-invasive test to check how well your blood vessels are working. It's painless and helps your care team catch problems early.",
  },
  {
    id: "reas-pat-2",
    section: "patient",
    title: "Patient explanation — plain-language cognitive",
    body: "Your provider recommends a short, painless brain-function test because of the {symptom} you've mentioned. It gives your care team a clearer picture so they can support your memory and balance health.",
  },
  {
    id: "reas-anc-bw",
    section: "ancillary_specific",
    title: "BrainWave reasoning",
    ancillary: "BrainWave",
    body: "Neurocognitive and neurophysiologic indicators (memory change, dizziness, fall risk, cerebrovascular history) support BrainWave testing to establish an objective functional baseline.",
  },
  {
    id: "reas-anc-vw",
    section: "ancillary_specific",
    title: "VitalWave reasoning",
    ancillary: "VitalWave",
    body: "Autonomic and vascular indicators (diabetes, neuropathy, hypertension burden) support VitalWave testing for early detection of autonomic dysfunction and vascular compromise.",
  },
  {
    id: "reas-appr-1",
    section: "approved_language",
    title: "Approved necessity phrase",
    body: "Testing is medically necessary to evaluate documented symptoms and established risk factors, with results used to direct ongoing management.",
  },
  {
    id: "reas-src-1",
    section: "source_linked",
    title: "Source-linked evidence phrase",
    body: "Supporting evidence drawn from the patient's documented history ({source_type}: \"{source_text}\") was reviewed and approved by the admin during chart review on {date}.",
  },
];

// ───── Order Note Library ───────────────────────────────────────────────

export type CiOrderNoteTemplate = {
  id: string;
  section: "brainwave" | "vitalwave" | "ultrasound" | "medical_necessity" | "source_linked" | "provider_approved";
  title: string;
  body: string;
};

export const ORDER_NOTE_TEMPLATES: CiOrderNoteTemplate[] = [
  {
    id: "note-bw",
    section: "brainwave",
    title: "BrainWave order note",
    body: "Order BrainWave neurophysiologic assessment. Indication: {symptoms} in the setting of {diagnosis}. Objective baseline required for diagnosis-directed management.",
  },
  {
    id: "note-vw",
    section: "vitalwave",
    title: "VitalWave order note",
    body: "Order VitalWave autonomic/vascular assessment. Indication: {symptoms} with {diagnosis}; medication profile ({medications}) supports disease burden.",
  },
  {
    id: "note-us",
    section: "ultrasound",
    title: "Ultrasound order note",
    body: "Order {ultrasound_test}. Indication: {symptoms} with {findings}. Duplex evaluation required to characterize disease and guide management.",
  },
  {
    id: "note-mn",
    section: "medical_necessity",
    title: "Medical necessity statement",
    body: "This study is medically necessary based on documented signs, symptoms, and risk factors recorded in the clinical chart, consistent with applicable coverage criteria. Findings will directly inform the treatment plan.",
  },
  {
    id: "note-src",
    section: "source_linked",
    title: "Source-linked documentation language",
    body: "Necessity is supported by chart-documented evidence: {evidence_list}. Each item is traceable to its source (HX/DX/RX) and admin approval timestamp.",
  },
  {
    id: "note-prov",
    section: "provider_approved",
    title: "Provider-approved template",
    body: "Reviewed and approved by the supervising provider. Testing ordered in accordance with the documented clinical indication and practice protocols.",
  },
];

// ───── CMS & Regulatory Watch ───────────────────────────────────────────

export type CiCmsUpdate = {
  id: string;
  source: "CMS" | "LCD/NCD" | "MAC article" | "OIG" | "CPT/HCPCS" | "Payer article" | "Documentation requirement" | "Clinical guideline";
  title: string;
  summary: string;
  publishedDate: string;
  affectedAncillaries: string[];
  affectedRules: string[];
  suggestedAction: string;
  status: "new" | "under_review" | "acknowledged" | "action_proposed";
};

export const CMS_UPDATES: CiCmsUpdate[] = [
  {
    id: "cms-1",
    source: "LCD/NCD",
    title: "LCD update — non-invasive peripheral arterial studies",
    summary:
      "Draft LCD revision clarifies symptom documentation expectations (claudication distance, rest pain, tissue changes) for lower-extremity arterial duplex coverage.",
    publishedDate: "2026-05-14",
    affectedAncillaries: ["Lower Extremity Arterial Doppler (93925)", "VitalWave"],
    affectedRules: ["PAD symptom → arterial duplex support"],
    suggestedAction: "Review symptom-trigger rules for arterial studies; propose adding claudication-distance prompt to order note templates.",
    status: "under_review",
  },
  {
    id: "cms-2",
    source: "MAC article",
    title: "MAC billing article — carotid duplex frequency limits",
    summary:
      "Reiterates frequency limitations for repeat carotid duplex without new signs/symptoms or interval clinical change.",
    publishedDate: "2026-04-02",
    affectedAncillaries: ["Bilateral Carotid Duplex (93880)"],
    affectedRules: ["Stroke history → carotid support"],
    suggestedAction: "Confirm cooldown enforcement alignment; no rule change proposed. Rules are never changed silently — any change requires human approval.",
    status: "acknowledged",
  },
  {
    id: "cms-3",
    source: "OIG",
    title: "OIG work plan item — diagnostic testing documentation",
    summary:
      "OIG continues review of medical-necessity documentation for high-volume non-invasive diagnostic testing in physician offices.",
    publishedDate: "2026-03-10",
    affectedAncillaries: ["All"],
    affectedRules: [],
    suggestedAction: "Maintain source-linked evidence chains on every approved study so documentation remains CMS audit-ready and legally defensible.",
    status: "acknowledged",
  },
  {
    id: "cms-4",
    source: "CPT/HCPCS",
    title: "CPT annual update — no code changes to tracked studies",
    summary: "Annual CPT release reviewed; no changes to the codes used by tracked ancillaries.",
    publishedDate: "2026-01-01",
    affectedAncillaries: [],
    affectedRules: [],
    suggestedAction: "No action needed.",
    status: "acknowledged",
  },
  {
    id: "cms-5",
    source: "Clinical guideline",
    title: "ADA standards of care — neuropathy screening emphasis",
    summary:
      "Updated diabetes standards reinforce annual neuropathy assessment; strengthens documentation basis for autonomic testing in symptomatic diabetics.",
    publishedDate: "2026-02-20",
    affectedAncillaries: ["VitalWave"],
    affectedRules: ["Diabetic neuropathy → VitalWave support"],
    suggestedAction: "Propose strengthening evidence-strength rating for diabetes + neuropathy symptom combination (requires physician approval).",
    status: "action_proposed",
  },
];

// ───── EMR / API Data Wiring (future-state prototype) ───────────────────

export type CiDataSource = {
  id: string;
  name: string;
  kind: "EMR notes" | "Labs" | "Imaging" | "Claims" | "HIE";
  status: "planned" | "design" | "not_connected";
  description: string;
  exampleTriggers: string[];
};

export const EMR_DATA_SOURCES: CiDataSource[] = [
  {
    id: "src-emr",
    name: "EMR encounter notes",
    kind: "EMR notes",
    status: "design",
    description: "Future note ingestion will surface symptoms/findings directly from provider documentation for admin review.",
    exampleTriggers: ["New note mentions claudication → suggest arterial duplex evidence"],
  },
  {
    id: "src-labs",
    name: "Laboratory results",
    kind: "Labs",
    status: "planned",
    description: "Future lab wiring (A1c, lipids, BNP) as rule triggers requiring admin confirmation.",
    exampleTriggers: ["A1c ≥ 9 → strengthen diabetes evidence context"],
  },
  {
    id: "src-imaging",
    name: "Prior imaging reports",
    kind: "Imaging",
    status: "planned",
    description: "Prior imaging findings (stenosis %, EF) as structured evidence sources.",
    exampleTriggers: ["Prior carotid stenosis 50–69% → follow-up interval logic"],
  },
  {
    id: "src-hie",
    name: "Health information exchange",
    kind: "HIE",
    status: "not_connected",
    description: "External records for prior-test cooldown verification.",
    exampleTriggers: ["Outside carotid duplex within 12 months → cooldown flag"],
  },
];

// ───── Compliance Guardrails ────────────────────────────────────────────

export type CiGuardrail = {
  id: string;
  title: string;
  description: string;
  enforcement: "hard" | "workflow" | "advisory";
};

export const GUARDRAILS: CiGuardrail[] = [
  {
    id: "guard-human",
    title: "Human approval required for all rule activation",
    description: "No rule becomes active without explicit physician and/or compliance approval. AI never activates, modifies, or retires a rule on its own.",
    enforcement: "hard",
  },
  {
    id: "guard-cms-silent",
    title: "CMS watch never silently changes rules",
    description: "Regulatory updates can only PROPOSE changes. Every proposed change enters the approval queue with full traceability.",
    enforcement: "hard",
  },
  {
    id: "guard-evidence",
    title: "Source-linked evidence required",
    description: "Every qualifying decision must trace to documented HX/DX/RX or approved evidence so documentation remains CMS audit-ready and legally defensible.",
    enforcement: "workflow",
  },
  {
    id: "guard-scope",
    title: "Scope escalation requires review",
    description: "Patient-only logic can only be promoted to clinic/provider/global scope through the approval queue.",
    enforcement: "workflow",
  },
  {
    id: "guard-cooldown",
    title: "Cooldown enforcement is never overridden by rules",
    description: "6-month (PPO) / 12-month (Medicare) cooldowns take precedence over any rule suggestion.",
    enforcement: "hard",
  },
  {
    id: "guard-language",
    title: "Defensibility language standard",
    description: "Documentation language describes work as \"CMS audit-ready and legally defensible\" — never guarantees of audit outcomes.",
    enforcement: "advisory",
  },
];

// ───── Knowledge Objects / Knowledge Graph ──────────────────────────────

export type CiKnowledgeObject = {
  id: string;
  kind: "diagnosis" | "symptom" | "medication" | "finding" | "ancillary" | "template" | "rule_concept";
  name: string;
  connections: string[];
};

export const KNOWLEDGE_OBJECTS: CiKnowledgeObject[] = [
  { id: "ko-diabetes", kind: "diagnosis", name: "Diabetes mellitus", connections: ["Neuropathy", "Insulin", "Gabapentin", "VitalWave"] },
  { id: "ko-neuropathy", kind: "symptom", name: "Neuropathy", connections: ["Diabetes mellitus", "Gabapentin", "VitalWave", "Monofilament deficit"] },
  { id: "ko-insulin", kind: "medication", name: "Insulin", connections: ["Diabetes mellitus", "VitalWave"] },
  { id: "ko-gabapentin", kind: "medication", name: "Gabapentin", connections: ["Neuropathy", "Diabetes mellitus", "VitalWave"] },
  { id: "ko-stroke", kind: "diagnosis", name: "Stroke history / TIA", connections: ["Dizziness", "Memory change", "Clopidogrel", "BrainWave", "Carotid Duplex"] },
  { id: "ko-brainwave", kind: "ancillary", name: "BrainWave", connections: ["Stroke history / TIA", "Memory loss", "Falls", "Donepezil"] },
  { id: "ko-vitalwave", kind: "ancillary", name: "VitalWave", connections: ["Diabetes mellitus", "Neuropathy", "Hypertension", "Leg pain"] },
  { id: "ko-padpvd", kind: "diagnosis", name: "PAD / PVD", connections: ["Claudication", "Leg pain", "Cilostazol", "Arterial Doppler", "VitalWave"] },
  { id: "ko-claudication", kind: "symptom", name: "Claudication", connections: ["PAD / PVD", "Arterial Doppler"] },
  { id: "ko-bruit", kind: "finding", name: "Carotid bruit", connections: ["Carotid Duplex", "Stroke history / TIA"] },
  { id: "ko-mn-template", kind: "template", name: "Medical necessity statement", connections: ["All ancillaries", "Order note", "Audit packet"] },
  { id: "ko-rule-dmneuro", kind: "rule_concept", name: "Diabetic neuropathy → VitalWave", connections: ["Diabetes mellitus", "Neuropathy", "Gabapentin", "VitalWave"] },
];

// ───── Seeded rules written into the store on first load ────────────────

export function seededRules(): CiRule[] {
  const now = new Date().toISOString();
  const base = {
    version: 1,
    usageCount: 0,
    conflictFlags: [] as string[],
    createdAt: now,
    updatedAt: now,
    createdBy: "System (seed)",
    seeded: true,
  };
  const mk = (
    r: Omit<CiRule, "id" | "version" | "usageCount" | "conflictFlags" | "createdAt" | "updatedAt" | "createdBy" | "history" | "seeded">,
  ): CiRule => ({
    ...base,
    ...r,
    id: ciId("rule"),
    history: [{ version: 1, at: now, by: "System (seed)", summary: "Seeded example rule", status: r.status }],
  });
  return [
    mk({
      name: "Diabetic neuropathy → VitalWave support",
      description:
        "IF diagnosis includes diabetic neuropathy AND symptom includes burning feet or leg pain OR medication includes gabapentin THEN suggest VitalWave AND use approved source-linked evidence in downstream documentation AND require Admin Review before finalization.",
      triggerSource: "DX + HX + RX",
      triggerCondition: "diagnosis: diabetic neuropathy AND (symptom: burning feet | leg pain OR medication: gabapentin)",
      diagnosisTrigger: "Diabetic neuropathy (E11.42)",
      symptomTrigger: "Burning feet, leg pain",
      medicationTrigger: "Gabapentin",
      targetAncillary: "vitalwave",
      targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "audit_support"],
      evidenceRequirement: "At least one source-linked HX/DX/RX item",
      confidenceThreshold: "medium",
      scope: "global_draft",
      approvalRequirement: "Admin Review before finalization",
      status: "active",
    }),
    mk({
      name: "Cerebrovascular history → BrainWave support",
      description:
        "IF history includes stroke or TIA AND symptom includes dizziness, memory change, or falls THEN suggest BrainWave with source-linked evidence, requiring Admin Review.",
      triggerSource: "HX + DX",
      triggerCondition: "history: stroke | TIA AND symptom: dizziness | memory change | falls",
      diagnosisTrigger: "Stroke history (Z86.73)",
      symptomTrigger: "Dizziness, memory change, falls",
      targetAncillary: "brainwave",
      targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "audit_support"],
      evidenceRequirement: "Documented cerebrovascular history",
      confidenceThreshold: "medium",
      scope: "global_draft",
      approvalRequirement: "Admin Review before finalization",
      status: "active",
    }),
    mk({
      name: "Claudication → lower-extremity arterial duplex support",
      description:
        "IF symptom includes claudication or exertional leg pain THEN suggest Lower Extremity Arterial Doppler with documented symptom detail (distance, laterality) per LCD expectations.",
      triggerSource: "HX",
      triggerCondition: "symptom: claudication | exertional leg pain",
      symptomTrigger: "Claudication, exertional leg pain",
      targetAncillary: "ultrasound",
      targetOutputs: ["ancillary_assignment", "medical_necessity", "order_note", "evidence_traceability"],
      evidenceRequirement: "Symptom detail incl. distance/laterality",
      confidenceThreshold: "high",
      scope: "global_draft",
      approvalRequirement: "Physician review",
      status: "pending_physician_review",
    }),
    mk({
      name: "Donepezil → cognitive assessment context",
      description:
        "IF medication includes donepezil or memantine THEN treat as memory/cognitive diagnosis clue supporting BrainWave context; requires corroborating HX/DX before assignment.",
      triggerSource: "RX",
      triggerCondition: "medication: donepezil | memantine",
      medicationTrigger: "Donepezil, memantine",
      targetAncillary: "brainwave",
      targetOutputs: ["diagnosis_mapping", "evidence_traceability"],
      evidenceRequirement: "Corroborating HX or DX required",
      confidenceThreshold: "medium",
      scope: "clinic_draft",
      approvalRequirement: "Compliance review",
      status: "pending_compliance_review",
    }),
  ];
}

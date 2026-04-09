export type PlexusService = 'VitalWave' | 'Ultrasound' | 'BrainWave' | 'PGx';
export type PlexusDocumentKind = 'screening' | 'preProcedureOrder' | 'postProcedureNote' | 'billing';

export type ClinicProfile = {
  name: string;
  address: string;
  phone?: string;
  fax?: string;
};

export type PatientDemographics = {
  patientName: string;
  dateOfBirth?: string;
  dateOfService?: string;
  sex?: string;
  mrn?: string;
  previousTests?: string;
};

export type ClinicianInfo = {
  name: string;
  npi?: string;
};

export type ScreeningResult = {
  service: PlexusService;
  selectedConditions: string[];
  notes: string[];
  icd10Codes: string[];
  cptCodes: string[];
  meta?: Record<string, unknown>;
};

export type GeneratedDocument = {
  service: PlexusService;
  kind: PlexusDocumentKind;
  title: string;
  generatedAtISO: string;
  plexusId: string;
  patient: PatientDemographics;
  clinician?: ClinicianInfo;
  sections: Array<{ heading: string; body: string }>;
  billing?: {
    icd10: Array<{ code: string; description?: string; raw?: string }>;
    cpt: Array<{ code: string; description?: string }>;
  };
  meta?: Record<string, unknown>;
};

export type VitalWaveScreeningData = Record<string, Record<string, boolean>>;

export type UltrasoundScreeningData = {
  selection: string[];
  conditions: Record<string, boolean>;
  otherText?: Record<string, string>;
};

export type BrainWaveScreeningData = Record<string, Record<string, boolean>>;

export type PgxScreeningData = {
  matches?: Array<{ trigger: string }>;
};

export type GenerateInput = {
  patient: PatientDemographics;
  clinician?: ClinicianInfo;
  clinic?: ClinicProfile;
  plexusId?: string;
  nowISO?: string;
};

export function generatePlexusId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const rand = Math.floor(Math.random() * 10000);
  return `PLX-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${String(rand).padStart(4, '0')}`;
}

export const DEFAULT_CLINIC: ClinicProfile = {
  name: 'New Wave Physician Group',
  address: '13480 Veterans Memorial Dr R1\nHouston, TX 77014',
  phone: '(281) 587-1600',
  fax: '(832) 698-9568'
};

export const CLINIC_HUMBLE: ClinicProfile = {
  name: 'New Wave Physician Group',
  address: '1806 Humble Place Dr.\nHumble, TX 77338',
  phone: '(281) 369-9514',
  fax: '(281) 359-4208'
};

const HUMBLE_CLINICIANS = new Set([
  'Taylor, Jill, DO',
  'Hund, Donald, NP',
]);

export function resolveClinicForClinician(clinicianName: string): ClinicProfile {
  return HUMBLE_CLINICIANS.has(clinicianName) ? CLINIC_HUMBLE : DEFAULT_CLINIC;
}

export function formatClinicAddress(clinic: ClinicProfile, short = false): string {
  if (short) {
    return [clinic.name, clinic.address].join('\n');
  }
  const lines = [clinic.name, clinic.address];
  if (clinic.phone) lines.push(`Phone: ${clinic.phone}`);
  if (clinic.fax) lines.push(`Fax: ${clinic.fax}`);
  return lines.join('\n');
}

function isoNow(fallback?: string) {
  return fallback || new Date().toISOString();
}

function ensurePlexusId(provided?: string) {
  return provided || generatePlexusId();
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function splitIcd(code: string | undefined): { code: string; description?: string; raw?: string } {
  const raw = code || '';
  if (!raw) return { code: 'N/A' };
  if (raw.includes(' \u2013 ')) {
    const [c, desc] = raw.split(' \u2013 ');
    return { code: c.trim(), description: desc.trim(), raw };
  }
  if (raw.includes(' - ')) {
    const [c, desc] = raw.split(' - ');
    return { code: c.trim(), description: desc.trim(), raw };
  }
  return { code: raw.trim(), raw };
}

export type VitalWaveConfig = Record<
  string,
  {
    title: string;
    cpt: string;
    conditions: Array<{ name: string; sentence: string; icd?: string }>;
  }
>;

export const VITALWAVE_CONFIG: VitalWaveConfig = {
  cardiovascular: {
    title: 'Cardiovascular',
    cpt: '93923',
    conditions: [
      { name: 'Essential Hypertension', sentence: 'Patient has essential hypertension requiring vascular assessment.', icd: 'I10 – Essential (primary) Hypertension' },
      { name: 'Hypertensive Heart Disease', sentence: 'Patient has hypertensive heart disease requiring comprehensive cardiac evaluation.', icd: 'I11.9 – Hypertensive Heart Disease Without Heart Failure' },
      { name: 'Chronic Diastolic Heart Failure', sentence: 'Patient has chronic diastolic heart failure requiring hemodynamic assessment.', icd: 'I50.32 – Chronic Diastolic (congestive) Heart Failure' },
      { name: 'Mixed Hyperlipidemia', sentence: 'Patient has mixed hyperlipidemia with associated cardiovascular risk.', icd: 'E78.2 – Mixed Hyperlipidemia' },
      { name: 'Atherosclerosis of Aorta', sentence: 'Patient has atherosclerosis of the aorta requiring vascular studies.', icd: 'I70.0 – Atherosclerosis of Aorta' },
      { name: 'Atrial Fibrillation', sentence: 'Patient has atrial fibrillation requiring rhythm and cardiac function evaluation.', icd: 'I48.91 – Unspecified Atrial Fibrillation' },
    ]
  },
  autonomic: {
    title: 'Autonomic Nervous System',
    cpt: '95924',
    conditions: [
      { name: 'Autonomic Neuropathy', sentence: 'Patient has autonomic neuropathy requiring comprehensive autonomic testing.', icd: 'G90.09 – Other Idiopathic Peripheral Autonomic Neuropathy' },
      { name: 'Orthostatic Hypotension', sentence: 'Patient has orthostatic hypotension with positional blood pressure changes requiring tilt table evaluation.', icd: 'I95.1 – Orthostatic Hypotension' },
      { name: 'Syncope and Collapse', sentence: 'Patient experiences syncope and collapse requiring autonomic evaluation.', icd: 'R55 – Syncope and Collapse' },
      { name: 'Dizziness and Giddiness', sentence: 'Patient presents with dizziness and giddiness requiring autonomic workup.', icd: 'R42 – Dizziness and Giddiness' },
      { name: 'Type 2 Diabetes Mellitus', sentence: 'Patient has type 2 diabetes mellitus with autonomic complications requiring testing.', icd: 'E11.40 – Type 2 Diabetes Mellitus With Diabetic Neuropathy, Unspecified' },
      { name: 'Peripheral Neuropathy', sentence: 'Patient has peripheral neuropathy requiring autonomic and vascular assessment.', icd: 'G62.9 – Polyneuropathy, Unspecified' },
    ]
  },
  rhythm: {
    title: 'Rhythm ECG',
    cpt: '93040',
    conditions: [
      { name: 'Cardiac Arrhythmia', sentence: 'Patient has cardiac arrhythmia requiring rhythm electrocardiography with interpretation.', icd: 'I49.9 – Cardiac Arrhythmia, Unspecified' },
      { name: 'Palpitations', sentence: 'Patient presents with palpitations requiring ECG rhythm evaluation.', icd: 'R00.2 – Palpitations' },
      { name: 'Chest Pain', sentence: 'Patient has chest pain requiring cardiac rhythm assessment.', icd: 'R07.9 – Chest Pain, Unspecified' },
      { name: 'Bradycardia', sentence: 'Patient has bradycardia requiring rhythm monitoring and evaluation.', icd: 'R00.1 – Bradycardia, Unspecified' },
    ]
  }
};

export type UltrasoundConfig = Record<
  string,
  {
    cpt?: string;
    conditions: Array<{ category?: string; name: string; icd?: string; sentence: string }>;
  }
>;

export const ULTRASOUND_CONFIG: UltrasoundConfig = {
  'Carotid Duplex': {
    cpt: '93880',
    conditions: [
      { name: 'Carotid Artery Disease', icd: 'I65.29 – Occlusion and Stenosis of Unspecified Carotid Artery', sentence: 'Patient has carotid artery disease requiring duplex ultrasound for evaluation of stenosis.' },
      { name: 'Stroke/TIA History', icd: 'Z86.73 – Personal History of Transient Ischemic Attack (TIA)', sentence: 'Patient has history of stroke/TIA requiring carotid duplex evaluation.' },
      { name: 'Dizziness/Vertigo', icd: 'R42 – Dizziness and Giddiness', sentence: 'Patient presents with dizziness/vertigo requiring carotid evaluation.' },
      { name: 'Essential Hypertension', icd: 'I10 – Essential (primary) Hypertension', sentence: 'Patient has essential hypertension with carotid evaluation indicated.' },
      { name: 'Other', icd: 'Other', sentence: 'Carotid duplex ultrasound ordered for evaluation.' },
    ]
  },
  'Abdominal Aorta': {
    cpt: '93978',
    conditions: [
      { name: 'Abdominal Aortic Aneurysm', icd: 'I71.4 – Abdominal Aortic Aneurysm, Without Rupture', sentence: 'Patient has abdominal aortic aneurysm requiring surveillance ultrasound.' },
      { name: 'Abdominal Pain', icd: 'R10.9 – Unspecified Abdominal Pain', sentence: 'Patient has abdominal pain requiring aortic evaluation.' },
      { name: 'Atherosclerosis', icd: 'I70.0 – Atherosclerosis of Aorta', sentence: 'Patient has atherosclerosis of the aorta requiring vascular imaging.' },
      { name: 'Other', icd: 'Other', sentence: 'Abdominal aortic ultrasound ordered for evaluation.' },
    ]
  },
  'Renal Artery Duplex': {
    cpt: '93975',
    conditions: [
      { name: 'Renal Artery Stenosis', icd: 'I70.1 – Atherosclerosis of Renal Artery', sentence: 'Patient has suspected renal artery stenosis requiring duplex evaluation.' },
      { name: 'Renovascular Hypertension', icd: 'I15.0 – Renovascular Hypertension', sentence: 'Patient has renovascular hypertension requiring renal artery duplex imaging.' },
      { name: 'Chronic Kidney Disease', icd: 'N18.9 – Chronic Kidney Disease, Unspecified', sentence: 'Patient has chronic kidney disease with renal vascular evaluation indicated.' },
      { name: 'Other', icd: 'Other', sentence: 'Renal artery duplex ordered for evaluation.' },
    ]
  },
  'Lower Extremity Arterial': {
    cpt: '93925',
    conditions: [
      { name: 'Peripheral Arterial Disease', icd: 'I73.9 – Peripheral Vascular Disease, Unspecified', sentence: 'Patient has peripheral arterial disease requiring lower extremity arterial duplex.' },
      { name: 'Claudication', icd: 'I73.9 – Peripheral Vascular Disease, Unspecified', sentence: 'Patient presents with claudication requiring lower extremity arterial evaluation.' },
      { name: 'Leg Pain/Numbness', icd: 'M79.671 – Pain in Right Foot', sentence: 'Patient has leg pain/numbness requiring arterial assessment of lower extremities.' },
      { name: 'Diabetes with Neuropathy', icd: 'E11.40 – Type 2 Diabetes Mellitus With Diabetic Neuropathy, Unspecified', sentence: 'Patient has diabetes with neuropathy requiring lower extremity arterial evaluation.' },
      { name: 'Other', icd: 'Other', sentence: 'Lower extremity arterial duplex ordered for evaluation.' },
    ]
  },
  'Lower Extremity Venous': {
    cpt: '93971',
    conditions: [
      { name: 'Deep Vein Thrombosis', icd: 'I82.401 – Acute DVT of Unspecified Deep Veins of Right Lower Extremity', sentence: 'Patient has suspected deep vein thrombosis requiring lower extremity venous duplex.' },
      { name: 'Leg Swelling/Edema', icd: 'R60.0 – Localized Edema', sentence: 'Patient has leg swelling/edema requiring venous evaluation.' },
      { name: 'Varicose Veins', icd: 'I83.90 – Varicose Veins of Unspecified Lower Extremity Without Ulcer or Inflammation', sentence: 'Patient has varicose veins requiring venous duplex assessment.' },
      { name: 'Other', icd: 'Other', sentence: 'Lower extremity venous duplex ordered for evaluation.' },
    ]
  },
  'Echocardiogram TTE': {
    cpt: '93306',
    conditions: [
      { name: 'Heart Failure', icd: 'I50.9 – Heart Failure, Unspecified', sentence: 'Patient has heart failure requiring echocardiographic evaluation of cardiac function.' },
      { name: 'Atrial Fibrillation', icd: 'I48.91 – Unspecified Atrial Fibrillation', sentence: 'Patient has atrial fibrillation requiring echocardiogram to assess cardiac structure and function.' },
      { name: 'Essential Hypertension', icd: 'I10 – Essential (primary) Hypertension', sentence: 'Patient has essential hypertension requiring echocardiogram to evaluate for hypertensive heart disease.' },
      { name: 'Cardiomyopathy', icd: 'I42.9 – Cardiomyopathy, Unspecified', sentence: 'Patient has cardiomyopathy requiring echocardiographic evaluation.' },
      { name: 'Valvular Heart Disease', icd: 'I38 – Endocarditis, Valve Unspecified', sentence: 'Patient has valvular heart disease requiring echocardiographic assessment.' },
      { name: 'Other', icd: 'Other', sentence: 'Echocardiogram TTE ordered for cardiac evaluation.' },
    ]
  },
  'Stress Echocardiogram': {
    cpt: '93350',
    conditions: [
      { name: 'Chest Pain / Angina', icd: 'I20.9 – Angina Pectoris, Unspecified', sentence: 'Patient has chest pain/angina requiring stress echocardiogram for ischemia evaluation.' },
      { name: 'Coronary Artery Disease', icd: 'I25.10 – Atherosclerotic Heart Disease of Native Coronary Artery Without Angina Pectoris', sentence: 'Patient has coronary artery disease requiring stress echocardiogram for functional assessment.' },
      { name: 'Shortness of Breath on Exertion', icd: 'R06.09 – Other Forms of Dyspnea', sentence: 'Patient has exertional dyspnea requiring stress echocardiogram for cardiac evaluation.' },
      { name: 'Essential Hypertension', icd: 'I10 – Essential (primary) Hypertension', sentence: 'Patient has hypertension with cardiac risk factors requiring stress echocardiographic evaluation.' },
      { name: 'Other', icd: 'Other', sentence: 'Stress echocardiogram ordered for cardiac stress evaluation.' },
    ]
  },
  'Upper Extremity Arterial': {
    cpt: '93930',
    conditions: [
      { name: 'Peripheral Arterial Disease (Upper)', icd: 'I73.9 – Peripheral Vascular Disease, Unspecified', sentence: 'Patient has peripheral arterial disease requiring upper extremity arterial duplex evaluation.' },
      { name: 'Arm Pain / Claudication', icd: 'M79.622 – Pain in Left Upper Arm', sentence: 'Patient has arm pain/claudication requiring upper extremity arterial assessment.' },
      { name: 'Subclavian Steal Syndrome', icd: 'G45.8 – Other Transient Cerebral Ischemic Attacks', sentence: 'Patient has suspected subclavian steal syndrome requiring upper extremity arterial duplex.' },
      { name: 'Diabetes with Neuropathy', icd: 'E11.40 – Type 2 Diabetes Mellitus With Diabetic Neuropathy, Unspecified', sentence: 'Patient has diabetes with neuropathy requiring upper extremity arterial evaluation.' },
      { name: 'Other', icd: 'Other', sentence: 'Upper extremity arterial duplex ordered for evaluation.' },
    ]
  },
  'Upper Extremity Venous': {
    cpt: '93970',
    conditions: [
      { name: 'Upper Extremity DVT', icd: 'I82.401 – Acute DVT of Unspecified Deep Veins of Right Lower Extremity', sentence: 'Patient has suspected upper extremity deep vein thrombosis requiring venous duplex evaluation.' },
      { name: 'Arm Swelling / Edema', icd: 'R60.0 – Localized Edema', sentence: 'Patient has arm swelling/edema requiring upper extremity venous evaluation.' },
      { name: 'Central Line Complication', icd: 'T80.219A – Unspecified Local Infection Due to Central Venous Catheter', sentence: 'Patient has history of central line with suspected venous complication requiring upper extremity venous duplex.' },
      { name: 'Other', icd: 'Other', sentence: 'Upper extremity venous duplex ordered for evaluation.' },
    ]
  },
};

export type ConditionMapping = Record<string, { icdCodes: string[]; sentence: string; groups?: number[] }>;

export const BRAINWAVE_MAPPING: ConditionMapping = {
  'Essential Hypertension': { icdCodes: ['I10'], sentence: 'Patient has essential hypertension requiring neurological evaluation.', groups: [1, 2, 3] },
  'Type 2 Diabetes Mellitus': { icdCodes: ['E11.9'], sentence: 'Patient has type 2 diabetes mellitus with neurological complications.', groups: [1, 2, 3] },
  'Mixed Hyperlipidemia': { icdCodes: ['E78.2'], sentence: 'Patient has mixed hyperlipidemia requiring comprehensive metabolic evaluation.', groups: [1, 3] },
  'Major Depressive Disorder': { icdCodes: ['F32.9'], sentence: 'Patient has major depressive disorder requiring neuropsychological testing.', groups: [1] },
  'Generalized Anxiety Disorder': { icdCodes: ['F41.1'], sentence: 'Patient has generalized anxiety disorder requiring neuropsychological assessment.', groups: [1] },
  'ADHD, Predominantly Inattentive': { icdCodes: ['F90.0'], sentence: 'Patient has ADHD predominantly inattentive type requiring cognitive testing.', groups: [1] },
  'Mild Cognitive Impairment': { icdCodes: ['G31.84'], sentence: 'Patient has mild cognitive impairment requiring neuropsychological evaluation.', groups: [1] },
  'Dizziness and Giddiness': { icdCodes: ['R42'], sentence: 'Patient presents with dizziness and giddiness requiring EEG evaluation.', groups: [2, 3] },
  'Syncope and Collapse': { icdCodes: ['R55'], sentence: 'Patient experiences syncope and collapse requiring cardiac rhythm and neurological evaluation.', groups: [2, 3] },
  'Insomnia': { icdCodes: ['G47.00'], sentence: 'Patient has insomnia requiring neurological and sleep-related evaluation.', groups: [1, 2] },
  'Chronic Fatigue': { icdCodes: ['R53.82'], sentence: 'Patient has chronic fatigue requiring comprehensive neurological workup.', groups: [1, 2, 3] },
  'Headache': { icdCodes: ['R51.9'], sentence: 'Patient presents with headaches requiring neurological evaluation including EEG.', groups: [2] },
  'Seizure Disorder': { icdCodes: ['G40.909'], sentence: 'Patient has seizure disorder requiring EEG monitoring and interpretation.', groups: [2] },
  'Hypothyroidism': { icdCodes: ['E03.9'], sentence: 'Patient has hypothyroidism with neurological manifestations.', groups: [1, 3] },
  'Obesity': { icdCodes: ['E66.9'], sentence: 'Patient has obesity with metabolic and neurological implications.', groups: [1, 3] },
  'Prediabetes': { icdCodes: ['R73.03'], sentence: 'Patient has prediabetes requiring metabolic and neurological assessment.', groups: [1, 3] },
  'Peripheral Neuropathy': { icdCodes: ['G62.9'], sentence: 'Patient has peripheral neuropathy requiring neurological testing.', groups: [2, 3] },
  'Vitamin D Deficiency': { icdCodes: ['E55.9'], sentence: 'Patient has vitamin D deficiency with neurological implications.', groups: [1, 3] },
  'Depression': { icdCodes: ['F32.A'], sentence: 'Patient has depression requiring neuropsychological evaluation.', groups: [1] },
  'Chronic Pain': { icdCodes: ['G89.29'], sentence: 'Patient has chronic pain requiring neurological assessment.', groups: [2, 3] },
  'Memory Loss': { icdCodes: ['R41.3'], sentence: 'Patient presents with memory loss requiring comprehensive cognitive evaluation.', groups: [1] },
};

export const BRAINWAVE_GROUPS: Record<string, { label: string; conditions: string[] }> = {
  'group1': {
    label: 'Group 1 – Neuropsychological Testing (CPT: 96132, 96138, 96139)',
    conditions: [
      'Essential Hypertension', 'Type 2 Diabetes Mellitus', 'Mixed Hyperlipidemia',
      'Major Depressive Disorder', 'Generalized Anxiety Disorder', 'ADHD, Predominantly Inattentive',
      'Mild Cognitive Impairment', 'Insomnia', 'Chronic Fatigue', 'Hypothyroidism',
      'Obesity', 'Prediabetes', 'Vitamin D Deficiency', 'Depression', 'Memory Loss'
    ]
  },
  'group2': {
    label: 'Group 2 – EEG (CPT: 95816, 95957)',
    conditions: [
      'Dizziness and Giddiness', 'Syncope and Collapse', 'Insomnia', 'Chronic Fatigue',
      'Headache', 'Seizure Disorder', 'Peripheral Neuropathy', 'Chronic Pain'
    ]
  },
  'group3': {
    label: 'Group 3 – VEP / AEP (CPT: 95930)',
    conditions: [
      'Essential Hypertension', 'Type 2 Diabetes Mellitus', 'Mixed Hyperlipidemia',
      'Dizziness and Giddiness', 'Syncope and Collapse', 'Chronic Fatigue',
      'Hypothyroidism', 'Obesity', 'Prediabetes', 'Peripheral Neuropathy',
      'Vitamin D Deficiency', 'Chronic Pain'
    ]
  }
};

export const PGX_TRIGGER_MEDICATIONS = [
  'Clopidogrel (Plavix)', 'Warfarin (Coumadin)', 'Simvastatin (Zocor)', 'Atorvastatin (Lipitor)',
  'Codeine', 'Tramadol', 'Oxycodone', 'Hydrocodone', 'Morphine', 'Fentanyl',
  'Sertraline (Zoloft)', 'Fluoxetine (Prozac)', 'Paroxetine (Paxil)', 'Escitalopram (Lexapro)',
  'Citalopram (Celexa)', 'Venlafaxine (Effexor)', 'Duloxetine (Cymbalta)', 'Bupropion (Wellbutrin)',
  'Amitriptyline', 'Nortriptyline', 'Imipramine', 'Clomipramine',
  'Risperidone (Risperdal)', 'Aripiprazole (Abilify)', 'Haloperidol', 'Quetiapine (Seroquel)',
  'Clonazepam (Klonopin)', 'Alprazolam (Xanax)', 'Diazepam (Valium)', 'Lorazepam (Ativan)',
  'Metformin', 'Glipizide', 'Glyburide', 'Pioglitazone (Actos)',
  'Metoprolol', 'Carvedilol', 'Propranolol', 'Atenolol',
  'Lisinopril', 'Losartan', 'Amlodipine', 'Hydrochlorothiazide',
  'Omeprazole (Prilosec)', 'Pantoprazole (Protonix)', 'Esomeprazole (Nexium)',
  'Tamoxifen', 'Ondansetron (Zofran)', 'Metoclopramide',
  'Azathioprine', 'Mercaptopurine', 'Thioguanine',
  'Irinotecan', 'Fluorouracil (5-FU)', 'Capecitabine (Xeloda)',
];

export function vitalWaveScreeningToResult(args: {
  config: VitalWaveConfig;
  screening: VitalWaveScreeningData;
}): ScreeningResult {
  const selected: Array<{ name: string; sentence: string; icd?: string; cpt: string }> = [];

  Object.keys(args.config).forEach((groupKey) => {
    const groupConfig = args.config[groupKey];
    const selectedInGroup = args.screening[groupKey] || {};
    groupConfig.conditions.forEach((c) => {
      if (selectedInGroup[c.name]) {
        selected.push({ name: c.name, sentence: c.sentence, icd: c.icd, cpt: groupConfig.cpt });
      }
    });
  });

  return {
    service: 'VitalWave',
    selectedConditions: selected.map((s) => s.name),
    notes: selected.map((s) => s.sentence),
    icd10Codes: uniq(selected.map((s) => s.icd).filter(Boolean) as string[]),
    cptCodes: uniq(selected.map((s) => s.cpt).filter(Boolean) as string[]),
    meta: { selectedDetailed: selected }
  };
}

export function ultrasoundScreeningToResult(args: {
  config: UltrasoundConfig;
  screening: UltrasoundScreeningData;
}): ScreeningResult {
  const selectedConditions: string[] = [];
  const notes: string[] = [];
  const icd10: string[] = [];
  const cpt: string[] = [];

  const selection = args.screening.selection || [];
  const conditions = args.screening.conditions || {};
  const otherText = args.screening.otherText || {};

  Object.entries(args.config).forEach(([type, cfg]) => {
    if (!selection.includes(type)) return;
    if (cfg.cpt) cpt.push(cfg.cpt);

    cfg.conditions.forEach((cond) => {
      const key = cond.name === 'Other' ? `${type}-Other` : cond.name;
      if (!conditions[key]) return;

      if (cond.name === 'Other') {
        const text = otherText[type];
        if (text) {
          selectedConditions.push(`Other: ${text}`);
          notes.push(`Patient presents with ${text}; ultrasound ordered for evaluation.`);
          icd10.push('Other');
        }
      } else {
        selectedConditions.push(cond.name);
        notes.push(cond.sentence);
        if (cond.icd) icd10.push(cond.icd);
      }
    });
  });

  return {
    service: 'Ultrasound',
    selectedConditions: uniq(selectedConditions),
    notes,
    icd10Codes: uniq(icd10.filter(Boolean)),
    cptCodes: uniq(cpt.filter(Boolean)),
    meta: { selection }
  };
}

export function brainWaveScreeningToResult(args: {
  mapping: ConditionMapping;
  screening: BrainWaveScreeningData;
}): ScreeningResult {
  const selectedConditions: string[] = [];
  const notes: string[] = [];
  const icd10: string[] = [];

  Object.entries(args.screening || {}).forEach(([, conditions]) => {
    Object.entries(conditions || {}).forEach(([condition, isSelected]) => {
      if (!isSelected) return;
      if (!selectedConditions.includes(condition)) selectedConditions.push(condition);
      const m = args.mapping[condition];
      if (m?.sentence) notes.push(m.sentence);
      (m?.icdCodes || []).forEach((c) => icd10.push(c));
    });
  });

  const cptCodes = ['96132', '96138', '96139', '95816', '95957', '93040', '95930', '92653'];

  return {
    service: 'BrainWave',
    selectedConditions,
    notes,
    icd10Codes: uniq(icd10),
    cptCodes,
    meta: {}
  };
}

export function pgxScreeningToResult(args: { screening: PgxScreeningData }): ScreeningResult {
  const triggers = (args.screening.matches || []).map((m) => m.trigger).filter(Boolean);

  return {
    service: 'PGx',
    selectedConditions: triggers,
    notes:
      triggers.length > 0
        ? ['Trigger medications identified from screening:', ...triggers.map((t) => `\u2022 ${t}`)]
        : [],
    icd10Codes: ['Z13.79', 'Z13.89', 'T88.7XXA', 'G62.9', 'F32.9', 'F41.1', 'G89.29', 'Z79.899'],
    cptCodes: ['99214', '99215', '99417', '99401', '99402', '99403', '99404', '99000', 'G2023'],
    meta: {}
  };
}

function buildVitalWaveNotesBody(
  config: VitalWaveConfig,
  screening: Record<string, Record<string, boolean>>
): string {
  const paragraphs: string[] = [];
  for (const [groupKey, groupCfg] of Object.entries(config)) {
    const selectedGroup = screening[groupKey] || {};
    const conditionNames = groupCfg.conditions
      .filter((c) => selectedGroup[c.name])
      .map((c) => c.name.toLowerCase());
    if (conditionNames.length === 0) continue;
    paragraphs.push(`${groupCfg.title} (CPT ${groupCfg.cpt}): Indicated for ${joinNatural(conditionNames)}.`);
  }
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : 'Select conditions in the screening form.';
}

export function generateVitalWaveDocuments(args: {
  input: GenerateInput;
  screeningResult: ScreeningResult;
  vitalWaveConfig?: VitalWaveConfig;
  vitalWaveScreening?: Record<string, Record<string, boolean>>;
  aiJustification?: string;
}): Record<'preProcedureOrder' | 'postProcedureNote' | 'billing', GeneratedDocument> {
  const generatedAtISO = isoNow(args.input.nowISO);
  const plexusId = ensurePlexusId(args.input.plexusId);
  const patient = args.input.patient;
  const clinician = args.input.clinician;
  const dxList = args.screeningResult.selectedConditions;
  const notes = args.vitalWaveConfig && args.vitalWaveScreening
    ? buildVitalWaveNotesBody(args.vitalWaveConfig, args.vitalWaveScreening)
    : args.screeningResult.notes.join(' ');

  const pre: GeneratedDocument = {
    service: 'VitalWave',
    kind: 'preProcedureOrder',
    title: `Pre-Procedure Order Form - ${patient.patientName}`,
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Patient Information',
        body: [
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          `Date of Service: ${patient.dateOfService || 'Not specified'}`,
          `Sex: ${patient.sex || 'Not specified'}`,
          `MRN: ${patient.mrn || 'Not specified'}`,
          clinician ? `Ordering Clinician: ${clinician.name}` : `Ordering Clinician: Not specified`,
          clinician?.npi ? `NPI: ${clinician.npi}` : `NPI: Not specified`,
          `Date: ${new Date(generatedAtISO).toLocaleDateString()}`
        ].join('\n')
      },
      { heading: 'Procedure Ordered', body: 'VitalWave - Comprehensive Autonomic & Vascular Assessment' },
      { heading: 'Diagnosis', body: dxList.length ? dxList.map((d) => `\u2022 ${d}`).join('\n') : 'No conditions selected in screening form' },
      ...(args.aiJustification ? [{ heading: 'Clinical Justification', body: args.aiJustification }] : []),
      { heading: 'Notes', body: notes || 'Select conditions in the screening form.' },
      { heading: 'Procedures', body: 'Comprehensive autonomic nervous system testing including parasympathetic and sympathetic function evaluation with tilt table testing. Arterial physiologic studies of upper and lower extremities. Rhythm electrocardiography with interpretation and report.' },

    ],
    meta: {}
  };

  const post: GeneratedDocument = {
    service: 'VitalWave',
    kind: 'postProcedureNote',
    title: 'Plexus VitalWave Procedure Note',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Demographics',
        body: [
          `Patient Name: ${patient.patientName}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          `Sex: ${patient.sex || 'Not specified'}`,
          `Patient MRN (Medical Record Number) from EMR: ${patient.mrn || 'Not specified'}`
        ].join('\n')
      },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'Chief Complaint', body: 'VitalWave Autonomic & Vascular Testing' },
      { heading: 'Subjective', body: "Patient presents today for VitalWave autonomic and vascular testing. Patient's clinical history was reviewed and appropriateness of studies confirmed. Testing indications include autonomic dysfunction assessment and vascular perfusion evaluation." },
      { heading: 'Objective', body: 'Physical exam not required for this visit' },
      { heading: 'Assessment & Plan', body: 'The patient tolerated all procedures well. Autonomic nervous system testing was performed including assessment of parasympathetic and sympathetic function with tilt table evaluation. Blood pressure and heart rate responses were monitored throughout position changes. Arterial physiologic studies of extremities were completed using segmental pressure measurements and waveform analysis at multiple levels. Rhythm electrocardiography was performed with continuous monitoring and interpretation. All testing equipment functioned properly and adequate signal quality was maintained throughout. Patient remained stable during all procedures with no adverse events. Results will be interpreted by the reviewing physician and communicated to the ordering clinician. The VitalWave testing was completed successfully and the patient was discharged in stable condition.' },

      {
        heading: 'Order',
        body: [
          'Plexus VitalWave Test - Pre-Procedure Order',
          '',
          'Patient Information',
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          `DOB: ${patient.dateOfBirth || 'Not specified'}`,
          `Service Date: ${patient.dateOfService || 'Not specified'}`,
          `Sex: ${patient.sex || 'Not specified'}`,
          `MRN: ${patient.mrn || 'Not specified'}`,
          clinician ? `Ordering Clinician: ${clinician.name}` : `Ordering Clinician: Not specified`,
          clinician?.npi ? `NPI: ${clinician.npi}` : `NPI: Not specified`,
          `Date: ${new Date(generatedAtISO).toLocaleDateString()}`,
          '',
          'Procedure Ordered',
          'VitalWave - Comprehensive Autonomic & Vascular Assessment',
          '',
          'Diagnosis',
          dxList.length ? dxList.map((d) => `\u2022 ${d}`).join('\n') : 'No conditions selected in screening form',
          '',
          'Clinical Notes',
          args.screeningResult.notes.length ? args.screeningResult.notes.map((n) => `\u2022 ${n}`).join('\n') : 'N/A'
        ].join('\n')
      }
    ]
  };

  const cptDescriptions: Record<string, string> = {
    '93923': 'Complete bilateral noninvasive physiologic studies of upper or lower extremity arteries, 3 or more levels',
    '95924': 'Testing of autonomic nervous system function; parasympathetic and sympathetic adrenergic function, including tilt table testing',
    '93040': 'Rhythm ECG, 1-3 leads; with interpretation and report'
  };

  const bill: GeneratedDocument = {
    service: 'VitalWave',
    kind: 'billing',
    title: 'Plexus VitalWave Billing Document',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}\nPlexus ID: ${plexusId}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'Procedure', body: 'Procedure: VitalWave Comprehensive Autonomic & Vascular Assessment\nDetails: Autonomic nervous system testing with tilt table, arterial physiologic studies of extremities, and rhythm ECG completed successfully. No complications.' },
      { heading: 'ICD-10 Codes', body: args.screeningResult.icd10Codes.length ? args.screeningResult.icd10Codes.map((i) => `\u2022 ${i}`).join('\n') : 'No conditions selected in screening form' },
      { heading: 'CPT Codes', body: args.screeningResult.cptCodes.length ? args.screeningResult.cptCodes.map((c) => `\u2022 ${c} \u2013 ${cptDescriptions[c] || 'Procedure'}`).join('\n') : 'No procedures indicated based on selection' }
    ],
    billing: {
      icd10: args.screeningResult.icd10Codes.map((raw) => splitIcd(raw)),
      cpt: args.screeningResult.cptCodes.map((code) => ({ code, description: cptDescriptions[code] }))
    }
  };

  return { preProcedureOrder: pre, postProcedureNote: post, billing: bill };
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function buildUltrasoundNotesBody(
  selection: string[],
  conditions: Record<string, boolean>,
  config: UltrasoundConfig,
  otherText?: Record<string, string>
): string {
  if (!selection || selection.length === 0) return 'Select conditions in the screening form.';
  const paragraphs: string[] = [];
  for (const type of selection) {
    const cfg = config[type];
    if (!cfg) continue;
    const conditionNames: string[] = [];
    for (const cond of cfg.conditions) {
      const key = cond.name === 'Other' ? `${type}-Other` : cond.name;
      if (!conditions[key]) continue;
      if (cond.name === 'Other') {
        const text = (otherText || {})[type];
        if (text) conditionNames.push(text);
      } else {
        conditionNames.push(cond.name.toLowerCase());
      }
    }
    if (conditionNames.length === 0) continue;
    const cptLabel = cfg.cpt ? ` (CPT ${cfg.cpt})` : '';
    paragraphs.push(`${type}${cptLabel}: Indicated for ${joinNatural(conditionNames)}.`);
  }
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : 'Select conditions in the screening form.';
}

export function generateUltrasoundDocuments(args: {
  input: GenerateInput;
  screeningResult: ScreeningResult;
  screening: UltrasoundScreeningData;
  config: UltrasoundConfig;
  aiJustification?: string;
}): Record<'preProcedureOrder' | 'postProcedureNote' | 'billing', GeneratedDocument> {
  const generatedAtISO = isoNow(args.input.nowISO);
  const plexusId = ensurePlexusId(args.input.plexusId);
  const patient = args.input.patient;
  const clinician = args.input.clinician;
  const selection = args.screening.selection || [];
  const selectedConditions = args.screeningResult.selectedConditions;
  const procedureNotes = args.screeningResult.notes;

  const pre: GeneratedDocument = {
    service: 'Ultrasound',
    kind: 'preProcedureOrder',
    title: `Pre-Procedure Order Form - ${patient.patientName}`,
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Patient Information',
        body: [
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          clinician ? `Ordering Clinician: ${clinician.name}` : `Ordering Clinician: Not specified`,
          clinician?.npi ? `NPI: ${clinician.npi}` : `NPI: Not specified`
        ].join('\n')
      },
      { heading: 'Procedures Ordered', body: selection.length ? selection.map((t) => `\u2022 ${t}`).join('\n') : 'None selected' },
      { heading: 'Diagnosis', body: selectedConditions.length ? selectedConditions.map((d) => `\u2022 ${d}`).join('\n') : 'Select conditions in the screening form.' },
      ...(args.aiJustification ? [{ heading: 'Clinical Justification', body: args.aiJustification }] : []),
      { heading: 'Notes', body: buildUltrasoundNotesBody(selection, args.screening.conditions || {}, args.config, args.screening.otherText) },

    ]
  };

  const post: GeneratedDocument = {
    service: 'Ultrasound',
    kind: 'postProcedureNote',
    title: 'Plexus Ultrasound Procedure Note',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Demographics',
        body: [
          `Patient Name: ${patient.patientName}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          `Sex: ${patient.sex || 'Not specified'}`,
          `Patient MRN: ${patient.mrn || 'Not specified'}`
        ].join('\n')
      },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC, true) },
      { heading: 'Procedure', body: "Chief Complaint: Ultrasound Procedure\n\nSubjective\nPatient presents today for an ultrasound procedure. Intake has been completed. The patient's clinical history and indication for today's imaging study were reviewed and confirmed.\n\nObjective\nPhysical exam not required for this visit.\n\nAssessment & Plan\nThe room was prepared for diagnostic ultrasound imaging. The patient was positioned comfortably on the examination table, with pillows or supports placed as needed to optimize access to the area being studied. The skin over the targeted region was exposed, and ultrasound gel was applied to ensure proper transducer contact. A diagnostic ultrasound system was used to obtain sonographic images. The appropriate transducer was selected, and the exam proceeded according to standard scanning protocols for the anatomy of interest. Image acquisition may include grayscale imaging, Doppler flow assessment, compressibility testing, structural evaluation, or vascular characterization, depending on the type of study being performed. The sonographer adjusted gain, depth, Doppler angle, and other technical settings as needed to optimize visualization. After the study was completed, excess gel was removed, and the patient was assisted to a comfortable position. The patient tolerated the procedure well. The imaging study was successfully completed, and the finalized interpretation will be reviewed with the patient at a subsequent visit." },

      {
        heading: 'Order',
        body: [
          'Plexus Ultrasound Test - Pre-Procedure Order',
          '',
          'Patient Information',
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          `Date: ${new Date(generatedAtISO).toLocaleDateString()}`,
          '',
          'Procedure Ordered',
          selection.length ? selection.map((t) => `\u2022 ${t}`).join('\n') : 'None',
          '',
          'Diagnosis',
          selectedConditions.length ? selectedConditions.map((d) => `\u2022 ${d}`).join('\n') : 'N/A',
          '',
          'Notes',
          buildUltrasoundNotesBody(selection, args.screening.conditions || {}, args.config, args.screening.otherText)
        ].join('\n')
      }
    ]
  };

  const bill: GeneratedDocument = {
    service: 'Ultrasound',
    kind: 'billing',
    title: 'Plexus Ultrasound Billing Document',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}\nPlexus ID: ${plexusId}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC, true) },
      {
        heading: 'Procedures & Diagnoses',
        body: selection.map((type) => {
          const cfg = args.config[type];
          if (!cfg) return '';
          const selectedICDs: Array<{ code: string; name: string; raw?: string }> = [];
          cfg.conditions.forEach((cond) => {
            const key = cond.name === 'Other' ? `${type}-Other` : cond.name;
            if (!args.screening.conditions[key]) return;
            if (cond.name === 'Other') {
              const text = (args.screening.otherText || {})[type];
              if (text) selectedICDs.push({ code: 'Other', name: text });
            } else {
              const parsed = splitIcd(cond.icd);
              selectedICDs.push({ code: parsed.code, name: parsed.description || cond.name, raw: cond.icd });
            }
          });
          return [
            `${type}`,
            `CPT: ${cfg.cpt || 'N/A'}`,
            selectedICDs.length ? selectedICDs.map((i) => `\u2022 ${i.code}${i.name ? ` \u2013 ${i.name}` : ''}`).join('\n') : '\u2022 No diagnosis codes selected'
          ].join('\n');
        }).filter(Boolean).join('\n\n')
      }
    ],
    billing: {
      icd10: args.screeningResult.icd10Codes.map((raw) => splitIcd(raw)),
      cpt: args.screeningResult.cptCodes.map((code) => ({ code }))
    },
    meta: { selection }
  };

  return { preProcedureOrder: pre, postProcedureNote: post, billing: bill };
}

export function generateBrainWaveDocuments(args: {
  input: GenerateInput;
  screeningResult: ScreeningResult;
  aiJustification?: string;
}): Record<'preProcedureOrder' | 'postProcedureNote' | 'billing', GeneratedDocument> {
  const generatedAtISO = isoNow(args.input.nowISO);
  const plexusId = ensurePlexusId(args.input.plexusId);
  const patient = args.input.patient;
  const clinician = args.input.clinician;

  const pre: GeneratedDocument = {
    service: 'BrainWave',
    kind: 'preProcedureOrder',
    title: `Pre-Procedure Order Form - ${patient.patientName}`,
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Patient Information',
        body: [
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          clinician ? `Ordering Clinician: ${clinician.name}` : `Ordering Clinician: Not specified`,
          clinician?.npi ? `NPI: ${clinician.npi}` : `NPI: Not specified`
        ].join('\n')
      },
      { heading: 'Procedure Ordered', body: 'BrainWave - Comprehensive Assessment' },
      { heading: 'Diagnosis', body: args.screeningResult.selectedConditions.length ? args.screeningResult.selectedConditions.map((d) => `\u2022 ${d}`).join('\n') : 'Select conditions in the screening form.' },
      ...(args.aiJustification ? [{ heading: 'Clinical Justification', body: args.aiJustification }] : []),
      { heading: 'Notes', body: args.screeningResult.notes.length ? args.screeningResult.notes.join(' ') : 'Select conditions in the screening form.' },

    ]
  };

  const post: GeneratedDocument = {
    service: 'BrainWave',
    kind: 'postProcedureNote',
    title: 'Plexus BrainWave Procedure Note',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'Procedure', body: 'Procedure: BrainWave Comprehensive Assessment\nDetails: Neuropsychological testing, EEG/ECG, VEP, and AEP studies completed successfully. No complications.' },

    ]
  };

  const bill: GeneratedDocument = {
    service: 'BrainWave',
    kind: 'billing',
    title: 'Plexus BrainWave Billing Document',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}\nPlexus ID: ${plexusId}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'ICD-10 Codes', body: args.screeningResult.icd10Codes.length ? args.screeningResult.icd10Codes.map((c) => `\u2022 ${c}`).join('\n') : 'N/A' },
      { heading: 'CPT Codes', body: args.screeningResult.cptCodes.length ? args.screeningResult.cptCodes.map((c) => `\u2022 ${c}`).join('\n') : 'N/A' }
    ],
    billing: {
      icd10: args.screeningResult.icd10Codes.map((raw) => splitIcd(raw)),
      cpt: args.screeningResult.cptCodes.map((code) => ({ code }))
    }
  };

  return { preProcedureOrder: pre, postProcedureNote: post, billing: bill };
}

export function generatePgxDocuments(args: {
  input: GenerateInput;
  screeningResult: ScreeningResult;
  aiJustification?: string;
}): Record<'preProcedureOrder' | 'postProcedureNote' | 'billing', GeneratedDocument> {
  const generatedAtISO = isoNow(args.input.nowISO);
  const plexusId = ensurePlexusId(args.input.plexusId);
  const patient = args.input.patient;
  const clinician = args.input.clinician;

  const pre: GeneratedDocument = {
    service: 'PGx',
    kind: 'preProcedureOrder',
    title: 'Plexus PGx Pre-Procedure Order',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      {
        heading: 'Demographics',
        body: [
          `Patient Name: ${patient.patientName}`,
          `Date of Birth: ${patient.dateOfBirth || 'Not specified'}`,
          `Sex: ${patient.sex || 'Not specified'}`,
          `Patient MRN (Medical Record Number) from EMR: ${patient.mrn || 'Not specified'}`,
          `Plexus ID: ${plexusId}`
        ].join('\n')
      },
      {
        heading: 'Ordering Provider',
        body: [
          clinician ? `Ordering Provider Name: ${clinician.name}` : 'Ordering Provider Name: Not specified',
          clinician?.npi ? `NPI: ${clinician.npi}` : 'NPI: Not specified'
        ].join('\n')
      },
      { heading: 'Clinical Indication', body: 'History of adverse or failed medication trials; optimization of therapy and avoidance of drug\u2013gene interactions.' },
      ...(args.aiJustification ? [{ heading: 'Clinical Justification', body: args.aiJustification }] : []),
      { heading: 'Trigger Medications Identified', body: args.screeningResult.selectedConditions.length ? args.screeningResult.selectedConditions.map((t) => `\u2022 ${t}`).join('\n') : 'None identified from screening' },

    ]
  };

  const post: GeneratedDocument = {
    service: 'PGx',
    kind: 'postProcedureNote',
    title: 'Plexus PGx Collection Procedure Note',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}\nPlexus ID: ${plexusId}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'Chief Complaint', body: 'Pharmacogenomic Testing Collection' },
      { heading: 'Subjective', body: "Patient presents today for pharmacogenomic testing sample collection visit. Patient consent has been obtained and appropriateness of testing confirmed based on current medication regimen. Patient's clinical history and medication list were reviewed." },
      { heading: 'Objective', body: 'Physical exam not required for this visit' },
      { heading: 'Assessment & Plan', body: "The patient tolerated the sample collection procedure well. Patient was provided with verbal instructions for the buccal swab collection process. The collection area was prepared and a sterile buccal swab kit was opened. Patient was instructed to rinse mouth with water and wait 5 minutes before collection. The buccal swab was firmly rubbed against the inside of the patient's cheek for 30 seconds with rotation to ensure adequate cell collection from the buccal mucosa. This process was repeated on the opposite cheek with a second swab. Both swabs were immediately placed in the provided collection tube with preservation buffer and sealed according to manufacturer specifications. The collection tube was labeled with patient identifiers including name, date of birth, collection date, and MRN. The sample was logged and prepared for shipment to the reference laboratory. Patient was informed that results will be available within 7-10 business days and that the provider will schedule a follow-up appointment to review results and medication recommendations. The pharmacogenomic test collection was completed successfully." },

      {
        heading: 'Order',
        body: [
          'PGx Buccal Swab Order',
          '',
          'Order Details',
          'Order: Pharmacogenomic buccal swab test',
          'Indication: History of adverse or failed medication trials; optimization of therapy and avoidance of drug\u2013gene interactions.',
          'Specimen: Buccal swab (provided collection kit).',
          'Lab: GTI Lab',
          '',
          'Patient Information',
          `Patient: ${patient.patientName}`,
          `Plexus ID: ${plexusId}`,
          clinician ? `Ordering Clinician: ${clinician.name}` : 'Ordering Clinician: Not specified',
          `Date: ${new Date(generatedAtISO).toLocaleDateString()}`,
          '',
          'Trigger Medications',
          args.screeningResult.selectedConditions.length ? args.screeningResult.selectedConditions.map((t) => `\u2022 ${t}`).join('\n') : 'None'
        ].join('\n')
      }
    ]
  };

  const bill: GeneratedDocument = {
    service: 'PGx',
    kind: 'billing',
    title: 'Plexus PGx Billing Document',
    generatedAtISO,
    plexusId,
    patient,
    clinician,
    sections: [
      { heading: 'Demographics', body: `${patient.patientName}\nDOB: ${patient.dateOfBirth || 'Not specified'}\nSex: ${patient.sex || 'Not specified'}\nMRN: ${patient.mrn || 'Not specified'}\nPlexus ID: ${plexusId}` },
      { heading: 'Facility', body: formatClinicAddress(args.input.clinic || DEFAULT_CLINIC) },
      { heading: 'Procedure', body: 'Procedure: Pharmacogenomic buccal swab collection\nIndication: History of failed/adverse response to multiple medications, optimization of therapy\nDetails: Patient consent obtained. Buccal swab collected per lab instructions, sealed, and shipped to the licensed and certified genetic laboratory. No complications.' },
      { heading: 'ICD-10 Codes (Arizona-supported)', body: args.screeningResult.icd10Codes.map((c) => `\u2022 ${c}`).join('\n') },
      { heading: 'CPT/HCPCS Codes', body: args.screeningResult.cptCodes.map((c) => `\u2022 ${c}`).join('\n') },
      { heading: 'Trigger Medications from Screening', body: args.screeningResult.selectedConditions.length ? args.screeningResult.selectedConditions.map((t) => `\u2022 ${t}`).join('\n') : 'None' }
    ],
    billing: {
      icd10: args.screeningResult.icd10Codes.map((raw) => splitIcd(raw)),
      cpt: args.screeningResult.cptCodes.map((code) => ({ code }))
    }
  };

  return { preProcedureOrder: pre, postProcedureNote: post, billing: bill };
}

export type BundleArgs = {
  vitalWave?: { config: VitalWaveConfig; screening: VitalWaveScreeningData; };
  ultrasound?: { config: UltrasoundConfig; screening: UltrasoundScreeningData; };
  brainWave?: { mapping: ConditionMapping; screening: BrainWaveScreeningData; };
  pgx?: { screening: PgxScreeningData; };
};

export function generateAllDocuments(args: {
  input: GenerateInput;
  bundle: BundleArgs;
}): GeneratedDocument[] {
  const docs: GeneratedDocument[] = [];

  const resolvedClinic =
    args.input.clinic ??
    (args.input.clinician?.name ? resolveClinicForClinician(args.input.clinician.name) : DEFAULT_CLINIC);
  const input: GenerateInput = { ...args.input, clinic: resolvedClinic };

  if (args.bundle.vitalWave) {
    const screeningResult = vitalWaveScreeningToResult(args.bundle.vitalWave);
    docs.push(...Object.values(generateVitalWaveDocuments({ input, screeningResult, vitalWaveConfig: args.bundle.vitalWave.config, vitalWaveScreening: args.bundle.vitalWave.screening })));
  }
  if (args.bundle.ultrasound) {
    const screeningResult = ultrasoundScreeningToResult(args.bundle.ultrasound);
    docs.push(...Object.values(generateUltrasoundDocuments({ input, screeningResult, screening: args.bundle.ultrasound.screening, config: args.bundle.ultrasound.config })));
  }
  if (args.bundle.brainWave) {
    const screeningResult = brainWaveScreeningToResult(args.bundle.brainWave);
    docs.push(...Object.values(generateBrainWaveDocuments({ input, screeningResult })));
  }
  if (args.bundle.pgx) {
    const screeningResult = pgxScreeningToResult(args.bundle.pgx);
    docs.push(...Object.values(generatePgxDocuments({ input, screeningResult })));
  }

  return docs;
}

export type OpenAIPromptInput = {
  patient: PatientDemographics;
  service: PlexusService;
  selectedConditions: string[];
  notes: string[];
  icd10Codes?: string[];
  cptCodes?: string[];
};

export function generateOpenAIJustificationPrompt(input: OpenAIPromptInput): string {
  const serviceDescriptions: Record<string, string> = {
    VitalWave: 'VitalWave Comprehensive Autonomic & Vascular Assessment (non-invasive cardiovascular and autonomic nervous system diagnostic testing)',
    Ultrasound: 'Diagnostic Ultrasound study',
    BrainWave: 'BrainWave Comprehensive Neurological Assessment (EEG, neuropsychological testing, and related neurodiagnostic procedures)',
    PGx: 'Pharmacogenomic (PGx) Testing to assess drug-gene interactions and optimize medication therapy',
  };
  const serviceDesc = serviceDescriptions[input.service] || `${input.service} diagnostic testing`;

  return [
    `You are a CMS-certified medical scribe and clinical documentation specialist. Generate a 2-4 paragraph clinical justification narrative that is fully CMS-compliant and audit-ready for the following pre-procedure order.`,
    ``,
    `PATIENT INFORMATION:`,
    `Patient Name: ${input.patient.patientName}`,
    `Date of Birth: ${input.patient.dateOfBirth || 'Not specified'}`,
    ``,
    `SERVICE ORDERED: ${serviceDesc}`,
    input.icd10Codes?.length ? `ICD-10 Diagnosis Codes: ${input.icd10Codes.join(', ')}` : '',
    input.cptCodes?.length ? `CPT Procedure Codes: ${input.cptCodes.join(', ')}` : '',
    `Selected Diagnoses/Conditions: ${input.selectedConditions.length ? input.selectedConditions.join(', ') : 'None specified'}`,
    `Clinical Context (condition-mapped notes): ${input.notes.length ? input.notes.join(' ') : 'None'}`,
    ``,
    `REQUIREMENTS FOR THE JUSTIFICATION NARRATIVE:`,
    `- Write 2-4 cohesive paragraphs in formal clinical language suitable for inclusion in a medical record.`,
    `- Clearly state the medical necessity of the ordered procedure, linking the patient's specific diagnoses to the clinical rationale for testing.`,
    `- Reference the relevant ICD-10 diagnosis codes and CPT procedure codes by number when applicable.`,
    `- Explain how the test results will directly inform or change clinical management for this patient.`,
    `- Use language consistent with CMS Local Coverage Determinations (LCDs) and medical necessity documentation standards.`,
    `- The narrative must be patient-specific: reference ${input.patient.patientName}'s conditions and the specific service ordered.`,
    `- Do not use placeholder text, brackets, or template language. Use only the data provided above.`,
    `- Ensure the tone is objective, evidenced-based, and audit-ready.`,
    `- Output only the narrative paragraphs — no headings, no bullet points, no preamble.`
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

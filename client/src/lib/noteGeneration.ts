import {
  BRAINWAVE_MAPPING,
  VITALWAVE_CONFIG,
  ULTRASOUND_CONFIG,
  brainWaveScreeningToResult,
  vitalWaveScreeningToResult,
  ultrasoundScreeningToResult,
  generateBrainWaveDocuments,
  generateVitalWaveDocuments,
  generateUltrasoundDocuments,
  resolveClinicianNpi,
  resolveClinicForClinician,
  DEFAULT_CLINIC,
  type GeneratedDocument,
  type BrainWaveScreeningData,
  type VitalWaveScreeningData,
  type UltrasoundScreeningData,
} from "@shared/plexus";
import { apiRequest } from "@/lib/queryClient";

export interface NotePatientInput {
  id?: number;
  name: string;
  dob?: string | null;
  gender?: string | null;
  diagnoses?: string | null;
  history?: string | null;
  medications?: string | null;
  qualifyingTests?: string[] | null;
  reasoning?: Record<string, { qualifying_factors?: string[]; icd10_codes?: string[]; clinician_understanding?: string } | string> | null;
}

const ULTRASOUND_TEST_KEYWORDS = ["carotid", "echo", "stress", "venous", "duplex", "renal", "arterial", "aortic", "aneurysm", "aaa", "93880", "93306", "93975", "93925", "93930", "93978", "93350", "93971", "93970"];

function isImagingTest(test: string): boolean {
  const lower = test.toLowerCase();
  if (lower.includes("brain") || lower.includes("vital")) return false;
  return ULTRASOUND_TEST_KEYWORDS.some((u) => lower.includes(u));
}

const TEST_TO_ULTRASOUND_KEY: Record<string, string> = {
  "Bilateral Carotid Duplex": "Carotid Duplex",
  "Abdominal Aortic Aneurysm Duplex": "Abdominal Aorta",
  "Renal Artery Doppler": "Renal Artery Duplex",
  "Lower Extremity Arterial Doppler": "Lower Extremity Arterial",
  "Lower Extremity Venous Duplex": "Lower Extremity Venous",
  "Echocardiogram TTE": "Echocardiogram TTE",
  "Stress Echocardiogram": "Stress Echocardiogram",
  "Upper Extremity Arterial Doppler": "Upper Extremity Arterial",
  "Upper Extremity Venous Duplex": "Upper Extremity Venous",
};

async function fetchDocGenJustification(
  patientName: string,
  service: "BrainWave" | "VitalWave" | "Ultrasound",
  selectedConditions: string[],
  notes: string[],
  icd10Codes: string[],
  cptCodes: string[]
): Promise<string | undefined> {
  try {
    const res = await apiRequest("POST", "/api/generate-justification", {
      patient: { patientName },
      service,
      selectedConditions,
      notes,
      icd10Codes,
      cptCodes,
    });
    const data = await res.json();
    return data.justification || undefined;
  } catch {
    return undefined;
  }
}

function combineJustifications(docGenText: string | undefined, clinicianUnderstanding: string): string | undefined {
  const parts: string[] = [];
  if (docGenText) parts.push(docGenText);
  if (clinicianUnderstanding && clinicianUnderstanding !== docGenText) parts.push(clinicianUnderstanding);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export async function autoGeneratePatientNotes(
  patient: NotePatientInput,
  scheduleDate: string | null | undefined,
  facility: string | null | undefined,
  clinicianName: string | null | undefined
): Promise<GeneratedDocument[]> {
  const tests = patient.qualifyingTests || [];
  const reasoning = (patient.reasoning || {}) as Record<string, { qualifying_factors?: string[]; icd10_codes?: string[]; clinician_understanding?: string } | string>;

  const dos = scheduleDate || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const patientDemographics = {
    patientName: patient.name,
    dateOfBirth: patient.dob || undefined,
    dateOfService: dos,
    sex: patient.gender || undefined,
    diagnoses: patient.diagnoses || undefined,
    history: patient.history || undefined,
    medications: patient.medications || undefined,
  };

  const clinician = clinicianName
    ? { name: clinicianName, npi: resolveClinicianNpi(clinicianName) }
    : { name: "Ordering Clinician" };

  const clinic = clinicianName ? resolveClinicForClinician(clinicianName) : DEFAULT_CLINIC;
  const input = { patient: patientDemographics, clinician, clinic };

  const docs: GeneratedDocument[] = [];

  const getIcd10 = (test: string): string[] => {
    const r = reasoning[test];
    if (r && typeof r === "object" && r.icd10_codes) return r.icd10_codes;
    return [];
  };

  const getFactors = (test: string): string[] => {
    const r = reasoning[test];
    if (r && typeof r === "object" && r.qualifying_factors) return r.qualifying_factors;
    return [];
  };

  const getClinicianUnderstanding = (test: string): string => {
    const r = reasoning[test];
    if (r && typeof r === "object" && r.clinician_understanding) return r.clinician_understanding;
    return "";
  };

  const hasBrainWave = tests.some((t) => t.toLowerCase().includes("brain"));
  const hasVitalWave = tests.some((t) => t.toLowerCase().includes("vital"));
  const ultrasoundTests = tests.filter((t) => isImagingTest(t));

  if (hasBrainWave) {
    const bwTest = tests.find((t) => t.toLowerCase().includes("brain")) || "BrainWave";
    const icd10 = getIcd10(bwTest);
    const factors = getFactors(bwTest);
    const clinicianUnderstanding = getClinicianUnderstanding(bwTest);
    const screening: BrainWaveScreeningData = { group1: {}, group2: {}, group3: {} };
    factors.forEach((f) => {
      if (BRAINWAVE_MAPPING[f]) {
        const mapped = BRAINWAVE_MAPPING[f];
        (mapped.groups || [1]).forEach((g) => {
          const key = `group${g}` as keyof BrainWaveScreeningData;
          if (!screening[key]) screening[key] = {};
          (screening[key] as Record<string, boolean>)[f] = true;
        });
      }
    });
    const screeningResult = brainWaveScreeningToResult({ mapping: BRAINWAVE_MAPPING, screening });
    if (icd10.length > 0) screeningResult.icd10Codes = [...icd10, ...screeningResult.icd10Codes].filter((v, i, a) => a.indexOf(v) === i);
    if (factors.length > 0) screeningResult.selectedConditions = factors;

    const docGenJustification = await fetchDocGenJustification(
      patient.name, "BrainWave",
      screeningResult.selectedConditions, screeningResult.notes, screeningResult.icd10Codes, screeningResult.cptCodes
    );
    const aiJustification = combineJustifications(docGenJustification, clinicianUnderstanding);

    const generated = generateBrainWaveDocuments({ input, screeningResult, aiJustification });
    const bwMeta = JSON.stringify({ selectedConditions: screeningResult.selectedConditions, icd10Codes: screeningResult.icd10Codes, cptCodes: screeningResult.cptCodes });
    const bwMetaSection = { heading: "__screening_meta__", body: bwMeta };
    const bwJustSection = aiJustification ? { heading: "__ai_justification__", body: JSON.stringify({ text: aiJustification }) } : null;
    const bwExtra = [bwMetaSection, ...(bwJustSection ? [bwJustSection] : [])];
    generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, ...bwExtra];
    generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, ...bwExtra];
    generated.billing.sections = [...generated.billing.sections, ...bwExtra];
    docs.push(generated.preProcedureOrder, generated.postProcedureNote, generated.billing);
  }

  if (hasVitalWave) {
    const vwTest = tests.find((t) => t.toLowerCase().includes("vital")) || "VitalWave";
    const icd10 = getIcd10(vwTest);
    const factors = getFactors(vwTest);
    const clinicianUnderstanding = getClinicianUnderstanding(vwTest);
    const screening: VitalWaveScreeningData = {};
    Object.entries(VITALWAVE_CONFIG).forEach(([groupKey, group]) => {
      group.conditions.forEach((cond) => {
        if (factors.some((f) => f.toLowerCase().includes(cond.name.toLowerCase()) || cond.name.toLowerCase().includes(f.toLowerCase()))) {
          if (!screening[groupKey]) screening[groupKey] = {};
          screening[groupKey][cond.name] = true;
        }
      });
    });
    const screeningResult = vitalWaveScreeningToResult({ config: VITALWAVE_CONFIG, screening });
    if (icd10.length > 0) screeningResult.icd10Codes = [...icd10, ...screeningResult.icd10Codes].filter((v, i, a) => a.indexOf(v) === i);
    if (factors.length > 0 && screeningResult.selectedConditions.length === 0) screeningResult.selectedConditions = factors;

    const docGenJustification = await fetchDocGenJustification(
      patient.name, "VitalWave",
      screeningResult.selectedConditions, screeningResult.notes, screeningResult.icd10Codes, screeningResult.cptCodes
    );
    if (!docGenJustification) {
      console.warn(`[noteGeneration] DocGen justification empty for VitalWave — patient: ${patient.name}`);
    }
    const aiJustification = combineJustifications(docGenJustification, clinicianUnderstanding);

    const generated = generateVitalWaveDocuments({ input, screeningResult, vitalWaveConfig: VITALWAVE_CONFIG, vitalWaveScreening: screening, aiJustification });
    const vwMeta = JSON.stringify({ selectedConditions: screeningResult.selectedConditions, icd10Codes: screeningResult.icd10Codes, cptCodes: screeningResult.cptCodes });
    const vwMetaSection = { heading: "__screening_meta__", body: vwMeta };
    const vwJustSection = aiJustification ? { heading: "__ai_justification__", body: JSON.stringify({ text: aiJustification }) } : null;
    const vwExtra = [vwMetaSection, ...(vwJustSection ? [vwJustSection] : [])];
    generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, ...vwExtra];
    generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, ...vwExtra];
    generated.billing.sections = [...generated.billing.sections, ...vwExtra];
    docs.push(generated.preProcedureOrder, generated.postProcedureNote, generated.billing);
  }

  if (ultrasoundTests.length > 0) {
    const icd10: string[] = [];
    const factors: string[] = [];
    const clinicianUnderstandings: string[] = [];
    ultrasoundTests.forEach((t) => {
      icd10.push(...getIcd10(t));
      factors.push(...getFactors(t));
      const cu = getClinicianUnderstanding(t);
      if (cu) clinicianUnderstandings.push(cu);
    });
    const selection = ultrasoundTests
      .map((t) => TEST_TO_ULTRASOUND_KEY[t] || t.replace(/\s*\(\d{4,5}\)\s*$/, "").trim())
      .filter((k) => ULTRASOUND_CONFIG[k]);
    const conditions: Record<string, boolean> = {};
    const fuzzyMatch = (factor: string, condName: string): boolean => {
      const f = factor.toLowerCase();
      const c = condName.toLowerCase();
      return f.includes(c) || c.includes(f);
    };
    selection.forEach((key) => {
      const cfg = ULTRASOUND_CONFIG[key];
      if (!cfg) return;
      const nonOtherConds = cfg.conditions.filter((cond) => cond.name !== "Other");
      let matched = false;
      nonOtherConds.forEach((cond) => {
        if (factors.some((f) => fuzzyMatch(f, cond.name))) {
          conditions[cond.name] = true;
          matched = true;
        }
      });
      if (!matched && nonOtherConds.length > 0) {
        conditions[nonOtherConds[0].name] = true;
      }
    });
    const usScreening: UltrasoundScreeningData = { selection, conditions };
    const screeningResult = ultrasoundScreeningToResult({ config: ULTRASOUND_CONFIG, screening: usScreening });
    if (icd10.length > 0) screeningResult.icd10Codes = [...icd10, ...screeningResult.icd10Codes].filter((v, i, a) => a.indexOf(v) === i);
    if (factors.length > 0 && screeningResult.selectedConditions.length === 0) screeningResult.selectedConditions = factors;

    const docGenJustification = await fetchDocGenJustification(
      patient.name, "Ultrasound",
      screeningResult.selectedConditions, screeningResult.notes, screeningResult.icd10Codes, screeningResult.cptCodes
    );
    if (!docGenJustification) {
      console.warn(`[noteGeneration] DocGen justification empty for Ultrasound — patient: ${patient.name}`);
    }
    const combinedClinician = clinicianUnderstandings.join("\n\n");
    const aiJustification = combineJustifications(docGenJustification, combinedClinician);

    const generated = generateUltrasoundDocuments({ input, screeningResult, screening: usScreening, config: ULTRASOUND_CONFIG, aiJustification });
    const usMeta = JSON.stringify({ selectedConditions: screeningResult.selectedConditions, icd10Codes: screeningResult.icd10Codes, cptCodes: screeningResult.cptCodes, selection, conditions });
    const usMetaSection = { heading: "__screening_meta__", body: usMeta };
    const usJustSection = aiJustification ? { heading: "__ai_justification__", body: JSON.stringify({ text: aiJustification }) } : null;
    const usExtra = [usMetaSection, ...(usJustSection ? [usJustSection] : [])];
    generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, ...usExtra];
    generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, ...usExtra];
    generated.billing.sections = [...generated.billing.sections, ...usExtra];
    docs.push(generated.preProcedureOrder, generated.postProcedureNote, generated.billing);
  }

  return docs;
}

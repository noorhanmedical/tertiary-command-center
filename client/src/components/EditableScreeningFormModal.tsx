import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, RefreshCw } from "lucide-react";
import {
  VITALWAVE_CONFIG,
  ULTRASOUND_CONFIG,
  BRAINWAVE_MAPPING,
  BRAINWAVE_GROUPS,
  PGX_TRIGGER_MEDICATIONS,
  type VitalWaveScreeningData,
  type UltrasoundScreeningData,
  type BrainWaveScreeningData,
  type PgxScreeningData,
  vitalWaveScreeningToResult,
  ultrasoundScreeningToResult,
  brainWaveScreeningToResult,
  pgxScreeningToResult,
  generateVitalWaveDocuments,
  generateUltrasoundDocuments,
  generateBrainWaveDocuments,
  generatePgxDocuments,
  resolveClinicForClinician,
  DEFAULT_CLINIC,
} from "@shared/plexus";

const SERVICE_COLORS: Record<string, string> = {
  BrainWave: "bg-purple-100 text-purple-700 border-purple-200",
  VitalWave: "bg-red-100 text-red-700 border-red-200",
  Ultrasound: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PGx: "bg-blue-100 text-blue-700 border-blue-200",
};

type NoteSection = { heading: string; body: string };

export type EditableScreeningNoteContext = {
  service: string;
  title: string;
  sections: NoteSection[];
  patientId: number;
  batchId: number;
  facility: string | null;
  scheduleDate: string | null;
  patientName: string;
  clinicianName?: string | null;
};

type PatientScreeningRecord = {
  id: number;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  qualifyingTests: string[] | null;
};

function extractMetaFromSections(sections: NoteSection[]): {
  selectedConditions: string[];
  icd10Codes: string[];
  cptCodes: string[];
  selection: string[];
  otherText: Record<string, string>;
  conditions: Record<string, boolean> | null;
  hasData: boolean;
} {
  const metaSection = sections.find((s) => s.heading === "__screening_meta__");
  if (metaSection) {
    try {
      const parsed = JSON.parse(metaSection.body);
      const selectedConditions = Array.isArray(parsed.selectedConditions) ? parsed.selectedConditions : [];
      const hasData = selectedConditions.length > 0;
      return {
        selectedConditions,
        icd10Codes: Array.isArray(parsed.icd10Codes) ? parsed.icd10Codes : [],
        cptCodes: Array.isArray(parsed.cptCodes) ? parsed.cptCodes : [],
        selection: Array.isArray(parsed.selection) ? parsed.selection : [],
        otherText: (parsed.otherText && typeof parsed.otherText === "object" && !Array.isArray(parsed.otherText))
          ? parsed.otherText
          : {},
        conditions: (parsed.conditions && typeof parsed.conditions === "object" && !Array.isArray(parsed.conditions))
          ? parsed.conditions as Record<string, boolean>
          : null,
        hasData,
      };
    } catch {
    }
  }
  return { selectedConditions: [], icd10Codes: [], cptCodes: [], selection: [], otherText: {}, conditions: null, hasData: false };
}

function clinicalTextMatchesCondition(condName: string, clinicalText: string): boolean {
  const lower = clinicalText.toLowerCase();
  const cond = condName.toLowerCase();

  if (lower.includes(cond)) return true;

  const ALIASES: Record<string, string[]> = {
    "essential hypertension": ["htn", "hypertension", "high blood pressure"],
    "type 2 diabetes mellitus": ["dm2", "t2dm", "diabetes mellitus type 2", "type ii diabetes", "diabetes"],
    "mixed hyperlipidemia": ["hyperlipidemia", "hld", "dyslipidemia", "high cholesterol"],
    "atrial fibrillation": ["afib", "a-fib", "a fib"],
    "peripheral neuropathy": ["neuropathy", "peripheral neuropathy"],
    "orthostatic hypotension": ["orthostatic hypotension"],
    "syncope and collapse": ["syncope", "collapse", "fainting"],
    "dizziness and giddiness": ["dizziness", "giddiness", "vertigo"],
    "cardiac arrhythmia": ["arrhythmia", "dysrhythmia"],
    "chest pain": ["chest pain", "angina"],
    "bradycardia": ["bradycardia", "slow heart"],
    "palpitations": ["palpitations", "palpitation"],
    "major depressive disorder": ["depression", "mdd", "depressive disorder"],
    "generalized anxiety disorder": ["anxiety", "gad"],
    "adhd, predominantly inattentive": ["adhd", "add", "attention deficit"],
    "mild cognitive impairment": ["mci", "cognitive impairment", "memory loss"],
    "seizure disorder": ["seizure", "epilepsy"],
    "hypothyroidism": ["hypothyroid", "low thyroid"],
    "obesity": ["obesity", "obese"],
    "prediabetes": ["prediabetes", "pre-diabetes", "borderline diabetes"],
    "vitamin d deficiency": ["vitamin d deficiency", "vit d deficiency"],
    "chronic pain": ["chronic pain"],
    "memory loss": ["memory loss", "forgetfulness", "cognitive decline"],
    "peripheral arterial disease": ["pad", "peripheral arterial disease", "peripheral vascular disease"],
    "carotid artery disease": ["carotid", "carotid stenosis"],
    "stroke/tia history": ["stroke", "tia", "transient ischemic"],
    "abdominal aortic aneurysm": ["aaa", "abdominal aortic aneurysm"],
    "deep vein thrombosis": ["dvt", "deep vein thrombosis"],
    "heart failure": ["heart failure", "chf", "congestive heart failure"],
    "cardiomyopathy": ["cardiomyopathy"],
    "valvular heart disease": ["valve", "valvular"],
    "coronary artery disease": ["cad", "coronary artery disease"],
    "renal artery stenosis": ["renal artery stenosis", "renovascular"],
    "renovascular hypertension": ["renovascular hypertension", "renal hypertension"],
    "chronic kidney disease": ["ckd", "chronic kidney disease", "renal failure"],
    "atherosclerosis of aorta": ["atherosclerosis"],
    "autonomic neuropathy": ["autonomic neuropathy", "autonomic dysfunction"],
  };

  const aliasSet = ALIASES[cond] || [];
  return aliasSet.some((alias) => lower.includes(alias));
}

function buildConditionsFromPatientRecord(
  patient: PatientScreeningRecord,
  service: string
): string[] {
  const clinicalText = [patient.diagnoses, patient.history, patient.medications]
    .filter(Boolean)
    .join(" ");
  const qualifyingTests = patient.qualifyingTests || [];

  if (service === "VitalWave") {
    const matched: string[] = [];
    Object.values(VITALWAVE_CONFIG).forEach((group) => {
      group.conditions.forEach((cond) => {
        if (clinicalText && clinicalTextMatchesCondition(cond.name, clinicalText)) {
          matched.push(cond.name);
        }
      });
    });
    return matched;
  }

  if (service === "BrainWave") {
    if (!qualifyingTests.includes("BrainWave") && !qualifyingTests.some((t) => t.toLowerCase().includes("brainwave"))) {
      return [];
    }
    const matched: string[] = [];
    Object.keys(BRAINWAVE_MAPPING).forEach((condName) => {
      if (clinicalText && clinicalTextMatchesCondition(condName, clinicalText)) {
        matched.push(condName);
      }
    });
    return matched;
  }

  if (service === "Ultrasound") {
    const matched: string[] = [];
    Object.values(ULTRASOUND_CONFIG).forEach((cfg) => {
      cfg.conditions.forEach((cond) => {
        if (cond.name !== "Other" && clinicalText && clinicalTextMatchesCondition(cond.name, clinicalText)) {
          matched.push(cond.name);
        }
      });
    });
    return matched;
  }

  if (service === "PGx") {
    if (!patient.medications) return [];
    return PGX_TRIGGER_MEDICATIONS.filter((med) =>
      patient.medications!.toLowerCase().includes(med.toLowerCase().split(" ")[0])
    );
  }

  return [];
}

function buildUltrasoundSelectionFromPatient(
  patient: PatientScreeningRecord
): string[] {
  const qualifyingTests = patient.qualifyingTests || [];
  const TEST_TO_US_TYPE: Record<string, string> = {
    "Bilateral Carotid Duplex": "Carotid Duplex",
    "Echocardiogram TTE": "Echocardiogram TTE",
    "Renal Artery Doppler": "Renal Artery Duplex",
    "Lower Extremity Arterial Doppler": "Lower Extremity Arterial",
    "Lower Extremity Venous Duplex": "Lower Extremity Venous",
    "Stress Echocardiogram": "Stress Echocardiogram",
    "Abdominal Aorta": "Abdominal Aorta",
    "Upper Extremity Arterial": "Upper Extremity Arterial",
    "Upper Extremity Venous": "Upper Extremity Venous",
  };
  const usTypes = new Set<string>();
  qualifyingTests.forEach((test) => {
    const mapped = TEST_TO_US_TYPE[test];
    if (mapped && ULTRASOUND_CONFIG[mapped]) {
      usTypes.add(mapped);
    }
    Object.keys(ULTRASOUND_CONFIG).forEach((type) => {
      if (test.toLowerCase().includes(type.toLowerCase()) || type.toLowerCase().includes(test.toLowerCase())) {
        usTypes.add(type);
      }
    });
  });
  return Array.from(usTypes);
}

function buildInitialVwScreening(selectedConditions: string[]): VitalWaveScreeningData {
  const screening: VitalWaveScreeningData = {};
  Object.entries(VITALWAVE_CONFIG).forEach(([groupKey, group]) => {
    group.conditions.forEach((cond) => {
      if (selectedConditions.includes(cond.name)) {
        if (!screening[groupKey]) screening[groupKey] = {};
        screening[groupKey][cond.name] = true;
      }
    });
  });
  return screening;
}

function buildInitialBwScreening(selectedConditions: string[]): BrainWaveScreeningData {
  const screening: BrainWaveScreeningData = {};
  Object.entries(BRAINWAVE_GROUPS).forEach(([groupKey, group]) => {
    group.conditions.forEach((condName) => {
      if (selectedConditions.includes(condName)) {
        if (!screening[groupKey]) screening[groupKey] = {};
        (screening[groupKey] as Record<string, boolean>)[condName] = true;
      }
    });
  });
  return screening;
}

function buildInitialUsScreening(
  selectedConditions: string[],
  selection: string[],
  savedOtherText: Record<string, string>,
  savedConditions: Record<string, boolean> | null
): UltrasoundScreeningData {
  const otherText: Record<string, string> = { ...savedOtherText };
  if (savedConditions !== null) {
    return { selection, conditions: { ...savedConditions }, otherText };
  }
  const conditions: Record<string, boolean> = {};
  selection.forEach((type) => {
    const cfg = ULTRASOUND_CONFIG[type];
    if (!cfg) return;
    cfg.conditions.forEach((cond) => {
      if (cond.name === "Other") {
        if (savedOtherText[type]) {
          conditions[`${type}-Other`] = true;
        }
        return;
      }
      if (selectedConditions.includes(cond.name)) {
        conditions[cond.name] = true;
      }
    });
  });
  return { selection, conditions, otherText };
}

function buildInitialPgxScreening(selectedConditions: string[]): PgxScreeningData {
  return {
    matches: selectedConditions
      .filter((c) => PGX_TRIGGER_MEDICATIONS.includes(c))
      .map((trigger) => ({ trigger })),
  };
}

export function EditableScreeningFormModal({
  note,
  onClose,
  onSuccess,
}: {
  note: EditableScreeningNoteContext;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const service = note.service;
  const colorClass = SERVICE_COLORS[service] || "bg-slate-100 text-slate-600 border-slate-200";

  const meta = extractMetaFromSections(note.sections);

  const needsFallback = !meta.hasData;

  const { data: patientRecord, isError: patientFetchError } = useQuery<PatientScreeningRecord>({
    queryKey: ["/api/patients", note.patientId],
    enabled: needsFallback,
  });

  const [initialized, setInitialized] = useState(!needsFallback);

  const [vwScreening, setVwScreening] = useState<VitalWaveScreeningData>(() =>
    buildInitialVwScreening(meta.selectedConditions)
  );
  const [usScreening, setUsScreening] = useState<UltrasoundScreeningData>(() =>
    buildInitialUsScreening(meta.selectedConditions, meta.selection, meta.otherText, meta.conditions)
  );
  const [bwScreening, setBwScreening] = useState<BrainWaveScreeningData>(() =>
    buildInitialBwScreening(meta.selectedConditions)
  );
  const [pgxScreening, setPgxScreening] = useState<PgxScreeningData>(() =>
    buildInitialPgxScreening(meta.selectedConditions)
  );

  useEffect(() => {
    if (!needsFallback || initialized) return;
    if (patientFetchError) {
      setInitialized(true);
      return;
    }
    if (!patientRecord) return;

    const conditions = buildConditionsFromPatientRecord(patientRecord, service);

    if (service === "VitalWave") {
      setVwScreening(buildInitialVwScreening(conditions));
    } else if (service === "BrainWave") {
      setBwScreening(buildInitialBwScreening(conditions));
    } else if (service === "Ultrasound") {
      const selection = buildUltrasoundSelectionFromPatient(patientRecord);
      setUsScreening(buildInitialUsScreening(conditions, selection, {}, null));
    } else if (service === "PGx") {
      setPgxScreening(buildInitialPgxScreening(conditions));
    }

    setInitialized(true);
  }, [needsFallback, initialized, patientRecord, patientFetchError, service]);

  const regenerateMutation = useMutation({
    mutationFn: async (payload: Array<{
      patientId: number;
      batchId: number;
      facility: string | null;
      scheduleDate: string | null;
      patientName: string;
      service: string;
      docKind: string;
      title: string;
      sections: NoteSection[];
    }>) => {
      const res = await apiRequest("POST", "/api/generated-notes/service", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-notes/batch", note.batchId] });
      toast({ title: "Documents regenerated", description: "Updated clinical notes have been saved." });
      onSuccess?.();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Regeneration failed", description: e.message, variant: "destructive" });
    },
  });

  function handleRegenerate() {
    const patientName = note.patientName;
    const clinicianName = note.clinicianName;

    const patientDemographics = { patientName };
    const clinician = clinicianName ? { name: clinicianName } : { name: "Ordering Clinician" };
    const clinic = clinicianName ? resolveClinicForClinician(clinicianName) : DEFAULT_CLINIC;
    const input = { patient: patientDemographics, clinician, clinic };

    type DocOutput = {
      service: string;
      kind: string;
      title: string;
      sections: NoteSection[];
    };

    let docs: DocOutput[] = [];

    if (service === "VitalWave") {
      const result = vitalWaveScreeningToResult({ config: VITALWAVE_CONFIG, screening: vwScreening });
      const generated = generateVitalWaveDocuments({ input, screeningResult: result, vitalWaveConfig: VITALWAVE_CONFIG, vitalWaveScreening: vwScreening });
      const meta = JSON.stringify({ selectedConditions: result.selectedConditions, icd10Codes: result.icd10Codes, cptCodes: result.cptCodes });
      const metaSection = { heading: "__screening_meta__", body: meta };
      generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, metaSection];
      generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, metaSection];
      generated.billing.sections = [...generated.billing.sections, metaSection];
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "Ultrasound") {
      const result = ultrasoundScreeningToResult({ config: ULTRASOUND_CONFIG, screening: usScreening });
      const generated = generateUltrasoundDocuments({ input, screeningResult: result, screening: usScreening, config: ULTRASOUND_CONFIG });
      const metaBody = JSON.stringify({ selectedConditions: result.selectedConditions, icd10Codes: result.icd10Codes, cptCodes: result.cptCodes, selection: usScreening.selection, otherText: usScreening.otherText || {}, conditions: usScreening.conditions });
      const metaSection = { heading: "__screening_meta__", body: metaBody };
      generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, metaSection];
      generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, metaSection];
      generated.billing.sections = [...generated.billing.sections, metaSection];
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "BrainWave") {
      const result = brainWaveScreeningToResult({ mapping: BRAINWAVE_MAPPING, screening: bwScreening });
      const generated = generateBrainWaveDocuments({ input, screeningResult: result });
      const metaBody = JSON.stringify({ selectedConditions: result.selectedConditions, icd10Codes: result.icd10Codes, cptCodes: result.cptCodes });
      const metaSection = { heading: "__screening_meta__", body: metaBody };
      generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, metaSection];
      generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, metaSection];
      generated.billing.sections = [...generated.billing.sections, metaSection];
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "PGx") {
      const result = pgxScreeningToResult({ screening: pgxScreening });
      const generated = generatePgxDocuments({ input, screeningResult: result });
      const metaBody = JSON.stringify({ selectedConditions: result.selectedConditions, icd10Codes: result.icd10Codes, cptCodes: result.cptCodes });
      const metaSection = { heading: "__screening_meta__", body: metaBody };
      generated.preProcedureOrder.sections = [...generated.preProcedureOrder.sections, metaSection];
      generated.postProcedureNote.sections = [...generated.postProcedureNote.sections, metaSection];
      generated.billing.sections = [...generated.billing.sections, metaSection];
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    }

    const payload = docs.map((doc) => ({
      patientId: note.patientId,
      batchId: note.batchId,
      facility: note.facility,
      scheduleDate: note.scheduleDate,
      patientName: note.patientName,
      service: doc.service,
      docKind: doc.kind,
      title: doc.title,
      sections: doc.sections,
    }));

    regenerateMutation.mutate(payload);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-editable-screening-form">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-600" />
            Screening Form
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
              {service}
            </span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-500 -mt-1">{note.title}</p>

        {needsFallback && !initialized && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Loading patient data…
          </div>
        )}

        <div className="space-y-4">
          {service === "VitalWave" && (
            <>
              {Object.entries(VITALWAVE_CONFIG).map(([groupKey, group]) => (
                <Card key={groupKey} className="p-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">{group.title}</h3>
                  <p className="text-xs text-slate-500 mb-3">CPT: {group.cpt}</p>
                  <div className="space-y-2">
                    {group.conditions.map((cond) => {
                      const checked = !!(vwScreening[groupKey]?.[cond.name]);
                      return (
                        <div key={cond.name} className="flex items-start gap-2.5">
                          <Checkbox
                            id={`edit-vw-${groupKey}-${cond.name}`}
                            checked={checked}
                            onCheckedChange={(v) =>
                              setVwScreening((prev) => ({
                                ...prev,
                                [groupKey]: { ...(prev[groupKey] || {}), [cond.name]: !!v },
                              }))
                            }
                            data-testid={`edit-checkbox-vw-${groupKey}-${cond.name.replace(/\s+/g, "-").toLowerCase()}`}
                          />
                          <label
                            htmlFor={`edit-vw-${groupKey}-${cond.name}`}
                            className="text-sm text-slate-700 leading-snug cursor-pointer select-none"
                          >
                            {cond.name}
                            {cond.icd && (
                              <span className="ml-1 text-xs text-slate-400">({cond.icd})</span>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </>
          )}

          {service === "Ultrasound" && (
            <>
              {Object.entries(ULTRASOUND_CONFIG).map(([type, cfg]) => {
                const isSelected = usScreening.selection.includes(type);
                return (
                  <Card
                    key={type}
                    className={`overflow-hidden border-2 transition-all ${isSelected ? "border-primary" : "border-slate-200"}`}
                  >
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50"
                      onClick={() => {
                        setUsScreening((prev) => ({
                          ...prev,
                          selection: isSelected
                            ? prev.selection.filter((s) => s !== type)
                            : [...prev.selection, type],
                        }));
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={(v) => {
                          setUsScreening((prev) => ({
                            ...prev,
                            selection: v
                              ? [...prev.selection, type]
                              : prev.selection.filter((s) => s !== type),
                          }));
                        }}
                        data-testid={`edit-checkbox-us-type-${type.replace(/\s+/g, "-").toLowerCase()}`}
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-slate-800">{type}</p>
                        <p className="text-xs text-slate-500">CPT: {cfg.cpt || "N/A"}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="border-t border-slate-100 p-4 pt-3 space-y-2 bg-slate-50/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Select indications:</p>
                        {cfg.conditions.map((cond) => {
                          const key = cond.name === "Other" ? `${type}-Other` : cond.name;
                          const checked = !!(usScreening.conditions[key]);
                          return (
                            <div key={cond.name}>
                              <div className="flex items-start gap-2.5">
                                <Checkbox
                                  id={`edit-us-${type}-${cond.name}`}
                                  checked={checked}
                                  onCheckedChange={(v) =>
                                    setUsScreening((prev) => ({
                                      ...prev,
                                      conditions: { ...prev.conditions, [key]: !!v },
                                    }))
                                  }
                                  data-testid={`edit-checkbox-us-cond-${type.replace(/\s+/g, "-").toLowerCase()}-${cond.name.replace(/\s+/g, "-").toLowerCase()}`}
                                />
                                <label
                                  htmlFor={`edit-us-${type}-${cond.name}`}
                                  className="text-sm text-slate-700 cursor-pointer select-none"
                                >
                                  {cond.name}
                                  {cond.icd && cond.name !== "Other" && (
                                    <span className="ml-1 text-xs text-slate-400">({cond.icd})</span>
                                  )}
                                </label>
                              </div>
                              {cond.name === "Other" && checked && (
                                <Input
                                  className="mt-1.5 ml-6 h-8 text-sm"
                                  placeholder="Describe indication..."
                                  value={(usScreening.otherText || {})[type] || ""}
                                  onChange={(e) =>
                                    setUsScreening((prev) => ({
                                      ...prev,
                                      otherText: { ...(prev.otherText || {}), [type]: e.target.value },
                                    }))
                                  }
                                  data-testid={`edit-input-us-other-${type.replace(/\s+/g, "-").toLowerCase()}`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </>
          )}

          {service === "BrainWave" && (
            <>
              {Object.entries(BRAINWAVE_GROUPS).map(([groupKey, group]) => (
                <Card key={groupKey} className="p-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">{group.label}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {group.conditions.map((condName) => {
                      const checked = !!(bwScreening[groupKey]?.[condName]);
                      return (
                        <div key={condName} className="flex items-start gap-2.5">
                          <Checkbox
                            id={`edit-bw-${groupKey}-${condName}`}
                            checked={checked}
                            onCheckedChange={(v) =>
                              setBwScreening((prev) => ({
                                ...prev,
                                [groupKey]: { ...(prev[groupKey] || {}), [condName]: !!v },
                              }))
                            }
                            data-testid={`edit-checkbox-bw-${groupKey}-${condName.replace(/\s+/g, "-").replace(/[,/]/g, "").toLowerCase()}`}
                          />
                          <label
                            htmlFor={`edit-bw-${groupKey}-${condName}`}
                            className="text-sm text-slate-700 leading-snug cursor-pointer select-none"
                          >
                            {condName}
                            {BRAINWAVE_MAPPING[condName]?.icdCodes?.length ? (
                              <span className="ml-1 text-xs text-slate-400">
                                ({BRAINWAVE_MAPPING[condName].icdCodes.join(", ")})
                              </span>
                            ) : null}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </>
          )}

          {service === "PGx" && (
            <Card className="p-4">
              <p className="text-sm text-slate-600 mb-4">
                Check all medications the patient is currently taking or has taken that may interact with genetic variants.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {PGX_TRIGGER_MEDICATIONS.map((med) => {
                  const isChecked = !!(pgxScreening.matches?.some((m) => m.trigger === med));
                  return (
                    <div key={med} className="flex items-start gap-2.5">
                      <Checkbox
                        id={`edit-pgx-${med}`}
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          setPgxScreening((prev) => ({
                            matches: v
                              ? [...(prev.matches || []), { trigger: med }]
                              : (prev.matches || []).filter((m) => m.trigger !== med),
                          }))
                        }
                        data-testid={`edit-checkbox-pgx-${med.replace(/[\s()]/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}`}
                      />
                      <label
                        htmlFor={`edit-pgx-${med}`}
                        className="text-sm text-slate-700 leading-snug cursor-pointer select-none"
                      >
                        {med}
                      </label>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button
            onClick={handleRegenerate}
            disabled={regenerateMutation.isPending}
            data-testid="button-regenerate-documents"
          >
            {regenerateMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {regenerateMutation.isPending ? "Regenerating..." : "Regenerate Documents"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

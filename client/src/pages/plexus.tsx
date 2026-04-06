import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ClipboardList,
  ChevronRight,
  Printer,
  Copy,
  Check,
  FileText,
  Activity,
  Brain,
  Pill,
  Waves,
} from "lucide-react";
import {
  type PlexusService,
  type GeneratedDocument,
  type VitalWaveScreeningData,
  type UltrasoundScreeningData,
  type BrainWaveScreeningData,
  type PgxScreeningData,
  VITALWAVE_CONFIG,
  ULTRASOUND_CONFIG,
  BRAINWAVE_MAPPING,
  BRAINWAVE_GROUPS,
  PGX_TRIGGER_MEDICATIONS,
  vitalWaveScreeningToResult,
  ultrasoundScreeningToResult,
  brainWaveScreeningToResult,
  pgxScreeningToResult,
  generateVitalWaveDocuments,
  generateUltrasoundDocuments,
  generateBrainWaveDocuments,
  generatePgxDocuments,
  resolveClinicForClinician,
} from "@shared/plexus";

type Step = "patient" | "service" | "screening" | "documents";

interface PatientInfo {
  patientName: string;
  dateOfBirth: string;
  sex: string;
  mrn: string;
  dateOfService: string;
  clinicianName: string;
  clinicianNpi: string;
}

const SERVICE_OPTIONS: { value: PlexusService; label: string; desc: string; icon: typeof FileText }[] = [
  { value: "VitalWave", label: "VitalWave", desc: "Comprehensive Autonomic & Vascular Assessment", icon: Activity },
  { value: "Ultrasound", label: "Ultrasound", desc: "Diagnostic Vascular Ultrasound Imaging", icon: Waves },
  { value: "BrainWave", label: "BrainWave", desc: "Neuropsychological & EEG Assessment", icon: Brain },
  { value: "PGx", label: "PGx", desc: "Pharmacogenomic Testing Collection", icon: Pill },
];

function DocumentSection({ doc, index }: { doc: GeneratedDocument; index: number }) {
  const [copied, setCopied] = useState(false);

  const kindLabel = {
    preProcedureOrder: "Pre-Procedure Order",
    postProcedureNote: "Post-Procedure Note",
    billing: "Billing Document",
    screening: "Screening",
  }[doc.kind] || doc.kind;

  const kindColor = {
    preProcedureOrder: "bg-blue-100 text-blue-800",
    postProcedureNote: "bg-teal-100 text-teal-800",
    billing: "bg-emerald-100 text-emerald-800",
    screening: "bg-slate-100 text-slate-800",
  }[doc.kind] || "bg-slate-100 text-slate-800";

  const fullText = doc.sections
    .map((s) => `${s.heading}\n${"─".repeat(s.heading.length)}\n${s.body}`)
    .join("\n\n");

  function handleCopy() {
    navigator.clipboard.writeText(`${doc.title}\n\n${fullText}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    w.document.write(
      `<html><head><title>${esc(doc.title)}</title><style>` +
      `body{font-family:Arial,sans-serif;font-size:12pt;padding:1in}` +
      `h1{font-size:14pt;border-bottom:2px solid #000;padding-bottom:6px}` +
      `h2{font-size:12pt;margin-top:20px;margin-bottom:4px;color:#222}` +
      `p{white-space:pre-wrap;margin:0 0 8px 0}` +
      `</style></head><body>` +
      `<h1>${esc(doc.title)}</h1>` +
      doc.sections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`).join("") +
      `</body></html>`
    );
    w.document.close();
    w.print();
  }

  return (
    <Card
      className="overflow-hidden border border-slate-200 dark:border-border"
      data-testid={`document-card-${index}`}
    >
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-muted/30 border-b border-slate-200 dark:border-border">
        <div className="flex items-center gap-3">
          <Badge className={`text-xs font-semibold ${kindColor}`} data-testid={`badge-doc-kind-${index}`}>
            {kindLabel}
          </Badge>
          <span className="text-sm font-semibold text-slate-800 dark:text-foreground">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={handleCopy}
            data-testid={`button-copy-doc-${index}`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={handlePrint}
            data-testid={`button-print-doc-${index}`}
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
        </div>
      </div>
      <div className="p-5 space-y-4">
        {doc.sections.map((section, si) => (
          <div key={si} data-testid={`doc-section-${index}-${si}`}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mb-1">
              {section.heading}
            </h4>
            <p className="text-sm text-slate-800 dark:text-foreground whitespace-pre-wrap leading-relaxed">
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function PlexusPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("patient");
  const [patient, setPatient] = useState<PatientInfo>({
    patientName: "",
    dateOfBirth: "",
    sex: "",
    mrn: "",
    dateOfService: "",
    clinicianName: "",
    clinicianNpi: "",
  });
  const [service, setService] = useState<PlexusService | null>(null);

  const [vwScreening, setVwScreening] = useState<VitalWaveScreeningData>({});
  const [usScreening, setUsScreening] = useState<UltrasoundScreeningData>({ selection: [], conditions: {}, otherText: {} });
  const [bwScreening, setBwScreening] = useState<BrainWaveScreeningData>({});
  const [pgxScreening, setPgxScreening] = useState<PgxScreeningData>({ matches: [] });

  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);

  function patientIsValid() {
    return patient.patientName.trim() && patient.clinicianName.trim();
  }

  function handleGenerateDocs() {
    if (!service) return;

    const patientDemographics = {
      patientName: patient.patientName,
      dateOfBirth: patient.dateOfBirth || undefined,
      dateOfService: patient.dateOfService || undefined,
      sex: patient.sex || undefined,
      mrn: patient.mrn || undefined,
    };
    const clinicianInfo = patient.clinicianName
      ? { name: patient.clinicianName, npi: patient.clinicianNpi || undefined }
      : undefined;
    const clinic = patient.clinicianName ? resolveClinicForClinician(patient.clinicianName) : undefined;

    const input = { patient: patientDemographics, clinician: clinicianInfo, clinic };

    let docs: GeneratedDocument[] = [];
    if (service === "VitalWave") {
      const result = vitalWaveScreeningToResult({ config: VITALWAVE_CONFIG, screening: vwScreening });
      const generated = generateVitalWaveDocuments({ input, screeningResult: result, vitalWaveConfig: VITALWAVE_CONFIG, vitalWaveScreening: vwScreening });
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "Ultrasound") {
      const result = ultrasoundScreeningToResult({ config: ULTRASOUND_CONFIG, screening: usScreening });
      const generated = generateUltrasoundDocuments({ input, screeningResult: result, screening: usScreening, config: ULTRASOUND_CONFIG });
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "BrainWave") {
      const result = brainWaveScreeningToResult({ mapping: BRAINWAVE_MAPPING, screening: bwScreening });
      const generated = generateBrainWaveDocuments({ input, screeningResult: result });
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    } else if (service === "PGx") {
      const result = pgxScreeningToResult({ screening: pgxScreening });
      const generated = generatePgxDocuments({ input, screeningResult: result });
      docs = [generated.preProcedureOrder, generated.postProcedureNote, generated.billing];
    }

    setDocuments(docs);
    setStep("documents");
  }

  function handleBack() {
    if (step === "documents") setStep("screening");
    else if (step === "screening") setStep("service");
    else if (step === "service") setStep("patient");
    else setLocation("/");
  }

  const STEPS: Step[] = ["patient", "service", "screening", "documents"];
  const stepLabels: Record<Step, string> = {
    patient: "Patient Info",
    service: "Service",
    screening: "Screening",
    documents: "Documents",
  };

  return (
    <div className="flex flex-col h-full relative z-10 bg-slate-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-slate-200 dark:border-border sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-600 dark:text-muted-foreground h-8 px-2"
            onClick={handleBack}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="h-5 w-px bg-slate-200 dark:bg-border" />
          <ClipboardList className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-foreground">
              Plexus Documents
            </h1>
            <p className="text-xs text-slate-500 dark:text-muted-foreground">
              Generate pre-procedure, post-procedure, and billing documents
            </p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    step === s
                      ? "bg-primary text-white"
                      : STEPS.indexOf(step) > i
                      ? "text-primary"
                      : "text-slate-400 dark:text-muted-foreground"
                  }`}
                  data-testid={`step-indicator-${s}`}
                >
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border border-current">
                    {STEPS.indexOf(step) > i ? <Check className="w-2.5 h-2.5" /> : i + 1}
                  </span>
                  {stepLabels[s]}
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

          {step === "patient" && (
            <Card className="p-6" data-testid="step-patient-info">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-5">
                Patient Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <Label htmlFor="patientName" className="text-sm">Patient Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="patientName"
                    value={patient.patientName}
                    onChange={(e) => setPatient((p) => ({ ...p, patientName: e.target.value }))}
                    placeholder="Last, First"
                    data-testid="input-patient-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateOfBirth" className="text-sm">Date of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={patient.dateOfBirth}
                    onChange={(e) => setPatient((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    data-testid="input-date-of-birth"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sex" className="text-sm">Sex</Label>
                  <Input
                    id="sex"
                    value={patient.sex}
                    onChange={(e) => setPatient((p) => ({ ...p, sex: e.target.value }))}
                    placeholder="Male / Female / Other"
                    data-testid="input-sex"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mrn" className="text-sm">MRN</Label>
                  <Input
                    id="mrn"
                    value={patient.mrn}
                    onChange={(e) => setPatient((p) => ({ ...p, mrn: e.target.value }))}
                    placeholder="Medical record number"
                    data-testid="input-mrn"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateOfService" className="text-sm">Date of Service</Label>
                  <Input
                    id="dateOfService"
                    type="date"
                    value={patient.dateOfService}
                    onChange={(e) => setPatient((p) => ({ ...p, dateOfService: e.target.value }))}
                    data-testid="input-date-of-service"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="clinicianName" className="text-sm">Clinician Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="clinicianName"
                    value={patient.clinicianName}
                    onChange={(e) => setPatient((p) => ({ ...p, clinicianName: e.target.value }))}
                    placeholder="Last, First, Credential"
                    data-testid="input-clinician-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="clinicianNpi" className="text-sm">Clinician NPI</Label>
                  <Input
                    id="clinicianNpi"
                    value={patient.clinicianNpi}
                    onChange={(e) => setPatient((p) => ({ ...p, clinicianNpi: e.target.value }))}
                    placeholder="10-digit NPI"
                    data-testid="input-clinician-npi"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button
                  onClick={() => setStep("service")}
                  disabled={!patientIsValid()}
                  data-testid="button-next-service"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </Card>
          )}

          {step === "service" && (
            <div data-testid="step-service-selection">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-4">
                Select Service
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SERVICE_OPTIONS.map(({ value, label, desc, icon: Icon }) => (
                  <Card
                    key={value}
                    className={`cursor-pointer p-5 flex items-start gap-4 border-2 transition-all ${
                      service === value
                        ? "border-primary bg-primary/5"
                        : "border-slate-200 dark:border-border hover:border-primary/50"
                    }`}
                    onClick={() => setService(value)}
                    data-testid={`service-card-${value.toLowerCase()}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      service === value ? "bg-primary text-white" : "bg-slate-100 dark:bg-muted text-slate-600 dark:text-muted-foreground"
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-foreground">{label}</p>
                      <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                    {service === value && (
                      <div className="ml-auto shrink-0">
                        <Check className="w-4 h-4 text-primary" />
                      </div>
                    )}
                  </Card>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <Button
                  onClick={() => setStep("screening")}
                  disabled={!service}
                  data-testid="button-next-screening"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "screening" && service === "VitalWave" && (
            <div data-testid="step-screening-vitalwave">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-4">
                VitalWave Screening
              </h2>
              <div className="space-y-4">
                {Object.entries(VITALWAVE_CONFIG).map(([groupKey, group]) => (
                  <Card key={groupKey} className="p-5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-foreground mb-1">
                      {group.title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-muted-foreground mb-3">CPT: {group.cpt}</p>
                    <div className="space-y-2">
                      {group.conditions.map((cond) => {
                        const checked = !!(vwScreening[groupKey]?.[cond.name]);
                        return (
                          <div key={cond.name} className="flex items-start gap-2.5">
                            <Checkbox
                              id={`vw-${groupKey}-${cond.name}`}
                              checked={checked}
                              onCheckedChange={(v) =>
                                setVwScreening((prev) => ({
                                  ...prev,
                                  [groupKey]: { ...(prev[groupKey] || {}), [cond.name]: !!v },
                                }))
                              }
                              data-testid={`checkbox-vw-${groupKey}-${cond.name.replace(/\s+/g, "-").toLowerCase()}`}
                            />
                            <label
                              htmlFor={`vw-${groupKey}-${cond.name}`}
                              className="text-sm text-slate-700 dark:text-foreground leading-snug cursor-pointer select-none"
                            >
                              {cond.name}
                              {cond.icd && (
                                <span className="ml-1 text-xs text-slate-400 dark:text-muted-foreground">({cond.icd})</span>
                              )}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleGenerateDocs} data-testid="button-generate-documents">
                  Generate Documents
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "screening" && service === "Ultrasound" && (
            <div data-testid="step-screening-ultrasound">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-4">
                Ultrasound Screening
              </h2>
              <div className="space-y-4">
                {Object.entries(ULTRASOUND_CONFIG).map(([type, cfg]) => {
                  const isSelected = usScreening.selection.includes(type);
                  return (
                    <Card key={type} className={`overflow-hidden border-2 transition-all ${isSelected ? "border-primary" : "border-slate-200 dark:border-border"}`}>
                      <div
                        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-muted/20"
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
                          data-testid={`checkbox-us-type-${type.replace(/\s+/g, "-").toLowerCase()}`}
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-slate-800 dark:text-foreground">{type}</p>
                          <p className="text-xs text-slate-500 dark:text-muted-foreground">CPT: {cfg.cpt || "N/A"}</p>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="border-t border-slate-100 dark:border-border p-4 pt-3 space-y-2 bg-slate-50/50 dark:bg-muted/10">
                          <p className="text-xs font-semibold text-slate-500 dark:text-muted-foreground uppercase tracking-wide mb-2">Select indications:</p>
                          {cfg.conditions.map((cond) => {
                            const key = cond.name === "Other" ? `${type}-Other` : cond.name;
                            const checked = !!(usScreening.conditions[key]);
                            return (
                              <div key={cond.name}>
                                <div className="flex items-start gap-2.5">
                                  <Checkbox
                                    id={`us-${type}-${cond.name}`}
                                    checked={checked}
                                    onCheckedChange={(v) =>
                                      setUsScreening((prev) => ({
                                        ...prev,
                                        conditions: { ...prev.conditions, [key]: !!v },
                                      }))
                                    }
                                    data-testid={`checkbox-us-cond-${type.replace(/\s+/g, "-").toLowerCase()}-${cond.name.replace(/\s+/g, "-").toLowerCase()}`}
                                  />
                                  <label
                                    htmlFor={`us-${type}-${cond.name}`}
                                    className="text-sm text-slate-700 dark:text-foreground cursor-pointer select-none"
                                  >
                                    {cond.name}
                                    {cond.icd && cond.name !== "Other" && (
                                      <span className="ml-1 text-xs text-slate-400 dark:text-muted-foreground">({cond.icd})</span>
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
                                    data-testid={`input-us-other-${type.replace(/\s+/g, "-").toLowerCase()}`}
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
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleGenerateDocs} data-testid="button-generate-documents">
                  Generate Documents
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "screening" && service === "BrainWave" && (
            <div data-testid="step-screening-brainwave">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-4">
                BrainWave Screening
              </h2>
              <div className="space-y-4">
                {Object.entries(BRAINWAVE_GROUPS).map(([groupKey, group]) => (
                  <Card key={groupKey} className="p-5">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-foreground mb-3">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {group.conditions.map((condName) => {
                        const checked = !!(bwScreening[groupKey]?.[condName]);
                        return (
                          <div key={condName} className="flex items-start gap-2.5">
                            <Checkbox
                              id={`bw-${groupKey}-${condName}`}
                              checked={checked}
                              onCheckedChange={(v) =>
                                setBwScreening((prev) => ({
                                  ...prev,
                                  [groupKey]: { ...(prev[groupKey] || {}), [condName]: !!v },
                                }))
                              }
                              data-testid={`checkbox-bw-${groupKey}-${condName.replace(/\s+/g, "-").replace(/[,/]/g, "").toLowerCase()}`}
                            />
                            <label
                              htmlFor={`bw-${groupKey}-${condName}`}
                              className="text-sm text-slate-700 dark:text-foreground leading-snug cursor-pointer select-none"
                            >
                              {condName}
                              {BRAINWAVE_MAPPING[condName]?.icdCodes?.length && (
                                <span className="ml-1 text-xs text-slate-400 dark:text-muted-foreground">
                                  ({BRAINWAVE_MAPPING[condName].icdCodes.join(", ")})
                                </span>
                              )}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleGenerateDocs} data-testid="button-generate-documents">
                  Generate Documents
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "screening" && service === "PGx" && (
            <div data-testid="step-screening-pgx">
              <h2 className="text-base font-semibold text-slate-900 dark:text-foreground mb-4">
                PGx Screening — Select Trigger Medications
              </h2>
              <Card className="p-5">
                <p className="text-sm text-slate-600 dark:text-muted-foreground mb-4">
                  Check all medications the patient is currently taking or has taken that may interact with genetic variants.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {PGX_TRIGGER_MEDICATIONS.map((med) => {
                    const isChecked = !!(pgxScreening.matches?.some((m) => m.trigger === med));
                    return (
                      <div key={med} className="flex items-start gap-2.5">
                        <Checkbox
                          id={`pgx-${med}`}
                          checked={isChecked}
                          onCheckedChange={(v) =>
                            setPgxScreening((prev) => ({
                              matches: v
                                ? [...(prev.matches || []), { trigger: med }]
                                : (prev.matches || []).filter((m) => m.trigger !== med),
                            }))
                          }
                          data-testid={`checkbox-pgx-${med.replace(/[\s()]/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}`}
                        />
                        <label
                          htmlFor={`pgx-${med}`}
                          className="text-sm text-slate-700 dark:text-foreground leading-snug cursor-pointer select-none"
                        >
                          {med}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleGenerateDocs} data-testid="button-generate-documents">
                  Generate Documents
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "documents" && (
            <div data-testid="step-documents">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-slate-900 dark:text-foreground">
                  Generated Documents — {service}
                </h2>
                <Badge variant="outline" className="text-xs">
                  {patient.patientName}
                </Badge>
              </div>
              <div className="space-y-4">
                {documents.map((doc, i) => (
                  <DocumentSection key={i} doc={doc} index={i} />
                ))}
              </div>
              <div className="mt-6 flex justify-start">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("patient");
                    setPatient({ patientName: "", dateOfBirth: "", sex: "", mrn: "", dateOfService: "", clinicianName: "", clinicianNpi: "" });
                    setService(null);
                    setVwScreening({});
                    setUsScreening({ selection: [], conditions: {}, otherText: {} });
                    setBwScreening({});
                    setPgxScreening({ matches: [] });
                    setDocuments([]);
                  }}
                  data-testid="button-start-new"
                >
                  Start New
                </Button>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

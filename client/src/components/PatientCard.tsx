import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Loader2, Sparkles, Calendar, Trash2, Plus, X } from "lucide-react";
import type { AncillaryAppointment, PatientScreening, ScreeningBatch } from "@shared/schema";
import { getAncillaryCategory, getBadgeColor } from "@/features/schedule/ancillaryMeta";
import { SchedulerIcon } from "@/components/plexus/SchedulerIcon";

import { ANCILLARY_TESTS } from "@shared/plexus";
import { ClinicalDataEditor } from "@/components/ClinicalDataEditor";
import { derivePatientType } from "@shared/patientType";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

const ALL_AVAILABLE_TESTS: string[] = [...ANCILLARY_TESTS];

function extractMostRecentDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const monthMap: Record<string, number> = {
    january:0,february:1,march:2,april:3,may:4,june:5,
    july:6,august:7,september:8,october:9,november:10,december:11
  };
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  const p0 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = p0.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p1 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
  while ((m = p1.exec(text)) !== null) {
    const yr = parseInt(m[3]);
    const fullYr = yr >= 0 && yr <= 30 ? 2000 + yr : 1900 + yr;
    const d = new Date(fullYr, parseInt(m[1])-1, parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = p2.exec(text)) !== null) {
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p3 = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = p3.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), monthMap[m[1].toLowerCase()], parseInt(m[2]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p4 = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
  while ((m = p4.exec(text)) !== null) {
    const d = new Date(parseInt(m[3]), monthMap[m[2].toLowerCase()], parseInt(m[1]));
    if (!isNaN(d.getTime())) dates.push(d);
  }
  const p5 = /(?<!\/)\b(\d{1,2})\/(\d{4})\b/g;
  while ((m = p5.exec(text)) !== null) {
    const mo = parseInt(m[1]);
    const yr = parseInt(m[2]);
    if (mo >= 1 && mo <= 12) {
      const d = new Date(yr, mo-1, 1);
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  const latest = dates.reduce((a, b) => b > a ? b : a);
  const yr = latest.getFullYear();
  const mo = String(latest.getMonth() + 1).padStart(2, "0");
  const dy = String(latest.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

interface PatientCardProps {
  patient: PatientScreening;
  isAnalyzing: boolean;
  onUpdate: (field: string, value: string | string[] | boolean) => void;
  onDelete: () => void;
  onAnalyze: () => void;
  onOpenScheduleModal?: (patient: PatientScreening) => void;
  schedulerName?: string | null;
  batchScheduleDate?: string | null;
  asOfDate?: string | null;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
}

function commitStatusStyle(status: string): string {
  switch (status) {
    case "Ready": return "bg-blue-100 text-blue-800 border border-blue-200";
    case "WithScheduler": return "bg-amber-100 text-amber-800 border border-amber-200";
    case "Scheduled": return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    default: return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

function commitStatusLabel(status: string): string {
  if (status === "WithScheduler") return "With Scheduler";
  return status || "Draft";
}

export function PatientCard({
  patient,
  isAnalyzing,
  onUpdate,
  onDelete,
  onAnalyze,
  schedulerName,
  batchScheduleDate,
  asOfDate,
}: PatientCardProps) {
  const isCompleted = patient.status === "completed";
  const commitStatus = patient.commitStatus || "Draft";

  const serverTests = patient.qualifyingTests || [];
  const [localTests, setLocalTests] = useState<string[]>(serverTests);
  const [generatingTests, setGeneratingTests] = useState<Set<string>>(new Set());
  const cardQueryClient = useQueryClient();
  const { toast: cardToast } = useToast();

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    enabled: !!patient.id,
  });
  const scheduledAppt = patientAppts.find((a: AncillaryAppointment) => a.status === "scheduled");

  // Derived patient type — visit if any scheduled appointment (or batch
  // visit date) sits within the next 90 days; otherwise falls back to the
  // stored manual override. Recomputes whenever appointments refetch.
  const todayIso = (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate))
    ? asOfDate
    : new Date().toISOString().slice(0, 10);
  const derivedType = derivePatientType({
    appointments: patientAppts,
    batchScheduleDate: batchScheduleDate ?? null,
    storedPatientType: patient.patientType,
    asOfDate: todayIso,
  });

  useEffect(() => { setLocalTests(patient.qualifyingTests || []); }, [patient.qualifyingTests]);

  const handleAddTest = useCallback((test: string) => {
    if (localTests.includes(test)) return;
    const updated = [...localTests, test];
    setLocalTests(updated);
    onUpdate("qualifyingTests", updated);
    setGeneratingTests(prev => new Set([...Array.from(prev), test]));
    apiRequest("POST", `/api/patients/${patient.id}/analyze-test`, { testName: test })
      .then(r => r.json())
      .then((data: PatientScreening) => {
        if (data) {
          cardQueryClient.setQueryData<ScreeningBatchWithPatients>(
            ["/api/screening-batches", patient.batchId],
            (old) => {
              if (!old) return old;
              return {
                ...old,
                patients: (old.patients || []).map((p) =>
                  p.id === patient.id ? { ...p, ...data } : p
                ),
              };
            }
          );
        }
      })
      .catch(() => {
        cardToast({ title: "Could not generate reasoning", description: `Qualification notes for ${test} were not generated. You can still proceed.`, variant: "destructive" });
      })
      .finally(() => {
        setGeneratingTests(prev => {
          const next = new Set(prev);
          next.delete(test);
          return next;
        });
      });
  }, [localTests, onUpdate, patient.id, patient.batchId, cardQueryClient, cardToast]);

  const handleRemoveTest = useCallback((test: string) => {
    const updated = localTests.filter((t) => t !== test);
    setLocalTests(updated);
    onUpdate("qualifyingTests", updated);
  }, [localTests, onUpdate]);

  const tests = localTests;

  const [localName, setLocalName] = useState(patient.name || "");
  const [localTime, setLocalTime] = useState(patient.time || "");
  const [localDob, setLocalDob] = useState(patient.dob || "");
  const [localPhone, setLocalPhone] = useState(patient.phoneNumber || "");
  const [localInsurance, setLocalInsurance] = useState(patient.insurance || "");
  const [localDx, setLocalDx] = useState(patient.diagnoses || "");
  const [localHx, setLocalHx] = useState(patient.history || "");
  const [localRx, setLocalRx] = useState(patient.medications || "");
  const [localPrevTests, setLocalPrevTests] = useState(patient.previousTests || "");
  const [localPrevTestsDate, setLocalPrevTestsDate] = useState(patient.previousTestsDate || "");
  const [localNoPrevTests, setLocalNoPrevTests] = useState(patient.noPreviousTests || false);

  // Display-only age. Prefer the persisted `patient.age` (set by AI analyze
  // or backend imports) and fall back to a DOB-derived value when the DOB
  // string is parseable. Not stored separately — display only.
  const displayAge = ((): string => {
    if (patient.age != null) return String(patient.age);
    if (!localDob) return "";
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDob);
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(localDob);
    let y: number | null = null;
    let m: number | null = null;
    let d: number | null = null;
    if (ymd) {
      y = parseInt(ymd[1]);
      m = parseInt(ymd[2]);
      d = parseInt(ymd[3]);
    } else if (mdy) {
      y = parseInt(mdy[3]);
      m = parseInt(mdy[1]);
      d = parseInt(mdy[2]);
    }
    if (y === null || m === null || d === null) return "";
    const dob = new Date(y, m - 1, d);
    if (Number.isNaN(dob.getTime())) return "";
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
    if (age < 0 || age > 130) return "";
    return String(age);
  })();

  useEffect(() => { setLocalName(patient.name || ""); }, [patient.name]);
  useEffect(() => { setLocalTime(patient.time || ""); }, [patient.time]);
  useEffect(() => { setLocalDob(patient.dob || ""); }, [patient.dob]);
  useEffect(() => { setLocalPhone(patient.phoneNumber || ""); }, [patient.phoneNumber]);
  useEffect(() => { setLocalInsurance(patient.insurance || ""); }, [patient.insurance]);
  useEffect(() => { setLocalDx(patient.diagnoses || ""); }, [patient.diagnoses]);
  useEffect(() => { setLocalHx(patient.history || ""); }, [patient.history]);
  useEffect(() => { setLocalRx(patient.medications || ""); }, [patient.medications]);
  useEffect(() => { setLocalPrevTests(patient.previousTests || ""); }, [patient.previousTests]);
  useEffect(() => { setLocalPrevTestsDate(patient.previousTestsDate || ""); }, [patient.previousTestsDate]);
  useEffect(() => { setLocalNoPrevTests(patient.noPreviousTests || false); }, [patient.noPreviousTests]);

  return (
    <Card
      className={`glass-tile glass-tile-interactive ${isCompleted ? "ring-1 ring-emerald-200 dark:ring-emerald-800" : ""}`}
      data-testid={`card-patient-${patient.id}`}
    >
      <div className="px-4 py-3 border-b">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <SchedulerIcon patientScreeningId={patient.id} patientName={patient.name} size="xs" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                  Patient Name
                </label>
                <Input
                  placeholder="Patient name"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={() => {
                    if (localName !== (patient.name || "")) onUpdate("name", localName);
                  }}
                  className="h-9 text-base font-semibold"
                  data-testid={`input-patient-name-${patient.id}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    DOB
                  </label>
                  <Input
                    placeholder="YYYY-MM-DD"
                    value={localDob}
                    onChange={(e) => setLocalDob(e.target.value)}
                    onBlur={() => {
                      if (localDob !== (patient.dob || "")) onUpdate("dob", localDob);
                    }}
                    className="h-8 text-xs"
                    data-testid={`input-patient-dob-${patient.id}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    Age
                  </label>
                  <Input
                    placeholder="—"
                    value={displayAge}
                    readOnly
                    tabIndex={-1}
                    className="h-8 text-xs bg-finance-bg-soft"
                    data-testid={`input-patient-age-${patient.id}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    Insurance
                  </label>
                  <Input
                    placeholder="Insurance"
                    value={localInsurance}
                    onChange={(e) => setLocalInsurance(e.target.value)}
                    onBlur={() => {
                      if (localInsurance !== (patient.insurance || ""))
                        onUpdate("insurance", localInsurance);
                    }}
                    className="h-8 text-xs"
                    data-testid={`input-patient-insurance-${patient.id}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    Phone
                  </label>
                  <Input
                    placeholder="Phone"
                    value={localPhone}
                    onChange={(e) => setLocalPhone(e.target.value)}
                    onBlur={() => {
                      if (localPhone !== (patient.phoneNumber || ""))
                        onUpdate("phoneNumber", localPhone);
                    }}
                    className="h-8 text-xs"
                    data-testid={`input-patient-phone-${patient.id}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-finance-text-muted">
                    Time
                  </label>
                  <Input
                    placeholder="Time"
                    value={localTime}
                    onChange={(e) => setLocalTime(e.target.value)}
                    onBlur={() => {
                      if (localTime !== (patient.time || "")) onUpdate("time", localTime);
                    }}
                    className="h-8 text-xs"
                    data-testid={`input-patient-time-${patient.id}`}
                  />
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-1.5">
                {isCompleted && (
                  <Badge
                    variant="outline"
                    className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate"
                  >
                    <Check className="w-3 h-3 text-emerald-500" /> Analyzed
                  </Badge>
                )}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${commitStatusStyle(commitStatus)}`}
                  title={`Commit status: ${commitStatusLabel(commitStatus)}`}
                  data-testid={`pill-commit-status-${patient.id}`}
                >
                  {commitStatusLabel(commitStatus)}
                </span>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                    derivedType === "visit"
                      ? "bg-sky-100 text-sky-800 border-sky-200"
                      : "bg-white text-slate-800 border-slate-200"
                  }`}
                  title={
                    derivedType === "visit"
                      ? "Visit patient — has an appointment within the next 90 days"
                      : "Outreach patient — no appointment within the next 90 days"
                  }
                  data-testid={`pill-patient-type-${patient.id}`}
                >
                  {derivedType}
                </span>
                {scheduledAppt && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5"
                    data-testid={`badge-scheduled-${patient.id}`}
                  >
                    <Calendar className="w-2.5 h-2.5" />
                    Scheduled {scheduledAppt.scheduledDate}
                  </span>
                )}
                {schedulerName && (
                  <span
                    title={`Scheduler: ${schedulerName}`}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0"
                    data-testid={`badge-scheduler-initials-${patient.id}`}
                  >
                    {getInitials(schedulerName)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="gap-1.5"
              data-testid={`button-generate-${patient.id}`}
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {isCompleted ? "Re-Generate" : "Generate"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("Remove this patient?")) onDelete();
              }}
              title="Remove patient"
              className="text-muted-foreground hover:text-destructive"
              data-testid={`button-delete-patient-${patient.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <ClinicalDataEditor
        patient={patient}
        localDx={localDx}
        setLocalDx={setLocalDx}
        localHx={localHx}
        setLocalHx={setLocalHx}
        localRx={localRx}
        setLocalRx={setLocalRx}
        localPrevTests={localPrevTests}
        setLocalPrevTests={setLocalPrevTests}
        localPrevTestsDate={localPrevTestsDate}
        setLocalPrevTestsDate={setLocalPrevTestsDate}
        localNoPrevTests={localNoPrevTests}
        setLocalNoPrevTests={setLocalNoPrevTests}
        onUpdate={onUpdate}
        onExtractDate={extractMostRecentDate}
      />

      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tests.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground mr-1">Qualifying:</span>
              {tests.map((test) => {
                const cat = getAncillaryCategory(test);
                const isGenerating = generatingTests.has(test);
                return (
                  <span key={test} className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] font-medium ${getBadgeColor(cat)}`}>
                    {isGenerating && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                    {test}
                    <button
                      className="rounded transition-colors p-0.5 -mr-0.5 shrink-0"
                      title={`Remove ${test}`}
                      onClick={() => handleRemoveTest(test)}
                      data-testid={`button-remove-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                data-testid={`button-add-test-${patient.id}`}
              >
                <Plus className="w-3 h-3" />
                Add Test
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start" data-testid={`popover-test-picker-${patient.id}`}>
              <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Select tests to add</p>
              <div className="space-y-1">
                {ALL_AVAILABLE_TESTS.map((test) => {
                  const isSelected = tests.includes(test);
                  const cat = getAncillaryCategory(test);
                  return (
                    <button
                      key={test}
                      disabled={isSelected}
                      onClick={() => handleAddTest(test)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                        isSelected
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-accent cursor-pointer"
                      }`}
                      data-testid={`option-test-${patient.id}-${test.replace(/\s+/g, "-")}`}
                    >
                      <span className={`w-3.5 h-3.5 flex items-center justify-center shrink-0 rounded border ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                      <span className={`flex-1 ${isSelected ? "line-through" : ""}`}>{test}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-medium ${getBadgeColor(cat)}`}>
                        {cat === "brainwave" ? "BW" : cat === "vitalwave" ? "VW" : "US"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </Card>
  );
}

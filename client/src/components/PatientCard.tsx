import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Trash2, Pencil } from "lucide-react";
import type { AncillaryAppointment, PatientScreening, ScreeningBatch } from "@shared/schema";
import {
  categoryIcons,
  categoryLabels,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import { QualificationReasoningDialog } from "@/features/schedule/QualificationReasoningDialog";
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { PatientEditDialog } from "@/components/PatientEditDialog";
import { derivePatientType } from "@shared/patientType";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

const ANCILLARY_CIRCLE_STYLES: Record<AncillaryCategory, string> = {
  brainwave: "bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100",
  vitalwave: "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100",
  ultrasound: "bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100",
  other: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
};

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
  sourceMode?: "visit" | "outreach";
}

export function PatientCard({
  patient,
  isAnalyzing,
  onUpdate,
  onDelete,
  onAnalyze,
  batchScheduleDate,
  asOfDate,
  sourceMode,
}: PatientCardProps) {
  const isCompleted = patient.status === "completed";
  const statusLabel = isCompleted ? "Final" : "Pending";
  const statusStyle = isCompleted
    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
    : "bg-slate-50 text-slate-600 border border-slate-200";

  const serverTests = patient.qualifyingTests || [];
  const [localTests, setLocalTests] = useState<string[]>(serverTests);
  const [generatingTests, setGeneratingTests] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [selectedTestDetail, setSelectedTestDetail] = useState<{
    patientId: number;
    category: string;
    tests: string[];
    reasoning: Record<string, ReasoningValue>;
  } | null>(null);
  const cardQueryClient = useQueryClient();
  const { toast: cardToast } = useToast();

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    enabled: !!patient.id,
  });

  const todayIso = (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate))
    ? asOfDate
    : new Date().toISOString().slice(0, 10);
  const derivedType = derivePatientType({
    appointments: patientAppts,
    batchScheduleDate: batchScheduleDate ?? null,
    storedPatientType: patient.patientType,
    asOfDate: todayIso,
  });
  // Build screen context wins over derivation: an outreach build screen always
  // labels its cards "Outreach" so the workflow context stays explicit even if
  // a stale appointment record otherwise classifies the patient as visit.
  const typeLabel: "Visit" | "Outreach" =
    sourceMode === "outreach" ? "Outreach" :
    sourceMode === "visit" ? "Visit" :
    derivedType === "visit" ? "Visit" : "Outreach";

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
  const reasoning = (patient.reasoning || {}) as Record<string, ReasoningValue>;

  // Group qualifying tests by ancillary category — used to render the small
  // circular icons on the card. Only categories with tests render.
  const testsByCategory = ANCILLARY_ORDER.reduce<Record<AncillaryCategory, string[]>>((acc, cat) => {
    acc[cat] = tests.filter((t) => getAncillaryCategory(t) === cat);
    return acc;
  }, { brainwave: [], vitalwave: [], ultrasound: [], other: [] });

  const ageDisplay = ((): string => {
    if (patient.age != null) return String(patient.age);
    if (!patient.dob) return "";
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(patient.dob);
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(patient.dob);
    let y: number | null = null, m: number | null = null, d: number | null = null;
    if (ymd) { y = parseInt(ymd[1]); m = parseInt(ymd[2]); d = parseInt(ymd[3]); }
    else if (mdy) { y = parseInt(mdy[3]); m = parseInt(mdy[1]); d = parseInt(mdy[2]); }
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

  const metaParts: string[] = [];
  if (patient.dob) metaParts.push(`DOB ${patient.dob}`);
  if (ageDisplay) metaParts.push(`${ageDisplay} yo`);
  if (patient.insurance) metaParts.push(patient.insurance);
  if (patient.phoneNumber) metaParts.push(patient.phoneNumber);
  const displayName = (patient.name || "").trim() || "Unnamed patient";

  return (
    <Card
      className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow"
      data-testid={`card-patient-${patient.id}`}
    >
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3
                className="text-base font-semibold text-slate-900 truncate"
                data-testid={`text-patient-name-${patient.id}`}
              >
                {displayName}
              </h3>
            </div>
            <div
              className="mt-0.5 text-xs text-slate-500 truncate"
              data-testid={`text-patient-meta-${patient.id}`}
            >
              {metaParts.length > 0 ? metaParts.join(" · ") : <span className="italic text-slate-400">No basics yet</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600">
              <span data-testid={`text-patient-type-${patient.id}`} className="font-medium">
                {typeLabel}
              </span>
              {typeLabel === "Visit" && patient.time && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="tabular-nums" data-testid={`text-patient-time-${patient.id}`}>
                    {patient.time}
                  </span>
                </>
              )}
            </div>
          </div>

          <span
            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-0.5 ${statusStyle}`}
            data-testid={`pill-patient-status-${patient.id}`}
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {ANCILLARY_ORDER.map((cat) => {
              const catTests = testsByCategory[cat];
              if (catTests.length === 0) return null;
              const Icon = categoryIcons[cat];
              const label = categoryLabels[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    setSelectedTestDetail({
                      patientId: patient.id,
                      category: cat,
                      tests: catTests,
                      reasoning,
                    })
                  }
                  title={`${label}${catTests.length > 1 ? ` (${catTests.length})` : ""}`}
                  className={`relative inline-flex items-center justify-center h-8 w-8 rounded-full border transition-colors ${ANCILLARY_CIRCLE_STYLES[cat]}`}
                  data-testid={`button-ancillary-${cat}-${patient.id}`}
                >
                  <Icon className="w-4 h-4" />
                  {catTests.length > 1 && (
                    <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-slate-900 text-white text-[9px] font-semibold">
                      {catTests.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditOpen(true)}
              className="h-8 px-2.5 text-xs gap-1.5 text-slate-600 hover:text-slate-900"
              data-testid={`button-edit-patient-${patient.id}`}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="h-8 px-2.5 text-xs gap-1.5"
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
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              data-testid={`button-delete-patient-${patient.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <PatientEditDialog
        patient={patient}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdate={onUpdate}
        showTime={sourceMode !== "outreach"}
        qualifyingTests={tests}
        generatingTests={generatingTests}
        onAddTest={handleAddTest}
        onRemoveTest={handleRemoveTest}
      />

      <QualificationReasoningDialog
        selectedTestDetail={selectedTestDetail}
        setSelectedTestDetail={setSelectedTestDetail}
      />
    </Card>
  );
}

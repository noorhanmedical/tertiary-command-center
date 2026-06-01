import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Sparkles,
  Trash2,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { PatientSilhouette } from "@/components/PatientSilhouette";
import type { AncillaryAppointment, PatientScreening, ScreeningBatch } from "@shared/schema";
import {
  categoryIcons,
  categoryLabels,
  categoryStyles,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import { PatientEditDialog } from "@/components/PatientEditDialog";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import { EngagementAssignmentBadge } from "@/components/qualification/EngagementAssignmentBadge";
import { QualificationReasoningDialog } from "@/features/schedule/QualificationReasoningDialog";
import type { ReasoningValue } from "@/lib/pdfGeneration";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";
import { derivePatientType } from "@shared/patientType";
import { getPatientCompleteness } from "@/lib/patientCompleteness";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

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
  const typeLabel: "Visit" | "Outreach" =
    sourceMode === "outreach" ? "Outreach" :
    sourceMode === "visit" ? "Visit" :
    derivedType === "visit" ? "Visit" : "Outreach";
  const isVisit = typeLabel === "Visit";

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

  const showTimeInBanner = isVisit && !!patient.time;

  const { isComplete: infoComplete, missing } = getPatientCompleteness(patient, { isVisit });
  const generatedFinal = patient.status === "completed";
  const showAsFinal = infoComplete && generatedFinal;
  const statusLabel = !infoComplete ? "Pending" : generatedFinal ? "Final" : "Ready";

  const banner = infoComplete
    ? {
        bar: "bg-plexus-navy-800 text-white",
        avatarRing: "bg-white/10 ring-1 ring-white/20 text-white",
        title: "text-white",
        subLabel: "text-white/60",
        time: "text-white",
        statusPill: showAsFinal
          ? "bg-emerald-400/15 text-emerald-200 border border-emerald-300/30"
          : "bg-white/15 text-white border border-white/25",
      }
    : {
        bar: "bg-sky-100 text-slate-900",
        avatarRing: "bg-white ring-1 ring-sky-200 text-plexus-navy-800",
        title: "text-slate-900",
        subLabel: "text-slate-500",
        time: "text-slate-900",
        statusPill: "bg-white text-sky-800 border border-sky-200",
      };

  const generateLabel = generatedFinal ? "Re-generate" : "Generate";
  const generateDisabled = isAnalyzing || !infoComplete;
  const generateTitle = !infoComplete
    ? `Complete required info before generating · Missing: ${missing.join(", ")}`
    : generateLabel;

  const openEdit = () => setEditOpen(true);

  return (
    <>
    <Card
      role="button"
      tabIndex={0}
      onClick={openEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openEdit();
        }
      }}
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition-shadow cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      data-testid={`card-patient-${patient.id}`}
    >
      <div
        className={`relative px-5 py-5 ${banner.bar}`}
        data-testid={`banner-patient-${patient.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-stretch gap-3 min-w-0 flex-1">
            <div
              aria-hidden="true"
              className={`shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-full ${banner.avatarRing}`}
            >
              <PatientSilhouette gender={patient.gender} className="w-6 h-6" />
            </div>

            <div className="min-w-0 flex-1 flex flex-col justify-center leading-tight">
              <h3
                className={`min-w-0 text-lg font-light tracking-tight ${banner.title} break-words`}
                title={displayName}
                data-testid={`text-patient-name-${patient.id}`}
              >
                {displayName}
              </h3>
              <div
                className={`mt-0.5 flex items-center gap-x-2 text-[10px] uppercase tracking-[0.14em] font-medium ${banner.subLabel}`}
              >
                <span>{isVisit ? "Visit Appointment" : "Outreach"}</span>
                {isVisit && showTimeInBanner && (
                  <>
                    <span aria-hidden className="opacity-60">·</span>
                    <span
                      className={`tabular-nums ${banner.time}`}
                      data-testid={`text-patient-time-${patient.id}`}
                    >
                      {patient.time}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-0.5 ${banner.statusPill}`}
            title={!infoComplete ? `Missing: ${missing.join(", ")}` : statusLabel}
            data-testid={`pill-patient-status-${patient.id}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-5 pt-4 pb-4 space-y-3">
        <div
          className="text-xs text-slate-700 truncate"
          data-testid={`text-patient-meta-${patient.id}`}
        >
          {metaParts.length > 0 ? (
            metaParts.join(" · ")
          ) : (
            <span className="italic text-slate-400">No basics yet</span>
          )}
        </div>
        <span
          data-testid={`text-patient-type-${patient.id}`}
          className="sr-only"
        >
          {typeLabel}
        </span>

        {ANCILLARY_ORDER.some((cat) => testsByCategory[cat].length > 0) && (
          <div
            className="flex items-center justify-center gap-6 py-1"
            data-testid={`qualification-icons-${patient.id}`}
          >
            {ANCILLARY_ORDER.map((cat) => {
              const catTests = testsByCategory[cat];
              if (catTests.length === 0) return null;
              const Icon = categoryIcons[cat];
              const label = categoryLabels[cat];
              const count = catTests.length;
              const style = categoryStyles[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTestDetail({
                      patientId: patient.id,
                      category: cat,
                      tests: catTests,
                      reasoning,
                    });
                  }}
                  aria-label={`${label}${count > 1 ? ` (${count})` : ""}`}
                  title={`${label}${count > 1 ? ` (${count})` : ""}`}
                  className="relative inline-flex items-center justify-center bg-transparent border-0 p-0 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-full"
                  data-testid={`button-ancillary-${cat}-${patient.id}`}
                >
                  <Icon
                    className={`h-7 w-7 ${style.icon}`}
                    strokeWidth={2}
                    fill="none"
                  />
                  {count > 1 && (
                    <span
                      className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-slate-900 text-white text-[9px] font-semibold leading-none shadow-sm"
                      aria-hidden
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {(
          !infoComplete ||
          (patient.commitStatus ?? "Draft") !== "Draft"
        ) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {!infoComplete && (
              <div
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-[10px] font-medium"
                data-testid={`text-patient-missing-${patient.id}`}
              >
                <span className="uppercase tracking-wider text-[9px] opacity-70">Missing</span>
                <span>{missing.join(" · ")}</span>
              </div>
            )}
            <EngagementAssignmentBadge
              patientId={patient.id}
              commitStatus={patient.commitStatus}
              compact
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <div className="inline-flex items-center gap-1">
            {isPatientPdfEligible(patient) && (
              <PatientPdfActions
                patient={patient}
                facility={patient.facility ?? null}
                scheduleDate={batchScheduleDate ?? null}
                iconOnly
              />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Remove this patient?")) onDelete();
              }}
              aria-label="Remove patient"
              title="Remove patient"
              className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors"
              data-testid={`button-delete-patient-${patient.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="More patient actions"
                  title="More"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                  data-testid={`button-patient-more-${patient.id}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditOpen(true);
                  }}
                  data-testid={`menu-edit-patient-${patient.id}`}
                >
                  <Pencil className="w-3.5 h-3.5 mr-2" />
                  Edit patient
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={generateDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!infoComplete) return;
                    onAnalyze();
                  }}
                  data-testid={`menu-generate-${patient.id}`}
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 mr-2" />
                  )}
                  {generateLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="inline-flex items-center gap-1.5">
            {tests.length === 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!infoComplete) return;
                  onAnalyze();
                }}
                disabled={generateDisabled}
                aria-label={generateTitle}
                title={generateTitle}
                className={`inline-flex items-center justify-center h-8 w-8 rounded-full shadow-sm transition-colors ${
                  infoComplete
                    ? "bg-slate-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
                data-testid={`button-generate-${patient.id}`}
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>

    <PatientEditDialog
      patient={patient}
      open={editOpen}
      onClose={() => setEditOpen(false)}
      onUpdate={onUpdate}
      showTime={isVisit}
      isVisit={isVisit}
      qualifyingTests={tests}
      generatingTests={generatingTests}
      onAddTest={handleAddTest}
      onRemoveTest={handleRemoveTest}
      onAnalyze={onAnalyze}
      isAnalyzing={isAnalyzing}
      isCompleted={generatedFinal}
    />

    <QualificationReasoningDialog
      selectedTestDetail={selectedTestDetail}
      setSelectedTestDetail={setSelectedTestDetail}
    />
    </>
  );
}

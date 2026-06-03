import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Sparkles,
  MoreHorizontal,
  Trash2,
  ShieldCheck,
  Pencil,
} from "lucide-react";
import type { PatientScreening, ScreeningBatch } from "@shared/schema";
import {
  categoryIcons,
  categoryStyles,
  getAncillaryCategory,
  type AncillaryCategory,
} from "@/features/schedule/ancillaryMeta";
import { PatientEditDialog } from "@/components/PatientEditDialog";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import { AdminReviewDialog } from "@/components/qualification/AdminReviewDialog";
import { getPatientCompleteness } from "@/lib/patientCompleteness";
import { isPatientPdfEligible } from "@/lib/pdfPacketGrouping";

type ScreeningBatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

const ANCILLARY_ORDER: AncillaryCategory[] = ["brainwave", "vitalwave", "ultrasound"];

interface PatientListRowProps {
  patient: PatientScreening;
  isAnalyzing: boolean;
  onUpdate: (
    field: string,
    value: string | string[] | boolean | Record<string, unknown>,
  ) => void;
  onDelete: () => void;
  onAnalyze: () => void;
  schedulerName?: string | null;
  batchScheduleDate?: string | null;
  sourceMode?: "visit" | "outreach";
}

export function PatientListRow({
  patient,
  isAnalyzing,
  onUpdate,
  onDelete,
  onAnalyze,
  batchScheduleDate,
  sourceMode,
}: PatientListRowProps) {
  const serverTests = patient.qualifyingTests || [];
  const [localTests, setLocalTests] = useState<string[]>(serverTests);
  const [generatingTests, setGeneratingTests] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [adminReviewOpen, setAdminReviewOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setLocalTests(patient.qualifyingTests || []);
  }, [patient.qualifyingTests]);

  const handleAddTest = useCallback(
    (test: string) => {
      if (localTests.includes(test)) return;
      const updated = [...localTests, test];
      setLocalTests(updated);
      onUpdate("qualifyingTests", updated);
      setGeneratingTests((prev) => new Set([...Array.from(prev), test]));
      apiRequest("POST", `/api/patients/${patient.id}/analyze-test`, { testName: test })
        .then((r) => r.json())
        .then((data: PatientScreening) => {
          if (data) {
            queryClient.setQueryData<ScreeningBatchWithPatients>(
              ["/api/screening-batches", patient.batchId],
              (old) => {
                if (!old) return old;
                return {
                  ...old,
                  patients: (old.patients || []).map((p) =>
                    p.id === patient.id ? { ...p, ...data } : p,
                  ),
                };
              },
            );
          }
        })
        .catch(() => {
          toast({
            title: "Could not generate reasoning",
            description: `Qualification notes for ${test} were not generated.`,
            variant: "destructive",
          });
        })
        .finally(() => {
          setGeneratingTests((prev) => {
            const next = new Set(prev);
            next.delete(test);
            return next;
          });
        });
    },
    [localTests, onUpdate, patient.id, patient.batchId, queryClient, toast],
  );

  const handleRemoveTest = useCallback(
    (test: string) => {
      const updated = localTests.filter((t) => t !== test);
      setLocalTests(updated);
      onUpdate("qualifyingTests", updated);
    },
    [localTests, onUpdate],
  );

  const tests = localTests;
  const isVisit = sourceMode !== "outreach";
  const { isComplete: infoComplete, missing } = getPatientCompleteness(patient, {
    isVisit,
  });
  const generatedFinal = patient.status === "completed";
  const statusLabel = !infoComplete ? "Pending" : generatedFinal ? "Final" : "Ready";
  const statusToneClass = !infoComplete
    ? "bg-amber-50 text-amber-800 border-amber-200"
    : generatedFinal
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-sky-50 text-sky-800 border-sky-200";

  const ancillaryCounts = ANCILLARY_ORDER.reduce<Record<AncillaryCategory, number>>(
    (acc, cat) => {
      acc[cat] = tests.filter((t) => getAncillaryCategory(t) === cat).length;
      return acc;
    },
    { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 },
  );

  const generateDisabled = isAnalyzing || !infoComplete;
  const generateLabel = generatedFinal ? "Re-generate" : "Generate";
  const generateTitle = !infoComplete
    ? `Complete required info before generating · Missing: ${missing.join(", ")}`
    : generateLabel;

  const displayName = (patient.name || "").trim() || "Unnamed patient";
  const ageDisplay = typeof patient.age === "number" ? `${patient.age}yo` : null;
  const isUnder16 = typeof patient.age === "number" && patient.age < 16;

  return (
    <>
      <div
        className="grid grid-cols-[minmax(140px,1.4fr)_minmax(80px,0.7fr)_minmax(110px,0.9fr)_minmax(120px,1.1fr)_minmax(110px,0.9fr)_minmax(80px,0.6fr)_auto_auto] gap-3 items-center px-3 py-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-50/60 transition-colors"
        data-testid={`plexus-iq-patient-list-row-${patient.id}`}
        data-row-type="plexus-iq-patient-list-row"
      >
        {/* Name */}
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-left min-w-0"
          data-testid={`text-list-row-patient-name-${patient.id}`}
        >
          <div className="text-sm font-semibold text-slate-900 truncate">
            {displayName}
          </div>
          {isUnder16 && (
            <span className="inline-flex items-center gap-1 mt-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-300 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider">
              &lt;16
            </span>
          )}
        </button>

        {/* DOB / age */}
        <div className="text-xs text-slate-600 truncate">
          {patient.dob ? <span title="DOB">{patient.dob}</span> : <span className="italic text-slate-400">—</span>}
          {ageDisplay && <span className="ml-1 text-slate-500">· {ageDisplay}</span>}
        </div>

        {/* Phone */}
        <div className="text-xs text-slate-600 truncate" title={patient.phoneNumber ?? ""}>
          {patient.phoneNumber || <span className="italic text-slate-400">—</span>}
        </div>

        {/* Facility */}
        <div className="text-xs text-slate-600 truncate" title={patient.facility ?? ""}>
          {patient.facility || <span className="italic text-slate-400">—</span>}
        </div>

        {/* Insurance */}
        <div className="text-xs text-slate-600 truncate" title={patient.insurance ?? ""}>
          {patient.insurance || <span className="italic text-slate-400">—</span>}
        </div>

        {/* Status */}
        <span
          className={`justify-self-start inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusToneClass}`}
          title={!infoComplete ? `Missing: ${missing.join(", ")}` : statusLabel}
          data-testid={`pill-list-row-status-${patient.id}`}
        >
          {statusLabel}
        </span>

        {/* Qualifying ancillary icons */}
        <div className="flex items-center gap-2 justify-end">
          {ANCILLARY_ORDER.map((cat) => {
            const count = ancillaryCounts[cat];
            if (count === 0) return null;
            const Icon = categoryIcons[cat];
            const style = categoryStyles[cat];
            return (
              <span
                key={cat}
                className="relative inline-flex items-center"
                title={`${cat} (${count})`}
              >
                <Icon className={`h-4 w-4 ${style.icon}`} strokeWidth={2} fill="none" />
                {count > 1 && (
                  <span className="absolute -top-1 -right-2 inline-flex items-center justify-center min-w-[12px] h-3 px-1 rounded-full bg-slate-900 text-white text-[8px] font-semibold leading-none">
                    {count}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {/* Actions: Admin Review, PDF, More */}
        <div className="flex items-center gap-1.5 justify-end">
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
            onClick={() => setAdminReviewOpen(true)}
            aria-label="Admin Review"
            title="Admin Review"
            className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            data-testid={`button-admin-review-list-row-${patient.id}`}
            data-row-action="button-admin-review-list-row"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                title="More"
                className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                data-testid={`button-list-row-more-${patient.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setEditOpen(true)}
                data-testid={`menu-list-row-edit-${patient.id}`}
              >
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Edit patient
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={generateDisabled}
                onClick={() => {
                  if (!infoComplete) return;
                  onAnalyze();
                }}
                data-testid={`menu-list-row-generate-${patient.id}`}
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-2" />
                )}
                {generateLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (confirm("Remove this patient?")) onDelete();
                }}
                data-testid={`menu-list-row-delete-${patient.id}`}
                className="text-rose-700"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Remove patient
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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

      <AdminReviewDialog
        open={adminReviewOpen}
        onOpenChange={setAdminReviewOpen}
        patient={patient}
        facility={patient.facility ?? null}
        scheduleDate={batchScheduleDate ?? null}
        onUpdate={onUpdate}
        onAddTest={handleAddTest}
        onRemoveTest={handleRemoveTest}
      />

      <span title={generateTitle} className="hidden" aria-hidden />
    </>
  );
}

export default PatientListRow;

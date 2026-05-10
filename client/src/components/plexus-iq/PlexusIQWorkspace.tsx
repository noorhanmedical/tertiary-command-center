import { useMemo } from "react";
import { Building2, CalendarDays, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

// Center workspace for /plexus-iq.
//
// Renders one section per non-empty screening batch using the existing
// QualificationPatientCardsPane (which itself reuses the premium PatientCard).
// Batches and counts come from the calendar-summary feed; patient detail is
// hydrated lazily by the page only for batches that have patientCount > 0,
// so empty/historical batches don't trigger detail fetches.

type BatchWithPatients = ScreeningBatch & { patients?: PatientScreening[] };

function formatDateLabel(scheduleDate: string | null | undefined): string {
  if (!scheduleDate) return "Outreach (no date)";
  const [yyyy, mm, dd] = scheduleDate.split("-").map(Number);
  if (!yyyy || !mm || !dd) return scheduleDate;
  const d = new Date(yyyy, mm - 1, dd);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PlexusIQWorkspace({
  summary,
  batchDetails,
  analyzingBatchId,
  analyzingPatients,
  onGenerateBatch,
  onOpenFinalSchedule,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
}: {
  summary: CalendarSummaryRow[];
  batchDetails: Record<number, BatchWithPatients>;
  analyzingBatchId: number | null;
  analyzingPatients: Set<number>;
  onGenerateBatch: (batchId: number) => void;
  onOpenFinalSchedule: (scheduleDate: string) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
}) {
  // Sort: dated batches by scheduleDate desc (most recent first), then
  // undated batches at the bottom alphabetically by facility.
  const renderable = useMemo(() => {
    const active = summary.filter((s) => s.patientCount > 0);
    active.sort((a, b) => {
      const ad = a.scheduleDate ?? "";
      const bd = b.scheduleDate ?? "";
      if (ad === bd) return (a.facility ?? "").localeCompare(b.facility ?? "");
      if (!ad) return 1;
      if (!bd) return -1;
      return bd.localeCompare(ad);
    });
    return active;
  }, [summary]);

  if (renderable.length === 0) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-sm font-semibold text-slate-900">No patients yet</div>
          <p className="mt-2 text-xs text-slate-500">
            Use <span className="font-medium">Add Patient</span> or{" "}
            <span className="font-medium">Import</span> to start. Patients route
            to the matching <span className="whitespace-nowrap">facility · date</span>{" "}
            batch automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      {renderable.map((row) => {
        const detail = batchDetails[row.id];
        const patients = detail?.patients ?? [];
        const completedCount = patients.filter((p) => p.status === "completed").length;
        const isAnalyzing = analyzingBatchId === row.id;
        const dateLabel = formatDateLabel(row.scheduleDate);
        const detailReady = !!detail?.patients;

        return (
          <section
            key={row.id}
            className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden"
            data-testid={`plexus-iq-workspace-batch-${row.id}`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {row.facility ?? "Unassigned facility"}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    {dateLabel}
                    <span className="text-slate-300">·</span>
                    <span>{row.patientCount} {row.patientCount === 1 ? "patient" : "patients"}</span>
                    {completedCount > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>{completedCount} analyzed</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl"
                  onClick={() => onGenerateBatch(row.id)}
                  disabled={isAnalyzing || analyzingBatchId !== null || row.patientCount === 0}
                  data-testid={`button-plexus-iq-generate-batch-${row.id}`}
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Generate All
                </Button>
                {row.scheduleDate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 rounded-xl"
                    onClick={() => onOpenFinalSchedule(row.scheduleDate as string)}
                    data-testid={`button-plexus-iq-open-final-${row.id}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Final Schedule
                  </Button>
                )}
              </div>
            </div>
            <div className="px-5 py-4">
              {!detailReady ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 italic py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading patients…
                </div>
              ) : (
                <QualificationPatientCardsPane
                  title="Patients"
                  patients={patients}
                  analyzingPatients={analyzingPatients}
                  completedCount={completedCount}
                  onUpdatePatient={onUpdatePatient}
                  onDeletePatient={onDeletePatient}
                  onAnalyzeOnePatient={onAnalyzeOnePatient}
                  onOpenScheduleModal={() => { /* Plexus IQ has no per-patient appointment modal */ }}
                  schedulerName={null}
                  batchScheduleDate={row.scheduleDate ?? null}
                  // Leave sourceMode undefined so PatientCard derives Visit /
                  // Outreach per row from per-patient data.
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

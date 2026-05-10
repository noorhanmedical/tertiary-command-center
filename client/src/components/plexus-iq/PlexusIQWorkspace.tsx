import { useMemo } from "react";
import {
  CalendarCheck,
  CalendarDays,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";
import type { CalendarSummaryRow } from "@/components/plexus-iq/PlexusIQCalendar";

// Facility → Date → Patient Cards accordion for /plexus-iq.
//
// Visual rules:
//   - Facility bar is solid near-black with the facility name only and an
//     icon-only trash control on the right. No counts/metrics on facility
//     rows — those live on the date pills inside.
//   - Date pills sit inside an open facility on a soft slate background,
//     with the date label + counts on the left and three icon-only actions
//     on the right (generate · final schedule · delete).
//   - Borders are intentionally minimal: rounded containers, soft inner
//     padding, no stacking horizontal rules.

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

function pendingFinal(detail: BatchWithPatients | undefined) {
  if (!detail?.patients) return { pending: null as number | null, final: null as number | null };
  let pending = 0;
  let final = 0;
  for (const p of detail.patients) {
    if (p.status === "completed") final += 1;
    else pending += 1;
  }
  return { pending, final };
}

function IconButton({
  label,
  testId,
  onClick,
  disabled,
  variant = "default",
  children,
}: {
  label: string;
  testId: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center h-8 w-8 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const tone =
    variant === "danger"
      ? "text-red-500 hover:text-red-600 hover:bg-red-50"
      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${base} ${tone}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function PlexusIQWorkspace({
  summary,
  batchDetails,
  analyzingBatchId,
  analyzingPatients,
  onGenerateBatch,
  onOpenFinalSchedule,
  onDeleteAllForBatch,
  onDeleteAllForFacility,
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
  onDeleteAllForBatch: (batchId: number) => void;
  onDeleteAllForFacility: (facility: string) => void;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
}) {
  const grouped = useMemo(() => {
    const active = summary.filter((s) => s.patientCount > 0);
    const byFacility = new Map<string, CalendarSummaryRow[]>();
    for (const row of active) {
      const key = row.facility ?? "Unassigned";
      const arr = byFacility.get(key);
      if (arr) arr.push(row);
      else byFacility.set(key, [row]);
    }
    const facilities: { facility: string; rows: CalendarSummaryRow[] }[] = [];
    byFacility.forEach((rows, facility) => {
      rows.sort((a, b) => {
        const ad = a.scheduleDate ?? "";
        const bd = b.scheduleDate ?? "";
        if (ad === bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return bd.localeCompare(ad);
      });
      facilities.push({ facility, rows });
    });
    facilities.sort((a, b) => {
      const aMax = a.rows[0]?.scheduleDate ?? "";
      const bMax = b.rows[0]?.scheduleDate ?? "";
      if (aMax === bMax) return a.facility.localeCompare(b.facility);
      if (!aMax) return 1;
      if (!bMax) return -1;
      return bMax.localeCompare(aMax);
    });
    return facilities;
  }, [summary]);

  const defaultOpenFacility = grouped[0]?.facility ?? "";
  const defaultOpenDate = grouped[0]?.rows[0] ? `${grouped[0].rows[0].id}` : "";

  if (grouped.length === 0) {
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
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          All Facilities
        </span>
        <span className="text-[10px] text-slate-400">
          ({grouped.length} {grouped.length === 1 ? "facility" : "facilities"})
        </span>
      </div>

      <Accordion
        type="multiple"
        defaultValue={defaultOpenFacility ? [defaultOpenFacility] : []}
        className="space-y-3"
      >
        {grouped.map(({ facility, rows }) => {
          return (
            <AccordionItem
              key={facility}
              value={facility}
              className="rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden border-0"
              data-testid={`plexus-iq-facility-${facility}`}
            >
              <div className="relative bg-slate-900 hover:bg-slate-800 transition-colors">
                <AccordionTrigger className="w-full hover:no-underline px-5 py-3 pr-24 text-white text-left [&>svg]:text-white/70 [&>svg]:hover:text-white">
                  <span className="text-sm font-semibold tracking-tight text-white truncate">
                    {facility}
                  </span>
                </AccordionTrigger>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAllForFacility(facility);
                  }}
                  aria-label={`Delete all patients in ${facility}`}
                  title={`Delete all patients in ${facility}`}
                  className="absolute right-12 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-8 w-8 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors z-10"
                  data-testid={`button-plexus-iq-delete-facility-${facility}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <AccordionContent className="pb-3 pt-0 bg-slate-50/40">
                <Accordion
                  type="multiple"
                  defaultValue={facility === defaultOpenFacility ? [defaultOpenDate] : []}
                  className="px-3 pt-3 space-y-2"
                >
                  {rows.map((row) => {
                    const detail = batchDetails[row.id];
                    const patients = detail?.patients ?? [];
                    const pf = pendingFinal(detail);
                    const isAnalyzing = analyzingBatchId === row.id;
                    const dateLabel = formatDateLabel(row.scheduleDate);
                    const detailReady = !!detail?.patients;
                    const completedCount = pf.final ?? 0;

                    return (
                      <AccordionItem
                        key={row.id}
                        value={`${row.id}`}
                        className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden border-0"
                        data-testid={`plexus-iq-date-${row.id}`}
                      >
                        <div className="relative hover:bg-slate-50 transition-colors">
                          <AccordionTrigger
                            className={`w-full hover:no-underline px-4 py-2.5 text-left ${
                              row.scheduleDate ? "pr-36" : "pr-24"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-900 truncate">
                                  {dateLabel}
                                </div>
                                <div className="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                                  <span>
                                    {row.patientCount}{" "}
                                    {row.patientCount === 1 ? "patient" : "patients"}
                                  </span>
                                  {pf.pending != null && pf.final != null && (
                                    <>
                                      <span className="text-slate-300">·</span>
                                      <span>{pf.pending} pending</span>
                                      <span className="text-slate-300">·</span>
                                      <span>{pf.final} final</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                            <IconButton
                              label={isAnalyzing ? "Generating…" : "Generate all"}
                              testId={`button-plexus-iq-generate-batch-${row.id}`}
                              onClick={() => onGenerateBatch(row.id)}
                              disabled={
                                isAnalyzing ||
                                analyzingBatchId !== null ||
                                row.patientCount === 0
                              }
                            >
                              {isAnalyzing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Sparkles className="w-4 h-4" />
                              )}
                            </IconButton>
                            {row.scheduleDate && (
                              <IconButton
                                label="Open final schedule"
                                testId={`button-plexus-iq-open-final-${row.id}`}
                                onClick={() =>
                                  onOpenFinalSchedule(row.scheduleDate as string)
                                }
                              >
                                <CalendarCheck className="w-4 h-4" />
                              </IconButton>
                            )}
                            <IconButton
                              label="Delete all on this date"
                              testId={`button-plexus-iq-delete-batch-${row.id}`}
                              onClick={() => onDeleteAllForBatch(row.id)}
                              variant="danger"
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </div>
                        </div>

                        <AccordionContent className="px-4 pb-4 pt-0">
                          {!detailReady ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 italic py-3">
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
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

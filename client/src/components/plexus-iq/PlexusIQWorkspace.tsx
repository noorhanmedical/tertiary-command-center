import { useMemo } from "react";
import {
  Building2,
  CalendarDays,
  ExternalLink,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
// Top level   : "All Facilities" header (visual; expansion is per-facility).
// Mid level   : one Accordion item per facility, defaulting to the facility
//               that owns the most-recent date open.
// Inner level : nested Accordion of dates within the facility, defaulting
//               to the most-recent date open.
// Leaf        : QualificationPatientCardsPane → premium PatientCard grid.
//
// Counts (total / pending / final) are computed from batchDetails when
// available; if a batch's detail hasn't hydrated yet, the summary's
// patientCount stands in for total and the breakdown shows "—".

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
  // Group active batches (patientCount > 0) by facility, then by date desc
  // within each facility. Undated batches sort to the bottom of their
  // facility group.
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
      // Facilities sorted by their most-recent date desc; undated last.
      const aMax = a.rows[0]?.scheduleDate ?? "";
      const bMax = b.rows[0]?.scheduleDate ?? "";
      if (aMax === bMax) return a.facility.localeCompare(b.facility);
      if (!aMax) return 1;
      if (!bMax) return -1;
      return bMax.localeCompare(aMax);
    });
    return facilities;
  }, [summary]);

  // Default-open: the facility with the most-recent date, and that
  // facility's most-recent date.
  const defaultOpenFacility = grouped[0]?.facility ?? "";
  const defaultOpenDate = grouped[0]?.rows[0]
    ? `${grouped[0].rows[0].id}`
    : "";

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
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
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
          const facilityTotal = rows.reduce((acc, r) => acc + r.patientCount, 0);
          let facilityPending = 0;
          let facilityFinal = 0;
          let facilityHasUnknown = false;
          for (const r of rows) {
            const pf = pendingFinal(batchDetails[r.id]);
            if (pf.pending == null || pf.final == null) facilityHasUnknown = true;
            else { facilityPending += pf.pending; facilityFinal += pf.final; }
          }
          const datesCount = rows.length;

          return (
            <AccordionItem
              key={facility}
              value={facility}
              className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden border-b"
              data-testid={`plexus-iq-facility-${facility}`}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/60 border-b border-slate-100">
                <AccordionTrigger className="flex-1 hover:no-underline py-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {facility}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>{facilityTotal} {facilityTotal === 1 ? "patient" : "patients"}</span>
                        {!facilityHasUnknown && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span>{facilityPending} pending</span>
                            <span className="text-slate-300">·</span>
                            <span>{facilityFinal} final</span>
                          </>
                        )}
                        <span className="text-slate-300">·</span>
                        <span>{datesCount} {datesCount === 1 ? "date" : "dates"}</span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAllForFacility(facility);
                  }}
                  data-testid={`button-plexus-iq-delete-facility-${facility}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete All
                </Button>
              </div>

              <AccordionContent className="pb-3 pt-0">
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
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden border-b"
                        data-testid={`plexus-iq-date-${row.id}`}
                      >
                        <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap">
                          <AccordionTrigger className="flex-1 hover:no-underline py-0 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                              <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-900 truncate">
                                  {dateLabel}
                                </div>
                                <div className="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                                  <span>{row.patientCount} {row.patientCount === 1 ? "patient" : "patients"}</span>
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 rounded-xl h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                onGenerateBatch(row.id);
                              }}
                              disabled={isAnalyzing || analyzingBatchId !== null || row.patientCount === 0}
                              data-testid={`button-plexus-iq-generate-batch-${row.id}`}
                            >
                              {isAnalyzing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                              Generate All
                            </Button>
                            {row.scheduleDate && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 rounded-xl h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenFinalSchedule(row.scheduleDate as string);
                                }}
                                data-testid={`button-plexus-iq-open-final-${row.id}`}
                              >
                                <ExternalLink className="w-3 h-3" />
                                Final Schedule
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 rounded-xl h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteAllForBatch(row.id);
                              }}
                              data-testid={`button-plexus-iq-delete-batch-${row.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete All
                            </Button>
                          </div>
                        </div>

                        <AccordionContent className="px-3 pb-3 pt-0">
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

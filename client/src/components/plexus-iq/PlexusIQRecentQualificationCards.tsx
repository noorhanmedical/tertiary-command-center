import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import QualificationPatientCardsPane from "@/components/qualification/QualificationPatientCardsPane";
import type { ActiveQualificationJob } from "@/components/plexus-iq/PlexusIQQualificationJobsStatus";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

// Recent Qualification Cards shelf for the Plexus IQ interior page.
//
// Renders the actual patient cards for every batch that's tracked in
// `activeQualificationJobs` so the operator sees the rows they just
// generated directly at the top of the page, without scrolling through
// the facility/date workspace below. The shelf consumes the same job
// list the status banner does, so hiding a job there also removes its
// shelf entry here. Soft-deleted patients are already filtered out by
// the server's batch-detail endpoint.

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

export function PlexusIQRecentQualificationCards({
  jobs,
  batchDetails,
  analyzingPatients,
  onUpdatePatient,
  onDeletePatient,
  onAnalyzeOnePatient,
}: {
  jobs: ActiveQualificationJob[];
  batchDetails: Record<number, BatchWithPatients>;
  analyzingPatients: Set<number>;
  onUpdatePatient: (id: number, updates: Record<string, unknown>) => void;
  onDeletePatient: (id: number) => void;
  onAnalyzeOnePatient: (id: number) => void;
}) {
  // Per-job expand state. Default closed so 8+ recent jobs don't dump
  // hundreds of cards by default; clicking a row reveals its patients.
  const [openJobs, setOpenJobs] = useState<Set<number>>(new Set());

  if (jobs.length === 0) return null;

  // Show newest jobId first (the merge helper in plexus-iq.tsx already
  // sorts this way; defensively re-sort here).
  const ordered = [...jobs].sort((a, b) => b.jobId - a.jobId);

  return (
    <Card
      className="border border-slate-200 bg-white px-4 py-3"
      data-testid="plexus-iq-recent-qualification-cards"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold text-slate-900">
          Recent qualification cards
          <span className="ml-1 text-slate-500 font-normal">({jobs.length})</span>
        </div>
        <span className="text-[10px] text-slate-500">
          Patient cards from active/recent qualification jobs
        </span>
      </div>

      <ul className="space-y-2" data-testid="plexus-iq-recent-cards-list">
        {ordered.map((job) => {
          const detail = job.batchId != null ? batchDetails[job.batchId] : undefined;
          const patients = detail?.patients ?? [];
          const facility = detail?.facility ?? null;
          const dateLabel = formatDateLabel(detail?.scheduleDate ?? null);
          const isOpen = openJobs.has(job.jobId);
          const total = patients.length || job.totalPatients || 0;
          return (
            <li
              key={job.jobId}
              className="rounded-xl border border-slate-100 bg-slate-50/40 overflow-hidden"
              data-testid={`plexus-iq-recent-cards-job-${job.jobId}`}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenJobs((prev) => {
                    const next = new Set(prev);
                    if (next.has(job.jobId)) next.delete(job.jobId);
                    else next.add(job.jobId);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                aria-expanded={isOpen}
                data-testid={`button-plexus-iq-recent-cards-toggle-${job.jobId}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      Job #{job.jobId}
                      {job.batchId ? (
                        <span className="ml-1 text-slate-500 font-normal">
                          · batch #{job.batchId}
                        </span>
                      ) : null}
                      {facility ? (
                        <span className="ml-1 text-slate-500 font-normal">· {facility}</span>
                      ) : null}
                      {detail?.scheduleDate ? (
                        <span className="ml-1 text-slate-500 font-normal">· {dateLabel}</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {total} {total === 1 ? "patient" : "patients"}
                      {detail == null ? " · loading…" : ""}
                    </div>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-3 pb-3">
                  {detail == null ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 italic py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading cards…
                    </div>
                  ) : patients.length === 0 ? (
                    <div className="text-xs text-slate-500 italic py-2">
                      No patients to show — batch may have been emptied or deleted.
                    </div>
                  ) : (
                    <QualificationPatientCardsPane
                      title="Recent cards"
                      patients={patients}
                      analyzingPatients={analyzingPatients}
                      completedCount={
                        patients.filter((p) => p.status === "completed").length
                      }
                      onUpdatePatient={onUpdatePatient}
                      onDeletePatient={onDeletePatient}
                      onAnalyzeOnePatient={onAnalyzeOnePatient}
                      onOpenScheduleModal={() => { /* no per-patient modal in this shelf */ }}
                      schedulerName={null}
                      batchScheduleDate={detail?.scheduleDate ?? null}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

import { useMemo } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw, X, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  fetchPlexusIqQualificationJobStatus,
  retryPlexusIqQualificationJobFailed,
  type QualificationJobStatus,
} from "@/lib/plexusIqClinicalImportApi";
import { useToast } from "@/hooks/use-toast";

// Multi-job clinical-import qualification status banner.
//
// A clinical import that spans multiple (facility, scheduleDate) groups
// produces one qualification job per group. This component polls all
// of them concurrently with useQueries, aggregates the counts for the
// header, and renders a compact per-job row underneath. Retry-failed
// works per-job and swaps in the new jobId without touching the others.

export type ActiveQualificationJob = {
  jobId: number;
  batchId?: number | null;
  totalPatients?: number | null;
};

export type PlexusIQQualificationJobsStatusProps = {
  jobs: ActiveQualificationJob[];
  onJobsChange: (jobs: ActiveQualificationJob[]) => void;
  onDismiss: () => void;
};

function isTerminal(s: string | undefined): boolean {
  return s === "completed" || s === "failed" || s === "cancelled";
}

function statusIcon(s: string | undefined) {
  if (s === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (s === "failed") return <AlertCircle className="h-4 w-4 text-rose-600" />;
  return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
}

export function PlexusIQQualificationJobsStatus({
  jobs,
  onJobsChange,
  onDismiss,
}: PlexusIQQualificationJobsStatusProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Poll all jobs concurrently. refetchInterval auto-stops per job once
  // its status becomes terminal — useQueries dedups requests per
  // queryKey, so React Query handles cache + stop-polling individually.
  const queries = useQueries({
    queries: jobs.map((j) => ({
      queryKey: ["plexus-iq-qualification-job", j.jobId] as const,
      queryFn: () => fetchPlexusIqQualificationJobStatus(j.jobId),
      refetchInterval: (q: { state: { data?: QualificationJobStatus } }) => {
        const s = q.state.data?.status;
        return isTerminal(s) ? false : 2500;
      },
    })),
  });

  const statuses: Array<QualificationJobStatus | undefined> = queries.map(
    (q) => q.data,
  );

  // Aggregate header — weighted by patient counts, not a simple average
  // across jobs.
  const aggregate = useMemo(() => {
    let total = 0;
    let completed = 0;
    let failed = 0;
    let queued = 0;
    let processing = 0;
    let skipped = 0;
    let terminalCount = 0;
    let anyFailed = false;
    for (let i = 0; i < jobs.length; i++) {
      const s = statuses[i];
      const fallbackTotal = jobs[i].totalPatients ?? 0;
      total += s?.total ?? fallbackTotal;
      completed += s?.completed ?? 0;
      failed += s?.failed ?? 0;
      queued += s?.queued ?? 0;
      processing += s?.processing ?? 0;
      skipped += s?.skipped ?? 0;
      if (s && isTerminal(s.status)) terminalCount += 1;
      if (s?.status === "failed") anyFailed = true;
    }
    const percent =
      total > 0
        ? Math.round(((completed + failed + skipped) / total) * 100)
        : 0;
    const allTerminal = terminalCount === jobs.length && jobs.length > 0;
    let headerStatus: "processing" | "completed" | "failed" = "processing";
    if (allTerminal) headerStatus = anyFailed ? "failed" : "completed";
    return {
      total,
      completed,
      failed,
      queued,
      processing,
      skipped,
      percent,
      headerStatus,
      allTerminal,
    };
  }, [jobs, statuses]);

  if (jobs.length === 0) return null;

  return (
    <Card
      className="border border-slate-200 bg-white px-4 py-3"
      data-testid="plexus-iq-qualification-jobs-status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {statusIcon(aggregate.headerStatus)}
            <div className="text-sm font-semibold text-slate-900">
              Qualification jobs
              <span className="ml-1 text-slate-500 font-normal">
                ({jobs.length})
              </span>
            </div>
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-700"
              data-testid="qualification-jobs-overall-status"
            >
              {aggregate.headerStatus}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={aggregate.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-plexus-navy-800 transition-[width]"
                style={{ width: `${Math.max(0, Math.min(100, aggregate.percent))}%` }}
              />
            </div>
            <div
              className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600"
              data-testid="qualification-jobs-aggregate-counts"
            >
              <span>{aggregate.percent}%</span>
              <span>
                <strong className="text-slate-900">{aggregate.completed}</strong>/{aggregate.total} completed
              </span>
              <span>
                <strong className="text-slate-900">{aggregate.queued}</strong> queued
              </span>
              {aggregate.failed > 0 && (
                <span className="text-rose-700">
                  <strong>{aggregate.failed}</strong> failed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="h-7 w-7 p-0"
            aria-label="Dismiss"
            data-testid="button-qualification-jobs-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5" data-testid="qualification-jobs-list">
        {jobs.map((job, idx) => (
          <JobRow
            key={job.jobId}
            job={job}
            status={statuses[idx]}
            isLoading={queries[idx].isLoading && !statuses[idx]}
            isError={queries[idx].isError}
            error={queries[idx].error}
            onRetried={(newJobId, totalPatients) => {
              const next = jobs.map((j, i) =>
                i === idx
                  ? {
                      ...j,
                      jobId: newJobId,
                      totalPatients: totalPatients ?? j.totalPatients ?? null,
                    }
                  : j,
              );
              onJobsChange(next);
              queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
            }}
            onRetryError={(msg) => {
              toast({
                title: "Retry failed",
                description: msg,
                variant: "destructive",
              });
            }}
          />
        ))}
      </ul>
    </Card>
  );
}

function JobRow({
  job,
  status,
  isLoading,
  isError,
  error,
  onRetried,
  onRetryError,
}: {
  job: ActiveQualificationJob;
  status: QualificationJobStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetried: (newJobId: number, totalPatients: number | null) => void;
  onRetryError: (msg: string) => void;
}) {
  const retryMutation = useMutation({
    mutationFn: () => retryPlexusIqQualificationJobFailed(job.jobId),
    onSuccess: (resp) => {
      onRetried(resp.jobId, resp.totalPatients ?? null);
    },
    onError: (err: unknown) => {
      onRetryError(
        err instanceof Error ? err.message : "Could not retry failed patients",
      );
    },
  });

  const total = status?.total ?? job.totalPatients ?? 0;
  const completed = status?.completed ?? 0;
  const failed = status?.failed ?? 0;
  const queued = status?.queued ?? Math.max(0, total - completed - failed);
  const percent = status?.percent ?? (total > 0 ? Math.round(((completed + failed) / total) * 100) : 0);
  const showRetry = (failed > 0 || status?.status === "failed") && !retryMutation.isPending;

  return (
    <li
      className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-2"
      data-testid={`qualification-job-row-${job.jobId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(status?.status)}
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-900 truncate">
              Job #{job.jobId}
              {(status?.batchId ?? job.batchId) ? (
                <span className="ml-1 text-slate-500 font-normal">
                  · batch #{status?.batchId ?? job.batchId}
                </span>
              ) : null}
            </div>
            <div className="text-[10px] text-slate-500" data-testid={`qualification-job-row-${job.jobId}-counts`}>
              {isLoading
                ? "Loading status…"
                : isError
                ? `Status error: ${error instanceof Error ? error.message : "unknown"}`
                : (
                    <>
                      {percent}% · <strong className="text-slate-700">{completed}</strong>/{total} completed
                      {queued > 0 ? <> · {queued} queued</> : null}
                      {failed > 0 ? (
                        <span className="text-rose-700"> · <strong>{failed}</strong> failed</span>
                      ) : null}
                    </>
                  )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status?.status && (
            <span className="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-600">
              {status.status}
            </span>
          )}
          {showRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="h-6 gap-1 px-2 text-[10px]"
              data-testid={`button-qualification-job-${job.jobId}-retry-failed`}
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
              Retry failed
            </Button>
          )}
        </div>
      </div>

      {status?.errors?.length ? (
        <details className="mt-1.5 text-[10px] text-rose-800">
          <summary className="cursor-pointer select-none">
            {status.errors.length} patient{status.errors.length === 1 ? "" : "s"} failed
          </summary>
          <ul className="mt-1 ml-2 max-h-20 overflow-y-auto space-y-0.5">
            {status.errors.slice(0, 8).map((e) => (
              <li key={e.patientId} className="truncate">
                #{e.patientId} · {e.patientName} · {e.error}
              </li>
            ))}
            {status.errors.length > 8 && (
              <li className="italic opacity-70">
                and {status.errors.length - 8} more…
              </li>
            )}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

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
import { categoryLabel, formatEta } from "./qualificationJobFormat";

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

// Map raw job state → the user-facing vocabulary the page should
// surface: Qualifying patients / Qualified / Qualified · Needs Review
// / Failed. Cancelled keeps its own label since the user explicitly
// cancelled.
type FriendlyLabel = {
  text: string;
  testId:
    | "plexus-iq-qualification-status-qualifying"
    | "plexus-iq-qualification-status-qualified"
    | "plexus-iq-qualification-status-needs-review"
    | "plexus-iq-qualification-status-failed"
    | "plexus-iq-qualification-status-cancelled";
};

function friendlyJobLabel(
  status: string | undefined,
  failedCount: number,
): FriendlyLabel {
  if (status === "failed") {
    return { text: "Failed", testId: "plexus-iq-qualification-status-failed" };
  }
  if (status === "cancelled") {
    return { text: "Cancelled", testId: "plexus-iq-qualification-status-cancelled" };
  }
  if (status === "completed") {
    if (failedCount > 0) {
      return {
        text: "Qualified · Needs Review",
        testId: "plexus-iq-qualification-status-needs-review",
      };
    }
    return { text: "Qualified", testId: "plexus-iq-qualification-status-qualified" };
  }
  // queued / processing / undefined → still in progress.
  return {
    text: "Qualifying patients",
    testId: "plexus-iq-qualification-status-qualifying",
  };
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
  //
  // Plexus IQ runtime hardening — also aggregate the v2 metadata
  // fields. Sums where additive (skipped, rateLimited, aiBatchFallback,
  // category counters). For throughput / ETA, jobs run concurrently
  // so the user-visible signal is: sum patientsPerMinute across
  // still-running jobs; ETA = max remaining across jobs (the slowest
  // job is the one we wait on).
  const aggregate = useMemo(() => {
    let total = 0;
    let completed = 0;
    let failed = 0;
    let queued = 0;
    let processing = 0;
    let skipped = 0;
    let rateLimitedCount = 0;
    let aiBatchFallbackCount = 0;
    let missingClinicalCount = 0;
    let missingDemographicCount = 0;
    let technicalFailedCount = 0;
    let aiErrorCount = 0;
    let anyCategoryCount = false;
    let patientsPerMinute = 0;
    let anySpeed = false;
    let etaSecondsRemaining: number | undefined = undefined;
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
      rateLimitedCount += s?.rateLimitedCount ?? 0;
      aiBatchFallbackCount += s?.aiBatchFallbackCount ?? 0;
      if (s?.missingClinicalCount != null) {
        missingClinicalCount += s.missingClinicalCount;
        anyCategoryCount = true;
      }
      if (s?.missingDemographicCount != null) {
        missingDemographicCount += s.missingDemographicCount;
        anyCategoryCount = true;
      }
      if (s?.technicalFailedCount != null) {
        technicalFailedCount += s.technicalFailedCount;
        anyCategoryCount = true;
      }
      if (s?.aiErrorCount != null) {
        aiErrorCount += s.aiErrorCount;
        anyCategoryCount = true;
      }
      // Only count throughput from jobs still running — a finished
      // job's last-known patientsPerMinute is no longer happening.
      if (s && !isTerminal(s.status) && s.patientsPerMinute != null) {
        patientsPerMinute += s.patientsPerMinute;
        anySpeed = true;
      }
      if (s && !isTerminal(s.status) && s.etaSecondsRemaining != null) {
        etaSecondsRemaining =
          etaSecondsRemaining == null
            ? s.etaSecondsRemaining
            : Math.max(etaSecondsRemaining, s.etaSecondsRemaining);
      }
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
      rateLimitedCount,
      aiBatchFallbackCount,
      missingClinicalCount,
      missingDemographicCount,
      technicalFailedCount,
      aiErrorCount,
      anyCategoryCount,
      patientsPerMinute: anySpeed ? patientsPerMinute : undefined,
      etaSecondsRemaining,
    };
  }, [jobs, statuses]);

  if (jobs.length === 0) return null;

  // Aggregate label uses the same vocabulary as per-job rows. The
  // header reflects: still running → "Qualifying patients";
  // every job terminal + any whole job failed → "Failed";
  // every job terminal + no whole job failed + any patient errored →
  // "Qualified · Needs Review"; otherwise → "Qualified".
  const aggregateLabel: FriendlyLabel = aggregate.allTerminal
    ? aggregate.headerStatus === "failed"
      ? { text: "Failed", testId: "plexus-iq-qualification-status-failed" }
      : aggregate.failed > 0
        ? {
            text: "Qualified · Needs Review",
            testId: "plexus-iq-qualification-status-needs-review",
          }
        : { text: "Qualified", testId: "plexus-iq-qualification-status-qualified" }
    : {
        text: "Qualifying patients",
        testId: "plexus-iq-qualification-status-qualifying",
      };

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
              data-testid={aggregateLabel.testId}
              data-aggregate-status="qualification-jobs-overall-status"
            >
              {aggregateLabel.text}
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
              {aggregate.skipped > 0 && (
                <span data-testid="qualification-jobs-skipped">
                  <strong className="text-slate-900">{aggregate.skipped}</strong> skipped
                </span>
              )}
              {aggregate.failed > 0 && (
                <span className="text-rose-700">
                  <strong>{aggregate.failed}</strong> failed
                </span>
              )}
            </div>
            {/* Plexus IQ runtime hardening — aggregate throughput.
                Sum of in-flight job p/min; ETA is the slowest job's
                remaining. Skipped when no running job has reported. */}
            {(aggregate.patientsPerMinute != null ||
              aggregate.etaSecondsRemaining != null ||
              aggregate.rateLimitedCount > 0 ||
              aggregate.aiBatchFallbackCount > 0) && (
              <div
                className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500"
                data-testid="qualification-jobs-aggregate-throughput"
              >
                {aggregate.patientsPerMinute != null && (
                  <span data-testid="qualification-jobs-speed">
                    <strong className="text-slate-700">{aggregate.patientsPerMinute}</strong>/min
                  </span>
                )}
                {aggregate.etaSecondsRemaining != null &&
                  aggregate.etaSecondsRemaining > 0 && (
                    <span data-testid="qualification-jobs-eta">
                      ETA <strong className="text-slate-700">{formatEta(aggregate.etaSecondsRemaining)}</strong>
                    </span>
                  )}
                {aggregate.rateLimitedCount > 0 && (
                  <span className="text-amber-700" data-testid="qualification-jobs-rate-limited">
                    rate-limited <strong>{aggregate.rateLimitedCount}</strong>
                  </span>
                )}
                {aggregate.aiBatchFallbackCount > 0 && (
                  <span className="text-amber-700" data-testid="qualification-jobs-ai-batch-fallback">
                    ai-batch fallback <strong>{aggregate.aiBatchFallbackCount}</strong>
                  </span>
                )}
              </div>
            )}
            {aggregate.anyCategoryCount &&
              aggregate.missingClinicalCount +
                aggregate.missingDemographicCount +
                aggregate.technicalFailedCount +
                aggregate.aiErrorCount >
                0 && (
                <div
                  className="flex flex-wrap items-center gap-2 text-[11px]"
                  data-testid="qualification-jobs-aggregate-categories"
                >
                  {aggregate.missingClinicalCount > 0 && (
                    <span
                      className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5"
                      data-testid="qualification-jobs-missing-clinical"
                    >
                      missing clinical <strong>{aggregate.missingClinicalCount}</strong>
                    </span>
                  )}
                  {aggregate.missingDemographicCount > 0 && (
                    <span
                      className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5"
                      data-testid="qualification-jobs-missing-demographic"
                    >
                      missing demographic <strong>{aggregate.missingDemographicCount}</strong>
                    </span>
                  )}
                  {aggregate.technicalFailedCount > 0 && (
                    <span
                      className="rounded-full bg-rose-50 text-rose-800 px-2 py-0.5"
                      data-testid="qualification-jobs-technical-failed"
                    >
                      technical failed <strong>{aggregate.technicalFailedCount}</strong>
                    </span>
                  )}
                  {aggregate.aiErrorCount > 0 && (
                    <span
                      className="rounded-full bg-rose-50 text-rose-800 px-2 py-0.5"
                      data-testid="qualification-jobs-ai-error"
                    >
                      ai error <strong>{aggregate.aiErrorCount}</strong>
                    </span>
                  )}
                </div>
              )}
            <p className="text-[10px] text-slate-500 leading-snug" data-testid="qualification-jobs-transparency">
              Each patient is qualified individually. Jobs run with limited
              concurrency, so multiple patients may complete at the same time.
            </p>
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
            data-testid="plexus-iq-qualification-status-dismiss"
            data-legacy-testid="button-qualification-jobs-dismiss"
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
            onHide={() => {
              onJobsChange(jobs.filter((j) => j.jobId !== job.jobId));
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
  onHide,
}: {
  job: ActiveQualificationJob;
  status: QualificationJobStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetried: (newJobId: number, totalPatients: number | null) => void;
  onRetryError: (msg: string) => void;
  onHide: () => void;
}) {
  const retryMutation = useMutation({
    mutationFn: () => retryPlexusIqQualificationJobFailed(job.jobId),
    onSuccess: (resp) => {
      // Plexus IQ runtime hardening — Routes step 3.
      // Retry can return `jobId: null` for the zero-failed and
      // duplicate-in-flight branches. Both are user-facing messages,
      // not a started job — surface them via the error toast path
      // and skip the poll-target swap.
      if (resp.jobId == null) {
        onRetryError(resp.reason ?? "No retryable failed patients");
        return;
      }
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
  const skipped = status?.skipped ?? 0;
  const queued = status?.queued ?? Math.max(0, total - completed - failed);
  const percent = status?.percent ?? (total > 0 ? Math.round(((completed + failed) / total) * 100) : 0);
  const showRetry = (failed > 0 || status?.status === "failed") && !retryMutation.isPending;
  const isStillRunning = status ? !["completed", "failed", "cancelled"].includes(status.status) : false;
  const showChunk =
    status?.chunkIndex != null && status?.totalChunks != null;
  const showSpeed = isStillRunning && status?.patientsPerMinute != null;
  const showEta =
    isStillRunning &&
    status?.etaSecondsRemaining != null &&
    status.etaSecondsRemaining > 0;

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
                      {skipped > 0 ? <> · {skipped} skipped</> : null}
                      {failed > 0 ? (
                        <span className="text-rose-700"> · <strong>{failed}</strong> failed</span>
                      ) : null}
                      {(showChunk || showSpeed || showEta) && (
                        <span data-testid={`qualification-job-row-${job.jobId}-throughput`}>
                          {showChunk ? (
                            <> · chunk {status!.chunkIndex}/{status!.totalChunks}</>
                          ) : null}
                          {showSpeed ? <> · {status!.patientsPerMinute}/min</> : null}
                          {showEta ? <> · ETA {formatEta(status!.etaSecondsRemaining!)}</> : null}
                        </span>
                      )}
                      {(status?.rateLimitedCount ?? 0) > 0 ? (
                        <span className="text-amber-700"> · rate-limited {status!.rateLimitedCount}</span>
                      ) : null}
                      {(status?.aiBatchFallbackCount ?? 0) > 0 ? (
                        <span className="text-amber-700"> · ai-batch fallback {status!.aiBatchFallbackCount}</span>
                      ) : null}
                    </>
                  )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(() => {
            const label = friendlyJobLabel(status?.status, failed);
            return (
              <span
                className="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-600"
                data-testid={label.testId}
                data-row-status="qualification-job-row-status"
              >
                {label.text}
              </span>
            );
          })()}
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onHide}
            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700"
            aria-label="Hide this job from this page"
            title="Hide this job from this page. This does not cancel server processing."
            data-testid={`button-qualification-job-${job.jobId}-hide`}
          >
            <X className="h-3 w-3" />
          </Button>
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
                #{e.patientId} · {e.patientName}
                {e.category ? (
                  <span className="ml-1 text-[9px] uppercase tracking-wider opacity-70">
                    [{categoryLabel(e.category)}]
                  </span>
                ) : null}
                {" · "}
                {e.error}
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

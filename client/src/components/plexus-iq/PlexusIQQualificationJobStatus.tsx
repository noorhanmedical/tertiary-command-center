import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCcw, X, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  fetchPlexusIqQualificationJobStatus,
  retryPlexusIqQualificationJobFailed,
  type QualificationJobStatus,
} from "@/lib/plexusIqClinicalImportApi";
import { useToast } from "@/hooks/use-toast";

// Compact status banner for the active clinical-import qualification
// job. Polls /api/plexus-iq/qualification-jobs/:jobId/status every 2.5s
// while the job is queued/processing, then stops once terminal. Exposes
// a Retry-Failed button which kicks off the existing retry endpoint
// and swaps to the new jobId.

export function PlexusIQQualificationJobStatus({
  jobId,
  onJobChange,
  onDismiss,
}: {
  jobId: number;
  onJobChange: (jobId: number) => void;
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<QualificationJobStatus>({
    queryKey: ["plexus-iq-qualification-job", jobId],
    queryFn: () => fetchPlexusIqQualificationJobStatus(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "completed" || s === "failed" || s === "cancelled") return false;
      return 2500;
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => retryPlexusIqQualificationJobFailed(jobId),
    onSuccess: (resp) => {
      toast({
        title: "Retrying",
        description: `Re-queued ${resp.totalPatients} patient${resp.totalPatients === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      onJobChange(resp.jobId);
    },
    onError: (err: unknown) => {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Could not retry failed patients",
        variant: "destructive",
      });
    },
  });

  const summary = useMemo(() => {
    if (!data) return null;
    return {
      total: data.total,
      completed: data.completed,
      failed: data.failed,
      queued: data.queued,
      percent: data.percent,
    };
  }, [data]);

  return (
    <Card
      className="border border-slate-200 bg-white px-4 py-3"
      data-testid="plexus-iq-qualification-job-status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {data?.status === "completed" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : data?.status === "failed" ? (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
            )}
            <div className="text-sm font-semibold text-slate-900">
              Qualification job
              {data?.batchId ? (
                <span className="ml-1 text-slate-500 font-normal">
                  (batch #{data.batchId})
                </span>
              ) : null}
            </div>
            {data?.status && (
              <span
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-700"
                data-testid="qualification-job-status-text"
              >
                {data.status}
              </span>
            )}
          </div>
          {isLoading && !data ? (
            <div className="mt-1 text-xs text-slate-500">Loading status…</div>
          ) : isError ? (
            <div className="mt-1 text-xs text-rose-700">
              {error instanceof Error ? error.message : "Failed to load status"}
            </div>
          ) : summary ? (
            <div className="mt-2 space-y-1">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={summary.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-plexus-navy-800 transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, summary.percent))}%` }}
                />
              </div>
              <div
                className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600"
                data-testid="qualification-job-counts"
              >
                <span>{summary.percent}%</span>
                <span>
                  <strong className="text-slate-900">{summary.completed}</strong>/{summary.total} completed
                </span>
                <span>
                  <strong className="text-slate-900">{summary.queued}</strong> queued
                </span>
                {summary.failed > 0 && (
                  <span className="text-rose-700">
                    <strong>{summary.failed}</strong> failed
                  </span>
                )}
              </div>
              {data?.errors?.length ? (
                <div className="mt-2 max-h-24 overflow-y-auto rounded-md border border-rose-100 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                  <div className="font-medium mb-0.5">
                    {data.errors.length} patient{data.errors.length === 1 ? "" : "s"} failed
                  </div>
                  <ul className="space-y-0.5">
                    {data.errors.slice(0, 8).map((e) => (
                      <li key={e.patientId} className="truncate">
                        #{e.patientId} · {e.patientName} · {e.error}
                      </li>
                    ))}
                    {data.errors.length > 8 && (
                      <li className="italic opacity-70">
                        and {data.errors.length - 8} more…
                      </li>
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {data && data.failed > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="gap-1.5"
              data-testid="button-qualification-job-retry-failed"
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Retry failed
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="h-7 w-7 p-0"
            aria-label="Dismiss"
            data-testid="button-qualification-job-dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

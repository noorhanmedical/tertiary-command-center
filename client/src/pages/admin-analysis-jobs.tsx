import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { History, ArrowLeft, CheckCircle2, XCircle, Loader2, Clock, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";

type AnalysisJobRow = {
  id: number;
  batchId: number;
  batchName: string;
  status: string;
  totalPatients: number;
  completedPatients: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1" data-testid="badge-status-completed">
        <CheckCircle2 className="h-3 w-3" />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-red-100 text-red-700 border-0 gap-1" data-testid="badge-status-failed">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge className="bg-blue-100 text-blue-700 border-0 gap-1" data-testid="badge-status-running">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-100 text-slate-600 border-0" data-testid="badge-status-unknown">
      {status}
    </Badge>
  );
}

export default function AdminAnalysisJobsPage() {
  const { data: jobs, isLoading, isError } = useQuery<AnalysisJobRow[]>({
    queryKey: ["/api/admin/analysis-jobs"],
  });

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <PageHeader
          backHref="/admin"
          eyebrow="PLEXUS ANCILLARY · ANALYSIS"
          icon={History}
          iconAccent="bg-indigo-100 text-indigo-700"
          title="Analysis Run History"
          subtitle="Recent batch analysis runs — up to 7 days of history. Older runs are auto-purged."
        />

        {isLoading && (
          <Card className="rounded-3xl border border-white/60 bg-white/75 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          </Card>
        )}

        {isError && (
          <Card className="rounded-3xl border border-white/60 bg-white/75 p-8 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
            <p className="text-slate-600 text-sm">Failed to load analysis job history.</p>
          </Card>
        )}

        {!isLoading && !isError && jobs && jobs.length === 0 && (
          <Card className="rounded-3xl border border-white/60 bg-white/75 p-10 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl text-center">
            <Clock className="h-8 w-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No analysis runs found in the last 7 days.</p>
          </Card>
        )}

        {!isLoading && !isError && jobs && jobs.length > 0 && (
          <Card className="rounded-3xl border border-white/60 bg-white/75 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-analysis-jobs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="px-5 py-3 text-left font-semibold text-slate-600">Batch</th>
                    <th className="px-5 py-3 text-left font-semibold text-slate-600">Started</th>
                    <th className="px-5 py-3 text-left font-semibold text-slate-600">Status</th>
                    <th className="px-5 py-3 text-right font-semibold text-slate-600">Patients</th>
                    <th className="px-5 py-3 text-right font-semibold text-slate-600">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition"
                      data-testid={`row-analysis-job-${job.id}`}
                    >
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-slate-800" data-testid={`text-batch-name-${job.id}`}>
                          {job.batchName}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap" data-testid={`text-started-at-${job.id}`}>
                        {formatDate(job.startedAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={job.status} />
                          {job.status === "failed" && job.errorMessage && (
                            <p
                              className="text-xs text-red-600 max-w-[280px] truncate"
                              title={job.errorMessage}
                              data-testid={`text-error-message-${job.id}`}
                            >
                              {job.errorMessage}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums" data-testid={`text-patients-${job.id}`}>
                        <span className="text-slate-800 font-medium">{job.completedPatients}</span>
                        <span className="text-slate-400">/{job.totalPatients}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-500 tabular-nums whitespace-nowrap" data-testid={`text-duration-${job.id}`}>
                        {formatDuration(job.startedAt, job.completedAt)}
                        {!job.completedAt && job.status === "running" && (
                          <span className="ml-1 text-blue-500">…</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import {
  Inbox,
  CloudUpload,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  Trash2,
  FileText,
  Sheet as SheetIcon,
  Loader2,
} from "lucide-react";

type OutboxItem = {
  id: number;
  kind: string;
  blobId: number | null;
  facility: string | null;
  patientName: string | null;
  ancillaryType: string | null;
  docKind: string | null;
  filename: string | null;
  status: "pending" | "uploading" | "completed" | "failed";
  attempts: number;
  errorText: string | null;
  resultId: string | null;
  resultUrl: string | null;
  isTest: boolean;
  createdAt: string;
  completedAt: string | null;
};

type OutboxResponse = {
  items: OutboxItem[];
  summary: { pending: number; failed: number; uploading: number; completed: number; total: number };
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  uploading: "Uploading",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  uploading: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export default function AdminOutboxPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<OutboxResponse>({
    queryKey: ["/api/outbox"],
    refetchInterval: 5000,
  });

  const drainAll = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/outbox/drain", {}),
    onSuccess: async (res: any) => {
      const json = await res.json();
      toast({
        title: "Upload All complete",
        description: `${json.succeeded}/${json.attempted} uploaded — ${json.failed} failed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/outbox"] });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const drainFailed = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/outbox/drain", { onlyFailed: true }),
    onSuccess: async () => { queryClient.invalidateQueries({ queryKey: ["/api/outbox"] }); toast({ title: "Retried failed items" }); },
  });

  const drainOne = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", "/api/outbox/drain", { ids: [id] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/outbox"] }),
  });

  const deleteOne = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/outbox/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/outbox"] }),
  });

  const enqueueSheets = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/outbox/enqueue-sheets", {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/outbox"] }); toast({ title: "Sheet syncs queued" }); },
  });

  const items = data?.items ?? [];
  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);
  const summary = data?.summary ?? { pending: 0, failed: 0, uploading: 0, completed: 0, total: 0 };

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">
        <PageHeader
          icon={Inbox}
          iconAccent="bg-blue-100 text-blue-700"
          title="Admin Outbox"
          subtitle="All Drive uploads and Sheet syncs are queued here. Files are saved locally first, then uploaded with one click."
          actions={
            <Button
              onClick={() => drainAll.mutate()}
              disabled={drainAll.isPending || summary.pending + summary.failed === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-upload-all"
            >
              {drainAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudUpload className="h-4 w-4 mr-2" />}
              Upload All ({summary.pending + summary.failed})
            </Button>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            ["all", `All (${summary.total})`, "bg-slate-100 text-slate-800"],
            ["pending", `Pending (${summary.pending})`, STATUS_COLORS.pending],
            ["uploading", `Uploading (${summary.uploading})`, STATUS_COLORS.uploading],
            ["completed", `Completed (${summary.completed})`, STATUS_COLORS.completed],
            ["failed", `Failed (${summary.failed})`, STATUS_COLORS.failed],
          ] as const).map(([key, label, color]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-xl px-3 py-2 text-sm font-medium border ${
                filter === key ? "border-blue-500 bg-white shadow" : "border-transparent " + color
              }`}
              data-testid={`filter-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => drainFailed.mutate()} disabled={summary.failed === 0}>
            <RefreshCcw className="h-3.5 w-3.5 mr-2" />Retry Failed
          </Button>
          <Button variant="outline" size="sm" onClick={() => enqueueSheets.mutate()} data-testid="button-queue-sheets">
            <SheetIcon className="h-3.5 w-3.5 mr-2" />Queue Sheet Sync
          </Button>
          <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/outbox"] })}>
            <RefreshCcw className="h-3.5 w-3.5 mr-2" />Refresh
          </Button>
        </div>

        <Card className="rounded-2xl border border-white/60 bg-white/85 p-0 shadow overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Inbox className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              No items in this view.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left p-3">Item</th>
                  <th className="text-left p-3">Kind</th>
                  <th className="text-left p-3">Patient</th>
                  <th className="text-left p-3">Facility</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100" data-testid={`outbox-row-${item.id}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {item.kind === "drive_file" ? <FileText className="h-4 w-4 text-slate-400" /> : <SheetIcon className="h-4 w-4 text-slate-400" />}
                        <div>
                          <div className="font-medium text-slate-900 truncate max-w-[280px]">{item.filename ?? `${item.kind} #${item.id}`}</div>
                          {item.isTest && <Badge variant="secondary" className="text-[10px] mt-0.5">TEST</Badge>}
                          {item.errorText && <div className="text-xs text-rose-700 mt-1">{item.errorText}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-slate-600">{item.kind}</td>
                    <td className="p-3 text-slate-600">{item.patientName ?? "—"}</td>
                    <td className="p-3 text-slate-600">{item.facility ?? "—"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                        {item.status === "completed" && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                        {item.status === "failed" && <AlertCircle className="inline h-3 w-3 mr-1" />}
                        {STATUS_LABELS[item.status]}
                        {item.attempts > 0 && ` (${item.attempts}x)`}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {item.status !== "completed" && (
                        <Button size="sm" variant="ghost" onClick={() => drainOne.mutate(item.id)} disabled={drainOne.isPending} data-testid={`button-upload-${item.id}`}>
                          <CloudUpload className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {item.resultUrl && (
                        <a href={item.resultUrl} target="_blank" rel="noreferrer" className="text-blue-600 text-xs ml-2 underline">Open</a>
                      )}
                      {item.blobId && (
                        <a href={`/api/documents/blob/${item.blobId}/download`} target="_blank" rel="noreferrer" className="text-slate-600 text-xs ml-2 underline">Local</a>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => deleteOne.mutate(item.id)} className="text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="rounded-2xl border border-white/60 bg-white/85 p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-2">Recommended additional folders</h2>
          <p className="text-sm text-slate-600 mb-3">
            Each patient ancillary already gets: Report, Informed Consent, Screening Form, Order Note, Procedure Note, Billing Doc.
            Consider adding the following to capture the full longitudinal record:
          </p>
          <ul className="text-sm text-slate-700 list-disc pl-5 space-y-1">
            <li><b>Insurance Card</b> — front/back image and eligibility printouts.</li>
            <li><b>Patient Communication</b> — reminder texts, emails, call notes.</li>
            <li><b>Pathology / Lab Result</b> — third-party reports referenced by clinical decision.</li>
            <li><b>Pre-Procedure Note</b> — last-mile checklist before the test.</li>
            <li><b>Post-Procedure Follow-up</b> — outcome tracking, complications, repeat orders.</li>
          </ul>
          <p className="text-sm text-slate-600 mt-3">
            And at the facility level: <b>Templates</b>, <b>Compliance Archive</b>, <b>Test Data</b>.
          </p>
        </Card>
      </div>
    </div>
  );
}

// Exception Queue — Phase 3 PR 3.2 / 3.3.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchExceptions, postEvaluateAll, postEvaluate,
  type ExceptionRow,
  SEVERITY_TONE,
} from "@/lib/exceptionsApi";
import { ExceptionReviewPanel } from "@/components/exceptions/ExceptionReviewPanel";

const SEVERITY_TABS = ["all", "critical", "high", "medium", "low", "info"];

export default function ExceptionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [facility, setFacility] = useState("");
  const [severity, setSeverity] = useState("all");
  const [ownerRole, setOwnerRole] = useState("");
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState<number | null>(null);

  const filters = {
    facilityId: facility.trim() || undefined,
    severity: severity === "all" ? undefined : severity,
    ownerRole: ownerRole.trim() || undefined,
    status,
  };

  const { data: rows = [], isLoading } = useQuery<ExceptionRow[]>({
    queryKey: ["exceptions", filters],
    queryFn: () => fetchExceptions(filters),
  });

  const evalAllMut = useMutation({
    mutationFn: async () => postEvaluateAll(),
    onSuccess: (r) => {
      toast({ title: `Engine ran — detected ${r.detected}, refreshed ${r.refreshed}, superseded ${r.superseded}` });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
    },
    onError: (e: Error) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  const evalFacilityMut = useMutation({
    mutationFn: async () => postEvaluate({ facilityId: facility.trim() }),
    onSuccess: () => { toast({ title: "Facility evaluated" }); queryClient.invalidateQueries({ queryKey: ["exceptions"] }); },
    onError: (e: Error) => toast({ title: "Evaluation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="exceptions-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Exception Queue</h1>
          <p className="text-xs text-slate-500">
            Detected by the rule-first engine. Humans acknowledge,
            assign, dismiss, or resolve — AI does not execute.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="exceptions-facility-input" />
          <Input value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder="owner role" className="h-8 w-[120px] text-xs" data-testid="exceptions-owner-input" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 px-2 text-xs border rounded" data-testid="exceptions-status-select">
            {["open", "acknowledged", "in_review", "resolved", "dismissed", "superseded"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button size="sm" disabled={evalAllMut.isPending} onClick={() => evalAllMut.mutate()} data-testid="exceptions-evaluate-all">
            {evalAllMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Evaluate all
          </Button>
          <Button size="sm" variant="outline" disabled={!facility.trim() || evalFacilityMut.isPending} onClick={() => evalFacilityMut.mutate()} data-testid="exceptions-evaluate-facility">
            Evaluate facility
          </Button>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["exceptions"] })} data-testid="exceptions-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1">
        {SEVERITY_TABS.map((s) => (
          <button key={s} type="button" onClick={() => setSeverity(s)} className={`px-2 py-1 text-[10px] rounded ${severity === s ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`} data-testid={`exceptions-tab-${s}`}>
            {s} ({s === "all" ? rows.length : rows.filter((r) => r.severity === s).length})
          </button>
        ))}
      </div>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No exceptions match this filter. Trigger an evaluation above.</div>
        ) : (
          <table className="w-full text-xs" data-testid="exceptions-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Type</th>
                <th>Title</th>
                <th>Facility</th>
                <th>Severity</th>
                <th>Owner</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-slate-50 cursor-pointer ${selected === r.id ? "bg-slate-50" : ""}`} onClick={() => setSelected(r.id)} data-testid={`exception-row-${r.id}`}>
                  <td className="py-2">{r.exceptionType}</td>
                  <td>{r.title}</td>
                  <td>{r.facilityId ?? "—"}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${SEVERITY_TONE[r.severity] ?? ""}`}>{r.severity}</span></td>
                  <td>{r.recommendedOwnerRole ?? "—"}</td>
                  <td className="text-[10px] text-slate-500">{new Date(r.detectedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected != null && (
        <ExceptionReviewPanel exceptionId={selected} />
      )}
    </div>
  );
}

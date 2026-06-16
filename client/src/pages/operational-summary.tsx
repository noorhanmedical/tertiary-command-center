// /admin/operational-summary — Phase 3 PR 3.8.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { fetchOperationalSummary, type OperationalSummary } from "@/lib/operationalSummaryApi";

function CountTable({ title, rows, dataTestid }: { title: string; rows: Record<string, number>; dataTestid: string }) {
  const entries = Object.entries(rows ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Card className="p-3 bg-white" data-testid={dataTestid}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      {entries.length === 0 ? (
        <div className="text-xs text-slate-500 italic">no data</div>
      ) : (
        <ul className="space-y-1">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between text-xs"><span className="text-slate-700">{k}</span><span className="font-mono">{v}</span></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function OperationalSummaryPage() {
  const [facility, setFacility] = useState("");
  const { data, isLoading } = useQuery<OperationalSummary>({
    queryKey: ["operational-summary", facility],
    queryFn: () => fetchOperationalSummary(facility.trim() || undefined),
  });

  return (
    <div className="container mx-auto p-4 space-y-4" data-testid="operational-summary-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Operational Summary</h1>
          <p className="text-xs text-slate-500">
            Read-only aggregation of Phase 3 exception engine and recommendation log state. Refresh to recompute.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="operational-summary-facility-input" />
        </div>
      </header>

      {isLoading || !data ? (
        <Card className="p-3 bg-white"><div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Card>
      ) : (
        <>
          <Card className="p-3 bg-white text-[11px] text-slate-600 flex flex-wrap gap-2" data-testid="operational-summary-meta">
            <Badge variant="outline">v{data.version}</Badge>
            <span>generated {new Date(data.generatedAt).toLocaleString()}</span>
            <span>facility {data.scope.facilityId ?? "all"}</span>
            <span>safety provider: {data.safety.effectiveModelProvider}</span>
            <span>auto actions: {String(data.safety.autoActionsEnabled)}</span>
            <span>human review: {String(data.safety.humanReviewRequired)}</span>
          </Card>

          <div className="grid gap-3 md:grid-cols-3">
            <CountTable title="exceptions by status" rows={data.exceptions.totalByStatus} dataTestid="opsum-exception-status" />
            <CountTable title="exceptions by severity" rows={data.exceptions.bySeverity} dataTestid="opsum-exception-severity" />
            <CountTable title="exceptions by type" rows={data.exceptions.totalByType} dataTestid="opsum-exception-type" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-3 bg-white" data-testid="opsum-cycle-time">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">cycle time (hours)</div>
              <div className="text-xs">avg to acknowledge: <span className="font-mono">{data.exceptions.avgHoursToAcknowledge?.toFixed(1) ?? "—"}</span></div>
              <div className="text-xs">avg to resolve: <span className="font-mono">{data.exceptions.avgHoursToResolve?.toFixed(1) ?? "—"}</span></div>
            </Card>
            <Card className="p-3 bg-white" data-testid="opsum-acceptance">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">recommendation acceptance</div>
              <div className="text-xs">acceptance: <span className="font-mono">{data.recommendations.acceptanceRatePercent != null ? `${data.recommendations.acceptanceRatePercent}%` : "—"}</span></div>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <CountTable title="recommendations by status" rows={data.recommendations.totalByStatus} dataTestid="opsum-rec-status" />
            <CountTable title="recommendations by action" rows={data.recommendations.totalByAction} dataTestid="opsum-rec-action" />
            <CountTable title="recommendations by provider" rows={data.recommendations.totalByProvider} dataTestid="opsum-rec-provider" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-3 bg-white" data-testid="opsum-top-facilities">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">top facilities by open exceptions</div>
              {data.topFacilitiesByOpen.length === 0 ? (
                <div className="text-xs text-slate-500 italic">no data</div>
              ) : (
                <ul className="space-y-1">
                  {data.topFacilitiesByOpen.map((r) => (
                    <li key={r.facilityId ?? "(null)"} className="flex justify-between text-xs"><span className="text-slate-700">{r.facilityId ?? "(no facility)"}</span><span className="font-mono">{r.openCount}</span></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-3 bg-white" data-testid="opsum-top-detectors">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">top detectors by open exceptions</div>
              {data.topDetectorsByOpen.length === 0 ? (
                <div className="text-xs text-slate-500 italic">no data</div>
              ) : (
                <ul className="space-y-1">
                  {data.topDetectorsByOpen.map((r) => (
                    <li key={r.exceptionType} className="flex justify-between text-xs"><span className="text-slate-700">{r.exceptionType}</span><span className="font-mono">{r.openCount}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

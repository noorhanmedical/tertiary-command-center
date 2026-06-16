// ExceptionReviewPanel — Phase 3 PR 3.2 (minimal) → PR 3.3 (full).
//
// PR 3.2 shows the exception detail. PR 3.3 fills in acknowledge /
// assign / note / dismiss / resolve / reopen actions.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { fetchException, type ExceptionRow, SEVERITY_TONE } from "@/lib/exceptionsApi";

export function ExceptionReviewPanel({ exceptionId }: { exceptionId: number }) {
  const { data: ex, isLoading } = useQuery<ExceptionRow>({
    queryKey: ["exception", exceptionId],
    queryFn: () => fetchException(exceptionId),
  });

  if (isLoading || !ex) {
    return (
      <Card className="p-3 bg-white"><div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading exception…</div></Card>
    );
  }

  return (
    <Card className="p-4 bg-white" data-testid={`exception-detail-${exceptionId}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${SEVERITY_TONE[ex.severity] ?? ""}`}>{ex.severity}</span>
        <Badge variant="outline" className="text-[10px]">{ex.status}</Badge>
        <div className="text-sm font-semibold text-slate-900">{ex.title}</div>
      </div>
      <div className="text-[12px] text-slate-700 mb-2">{ex.explanation}</div>
      <div className="grid gap-2 sm:grid-cols-2 text-[11px] text-slate-600">
        <div>Type: {ex.exceptionType}</div>
        <div>Entity: {ex.entityType} #{ex.entityId ?? "—"}</div>
        <div>Facility: {ex.facilityId ?? "—"}</div>
        <div>Owner role: {ex.recommendedOwnerRole ?? "—"}</div>
        <div>Detected: {new Date(ex.detectedAt).toLocaleString()}</div>
        <div>Last seen: {new Date(ex.lastSeenAt).toLocaleString()}</div>
      </div>
      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer text-slate-500">source snapshot</summary>
        <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(ex.sourceSnapshot, null, 2)}</pre>
      </details>
      <details className="mt-2 text-[11px]">
        <summary className="cursor-pointer text-slate-500">policy snapshot</summary>
        <pre className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-auto">{JSON.stringify(ex.policySnapshot, null, 2)}</pre>
      </details>
    </Card>
  );
}

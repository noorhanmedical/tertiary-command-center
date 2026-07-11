// /call-priority — Phase 3 PR 3.7.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { fetchCallPriority, type CallPriorityResponse } from "@/lib/callPriorityApi";
import { SEVERITY_TONE } from "@/lib/exceptionsApi";
import { ExceptionReviewPanel } from "@/components/exceptions/ExceptionReviewPanel";

export default function CallPriorityPage() {
  const [facility, setFacility] = useState("");
  const [ownerRole, setOwnerRole] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading } = useQuery<CallPriorityResponse>({
    queryKey: ["call-priority", { facility, ownerRole }],
    queryFn: () => fetchCallPriority({
      facilityId: facility.trim() || undefined,
      ownerRole: ownerRole.trim() || undefined,
    }),
  });

  const items = data?.items ?? [];

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="call-priority-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Call Priority</h1>
          <p className="text-xs text-slate-500">
            Rule-ranked queue of open call-related exceptions. Score combines severity, age, and overdue facts.
            Humans still own the dial.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="call-priority-facility-input" />
          <Input value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} placeholder="owner role (pcs / acs)" className="h-8 w-[160px] text-xs" data-testid="call-priority-owner-input" />
        </div>
      </header>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-slate-500 italic" data-testid="call-priority-empty">
            No call-related exceptions match this filter.
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="call-priority-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Rank</th>
                <th>Score</th>
                <th>Severity</th>
                <th>Type</th>
                <th>Title</th>
                <th>Owner</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr
                  key={it.exception.id}
                  className={`border-b border-slate-50 cursor-pointer ${selected === it.exception.id ? "bg-slate-50" : ""}`}
                  onClick={() => setSelected(it.exception.id)}
                  data-testid={`call-priority-row-${it.exception.id}`}
                >
                  <td className="py-2">{idx + 1}</td>
                  <td><Badge variant="outline" className="text-[10px]" data-testid={`call-priority-score-${it.exception.id}`}>{it.score}</Badge></td>
                  <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${SEVERITY_TONE[it.exception.severity] ?? ""}`}>{it.exception.severity}</span></td>
                  <td>{it.exception.exceptionType}</td>
                  <td>{it.exception.title}</td>
                  <td>{it.exception.recommendedOwnerRole ?? "—"}</td>
                  <td className="text-[10px] text-slate-500">{it.reasons.join(" · ")}</td>
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

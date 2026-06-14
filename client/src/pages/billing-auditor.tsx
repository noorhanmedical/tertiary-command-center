// Billing auditor worklist — Phase 4 PR 4.7.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  fetchWorklistSummary, fetchWorklistItems,
  QUEUE_LABELS,
  type WorklistQueueId, type WorklistSummary, type WorklistItem,
} from "@/lib/billingAuditorApi";

export default function BillingAuditorPage() {
  const [facility, setFacility] = useState("");
  const [queueId, setQueueId] = useState<WorklistQueueId>("ready_to_invoice");

  const { data: summary, isLoading: summaryLoading } = useQuery<WorklistSummary>({
    queryKey: ["billing-auditor-summary", facility],
    queryFn: () => fetchWorklistSummary(facility.trim() || undefined),
  });

  const { data: items, isLoading: itemsLoading } = useQuery<{ queueId: WorklistQueueId; items: WorklistItem[] }>({
    queryKey: ["billing-auditor-worklist", queueId, facility],
    queryFn: () => fetchWorklistItems(queueId, facility.trim() || undefined),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="billing-auditor-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Billing auditor</h1>
          <p className="text-xs text-slate-500">
            Operational queues across readiness, batches, drafts,
            delivery, payments, and denials. Read-only aggregation —
            actions link back to the canonical surfaces.
          </p>
        </div>
        <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="auditor-facility-input" />
      </header>

      <div className="flex flex-wrap gap-1">
        {summary?.queues.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQueueId(q)}
            className={`px-2 py-1 text-[10px] rounded ${queueId === q ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`}
            data-testid={`auditor-tab-${q}`}
          >
            {QUEUE_LABELS[q]} ({summary.summary[q] ?? 0})
          </button>
        ))}
        {summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </div>

      <Card className="p-4 bg-white">
        {itemsLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (items?.items ?? []).length === 0 ? (
          <div className="text-xs text-slate-500 italic">No items in this queue.</div>
        ) : (
          <table className="w-full text-xs" data-testid="auditor-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Item</th>
                <th>Facility</th>
                <th>Service</th>
                <th>Reason</th>
                <th>Detail</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(items?.items ?? []).map((it) => (
                <tr key={`${it.queueId}-${it.itemId}`} className="border-b border-slate-50" data-testid={`auditor-row-${it.queueId}-${it.itemId}`}>
                  <td className="py-2">{it.label}</td>
                  <td>{it.facilityId ?? "—"}</td>
                  <td>{it.testType ?? "—"}</td>
                  <td>{it.reason ?? "—"}</td>
                  <td>{it.detail ?? "—"}</td>
                  <td className="text-[10px] text-slate-500">{it.createdAt ? new Date(it.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

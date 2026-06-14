// Invoice batch builder — Phase 4 PR 4.3.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchInvoiceBatches, postInvoiceBatchPreview, fetchInvoiceBatch, voidInvoiceBatch,
  type InvoiceBatchRow, type InvoiceBatchItemRow,
} from "@/lib/invoiceBatchesApi";

function statusTone(s: string): "default" | "secondary" | "outline" {
  if (s === "invoice_drafts_created") return "default";
  if (s === "ready_for_review") return "secondary";
  return "outline";
}

export default function InvoiceBatchesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [facility, setFacility] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const { data: batches = [], isLoading } = useQuery<InvoiceBatchRow[]>({
    queryKey: ["invoice-batches", facility],
    queryFn: () => fetchInvoiceBatches({ facilityId: facility.trim() || undefined }),
  });

  const { data: detail } = useQuery<{ batch: InvoiceBatchRow; items: InvoiceBatchItemRow[] }>({
    queryKey: ["invoice-batch-detail", selected],
    queryFn: () => fetchInvoiceBatch(selected as number),
    enabled: selected != null,
  });

  const previewMutation = useMutation({
    mutationFn: async () =>
      postInvoiceBatchPreview({
        facilityId: facility.trim(),
        invoicePeriodStart: periodStart.trim() || undefined,
        invoicePeriodEnd: periodEnd.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast({ title: `Preview built — batch #${r.batchId}, ${r.itemCount} included, ${r.blockedCount} blocked` });
      queryClient.invalidateQueries({ queryKey: ["invoice-batches"] });
      setSelected(r.batchId);
    },
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: async (id: number) => voidInvoiceBatch(id),
    onSuccess: () => {
      toast({ title: "Batch voided" });
      queryClient.invalidateQueries({ queryKey: ["invoice-batches"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-batch-detail"] });
    },
    onError: (err: Error) => toast({ title: "Void failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="invoice-batches-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Invoice batches</h1>
          <p className="text-xs text-slate-500">
            Policy-driven previews. Items come from readiness snapshots
            (PR 4.2); the builder never invents data.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="batch-facility-input" />
          <Input value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} placeholder="YYYY-MM-DD" className="h-8 w-[120px] text-xs" data-testid="batch-period-start" />
          <Input value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder="YYYY-MM-DD" className="h-8 w-[120px] text-xs" data-testid="batch-period-end" />
          <Button
            size="sm"
            disabled={!facility.trim() || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
            data-testid="batch-build-preview"
          >
            {previewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Build preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["invoice-batches"] })} data-testid="batch-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : batches.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No batches yet. Use Build preview above.</div>
        ) : (
          <table className="w-full text-xs" data-testid="batch-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Batch</th>
                <th>Facility</th>
                <th>Period</th>
                <th>Status</th>
                <th>Items</th>
                <th>Blocked</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-slate-50 cursor-pointer ${selected === b.id ? "bg-slate-50" : ""}`}
                  onClick={() => setSelected(b.id)}
                  data-testid={`batch-row-${b.id}`}
                >
                  <td className="py-2">#{b.id}</td>
                  <td>{b.facilityId}</td>
                  <td>{b.invoicePeriodStart} → {b.invoicePeriodEnd}</td>
                  <td><Badge variant={statusTone(b.batchStatus)} className="text-[10px]">{b.batchStatus}</Badge></td>
                  <td>{b.itemCount}</td>
                  <td>{b.blockedCount}</td>
                  <td>${(b.totals?.totalCharges ?? 0).toFixed(2)}</td>
                  <td>
                    {b.batchStatus !== "voided" && b.batchStatus !== "invoice_drafts_created" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); voidMutation.mutate(b.id); }}
                        data-testid={`batch-void-${b.id}`}
                      >
                        Void
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected != null && detail ? (
        <Card className="p-4 bg-white" data-testid={`batch-detail-${selected}`}>
          <div className="text-sm font-semibold text-slate-900 mb-2">Batch #{detail.batch.id} — items</div>
          {detail.items.length === 0 ? (
            <div className="text-xs text-slate-500 italic">No items in this batch.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                  <th className="py-2">Patient</th>
                  <th>Service</th>
                  <th>Price</th>
                  <th>Line</th>
                  <th>Blockers</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-50" data-testid={`batch-item-${i.id}`}>
                    <td className="py-2">{i.patientName ?? "—"}</td>
                    <td>{i.testType}</td>
                    <td>{i.price ? `$${i.price}` : "—"}</td>
                    <td><Badge variant={i.lineStatus === "included" ? "default" : "outline"} className="text-[10px]">{i.lineStatus}</Badge></td>
                    <td className="text-[10px] text-slate-500">{(i.blockers ?? []).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

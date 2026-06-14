// Invoice Draft Review — Phase 4 PR 4.4.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  postCreateDraftsFromBatch,
  submitInvoiceForReview, approveInvoice, voidInvoice, reviseInvoice,
} from "@/lib/invoiceApprovalApi";

type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  facility: string;
  totalCharges: string;
  totalBalance: string;
  approvalStatus?: string;
  deliveryStatus?: string;
  dueDate?: string | null;
};

async function fetchInvoicesAll(): Promise<InvoiceRow[]> {
  const res = await fetch(`/api/invoices`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function approvalTone(s: string | undefined): "default" | "secondary" | "outline" {
  if (s === "approved") return "default";
  if (s === "pending_review") return "secondary";
  return "outline";
}

export default function InvoiceReviewPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [batchId, setBatchId] = useState("");
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const { data: invoices = [], isLoading } = useQuery<InvoiceRow[]>({
    queryKey: ["invoices-all"],
    queryFn: fetchInvoicesAll,
  });

  const createDraftsMut = useMutation({
    mutationFn: async () => postCreateDraftsFromBatch(parseInt(batchId, 10)),
    onSuccess: (r: any) => {
      toast({ title: `Draft created — invoice #${r.invoiceId} (${r.lineCount} line items)` });
      queryClient.invalidateQueries({ queryKey: ["invoices-all"] });
      setBatchId("");
    },
    onError: (e: Error) => toast({ title: "Could not create drafts", description: e.message, variant: "destructive" }),
  });

  const txMut = useMutation({
    mutationFn: async (args: { transition: string; id: number; reason?: string }) => {
      if (args.transition === "submit_for_review") return submitInvoiceForReview(args.id);
      if (args.transition === "approve") return approveInvoice(args.id);
      if (args.transition === "void") return voidInvoice(args.id, args.reason ?? "");
      if (args.transition === "revise") return reviseInvoice(args.id);
      throw new Error("unknown transition");
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["invoices-all"] });
      setVoidingId(null);
      setVoidReason("");
    },
    onError: (e: Error) => toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="invoice-review-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Invoice review</h1>
          <p className="text-xs text-slate-500">
            Submit drafts, approve, revise, or void. Approval is
            required before delivery (PR 4.5).
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="batch id" className="h-8 w-[120px] text-xs" data-testid="invoice-batch-id-input" />
          <Button
            size="sm"
            disabled={!batchId || createDraftsMut.isPending}
            onClick={() => createDraftsMut.mutate()}
            data-testid="invoice-create-drafts"
          >
            {createDraftsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Create drafts from batch
          </Button>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["invoices-all"] })} data-testid="invoice-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No invoices yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Number</th>
                <th>Facility</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Approval</th>
                <th>Delivery</th>
                <th>Due</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-50" data-testid={`invoice-row-${inv.id}`}>
                  <td className="py-2">{inv.invoiceNumber}</td>
                  <td>{inv.facility}</td>
                  <td>${inv.totalCharges}</td>
                  <td>${inv.totalBalance}</td>
                  <td><Badge variant={approvalTone(inv.approvalStatus)} className="text-[10px]">{inv.approvalStatus ?? "draft"}</Badge></td>
                  <td>{inv.deliveryStatus ?? "pending"}</td>
                  <td>{inv.dueDate ?? "—"}</td>
                  <td className="flex flex-wrap gap-1 py-1">
                    {(inv.approvalStatus ?? "draft") === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => txMut.mutate({ transition: "submit_for_review", id: inv.id })} data-testid={`invoice-submit-${inv.id}`}>Submit</Button>
                    )}
                    {inv.approvalStatus === "pending_review" && (
                      <>
                        <Button size="sm" onClick={() => txMut.mutate({ transition: "approve", id: inv.id })} data-testid={`invoice-approve-${inv.id}`}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => txMut.mutate({ transition: "revise", id: inv.id })} data-testid={`invoice-revise-${inv.id}`}>Revise</Button>
                      </>
                    )}
                    {inv.approvalStatus !== "voided" && (
                      <Button size="sm" variant="ghost" onClick={() => setVoidingId(inv.id)} data-testid={`invoice-void-${inv.id}`}>Void…</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {voidingId != null && (
        <Card className="p-4 bg-white" data-testid="invoice-void-dialog">
          <div className="text-sm font-semibold text-slate-900 mb-2">Void invoice #{voidingId}</div>
          <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="reason (required)" className="text-xs" data-testid="invoice-void-reason" />
          <div className="mt-2 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setVoidingId(null); setVoidReason(""); }}>Cancel</Button>
            <Button
              size="sm"
              disabled={!voidReason.trim() || txMut.isPending}
              onClick={() => txMut.mutate({ transition: "void", id: voidingId!, reason: voidReason.trim() })}
              data-testid="invoice-void-confirm"
            >
              Void
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

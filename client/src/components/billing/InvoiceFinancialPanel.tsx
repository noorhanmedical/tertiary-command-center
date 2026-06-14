// InvoiceFinancialPanel — Phase 4 PR 4.6.
//
// Renders the payment/adjustment/denial/remittance history of an
// invoice + inline forms for posting new entries.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchFinancialEvents, postPayment, postAdjustment, postDenial, postRemittance, patchDenialStatus,
  type FinancialEventsResponse,
} from "@/lib/invoiceFinancialApi";

type Props = { invoiceId: number };

export function InvoiceFinancialPanel({ invoiceId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<FinancialEventsResponse>({
    queryKey: ["invoice-financial-events", invoiceId],
    queryFn: () => fetchFinancialEvents(invoiceId),
  });

  const [pmt, setPmt] = useState({ amount: "", method: "Check", reference: "" });
  const [adj, setAdj] = useState({ amount: "", type: "manual", reason: "" });
  const [den, setDen] = useState({ code: "", reason: "", payer: "" });

  const inv = (k: ReadonlyArray<string | number>) => queryClient.invalidateQueries({ queryKey: k });

  const paymentMut = useMutation({
    mutationFn: async () =>
      postPayment(invoiceId, { amount: Number(pmt.amount), paymentMethod: pmt.method, reference: pmt.reference || undefined }),
    onSuccess: () => { toast({ title: "Payment posted" }); inv(["invoice-financial-events", invoiceId]); inv(["invoices-all"]); setPmt({ amount: "", method: "Check", reference: "" }); },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });
  const adjustMut = useMutation({
    mutationFn: async () =>
      postAdjustment(invoiceId, { adjustmentType: adj.type, amount: Number(adj.amount), reason: adj.reason || undefined }),
    onSuccess: () => { toast({ title: "Adjustment posted" }); inv(["invoice-financial-events", invoiceId]); inv(["invoices-all"]); setAdj({ amount: "", type: "manual", reason: "" }); },
    onError: (e: Error) => toast({ title: "Adjustment failed", description: e.message, variant: "destructive" }),
  });
  const denialMut = useMutation({
    mutationFn: async () =>
      postDenial(invoiceId, { denialCode: den.code || undefined, denialReason: den.reason || undefined, payer: den.payer || undefined }),
    onSuccess: () => { toast({ title: "Denial logged" }); inv(["invoice-financial-events", invoiceId]); setDen({ code: "", reason: "", payer: "" }); },
    onError: (e: Error) => toast({ title: "Denial failed", description: e.message, variant: "destructive" }),
  });
  const remitMut = useMutation({
    mutationFn: async () => postRemittance(invoiceId, {}),
    onSuccess: () => { toast({ title: "Remittance noted" }); inv(["invoice-financial-events", invoiceId]); },
    onError: (e: Error) => toast({ title: "Remittance failed", description: e.message, variant: "destructive" }),
  });

  const denialStatusMut = useMutation({
    mutationFn: async (args: { id: number; status: string }) => patchDenialStatus(args.id, args.status),
    onSuccess: () => { inv(["invoice-financial-events", invoiceId]); },
    onError: (e: Error) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <Card className="p-3 bg-white"><div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Card>
    );
  }

  return (
    <div className="space-y-3" data-testid={`invoice-financial-panel-${invoiceId}`}>
      <Card className="p-3 bg-white">
        <div className="text-sm font-semibold text-slate-900 mb-2">Post payment</div>
        <div className="flex flex-wrap gap-2">
          <Input value={pmt.amount} onChange={(e) => setPmt({ ...pmt, amount: e.target.value })} placeholder="amount" className="h-8 w-[120px] text-xs" data-testid="payment-amount" />
          <Input value={pmt.method} onChange={(e) => setPmt({ ...pmt, method: e.target.value })} placeholder="method" className="h-8 w-[100px] text-xs" data-testid="payment-method" />
          <Input value={pmt.reference} onChange={(e) => setPmt({ ...pmt, reference: e.target.value })} placeholder="reference" className="h-8 w-[160px] text-xs" data-testid="payment-reference" />
          <Button size="sm" disabled={!pmt.amount || paymentMut.isPending} onClick={() => paymentMut.mutate()} data-testid="payment-submit">Post</Button>
        </div>
      </Card>

      <Card className="p-3 bg-white">
        <div className="text-sm font-semibold text-slate-900 mb-2">Post adjustment</div>
        <div className="flex flex-wrap gap-2">
          <Input value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} placeholder="amount" className="h-8 w-[120px] text-xs" data-testid="adjustment-amount" />
          <select value={adj.type} onChange={(e) => setAdj({ ...adj, type: e.target.value })} className="h-8 px-2 text-xs border rounded" data-testid="adjustment-type">
            {["write_off", "contractual", "correction", "discount", "dispute_hold", "manual"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="reason" className="h-8 w-[200px] text-xs" data-testid="adjustment-reason" />
          <Button size="sm" disabled={!adj.amount || adjustMut.isPending} onClick={() => adjustMut.mutate()} data-testid="adjustment-submit">Post</Button>
        </div>
      </Card>

      <Card className="p-3 bg-white">
        <div className="text-sm font-semibold text-slate-900 mb-2">Log denial</div>
        <div className="flex flex-wrap gap-2">
          <Input value={den.code} onChange={(e) => setDen({ ...den, code: e.target.value })} placeholder="code" className="h-8 w-[100px] text-xs" data-testid="denial-code" />
          <Input value={den.reason} onChange={(e) => setDen({ ...den, reason: e.target.value })} placeholder="reason" className="h-8 w-[220px] text-xs" data-testid="denial-reason" />
          <Input value={den.payer} onChange={(e) => setDen({ ...den, payer: e.target.value })} placeholder="payer" className="h-8 w-[120px] text-xs" data-testid="denial-payer" />
          <Button size="sm" disabled={!den.reason || denialMut.isPending} onClick={() => denialMut.mutate()} data-testid="denial-submit">Log</Button>
          <Button size="sm" variant="outline" disabled={remitMut.isPending} onClick={() => remitMut.mutate()} data-testid="remittance-submit">Note remittance</Button>
        </div>
      </Card>

      <Card className="p-3 bg-white">
        <div className="text-sm font-semibold text-slate-900 mb-2">History</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Payments ({data.payments.length})</div>
            <ul className="text-[11px] space-y-1">
              {data.payments.map((p) => <li key={p.id} data-testid={`payment-row-${p.id}`}>${p.amount} · {p.paymentMethod} · {p.paymentDate}</li>)}
              {data.payments.length === 0 ? <li className="italic text-slate-500">none</li> : null}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Adjustments ({data.adjustments.length})</div>
            <ul className="text-[11px] space-y-1">
              {data.adjustments.map((a) => <li key={a.id} data-testid={`adjustment-row-${a.id}`}>${a.amount} · {a.adjustmentType} · {a.reason ?? "—"}</li>)}
              {data.adjustments.length === 0 ? <li className="italic text-slate-500">none</li> : null}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Denials ({data.denials.length})</div>
            <ul className="text-[11px] space-y-1">
              {data.denials.map((d) => (
                <li key={d.id} className="flex items-center gap-1" data-testid={`denial-row-${d.id}`}>
                  <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                  <span>{d.denialCode ?? "—"} · {d.denialReason ?? "—"}</span>
                  <select
                    value={d.status}
                    onChange={(e) => denialStatusMut.mutate({ id: d.id, status: e.target.value })}
                    className="h-6 px-1 text-[10px] border rounded"
                    data-testid={`denial-status-select-${d.id}`}
                  >
                    {["open", "appealed", "overturned", "upheld", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </li>
              ))}
              {data.denials.length === 0 ? <li className="italic text-slate-500">none</li> : null}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Remittances ({data.remittances.length})</div>
            <ul className="text-[11px] space-y-1">
              {data.remittances.map((r) => <li key={r.id} data-testid={`remittance-row-${r.id}`}>{r.eventType} · {r.payer ?? "—"} · {r.amount ? `$${r.amount}` : "—"}</li>)}
              {data.remittances.length === 0 ? <li className="italic text-slate-500">none</li> : null}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Invoice Delivery Queue — Phase 4 PR 4.5.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Send, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchDeliveryQueue, fetchDeliveryEvents,
  queueInvoice, sendInvoiceEmail, sendInvoiceReminder,
  type InvoiceQueueRow, type DeliveryEvent,
} from "@/lib/invoiceDeliveryApi";

function tone(s: string | undefined): "default" | "secondary" | "outline" {
  if (s === "sent") return "default";
  if (s === "queued" || s === "ready_to_send") return "secondary";
  return "outline";
}

const STATUS_TABS = ["all", "ready_to_send", "queued", "sent", "failed", "download_only", "blocked_missing_recipient", "blocked_not_approved", "pending"];

export default function InvoiceDeliveryPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);

  const { data: queue = [], isLoading } = useQuery<InvoiceQueueRow[]>({
    queryKey: ["invoice-delivery-queue"],
    queryFn: fetchDeliveryQueue,
  });

  const { data: events = [] } = useQuery<DeliveryEvent[]>({
    queryKey: ["invoice-delivery-events", selected],
    queryFn: () => fetchDeliveryEvents(selected as number),
    enabled: selected != null,
  });

  const filtered = useMemo(() => {
    if (tab === "all") return queue;
    return queue.filter((r) => (r.deliveryStatus ?? "pending") === tab);
  }, [queue, tab]);

  const queueMut = useMutation({
    mutationFn: async (id: number) => queueInvoice(id),
    onSuccess: () => { toast({ title: "Queued" }); queryClient.invalidateQueries({ queryKey: ["invoice-delivery-queue"] }); },
    onError: (e: Error) => toast({ title: "Queue failed", description: e.message, variant: "destructive" }),
  });
  const sendMut = useMutation({
    mutationFn: async (id: number) => sendInvoiceEmail(id),
    onSuccess: () => { toast({ title: "Sent" }); queryClient.invalidateQueries({ queryKey: ["invoice-delivery-queue"] }); },
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });
  const remindMut = useMutation({
    mutationFn: async (id: number) => sendInvoiceReminder(id),
    onSuccess: () => { toast({ title: "Reminder sent" }); queryClient.invalidateQueries({ queryKey: ["invoice-delivery-queue"] }); },
    onError: (e: Error) => toast({ title: "Reminder failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="invoice-delivery-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Invoice delivery</h1>
          <p className="text-xs text-slate-500">
            Approval-gated delivery. Sends are blocked until the
            invoice is approved and a recipient is resolvable from
            the recipient snapshot.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["invoice-delivery-queue"] })} data-testid="delivery-refresh">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </header>

      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTab(s)}
            className={`px-2 py-1 text-[10px] rounded ${tab === s ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`}
            data-testid={`delivery-tab-${s}`}
          >
            {s} ({s === "all" ? queue.length : queue.filter((r) => (r.deliveryStatus ?? "pending") === s).length})
          </button>
        ))}
      </div>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No invoices in this delivery state.</div>
        ) : (
          <table className="w-full text-xs" data-testid="delivery-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Invoice</th>
                <th>Facility</th>
                <th>Approval</th>
                <th>Delivery</th>
                <th>Sent to</th>
                <th>Sent at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-b border-slate-50 cursor-pointer ${selected === r.id ? "bg-slate-50" : ""}`} onClick={() => setSelected(r.id)} data-testid={`delivery-row-${r.id}`}>
                  <td className="py-2">{r.invoiceNumber}</td>
                  <td>{r.facility}</td>
                  <td><Badge variant={tone(r.approvalStatus)} className="text-[10px]">{r.approvalStatus ?? "draft"}</Badge></td>
                  <td><Badge variant={tone(r.deliveryStatus)} className="text-[10px]">{r.deliveryStatus ?? "pending"}</Badge></td>
                  <td>{r.sentTo ?? "—"}</td>
                  <td className="text-[10px] text-slate-500">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                  <td className="flex flex-wrap gap-1 py-1">
                    {r.approvalStatus === "approved" && r.deliveryStatus !== "sent" && (
                      <>
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); queueMut.mutate(r.id); }} data-testid={`delivery-queue-${r.id}`}>Queue</Button>
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); sendMut.mutate(r.id); }} data-testid={`delivery-send-${r.id}`}>
                          <Send className="h-3 w-3 mr-1" /> Send
                        </Button>
                      </>
                    )}
                    {r.deliveryStatus === "sent" && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); remindMut.mutate(r.id); }} data-testid={`delivery-remind-${r.id}`}>
                        <Mail className="h-3 w-3 mr-1" /> Reminder
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected != null && events.length > 0 && (
        <Card className="p-4 bg-white" data-testid={`delivery-events-${selected}`}>
          <div className="text-sm font-semibold text-slate-900 mb-2">Events for invoice #{selected}</div>
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[11px] text-slate-700 flex items-center gap-2" data-testid={`delivery-event-${e.id}`}>
                <Badge variant="outline" className="text-[10px]">{e.eventType}</Badge>
                <span>{new Date(e.createdAt).toLocaleString()}</span>
                {e.errorMessage ? <span className="text-rose-700">— {e.errorMessage}</span> : null}
                {e.messageId ? <span className="text-slate-500">· id {e.messageId}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

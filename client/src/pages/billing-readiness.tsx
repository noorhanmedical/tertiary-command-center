// Billing readiness queue — Phase 4 PR 4.2.
//
// Admin/biller-gated page that lists per-(case, testType)
// readiness snapshots emitted by the engine. Filters by facility,
// testType, status, and blocker. Shows blockers as chips.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchInvoiceReadiness,
  postEvaluateFacility,
  type InvoiceReadinessSnapshotRow,
  BLOCKER_LABELS,
} from "@/lib/invoiceReadinessApi";

function statusTone(s: string): "default" | "secondary" | "outline" {
  if (s === "ready_to_invoice") return "default";
  if (s === "blocked") return "secondary";
  return "outline";
}

const STATUS_OPTIONS = ["", "ready_to_invoice", "blocked", "not_ready", "excluded", "invoice_draft_created", "invoiced"];
const BLOCKER_OPTIONS = Object.keys(BLOCKER_LABELS);

export default function BillingReadinessPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [facility, setFacility] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [status, setStatus] = useState("");
  const [selectedBlocker, setSelectedBlocker] = useState("");

  const filters = {
    facilityId: facility.trim() || undefined,
    serviceType: serviceType.trim() || undefined,
    readinessStatus: status.trim() || undefined,
    blockersIncludeAny: selectedBlocker ? [selectedBlocker] : undefined,
  };

  const { data: rows = [], isLoading, isError } = useQuery<InvoiceReadinessSnapshotRow[]>({
    queryKey: ["invoice-readiness", filters],
    queryFn: () => fetchInvoiceReadiness(filters),
  });

  const evalFacility = useMutation({
    mutationFn: async (facilityId: string) => postEvaluateFacility({ facilityId }),
    onSuccess: (result) => {
      toast({ title: `Evaluated ${result.evaluated} cases` });
      queryClient.invalidateQueries({ queryKey: ["invoice-readiness"] });
    },
    onError: (err: Error) => toast({ title: "Evaluation failed", description: err.message, variant: "destructive" }),
  });

  const totals = useMemo(() => {
    const out: Record<string, number> = { ready_to_invoice: 0, blocked: 0, not_ready: 0, excluded: 0 };
    for (const r of rows) {
      out[r.readinessStatus] = (out[r.readinessStatus] ?? 0) + 1;
    }
    return out;
  }, [rows]);

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="billing-readiness-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Billing readiness</h1>
          <p className="text-xs text-slate-500">
            Per-(case, testType) snapshots emitted by the readiness
            engine. Blockers come from the canonical document /
            billing / procedure / policy sources — no faked states.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id" className="h-8 w-[140px] text-xs" data-testid="readiness-facility-input" />
          <Input value={serviceType} onChange={(e) => setServiceType(e.target.value)} placeholder="testType" className="h-8 w-[120px] text-xs" data-testid="readiness-service-input" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 px-2 text-xs border rounded" data-testid="readiness-status-select">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || "(any status)"}</option>)}
          </select>
          <select value={selectedBlocker} onChange={(e) => setSelectedBlocker(e.target.value)} className="h-8 px-2 text-xs border rounded" data-testid="readiness-blocker-select">
            <option value="">(any blocker)</option>
            {BLOCKER_OPTIONS.map((b) => <option key={b} value={b}>{BLOCKER_LABELS[b]}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["invoice-readiness"] })} data-testid="readiness-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            size="sm"
            disabled={!facility.trim() || evalFacility.isPending}
            onClick={() => evalFacility.mutate(facility.trim())}
            data-testid="readiness-evaluate-facility"
          >
            {evalFacility.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Evaluate facility
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(totals).map(([k, v]) => (
          <Badge key={k} variant={statusTone(k)} className="text-[11px]" data-testid={`readiness-count-${k}`}>{k}: {v}</Badge>
        ))}
      </div>

      <Card className="p-4 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-xs text-rose-700"><AlertCircle className="h-4 w-4" /> Failed to load readiness snapshots.</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No readiness snapshots match this filter. Trigger a facility evaluation above.</div>
        ) : (
          <table className="w-full text-xs" data-testid="readiness-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b">
                <th className="py-2">Patient</th>
                <th>Facility</th>
                <th>Service</th>
                <th>Status</th>
                <th>Blockers</th>
                <th>Price</th>
                <th>Evaluated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50" data-testid={`readiness-row-${r.id}`}>
                  <td className="py-2">{r.patientName ?? "—"}{r.patientDob ? ` · ${r.patientDob}` : ""}</td>
                  <td>{r.facilityId ?? "—"}</td>
                  <td>{r.serviceType}</td>
                  <td><Badge variant={statusTone(r.readinessStatus)} className="text-[10px]">{r.readinessStatus}</Badge></td>
                  <td className="flex flex-wrap gap-1 py-1">
                    {(r.blockers ?? []).map((b) => (
                      <span key={b} className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-900 text-[10px]" data-testid={`readiness-blocker-${r.id}-${b}`}>{BLOCKER_LABELS[b] ?? b}</span>
                    ))}
                  </td>
                  <td>{r.unitPrice ? `$${r.unitPrice}` : "—"}</td>
                  <td className="text-[10px] text-slate-500">{new Date(r.evaluatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

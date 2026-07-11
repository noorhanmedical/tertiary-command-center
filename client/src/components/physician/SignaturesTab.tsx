import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenLine, Undo2, AlertTriangle, FileWarning, Loader2 } from "lucide-react";

interface SignatureItem {
  id: number;
  patientScreeningId: number | null;
  serviceType: string;
  noteType: string;
  signatureStatus: string;
  patientName: string | null;
  patientDob: string | null;
  patientAge: number | null;
  patientGender: string | null;
  patientInsurance: string | null;
  patientFacility: string | null;
  reportUploaded: boolean;
  billingStatus: string;
  billingBlocked: boolean;
  signable: boolean;
  returnReason: string | null;
  flags: { missingReport: boolean; notSignable: boolean; billingBlocked: boolean };
}

const SERVICE_TYPES = ["BrainWave", "VitalWave", "Ultrasound", "PGx"];
const STATUS_LABELS: Record<string, string> = {
  needs_signature: "Needs Signature",
  ready_to_sign: "Ready to Sign",
  signed: "Signed",
  returned_for_correction: "Returned",
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "signed") return "default";
  if (status === "returned_for_correction") return "destructive";
  if (status === "ready_to_sign") return "secondary";
  return "outline";
}

export function SignaturesTab() {
  const { toast } = useToast();
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [returnTarget, setReturnTarget] = useState<SignatureItem | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [busy, setBusy] = useState(false);

  const queryParams = new URLSearchParams();
  if (serviceFilter !== "all") queryParams.set("serviceType", serviceFilter);
  if (statusFilter !== "all") queryParams.set("signatureStatus", statusFilter);
  const qs = queryParams.toString();

  const { data: items = [], isLoading } = useQuery<SignatureItem[]>({
    queryKey: ["/api/physician-portal/signature-items", serviceFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/physician-portal/signature-items${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load signature items");
      return res.json();
    },
  });

  const signableSelected = useMemo(
    () => items.filter((i) => selected.has(i.id) && i.signable).map((i) => i.id),
    [items, selected],
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/signature-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/financial-health"] });
  }

  async function signOne(item: SignatureItem) {
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/physician-portal/signature-items/${item.id}/sign`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to sign");
      }
      toast({ title: "Note signed", description: `${item.patientName ?? "Patient"} · ${item.serviceType}` });
      setSelected((s) => { const n = new Set(s); n.delete(item.id); return n; });
      invalidate();
    } catch (e: any) {
      toast({ title: "Sign failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function bulkSign() {
    if (signableSelected.length === 0) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/physician-portal/signature-items/bulk-sign", {
        ids: signableSelected,
      });
      const data = await res.json();
      toast({
        title: `Signed ${data.signed?.length ?? 0} note(s)`,
        description: data.skipped?.length ? `${data.skipped.length} skipped` : undefined,
      });
      setSelected(new Set());
      invalidate();
    } catch (e: any) {
      toast({ title: "Bulk sign failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn() {
    if (!returnTarget || !returnReason.trim()) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", `/api/physician-portal/signature-items/${returnTarget.id}/return`, {
        reason: returnReason.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to return");
      }
      toast({ title: "Returned for correction" });
      setReturnTarget(null);
      setReturnReason("");
      invalidate();
    } catch (e: any) {
      toast({ title: "Return failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(items.filter((i) => i.signable).map((i) => i.id)));
    else setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-signature-service">
            <SelectValue placeholder="Service type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {SERVICE_TYPES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-signature-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="needs_signature">Needs Signature</SelectItem>
            <SelectItem value="ready_to_sign">Ready to Sign</SelectItem>
            <SelectItem value="returned_for_correction">Returned</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button
            onClick={bulkSign}
            disabled={busy || signableSelected.length === 0}
            data-testid="button-bulk-sign"
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenLine className="w-4 h-4 mr-2" />}
            Sign selected ({signableSelected.length})
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={items.length > 0 && selected.size === items.filter((i) => i.signable).length && selected.size > 0}
                  onCheckedChange={(c) => toggleAll(!!c)}
                  data-testid="checkbox-select-all"
                />
              </TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground" data-testid="text-signatures-empty">No notes awaiting signature.</TableCell></TableRow>
            ) : items.map((item) => (
              <TableRow key={item.id} data-testid={`row-signature-${item.id}`}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(item.id)}
                    disabled={!item.signable}
                    onCheckedChange={(c) => setSelected((s) => {
                      const n = new Set(s);
                      if (c) n.add(item.id); else n.delete(item.id);
                      return n;
                    })}
                    data-testid={`checkbox-signature-${item.id}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium" data-testid={`text-patient-${item.id}`}>{item.patientName ?? "Unknown"}</div>
                  <div className="text-xs text-muted-foreground">
                    {[item.patientAge != null ? `${item.patientAge}y` : null, item.patientGender, item.patientInsurance].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline">{item.serviceType}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.noteType?.replace(/_/g, " ")}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(item.signatureStatus)} data-testid={`status-signature-${item.id}`}>
                    {STATUS_LABELS[item.signatureStatus] ?? item.signatureStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.flags.missingReport && (
                      <Badge variant="destructive" className="gap-1"><FileWarning className="w-3 h-3" />No report</Badge>
                    )}
                    {item.flags.billingBlocked && (
                      <Badge variant="secondary" className="gap-1"><AlertTriangle className="w-3 h-3" />Billing blocked</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => { setReturnTarget(item); setReturnReason(""); }}
                      data-testid={`button-return-${item.id}`}
                    >
                      <Undo2 className="w-3.5 h-3.5 mr-1" />Return
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !item.signable}
                      onClick={() => signOne(item)}
                      data-testid={`button-sign-${item.id}`}
                    >
                      <PenLine className="w-3.5 h-3.5 mr-1" />Sign
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!returnTarget} onOpenChange={(o) => { if (!o) setReturnTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for correction</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {returnTarget?.patientName} · {returnTarget?.serviceType}
          </p>
          <Textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Describe what needs correcting…"
            rows={4}
            data-testid="input-return-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)} data-testid="button-cancel-return">Cancel</Button>
            <Button onClick={submitReturn} disabled={busy || !returnReason.trim()} data-testid="button-confirm-return">
              Return note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

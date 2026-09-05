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
import { PenLine, Undo2, AlertTriangle, FileWarning, Loader2, Eye, Activity } from "lucide-react";
import { CANONICAL_OVERVIEW_QUERY_KEY } from "./useCanonicalOverview";
import { StatusPill } from "./ui/primitives";
import { OrderNoteDocumentView } from "./OrderNoteDocumentView";
import { CaseLifecycleDrawer, type CaseLifecycleTarget } from "./CaseLifecycleDrawer";
import {
  WORKLIST_FILTERS,
  filterWorklist,
  orderNoteStateLabel,
  orderNoteStateTone,
} from "./orderNoteLifecycle";

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
  // Slice B-minimal / C — Order Note lifecycle state + version tokens.
  orderNotePortalState: string | null;
  screeningComplete: boolean | null;
  // P1 additive canonical fields (server-sourced; no frontend inference).
  requiresScreening: boolean;
  ancillaryCaseId: number | null;
  expectedEvidenceFingerprint: string | null;
  expectedScreeningVersion: string | null;
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
  // Canonical action-required worklist filter (client-side over the fetched
  // items; server remains the source of truth for the data itself).
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [returnTarget, setReturnTarget] = useState<SignatureItem | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Read-only "View Order Note" — fetches the current note so the clinician
  // reviews the patient-specific structured document before signing. No
  // signature state here.
  const [viewTarget, setViewTarget] = useState<SignatureItem | null>(null);
  const [viewNote, setViewNote] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Case Lifecycle drawer target (composes the canonical read endpoints).
  const [caseTarget, setCaseTarget] = useState<CaseLifecycleTarget | null>(null);

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

  const visibleItems = useMemo(() => filterWorklist(items, actionFilter), [items, actionFilter]);

  const signableSelected = useMemo(
    () => items.filter((i) => selected.has(i.id) && i.signable).map((i) => i.id),
    [items, selected],
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/signature-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/physician-portal/financial-health"] });
    // Keep the read-only canonical Orders & Notes overview in sync so a signed
    // note flips to Signed there too (server remains the source of truth).
    queryClient.invalidateQueries({ queryKey: CANONICAL_OVERVIEW_QUERY_KEY });
  }

  async function openView(item: SignatureItem) {
    setViewTarget(item);
    setViewNote(null);
    setViewLoading(true);
    try {
      const res = await fetch(`/api/procedure-notes/${item.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load note");
      const note = await res.json();
      setViewNote(note);
    } catch (e: any) {
      setViewNote(null);
      toast({ title: "Could not load note", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setViewLoading(false);
    }
  }

  function openCase(item: SignatureItem) {
    if (item.ancillaryCaseId == null) {
      toast({ title: "No linked case", description: "This note is not linked to a canonical ancillary case yet." });
      return;
    }
    setCaseTarget({
      ancillaryCaseId: item.ancillaryCaseId,
      patientScreeningId: item.patientScreeningId,
      serviceType: item.serviceType,
      patientName: item.patientName,
      requiresScreening: item.requiresScreening,
      screeningComplete: item.screeningComplete,
      orderNotePortalState: item.orderNotePortalState,
    });
  }

  async function signOne(item: SignatureItem) {
    setBusy(true);
    try {
      // Slice C — echo the current document/version tokens so a stale client
      // copy is rejected server-side.
      await apiRequest("POST", `/api/physician-portal/signature-items/${item.id}/sign`, {
        expectedEvidenceFingerprint: item.expectedEvidenceFingerprint,
        expectedScreeningVersion: item.expectedScreeningVersion,
      });
      toast({ title: "Note signed", description: `${item.patientName ?? "Patient"} · ${item.serviceType}` });
      setSelected((s) => { const n = new Set(s); n.delete(item.id); return n; });
      invalidate();
    } catch (e: any) {
      let reason: string | undefined;
      let msg: string = e?.message ?? "Failed to sign";
      try {
        const body = JSON.parse(e?.body ?? "{}");
        reason = body?.reason;
        if (body?.error) msg = body.error;
      } catch { /* non-JSON error body */ }
      if (reason === "ORDER_NOTE_STALE") {
        toast({ title: "Order Note updated", description: "Clinical information has changed. Please review the current Order Note before signing.", variant: "destructive" });
        invalidate();
      } else if (reason === "REQUIRED_SCREENING_INCOMPLETE") {
        toast({ title: "Screening incomplete", description: "Required screening must be completed before this Order Note can be signed.", variant: "destructive" });
        invalidate();
      } else {
        toast({ title: "Sign failed", description: msg, variant: "destructive" });
      }
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
    if (checked) setSelected(new Set(visibleItems.filter((i) => i.signable).map((i) => i.id)));
    else setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[220px]" data-testid="select-worklist-filter">
            <SelectValue placeholder="Action required" />
          </SelectTrigger>
          <SelectContent>
            {WORKLIST_FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id} data-testid={`worklist-filter-${f.id}`}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                  checked={visibleItems.length > 0 && selected.size === visibleItems.filter((i) => i.signable).length && selected.size > 0}
                  onCheckedChange={(c) => toggleAll(!!c)}
                  data-testid="checkbox-select-all"
                />
              </TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Order Note</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : visibleItems.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground" data-testid="text-signatures-empty">No notes in this view.</TableCell></TableRow>
            ) : visibleItems.map((item) => (
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
                  {item.orderNotePortalState ? (
                    <StatusPill
                      label={orderNoteStateLabel(item.orderNotePortalState)}
                      tone={orderNoteStateTone(item.orderNotePortalState)}
                      testId={`order-note-state-${item.id}`}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
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
                      variant="ghost"
                      onClick={() => openCase(item)}
                      data-testid={`button-case-${item.id}`}
                    >
                      <Activity className="w-3.5 h-3.5 mr-1" />Case
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => openView(item)}
                      data-testid={`button-view-${item.id}`}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" />View
                    </Button>
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

      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) { setViewTarget(null); setViewNote(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Note — {viewTarget?.patientName ?? "Patient"} · {viewTarget?.serviceType}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="view-note-state">
            <span>Status:</span>
            {viewTarget?.orderNotePortalState ? (
              <StatusPill
                label={orderNoteStateLabel(viewTarget.orderNotePortalState)}
                tone={orderNoteStateTone(viewTarget.orderNotePortalState)}
              />
            ) : "—"}
          </div>
          {viewLoading ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 inline animate-spin" />Loading…</div>
          ) : (
            <OrderNoteDocumentView
              text={viewNote?.generatedText ?? viewNote?.generated_text ?? null}
              testId="view-note-body"
              audit={{
                evidenceFingerprint: viewNote?.evidenceFingerprint,
                evaluatedScreeningEvidenceVersion: viewNote?.evaluatedScreeningEvidenceVersion,
                generatedByAi: viewNote?.generatedByAi,
                signedAt: viewNote?.signedAt,
                effectiveClinicalDate: viewNote?.effectiveClinicalDate,
              }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setViewTarget(null); setViewNote(null); }} data-testid="button-close-view">Close</Button>
            {viewTarget?.signable && (
              <Button
                disabled={busy}
                onClick={() => { const t = viewTarget; setViewTarget(null); setViewNote(null); if (t) void signOne(t); }}
                data-testid="button-view-sign"
              >
                <PenLine className="w-3.5 h-3.5 mr-1" />Sign
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CaseLifecycleDrawer
        target={caseTarget}
        open={!!caseTarget}
        onOpenChange={(o) => { if (!o) setCaseTarget(null); }}
      />
    </div>
  );
}

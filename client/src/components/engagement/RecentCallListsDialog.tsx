// Recent Generated Lists (Task 10) — lives inside the Engagement Center (no new
// top-level nav). Lists recently generated call-list packages and supports:
// View, Copy Link (after regenerate), Download PDF, Retry PDF, Extend, Regenerate,
// Revoke. Header rows only (no member PHI) until the manager opens a share view.

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Download,
  ExternalLink,
  Ban,
  RefreshCw,
  Clock,
  Copy,
} from "lucide-react";
import {
  fetchRecentPackages,
  revokePackage,
  extendPackage,
  regeneratePackage,
  generateAndUploadPackagePdf,
  buildShareUrl,
  type RecentPackage,
} from "@/lib/api/callListPackages";

const EXTEND_HOURS = 72;

function statusBadge(p: RecentPackage): { label: string; cls: string } {
  if (p.shareRevokedAt) return { label: "Revoked", cls: "bg-rose-50 text-rose-700" };
  if (p.shareExpiresAt && new Date(p.shareExpiresAt).getTime() <= Date.now()) {
    return { label: "Expired", cls: "bg-slate-100 text-slate-500" };
  }
  return { label: "Active", cls: "bg-emerald-50 text-emerald-700" };
}

export function RecentCallListsDialog({
  open,
  onOpenChange,
  facility,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facility?: string | null;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RecentPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRecentPackages({ facility: facility ?? null, limit: 50 });
      setRows(data);
    } catch (e) {
      toast({ title: "Failed to load", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [facility, toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function withBusy(id: number, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(p: RecentPackage) {
    await withBusy(p.id, async () => {
      await revokePackage(p.id);
      toast({ title: "Link revoked" });
      await load();
    });
  }

  async function handleExtend(p: RecentPackage) {
    await withBusy(p.id, async () => {
      await extendPackage(p.id, EXTEND_HOURS);
      toast({ title: `Extended ${EXTEND_HOURS}h` });
      await load();
    });
  }

  async function handleRegenerate(p: RecentPackage) {
    await withBusy(p.id, async () => {
      const res = await regeneratePackage(p.id);
      try {
        await navigator.clipboard.writeText(buildShareUrl(res.shareToken));
        toast({ title: "New link generated + copied" });
      } catch {
        toast({ title: "New link generated", description: buildShareUrl(res.shareToken) });
      }
      await load();
    });
  }

  async function handleRetryPdf(p: RecentPackage) {
    await withBusy(p.id, async () => {
      const status = await generateAndUploadPackagePdf(p.id);
      toast({ title: status === "ready" ? "PDF regenerated" : "PDF generation failed", variant: status === "ready" ? undefined : "destructive" });
      await load();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recent Generated Lists</DialogTitle>
          <DialogDescription>
            Retrieve, download, extend, regenerate, or revoke previously generated
            call-list packages.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">No generated lists yet.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((p) => {
              const badge = statusBadge(p);
              const busy = busyId === p.id;
              const pdfReady = p.generationStatus === "ready" && p.pdfAvailable;
              return (
                <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`recent-pkg-${p.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.teamMemberName ?? `Member #${p.teamMemberId}`}</div>
                      <div className="text-xs text-slate-500">
                        {[p.facility, p.serviceDate, p.cohortLabel].filter(Boolean).join(" · ")} · {p.patientCount} patients
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={pdfReady ? `/api/engagement/call-lists/packages/${p.id}/pdf` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs ${pdfReady ? "border-slate-200 text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-100 text-slate-300"}`}
                      data-testid={`recent-download-${p.id}`}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" /> Download PDF
                    </a>
                    {p.generationStatus === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => handleRetryPdf(p)} disabled={busy} data-testid={`recent-retry-${p.id}`}>
                        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Retry PDF
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleRegenerate(p)} disabled={busy} data-testid={`recent-regen-${p.id}`}>
                      <Copy className="mr-1 h-3.5 w-3.5" /> Regenerate Link
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleExtend(p)} disabled={busy || !!p.shareRevokedAt} data-testid={`recent-extend-${p.id}`}>
                      <Clock className="mr-1 h-3.5 w-3.5" /> Extend
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(p)} disabled={busy || !!p.shareRevokedAt} data-testid={`recent-revoke-${p.id}`}>
                      <Ban className="mr-1 h-3.5 w-3.5" /> {p.shareRevokedAt ? "Revoked" : "Revoke"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

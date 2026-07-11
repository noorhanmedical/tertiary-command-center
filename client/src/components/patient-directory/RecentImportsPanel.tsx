// Recent Imports panel (task #723).
//
// Collapsible panel on the Patient EHR page listing the last 30
// import sessions (screening_batches rows stamped with import metadata).
// Each batch shows who imported it, when, which source fields the file
// carried, and a preview of patient names. Admin-only actions:
//   - "Delete All" — soft-deletes every patient in the batch (14-day
//     restore window) and retires the batch from this list.
//   - "Review" — opens the match-review dialog for batches submitted
//     for approval by non-admin staff ("Waiting for approval" badge).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/api/auth";
import {
  deleteImportBatch,
  listImportBatches,
  type ImportBatchSummary,
} from "@/lib/patientDirectoryApi";
import { BulkImportDialog } from "@/components/patient-directory/PatientDirectoryActions";

export const IMPORT_BATCHES_QUERY_KEY = ["patient-directory-import-batches"] as const;

function fmtWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function RecentImportsPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirmDelete, setConfirmDelete] = useState<ImportBatchSummary | null>(null);
  const [reviewBatch, setReviewBatch] = useState<ImportBatchSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "admin";

  const batchesQ = useQuery({
    queryKey: [...IMPORT_BATCHES_QUERY_KEY],
    queryFn: () => listImportBatches(),
    enabled: open,
    staleTime: 30_000,
  });
  const batches = batchesQ.data ?? [];

  async function runDelete(batch: ImportBatchSummary) {
    setDeleting(true);
    try {
      const res = await deleteImportBatch(batch.id);
      toast({ title: "Import deleted", description: `${res.affected} patient(s) removed (restorable for 14 days).` });
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: [...IMPORT_BATCHES_QUERY_KEY] });
      qc.invalidateQueries({ queryKey: ["patient-directory-search"] });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white/70" data-testid="recent-imports-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        data-testid="recent-imports-toggle"
      >
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        <History className="h-4 w-4 text-indigo-500" />
        <span className="text-[12px] font-semibold text-slate-700">Recent Imports</span>
        {batches.some((b) => b.pending) && (
          <Badge className="ml-1 border-amber-200 bg-amber-100 text-[10px] text-amber-800">Approval needed</Badge>
        )}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          {batchesQ.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-[11px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading imports…
            </div>
          ) : batches.length === 0 ? (
            <div className="py-3 text-[11px] text-slate-500" data-testid="recent-imports-empty">
              No imports yet. Use Bulk Import to add patients from a file or pasted list.
            </div>
          ) : (
            <div className="max-h-[40vh] space-y-2 overflow-y-auto">
              {batches.map((b) => (
                <div key={b.id} className="rounded-lg border border-slate-200 p-2" data-testid={`recent-import-batch-${b.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-medium text-slate-800">{b.name}</span>
                        {b.pending && (
                          <Badge className="border-amber-200 bg-amber-100 text-[10px] text-amber-800" data-testid={`recent-import-pending-${b.id}`}>
                            Waiting for approval
                          </Badge>
                        )}
                        {b.importKind === "service" && !b.pending && (
                          <Badge variant="secondary" className="text-[10px]">service list</Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {fmtWhen(b.createdAt)}
                        {b.createdByUsername ? ` · by ${b.createdByUsername}` : ""}
                        {` · ${b.patientCount} patient(s)`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isAdmin && b.pending && b.pendingPayload && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 rounded-full px-2 text-[10px]"
                          onClick={() => setReviewBatch(b)}
                          data-testid={`recent-import-review-${b.id}`}
                        >
                          Review
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 rounded-full px-2 text-[10px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setConfirmDelete(b)}
                          data-testid={`recent-import-delete-${b.id}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" /> Delete All
                        </Button>
                      )}
                    </div>
                  </div>
                  {b.sourceFields.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {b.sourceFields.map((f) => (
                        <Badge key={f} variant="secondary" className="text-[9px]">{f}</Badge>
                      ))}
                    </div>
                  )}
                  {b.patientNames.length > 0 && (
                    <div className="mt-1 truncate text-[10px] text-slate-500" data-testid={`recent-import-names-${b.id}`}>
                      {b.patientNames.join(", ")}{b.patientCount > b.patientNames.length ? "…" : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm" data-testid="recent-import-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete this import?</DialogTitle>
            <DialogDescription>
              Removes all {confirmDelete?.patientCount ?? 0} patient(s) imported in
              “{confirmDelete?.name}”. They stay restorable for 14 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && runDelete(confirmDelete)}
              disabled={deleting}
              data-testid="recent-import-delete-confirm"
            >
              {deleting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin resume/review of a pending submission */}
      {reviewBatch && reviewBatch.pendingPayload && (
        <BulkImportDialog
          open={reviewBatch !== null}
          onOpenChange={(o) => !o && setReviewBatch(null)}
          batchId={reviewBatch.id}
          resumePending={{ batchId: reviewBatch.id, payload: reviewBatch.pendingPayload }}
          onComplete={() => {
            setReviewBatch(null);
            qc.invalidateQueries({ queryKey: [...IMPORT_BATCHES_QUERY_KEY] });
            qc.invalidateQueries({ queryKey: ["patient-directory-search"] });
          }}
        />
      )}
    </div>
  );
}

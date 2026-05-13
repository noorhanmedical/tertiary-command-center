import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2, Undo2 } from "lucide-react";
import {
  fetchPlexusIqRecentlyDeleted,
  restorePlexusIqDeletedPatient,
  type RecentlyDeletedPatient,
} from "@/lib/plexusIqRecentlyDeletedApi";
import { useToast } from "@/hooks/use-toast";

// Compact "Recently Deleted" shelf for the Plexus IQ interior page.
// Lists soft-deleted patients within the 14-day restore window with a
// Reactivate button that calls the canonical restore endpoint and
// invalidates downstream queries so the patient reappears in the
// workspace / calendar / counts.

const RECENTLY_DELETED_KEY = ["plexus-iq", "recently-deleted"] as const;

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = t - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function PlexusIQRecentlyDeleted() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<RecentlyDeletedPatient[]>({
    queryKey: RECENTLY_DELETED_KEY,
    queryFn: () => fetchPlexusIqRecentlyDeleted(100),
    refetchInterval: 30_000,
  });

  // Server already filters expired rows, but trust-but-verify on the
  // client so a stale cache doesn't show a row whose 14 days just
  // ticked over.
  const rows = useMemo(() => {
    const now = Date.now();
    return (data ?? []).filter((r) => {
      if (!r.deleteExpiresAt) return false;
      const exp = new Date(r.deleteExpiresAt).getTime();
      return Number.isFinite(exp) && exp >= now;
    });
  }, [data]);

  const restoreMutation = useMutation({
    mutationFn: (id: number) => restorePlexusIqDeletedPatient(id),
    onSuccess: (_resp, id) => {
      toast({ title: "Patient reactivated" });
      queryClient.invalidateQueries({ queryKey: RECENTLY_DELETED_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/screening-batches/calendar-summary"] });
      // Force-refetch the affected batch's detail so the workspace
      // refreshes immediately. The id is the patient id; we don't have
      // the batch id locally — invalidate all batch detail entries.
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/screening-batches" });
      void id;
    },
    onError: (err: unknown) => {
      toast({
        title: "Reactivation failed",
        description: err instanceof Error ? err.message : "Could not reactivate",
        variant: "destructive",
      });
    },
  });

  if (!isLoading && rows.length === 0) {
    return null;
  }

  return (
    <Card
      className="border border-slate-200 bg-white px-4 py-3"
      data-testid="plexus-iq-recently-deleted"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0"
          aria-expanded={open}
          aria-label="Toggle Recently Deleted"
          data-testid="button-plexus-iq-recently-deleted-toggle"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500" />
          )}
          <span className="text-sm font-semibold text-slate-900">Recently Deleted</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            {rows.length}
          </span>
          <span className="text-[10px] text-slate-500">Restore available for 14 days</span>
        </button>
      </div>

      {open && (
        <ul
          className="mt-2 space-y-1.5 max-h-64 overflow-y-auto"
          data-testid="plexus-iq-recently-deleted-list"
        >
          {rows.map((r) => {
            const dleft = daysUntil(r.deleteExpiresAt);
            return (
              <li
                key={r.id}
                className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-2"
                data-testid={`plexus-iq-recently-deleted-row-${r.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {r.name || `Patient #${r.id}`}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {r.facility ?? "—"}
                      {r.dob ? ` · DOB ${r.dob}` : ""}
                      {" · deleted "}
                      {formatRelative(r.deletedAt)}
                      {dleft != null ? ` · ${dleft}d left` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[10px]"
                    onClick={() => restoreMutation.mutate(r.id)}
                    disabled={restoreMutation.isPending && restoreMutation.variables === r.id}
                    data-testid={`button-plexus-iq-reactivate-${r.id}`}
                  >
                    {restoreMutation.isPending && restoreMutation.variables === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Undo2 className="h-3 w-3" />
                    )}
                    Reactivate
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

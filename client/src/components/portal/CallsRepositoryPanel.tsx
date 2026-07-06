import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  RotateCcw,
  PhoneCall,
  UserPlus,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { searchPatients, type PatientSearchRow } from "@/lib/portal/commandCenterApi";

// Step 6 + 7 — Calls Repository. A read view over completed / closed execution
// cases (the "calls already worked" archive) plus a patient search, both with a
// one-click action that re-surfaces the case onto the operator's active call
// list via POST /api/scheduler-portal/call-list/recall. Honest boundaries: the
// recall only works for patients that already have an execution case; a patient
// with no case (or an operator with no clinic-roster mapping) gets a clear
// error instead of a silent no-op.

type RepositoryCase = {
  id: number;
  patientName: string;
  patientDob: string | null;
  patientScreeningId: number | null;
  facilityId: string | null;
  engagementStatus: string | null;
  lifecycleStatus: string | null;
  engagementBucket: string | null;
  updatedAt: string | null;
};

type RecallBody = {
  executionCaseId?: number;
  patientScreeningId?: number;
  assignToMe: boolean;
  facilityId: string | null;
  reason?: string;
};

export function CallsRepositoryPanel({
  facility,
  onRecalled,
}: {
  facility: string | null;
  /** Fired after a successful recall so the parent can refetch the call list. */
  onRecalled?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"completed" | "closed">("completed");
  const [q, setQ] = useState("");

  const casesQuery = useQuery<RepositoryCase[]>({
    queryKey: ["calls-repository", facility, statusFilter],
    queryFn: async () => {
      const u = new URL("/api/engagement-center/cases", window.location.origin);
      u.searchParams.set("engagementStatus", statusFilter);
      u.searchParams.set("limit", "100");
      if (facility) u.searchParams.set("facilityId", facility);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load calls repository (${res.status})`);
      return (await res.json()) as RepositoryCase[];
    },
  });

  const searchQuery = useQuery<PatientSearchRow[]>({
    queryKey: ["calls-repository-search", q],
    queryFn: () =>
      q.trim().length >= 2 ? searchPatients({ query: q.trim(), limit: 50 }) : Promise.resolve([]),
    enabled: q.trim().length >= 2,
  });

  const recall = useMutation({
    mutationFn: async (body: RecallBody) => {
      const res = await apiRequest("POST", "/api/scheduler-portal/call-list/recall", body);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Added to call list",
        description: "The patient is back on your active call list.",
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "team-workspace-call-list",
      });
      queryClient.invalidateQueries({ queryKey: ["calls-repository"] });
      onRecalled?.();
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't add to call list",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-4" data-testid="calls-repository">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-[#4863A0]" />
          <h2 className="text-sm font-semibold text-slate-900">Calls Repository</h2>
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-slate-200">
          {(["completed", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                statusFilter === s
                  ? "bg-[#4863A0] text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`button-repository-filter-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Manual add by patient search (step 7). */}
      <Card className="p-3 bg-white">
        <div className="mb-2 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">Add a patient to the call list</span>
        </div>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patients by name, DOB, phone, insurance…"
            className="h-8 text-xs"
            data-testid="input-repository-search"
          />
        </div>
        {q.trim().length >= 2 && (
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
            {searchQuery.isFetching ? (
              <div className="flex items-center gap-2 py-2 text-xs italic text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : searchQuery.isError ? (
              <div className="py-2 text-xs text-rose-700">
                {searchQuery.error instanceof Error ? searchQuery.error.message : "Search failed"}
              </div>
            ) : (searchQuery.data ?? []).length === 0 ? (
              <div className="py-2 text-xs italic text-slate-500">No patients found for &ldquo;{q}&rdquo;.</div>
            ) : (
              (searchQuery.data ?? []).map((row) => (
                <div
                  key={row.patientScreeningId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5"
                  data-testid={`repository-search-row-${row.patientScreeningId}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-slate-900">{row.name}</div>
                    <div className="truncate text-[10px] text-slate-500">
                      {[row.facility, row.dob, row.insurance].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    disabled={recall.isPending}
                    onClick={() =>
                      recall.mutate({
                        patientScreeningId: row.patientScreeningId,
                        assignToMe: true,
                        facilityId: row.facility ?? facility,
                        reason: "Manually added from Calls Repository",
                      })
                    }
                    data-testid={`button-add-to-call-list-${row.patientScreeningId}`}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span className="ml-1">Add</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* Worked-calls archive with recall (step 6). */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700 capitalize">{statusFilter} calls</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {casesQuery.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs italic text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading repository…
            </div>
          ) : casesQuery.isError ? (
            <div className="py-2 text-xs text-rose-700">
              {casesQuery.error instanceof Error ? casesQuery.error.message : "Failed to load"}
            </div>
          ) : (casesQuery.data ?? []).length === 0 ? (
            <div className="py-2 text-xs italic text-slate-500">
              No {statusFilter} calls{facility ? ` for ${facility}` : ""}.
            </div>
          ) : (
            (casesQuery.data ?? []).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5"
                data-testid={`repository-case-row-${c.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-900">{c.patientName}</div>
                  <div className="flex items-center gap-1.5 truncate text-[10px] text-slate-500">
                    {c.facilityId ? <span>{c.facilityId}</span> : null}
                    {c.engagementBucket ? <span>· {c.engagementBucket}</span> : null}
                    {c.updatedAt ? <span>· {new Date(c.updatedAt).toLocaleDateString()}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">
                    {c.engagementStatus ?? c.lifecycleStatus ?? "—"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={recall.isPending}
                    onClick={() =>
                      recall.mutate({
                        executionCaseId: c.id,
                        assignToMe: true,
                        facilityId: c.facilityId ?? facility,
                        reason: "Recalled from Calls Repository",
                      })
                    }
                    data-testid={`button-recall-case-${c.id}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="ml-1">Recall</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

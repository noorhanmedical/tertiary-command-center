// Manager workforce panels (Phase 5C) — Needs Coverage, Ownership Timeline,
// and Manager Workload. All consume the canonical Phase 3/4 endpoints and are
// backend-scoped (admin = all; manager = their team/facility scope, enforced
// server-side). Capacity numbers come straight from the canonical backend —
// nothing is recomputed in React.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, History, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ─── Needs Coverage ──────────────────────────────────────────────────────────
type NeedsCoverageItem = {
  executionCaseId: number;
  patientScreeningId: number | null;
  facilityId: string | null;
  category: string;
  reason: string;
  priorityLevel: string | null;
  createdAt: string;
};
const CATEGORY_LABEL: Record<string, string> = {
  no_eligible_staff: "No eligible staff",
  capacity_exhausted: "Capacity exhausted",
  facility_coverage_mismatch: "Facility mismatch",
  absent_owner: "Absent owner",
  failed_redistribution: "Failed redistribution",
  manager_hold: "Manager hold",
  deactivated_owner: "Deactivated owner",
  other: "Other",
};

export function NeedsCoveragePanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery<{ items: NeedsCoverageItem[]; byCategory: Record<string, number>; total: number }>({
    queryKey: ["/api/engagement/needs-coverage"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/needs-coverage", { credentials: "include" });
      if (res.status === 403) throw new Error("__forbidden__");
      if (!res.ok) throw new Error("Failed to load needs coverage");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const preview = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/engagement/distribution/preview", { credentials: "include" });
      if (!res.ok) throw new Error("Preview failed");
      return res.json();
    },
    onSuccess: (plan: { plan?: { totals?: { assigned: number; unplaced: number } } }) => {
      const t = plan?.plan?.totals;
      toast({ title: "Distribution preview", description: t ? `${t.assigned} would be assigned, ${t.unplaced} would remain uncovered.` : "Preview ready." });
    },
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const forbidden = isError && error instanceof Error && error.message === "__forbidden__";
  if (forbidden) return null; // ordinary staff don't see this panel

  return (
    <Card data-testid="needs-coverage-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" /> Needs Coverage
          {data?.total ? <Badge variant="destructive">{data.total}</Badge> : null}
        </CardTitle>
        {isAdmin ? (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => preview.mutate()} disabled={preview.isPending} data-testid="needs-coverage-preview">
            Run distribution preview
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <div className="text-sm text-red-600">{(error as Error).message}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No uncovered cases in your scope.</div>
        ) : (
          <div className="space-y-1.5">
            {data.items.map((i) => (
              <div key={i.executionCaseId} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm" data-testid={`needs-coverage-${i.executionCaseId}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">Case #{i.executionCaseId}{i.facilityId ? ` · ${i.facilityId}` : ""}</div>
                  <div className="text-xs text-muted-foreground truncate">{i.reason}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {i.priorityLevel ? <Badge variant="outline">{i.priorityLevel}</Badge> : null}
                  <Badge variant="secondary">{CATEGORY_LABEL[i.category] ?? i.category}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Ownership Timeline ──────────────────────────────────────────────────────
type TimelineEntry = {
  at: string | null;
  kind: string;
  mode: string;
  actorName: string | null;
  reason: string | null;
  summary: string;
  priorityLevel: string | null;
  handoffStatus: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
};

export function OwnershipTimelinePanel({ executionCaseId }: { executionCaseId: number }) {
  const { data, isLoading, isError } = useQuery<{ currentOwnerSchedulerId: number | null; entries: TimelineEntry[] }>({
    queryKey: ["/api/engagement/cases", executionCaseId, "ownership-timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/engagement/cases/${executionCaseId}/ownership-timeline`, { credentials: "include" });
      if (res.status === 403) throw new Error("out of scope");
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
    enabled: executionCaseId > 0,
  });

  return (
    <Card data-testid="ownership-timeline-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Ownership Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <div className="text-sm text-muted-foreground">Timeline unavailable in your scope.</div>
        ) : !data || data.entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No ownership history yet.</div>
        ) : (
          <ol className="space-y-2 border-l pl-3">
            {data.entries.map((e, idx) => (
              <li key={idx} className="relative text-sm" data-testid={`timeline-entry-${idx}`}>
                <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-slate-400" />
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">{e.kind}</Badge>
                  <Badge variant="secondary">{e.mode}</Badge>
                  {e.priorityLevel ? <Badge variant="outline">{e.priorityLevel}</Badge> : null}
                </div>
                <div className="text-xs text-slate-700">{e.summary}</div>
                <div className="text-[10px] text-muted-foreground">
                  {e.actorName ? `${e.actorName} · ` : ""}{e.at ? new Date(e.at).toLocaleString() : ""}
                  {e.acknowledgedAt ? " · acknowledged" : ""}{e.completedAt ? " · completed" : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Manager Workload (canonical capacity, NOT recomputed in React) ──────────
type MetricsMember = {
  schedulerId: number;
  name: string;
  workingToday: boolean;
  configuredWorkloadPercent: number;
  dailyCallCapacity: number;
  activeQueue: number;
  completedCalls: number;
  remainingCapacity: number;
  carryover: number;
  priorityHandoffs: number;
  overCapacity: number;
};

export function ManagerWorkloadPanel() {
  const { data, isLoading, isError, error } = useQuery<{ members: MetricsMember[] }>({
    queryKey: ["/api/engagement/team-metrics"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/team-metrics", { credentials: "include" });
      if (res.status === 403) throw new Error("__forbidden__");
      if (!res.ok) throw new Error("Failed to load team metrics");
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const forbidden = isError && error instanceof Error && error.message === "__forbidden__";
  if (forbidden) return null;

  return (
    <Card data-testid="manager-workload-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Team Workload</CardTitle>
        <p className="text-xs text-muted-foreground">Canonical capacity — the same numbers auto-distribution uses.</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <div className="text-sm text-red-600">{(error as Error).message}</div>
        ) : !data || data.members.length === 0 ? (
          <div className="text-sm text-muted-foreground">No team members.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Member</th><th className="px-1">Working</th><th className="px-1">%</th>
                <th className="px-1">Cap</th><th className="px-1">Assigned</th><th className="px-1">Done</th>
                <th className="px-1">Remaining</th><th className="px-1">Carry</th><th className="px-1">Handoffs</th><th className="px-1">Over</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.schedulerId} className="border-t" data-testid={`workload-row-${m.schedulerId}`}>
                  <td className="py-1 pr-2 font-medium">{m.name}</td>
                  <td className="px-1">{m.workingToday ? "✓" : "—"}</td>
                  <td className="px-1">{m.configuredWorkloadPercent}%</td>
                  <td className="px-1">{m.dailyCallCapacity}</td>
                  <td className="px-1">{m.activeQueue}</td>
                  <td className="px-1">{m.completedCalls}</td>
                  <td className="px-1">{m.remainingCapacity}</td>
                  <td className="px-1">{m.carryover}</td>
                  <td className="px-1">{m.priorityHandoffs}</td>
                  <td className="px-1">{m.overCapacity > 0 ? <Badge variant="destructive">+{m.overCapacity}</Badge> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

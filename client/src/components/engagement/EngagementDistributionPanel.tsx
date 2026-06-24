// Engagement Distribution panel (Phase 2) — admin-only.
//
// Previews and applies a capacity-aware bulk distribution of the waiting
// (unassigned) engagement pool across working team members. The preview is a
// pure read; Apply re-runs the allocator atomically on the server so a stale
// preview can never over-assign.

import { useState } from "react";
import { Loader2, RefreshCw, Users, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useDistributionPreview,
  useApplyDistribution,
  type MemberAllocationSummary,
  type ProposedAssignment,
  type UnplacedCase,
} from "@/hooks/api/engagementDistribution";

function Stat({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "indigo" | "amber" | "emerald" }) {
  const toneClass = {
    slate: "text-slate-900 dark:text-white",
    indigo: "text-indigo-600 dark:text-indigo-400",
    amber: "text-amber-600 dark:text-amber-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function MemberRow({ m, proposed }: { m: MemberAllocationSummary; proposed: ProposedAssignment[] }) {
  const mine = proposed.filter((a) => a.schedulerId === m.schedulerId);
  const offline = !m.active || !m.workingToday;
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
      data-testid={`distribution-member-${m.schedulerId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {m.name}
            {offline ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
                {m.active ? "off today" : "inactive"}
              </span>
            ) : null}
          </div>
          {m.facility ? (
            <div className="truncate text-[11px] text-slate-400">{m.facility}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div
            className="text-sm font-semibold tabular-nums text-indigo-600 dark:text-indigo-400"
            data-testid={`distribution-member-total-${m.schedulerId}`}
          >
            {m.assignedTotal}/{m.remainingCapacity}
          </div>
          <div className="text-[10px] text-slate-400">
            visit {m.assignedVisit}/{m.visitTarget} · outreach {m.assignedOutreach}/{m.outreachTarget}
          </div>
        </div>
      </div>
      {mine.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {mine.map((a) => (
            <span
              key={a.executionCaseId}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              data-testid={`distribution-assignment-${a.executionCaseId}`}
            >
              {a.patientName}
              <span className="ml-1 text-slate-400">{a.lane === "visit" ? "V" : "O"}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UnplacedRow({ u }: { u: UnplacedCase }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
      data-testid={`distribution-unplaced-${u.executionCaseId}`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      <div className="min-w-0">
        <div className="font-medium text-slate-800 dark:text-slate-200">
          {u.patientName}
          {u.facility ? <span className="ml-1 text-slate-400">· {u.facility}</span> : null}
        </div>
        <div className="text-amber-700 dark:text-amber-400">{u.reason}</div>
      </div>
    </div>
  );
}

export function EngagementDistributionPanel() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const preview = useDistributionPreview(enabled);
  const apply = useApplyDistribution();

  const plan = preview.data?.plan;
  const members = plan?.memberSummaries ?? [];
  const assignments = plan?.assignments ?? [];
  const unplaced = plan?.unplaced ?? [];

  const handleApply = async () => {
    try {
      const result = await apply.mutateAsync();
      toast({
        title: result.ok ? "Distribution applied" : "Distribution applied with skips",
        description: `${result.summary.applied} assigned${
          result.summary.skipped ? `, ${result.summary.skipped} skipped` : ""
        }.`,
      });
      void preview.refetch();
    } catch (e) {
      toast({
        title: "Could not apply distribution",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (preview.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building distribution preview…
      </div>
    );
  }

  if (preview.isError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
        {preview.error instanceof Error ? preview.error.message : "Failed to load preview."}
      </div>
    );
  }

  const totals = plan?.totals;
  const nothingToDo = assignments.length === 0;

  return (
    <div className="space-y-4" data-testid="engagement-distribution-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Distribution Engine
          </h2>
          <p className="text-xs text-slate-500">
            Spread the waiting pool across working team members, respecting each
            member's remaining capacity, facility coverage, and visit/outreach split.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEnabled(true);
              void preview.refetch();
            }}
            disabled={preview.isFetching}
            data-testid="button-distribution-refresh"
          >
            {preview.isFetching ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={apply.isPending || nothingToDo}
            data-testid="button-distribution-apply"
          >
            {apply.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Apply {assignments.length > 0 ? `(${assignments.length})` : ""}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Waiting Pool" value={totals?.poolSize ?? 0} tone="slate" />
        <Stat label="Will Assign" value={totals?.assigned ?? 0} tone="indigo" />
        <Stat label="Unplaced" value={totals?.unplaced ?? 0} tone="amber" />
        <Stat label="Working Members" value={totals?.eligibleMembers ?? 0} tone="emerald" />
      </div>

      {nothingToDo ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Nothing to distribute right now — the waiting pool is empty or no working
          member has remaining capacity.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" /> Proposed per member
          </div>
          {members.length === 0 ? (
            <div className="text-xs text-slate-400">No team members configured.</div>
          ) : (
            members.map((m) => (
              <MemberRow key={m.schedulerId} m={m} proposed={assignments} />
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Unplaced ({unplaced.length})
          </div>
          {unplaced.length === 0 ? (
            <div className="text-xs text-slate-400">
              Every waiting case found an eligible team member.
            </div>
          ) : (
            unplaced.map((u) => <UnplacedRow key={u.executionCaseId} u={u} />)
          )}
        </div>
      </div>
    </div>
  );
}

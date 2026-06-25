// Engagement Distribution panel (Phase 2) — admin-only.
//
// Previews and applies a capacity-aware bulk distribution of the waiting
// (unassigned) engagement pool across working team members. The preview is a
// pure read; Apply re-runs the allocator atomically on the server so a stale
// preview can never over-assign.

import { useState } from "react";
import {
  Loader2,
  RefreshCw,
  Users,
  AlertTriangle,
  CheckCircle2,
  Activity,
  CalendarCheck,
  Phone,
  UserPlus,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useDistributionPreview,
  useApplyDistribution,
  useDistributionLive,
  useDistributionMemberCases,
  type MemberAllocationSummary,
  type MemberLiveProgress,
  type ActivityFeedEvent,
  type ProposedAssignment,
  type UnplacedCase,
  type MemberCaseItem,
  type MemberCaseCategory,
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

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const CASE_CATEGORY_META: Record<
  MemberCaseCategory,
  { label: string; dot: string; badge: string }
> = {
  remaining: {
    label: "Remaining",
    dot: "bg-amber-500",
    badge:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-indigo-500",
    badge:
      "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
  completed_today: {
    label: "Completed today",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
};

const CASE_CATEGORY_ORDER: MemberCaseCategory[] = [
  "in_progress",
  "remaining",
  "completed_today",
];

function statusLabel(status: string | null): string {
  if (!status) return "new";
  return status.replace(/_/g, " ");
}

function MemberCaseRow({ c }: { c: MemberCaseItem }) {
  const meta = CASE_CATEGORY_META[c.category];
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900"
      data-testid={`member-case-${c.executionCaseId}`}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-slate-800 dark:text-slate-200">
            {c.patientName}
          </span>
          <span className="shrink-0 capitalize text-[10px] text-slate-400">
            {statusLabel(c.engagementStatus)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
          {c.facility ? <span className="truncate">{c.facility}</span> : null}
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {c.lastAttemptAt
              ? `last attempt ${relativeTime(c.lastAttemptAt)}`
              : "no attempts yet"}
          </span>
          {c.callAttemptCount > 0 ? (
            <span>{c.callAttemptCount} call{c.callAttemptCount === 1 ? "" : "s"}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MemberCasesDrawer({
  schedulerId,
  enabled,
}: {
  schedulerId: number;
  enabled: boolean;
}) {
  const q = useDistributionMemberCases(schedulerId, enabled);
  const cases = q.data?.cases ?? [];

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading cases…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400">
        {q.error instanceof Error ? q.error.message : "Failed to load cases."}
      </div>
    );
  }
  if (cases.length === 0) {
    return (
      <div className="px-3 py-3 text-[11px] text-slate-400">
        No active or completed-today cases for this member.
      </div>
    );
  }

  return (
    <div className="space-y-2.5 px-3 pb-3 pt-1" data-testid={`member-cases-${schedulerId}`}>
      {CASE_CATEGORY_ORDER.map((cat) => {
        const group = cases.filter((c) => c.category === cat);
        if (group.length === 0) return null;
        const meta = CASE_CATEGORY_META[cat];
        return (
          <div key={cat} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {meta.label}
              </span>
              <span
                className={`rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums ${meta.badge}`}
              >
                {group.length}
              </span>
            </div>
            <div className="space-y-1">
              {group.map((c) => (
                <MemberCaseRow key={c.executionCaseId} c={c} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LiveMemberRow({ m }: { m: MemberLiveProgress }) {
  const offline = !m.active || !m.workingToday;
  const [open, setOpen] = useState(false);
  const hasCases = m.remaining > 0 || m.inProgress > 0 || m.completedToday > 0;
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      data-testid={`live-member-${m.schedulerId}`}
    >
      <button
        type="button"
        onClick={() => hasCases && setOpen((v) => !v)}
        disabled={!hasCases}
        className="w-full px-3 py-2 text-left disabled:cursor-default"
        aria-expanded={open}
        data-testid={`live-member-toggle-${m.schedulerId}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {hasCases ? (
              open ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )
            ) : (
              <span className="h-3.5 w-3.5 shrink-0" />
            )}
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
          </div>
          <div className="text-right">
            <div
              className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
              data-testid={`live-member-completed-${m.schedulerId}`}
            >
              {m.completedToday}/{m.completedKpi}
            </div>
            <div className="text-[10px] text-slate-400">done today</div>
          </div>
        </div>
        <ProgressBar done={m.completedToday} total={m.completedKpi} />
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
          <span data-testid={`live-member-remaining-${m.schedulerId}`}>
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {m.remaining}
            </span>{" "}
            remaining
          </span>
          <span data-testid={`live-member-inprogress-${m.schedulerId}`}>
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {m.inProgress}
            </span>{" "}
            in progress
          </span>
        </div>
      </button>
      {open && hasCases ? (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <MemberCasesDrawer schedulerId={m.schedulerId} enabled={open} />
        </div>
      ) : null}
    </div>
  );
}

const ACTIVITY_ICON: Record<
  string,
  { Icon: typeof Activity; className: string }
> = {
  call_result_logged: { Icon: Phone, className: "text-indigo-500" },
  scheduled_ancillary: { Icon: CalendarCheck, className: "text-emerald-500" },
  schedule_confirmed: { Icon: CalendarCheck, className: "text-emerald-500" },
  schedule_rescheduled: { Icon: CalendarCheck, className: "text-amber-500" },
  schedule_cancelled: { Icon: CalendarCheck, className: "text-rose-500" },
  schedule_no_show: { Icon: CalendarCheck, className: "text-rose-500" },
  engagement_assigned: { Icon: UserPlus, className: "text-sky-500" },
  scheduler_assigned: { Icon: UserPlus, className: "text-sky-500" },
  engagement_assignment_changed: {
    Icon: ArrowRightLeft,
    className: "text-sky-500",
  },
  engagement_assignment_cancelled: {
    Icon: ArrowRightLeft,
    className: "text-slate-400",
  },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function ActivityRow({ e }: { e: ActivityFeedEvent }) {
  const meta = ACTIVITY_ICON[e.eventType] ?? {
    Icon: Activity,
    className: "text-slate-400",
  };
  const { Icon } = meta;
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
      data-testid={`activity-event-${e.id}`}
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-800 dark:text-slate-200">
          {e.patientName}
        </div>
        <div className="truncate text-slate-500 dark:text-slate-400">
          {e.summary}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
          {e.actorName ? <span>{e.actorName}</span> : null}
          {e.actorName ? <span>·</span> : null}
          <span>{relativeTime(e.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function LiveProgressSection({ enabled }: { enabled: boolean }) {
  const live = useDistributionLive(enabled);
  const members = live.data?.members ?? [];
  const activity = live.data?.activity ?? [];
  const totals = live.data?.totals;

  return (
    <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800" data-testid="distribution-live-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-900 dark:text-white">
            <Activity className="h-4 w-4 text-emerald-500" /> Live Team Activity
          </h2>
          <p className="text-xs text-slate-500">
            Real-time progress on assigned work today. Updates automatically.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          {live.isFetching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          )}
          {live.data?.asOf ? (
            <span data-testid="live-asof">
              updated {relativeTime(live.data.asOf)}
            </span>
          ) : null}
        </div>
      </div>

      {live.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          {live.error instanceof Error
            ? live.error.message
            : "Failed to load live progress."}
        </div>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Completed Today" value={totals.completedToday} tone="emerald" />
          <Stat label="In Progress" value={totals.inProgress} tone="indigo" />
          <Stat label="Remaining" value={totals.remaining} tone="amber" />
          <Stat label="Active Members" value={totals.activeMembers} tone="slate" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" /> Progress per member
          </div>
          {live.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live
              progress…
            </div>
          ) : members.length === 0 ? (
            <div className="text-xs text-slate-400">
              No team members configured.
            </div>
          ) : (
            members.map((m) => <LiveMemberRow key={m.schedulerId} m={m} />)
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Activity className="h-3.5 w-3.5" /> Recent activity
          </div>
          {live.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading activity…
            </div>
          ) : activity.length === 0 ? (
            <div className="text-xs text-slate-400">
              No recent assignment or outcome activity yet.
            </div>
          ) : (
            <div className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
              {activity.map((e) => (
                <ActivityRow key={e.id} e={e} />
              ))}
            </div>
          )}
        </div>
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

      <LiveProgressSection enabled={enabled} />
    </div>
  );
}

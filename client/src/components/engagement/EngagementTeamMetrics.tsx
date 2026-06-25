// Engagement Center — Phase 3: Live Team Metrics + Activity Feed (admin-only).
//
// A live (short-poll) admin dashboard derived ONLY from existing call-log /
// journey / execution-case data. Targets reuse the Call Settings math; there is
// no RingCentral telemetry, so the live-events boundary is shown honestly
// instead of fabricated.

import {
  Loader2,
  RadioTower,
  Phone,
  CalendarCheck,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  useTeamMetrics,
  useActivityFeed,
  fetchActivityFeedPage,
  type TeamMetricsMember,
  type DispositionBreakdown,
  type DispositionCategory,
  type ActivityFeedItem,
} from "@/hooks/api/engagementTeamMetrics";
import { formatTime12, formatDate } from "@/lib/format";

const DISPOSITION_META: {
  key: DispositionCategory;
  label: string;
  className: string;
}[] = [
  { key: "scheduled", label: "Scheduled", className: "text-emerald-600 dark:text-emerald-400" },
  { key: "completed", label: "Reached", className: "text-indigo-600 dark:text-indigo-400" },
  { key: "followUp", label: "Follow-up", className: "text-amber-600 dark:text-amber-400" },
  { key: "noAnswer", label: "No answer", className: "text-slate-500 dark:text-slate-400" },
  { key: "voicemail", label: "Voicemail", className: "text-slate-500 dark:text-slate-400" },
  { key: "declined", label: "Declined", className: "text-rose-600 dark:text-rose-400" },
  { key: "other", label: "Other", className: "text-slate-400" },
];

function SummaryStat({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "slate" | "indigo" | "amber" | "emerald" | "rose";
}) {
  const toneClass: Record<string, string> = {
    slate: "text-slate-900 dark:text-white",
    indigo: "text-indigo-600 dark:text-indigo-400",
    amber: "text-amber-600 dark:text-amber-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
  };
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
      data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass[tone]}`}>
        {value}
      </div>
      {sub ? <div className="text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

function ProgressBar({ done, target }: { done: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const tone =
    pct >= 100
      ? "bg-emerald-500"
      : pct >= 60
        ? "bg-indigo-500"
        : "bg-amber-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TeamProgress({
  label,
  done,
  target,
  tone,
}: {
  label: string;
  done: number;
  target: number;
  tone: "indigo" | "emerald";
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const accent =
    tone === "indigo"
      ? "text-indigo-600 dark:text-indigo-400"
      : "text-emerald-600 dark:text-emerald-400";
  return (
    <div
      className="flex-1"
      data-testid={`team-progress-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <span className={`text-xs font-semibold tabular-nums ${accent}`}>
          {done}/{target}{" "}
          <span className="text-slate-400">({pct}%)</span>
        </span>
      </div>
      <ProgressBar done={done} target={target} />
    </div>
  );
}

function DispositionChips({ d }: { d: DispositionBreakdown }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DISPOSITION_META.filter((m) => d[m.key] > 0).map((m) => (
        <span
          key={m.key}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums dark:bg-slate-800"
          data-testid={`disposition-${m.key}`}
        >
          <span className={m.className}>{m.label}</span>{" "}
          <span className="text-slate-500 dark:text-slate-400">{d[m.key]}</span>
        </span>
      ))}
    </div>
  );
}

function MemberRow({ m }: { m: TeamMetricsMember }) {
  const offline = !m.workingToday;
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
      data-testid={`team-metrics-member-${m.schedulerId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
              {m.name}
            </span>
            {offline ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
                {m.ptoToday ? "PTO" : "off today"}
              </span>
            ) : null}
          </div>
          {m.facility ? (
            <div className="truncate text-[11px] text-slate-400">{m.facility}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div
            className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white"
            data-testid={`member-calls-${m.schedulerId}`}
          >
            {m.completedCalls}/{m.completedCallKpi}
          </div>
          <div className="text-[10px] text-slate-400">
            {m.remainingCallKpi} call{m.remainingCallKpi === 1 ? "" : "s"} left
          </div>
        </div>
      </div>

      <div className="mt-2">
        <ProgressBar done={m.completedCalls} target={m.completedCallKpi} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span data-testid={`member-scheduled-${m.schedulerId}`}>
          Scheduled{" "}
          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {m.scheduledToday}/{m.scheduledKpi}
          </span>
        </span>
        <span data-testid={`member-queue-${m.schedulerId}`}>
          Active queue{" "}
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {m.activeQueue}
          </span>
        </span>
        <span data-testid={`member-carryover-${m.schedulerId}`}>
          Carryover{" "}
          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {m.carryover}
          </span>
        </span>
      </div>

      {m.completedCalls > 0 ? (
        <div className="mt-2">
          <DispositionChips d={m.dispositions} />
        </div>
      ) : null}
    </div>
  );
}

function FeedRow({ item }: { item: ActivityFeedItem }) {
  const Icon = item.kind === "call" ? Phone : Activity;
  return (
    <li
      className="flex items-start gap-2.5 px-3 py-2"
      data-testid={`activity-item-${item.id}`}
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
          {item.title}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
          {item.patientName ? <span>{item.patientName}</span> : null}
          {item.actorName ? <span>· {item.actorName}</span> : null}
          {item.at ? (
            <span>· {formatTime12(item.at)} {formatDate(item.at)}</span>
          ) : null}
        </div>
        {item.detail ? (
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {item.detail}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function EngagementTeamMetrics() {
  const metrics = useTeamMetrics();
  const feed = useActivityFeed(50);

  const data = metrics.data;
  const totals = data?.totals;

  // Back-pagination: the polling hook owns the freshest first page; older
  // pages are fetched on demand via the `before` cursor and appended below.
  const [olderItems, setOlderItems] = useState<ActivityFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Whenever the live first page refreshes, reset the back-pagination chain so
  // we never show stale or duplicated older rows.
  useEffect(() => {
    if (feed.data) {
      setOlderItems([]);
      setCursor(feed.data.nextCursor);
      setHasMore(feed.data.hasMore);
    }
  }, [feed.data]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchActivityFeedPage(cursor, 50);
      setOlderItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Surface nothing destructive — leave the button to retry.
    } finally {
      setLoadingMore(false);
    }
  };

  const feedItems = [...(feed.data?.items ?? []), ...olderItems];

  return (
    <div className="space-y-4" data-testid="engagement-team-metrics">
      {/* Honest live-telemetry boundary */}
      <div
        className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
        data-testid="ringcentral-boundary"
      >
        <RadioTower className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            RingCentral live events not connected.
          </span>{" "}
          Metrics below are derived from logged call results and engagement
          activity — not real-time dial/connect telemetry.
          {data ? (
            <span className="ml-1 text-slate-400">
              Updated {formatTime12(data.generatedAt)}.
            </span>
          ) : null}
        </div>
      </div>

      {metrics.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : metrics.isError ? (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {metrics.error instanceof Error
            ? metrics.error.message
            : "Failed to load team metrics."}
        </div>
      ) : data && totals ? (
        <>
          {/* Team summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryStat
              label="Calls Today"
              value={totals.completedCalls}
              sub={`of ${totals.completedCallKpi} target`}
              tone="indigo"
            />
            <SummaryStat
              label="Scheduled"
              value={totals.scheduledToday}
              sub={`of ${totals.scheduledKpi} target`}
              tone="emerald"
            />
            <SummaryStat
              label="Calls Remaining"
              value={totals.remainingCallKpi}
              tone="amber"
            />
            <SummaryStat
              label="Active Queue"
              value={totals.activeQueue}
              tone="slate"
            />
            <SummaryStat
              label="Carryover"
              value={totals.carryover}
              tone="rose"
            />
            <SummaryStat
              label="Working"
              value={`${totals.workingMembers}/${totals.members}`}
              sub="members today"
              tone="slate"
            />
          </div>

          {/* Team-level progress toward KPIs */}
          <div
            className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row dark:border-slate-800 dark:bg-slate-900"
            data-testid="team-progress"
          >
            <TeamProgress
              label="Completed calls"
              done={totals.completedCalls}
              target={totals.completedCallKpi}
              tone="indigo"
            />
            <TeamProgress
              label="Scheduled"
              done={totals.scheduledToday}
              target={totals.scheduledKpi}
              tone="emerald"
            />
          </div>

          {/* Team disposition breakdown */}
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Today's dispositions
            </div>
            {totals.completedCalls > 0 ? (
              <DispositionChips d={totals.dispositions} />
            ) : (
              <div className="text-xs text-slate-400">
                No calls logged yet today.
              </div>
            )}
            {data.unattributedCalls > 0 ? (
              <div
                className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
                data-testid="unattributed-calls"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {data.unattributedCalls} call
                {data.unattributedCalls === 1 ? "" : "s"} today could not be
                attributed to a roster member (link team members to user
                accounts in Call Settings).
              </div>
            ) : null}
          </div>

          {/* Two-column: members + activity feed */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <CalendarCheck className="h-3.5 w-3.5" />
                Per team member
              </div>
              {data.members.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                  No team members configured yet.
                </div>
              ) : (
                data.members.map((m) => (
                  <MemberRow key={m.schedulerId} m={m} />
                ))
              )}
            </div>

            {/* Activity feed */}
            <div className="lg:col-span-1">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Activity className="h-3.5 w-3.5" />
                Activity feed
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {feed.isLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  </div>
                ) : feed.isError ? (
                  <div className="px-3 py-4 text-xs text-rose-600 dark:text-rose-400">
                    Failed to load activity.
                  </div>
                ) : feedItems.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-slate-400">
                    No recent activity.
                  </div>
                ) : (
                  <>
                    <ul className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                      {feedItems.map((item) => (
                        <FeedRow key={item.id} item={item} />
                      ))}
                    </ul>
                    {hasMore ? (
                      <div className="border-t border-slate-100 p-2 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={handleLoadMore}
                          disabled={loadingMore}
                          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                          data-testid="button-activity-load-more"
                        >
                          {loadingMore ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Load more
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

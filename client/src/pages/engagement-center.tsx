// Outreach / Engagement Center — the canonical command-center surface
// for engagement assignments. Distinct from Patient Care Specialist
// Workspace (a single team-member's queue) and Scheduler Portal
// (the legacy outreach call surface). /engagement-center is the
// manager-level view over every patient currently routed through
// engagement: who is assigned to whom, what is on follow-up, and what
// needs reassignment.
//
// Backed by /api/engagement/assignment-board (read) and
// /api/engagement/assignment-board/assign (write). Both ride on the
// existing patient_execution_cases + patient_screenings spine — no
// new tables, no parallel call-list store.
//
// Legacy routes:
//   /outreach-center → /scheduler-portal (unchanged, preserves
//                       deep links into the outreach call surface)
//   /scheduler-portal → OutreachPage (unchanged, scheduler call queue)
//   /engagement-center → this page (assignment manager view)

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { EngagementAssignmentBoard } from "@/components/engagement/EngagementAssignmentBoard";
import { EngagementDuplicateBanner } from "@/components/engagement/EngagementDuplicateBanner";

type BoardSummary = {
  total: number;
  assigned: number;
  unassigned: number;
  needsInfo: number;
  byFacility: Array<{ facility: string; count: number }>;
  byAssignedTeamMember: Array<{ name: string; count: number }>;
  byEngagementStatus: Array<{ status: string; count: number }>;
};

type BoardResponse = { rows: unknown[]; summary: BoardSummary };

type SchedulerOption = {
  id: number;
  name: string;
  facility: string;
};

const emptySummary: BoardSummary = {
  total: 0,
  assigned: 0,
  unassigned: 0,
  needsInfo: 0,
  byFacility: [],
  byAssignedTeamMember: [],
  byEngagementStatus: [],
};

export default function EngagementCenterPage() {
  const boardStatus = useQuery<BoardResponse>({
    queryKey: ["/api/engagement/assignment-board", "engagement-center-shell"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/assignment-board", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return (await res.json()) as BoardResponse;
    },
    refetchInterval: 60_000,
  });

  const schedulers = useQuery<SchedulerOption[]>({
    queryKey: ["/api/outreach/schedulers"],
    queryFn: async () => {
      const res = await fetch("/api/outreach/schedulers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load schedulers");
      return (await res.json()) as SchedulerOption[];
    },
  });

  const summary = boardStatus.data?.summary ?? emptySummary;
  const boardLabel = boardStatus.isLoading ? "Syncing" : boardStatus.isError ? "Check board" : "Live";

  const scrollToBoard = () => {
    document
      .querySelector('[data-testid="engagement-assignment-board"]')
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative left-1/2 flex h-full w-screen -translate-x-1/2 flex-col bg-[#EEF1F6] text-[#101115]">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#101115] text-white">
        <div className="flex h-20 w-full items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle-engagement-center" />
            <div>
              <h1
                className="text-base font-medium tracking-[-0.02em] text-white"
                data-testid="text-engagement-center-title"
              >
                Engagement Center
              </h1>
              <div className="mt-1 text-[10px] font-light uppercase tracking-[0.22em] text-slate-400">
                Plexus Assignment Board
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="border border-white bg-white px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-[#101115]">
              Manager
            </span>
            <span className="border border-slate-700 bg-slate-900 px-4 py-2 text-[11px] font-light uppercase tracking-[0.12em] text-slate-300">
              {boardLabel}
            </span>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto bg-[#EEF1F6]">
        <div className="w-full px-6 py-8 lg:px-10">
          <section className="relative mb-5 overflow-hidden rounded-md border border-slate-800 bg-[linear-gradient(135deg,#0D0E12_0%,#171B26_52%,#2A3D5A_100%)] px-8 py-10 text-white shadow-[0_34px_90px_rgba(4,8,16,0.20)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                backgroundSize: "56px 56px",
              }}
              aria-hidden="true"
            />
            <div className="relative z-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="text-[11px] font-light uppercase tracking-[0.22em] text-slate-300">Plexus Clinical</div>
                <div className="mt-4 text-[52px] font-light leading-[0.95] tracking-[-0.055em] sm:text-[62px]">
                  Engagement
                </div>
                <p className="mt-5 max-w-3xl text-[15px] font-light leading-6 text-slate-300">
                  Assign approved patients to the right team member. PCS handles calls. Scheduler handles appointments. ACS handles tests.
                </p>
                <div className="mt-8 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={scrollToBoard}
                    className="rounded-sm border border-white bg-white px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-[#101115]"
                  >
                    Assign selected
                  </button>
                  <button
                    type="button"
                    onClick={scrollToBoard}
                    className="rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white"
                  >
                    Unassigned
                  </button>
                  <button
                    type="button"
                    onClick={scrollToBoard}
                    className="rounded-sm border border-white/20 bg-white/10 px-4 py-2 text-xs font-light uppercase tracking-[0.08em] text-white"
                  >
                    Interested
                  </button>
                </div>
              </div>
              <div className="rounded-sm border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-lg font-medium tracking-[-0.02em] text-white">Board status</div>
                  <div className="text-[11px] font-light uppercase tracking-[0.12em] text-slate-200">{boardLabel}</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-white/15 pt-5">
                  <HeroStat label="Total" value={summary.total} />
                  <HeroStat label="Unassigned" value={summary.unassigned} />
                  <HeroStat label="Assigned" value={summary.assigned} />
                  <HeroStat label="Needs Info" value={summary.needsInfo} />
                </div>
              </div>
            </div>
          </section>

          <EngagementDuplicateBanner />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0">
              <EngagementAssignmentBoard />
            </section>
            <aside className="space-y-4">
              <TeamWorkloadPanel
                schedulers={schedulers.data ?? []}
                assignedCounts={summary.byAssignedTeamMember}
                loading={schedulers.isLoading || boardStatus.isLoading}
              />
              <HandoffPathPanel />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] font-light uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="mt-2 text-3xl font-light tabular-nums text-white">{value}</div>
    </div>
  );
}

function TeamWorkloadPanel({
  schedulers,
  assignedCounts,
  loading,
}: {
  schedulers: SchedulerOption[];
  assignedCounts: BoardSummary["byAssignedTeamMember"];
  loading: boolean;
}) {
  const rows = useMemo(() => {
    const countByName = new Map(assignedCounts.map((item) => [item.name, item.count]));
    if (schedulers.length > 0) {
      return schedulers
        .map((scheduler) => ({
          key: String(scheduler.id),
          name: scheduler.name,
          facility: scheduler.facility || "No facility",
          count: countByName.get(scheduler.name) ?? 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    return assignedCounts
      .map((item) => ({
        key: item.name,
        name: item.name,
        facility: "Assigned team member",
        count: item.count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [assignedCounts, schedulers]);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,.055)]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="text-[11px] font-light uppercase tracking-[0.16em] text-slate-500">Team workload</div>
          <h2 className="mt-2 text-lg font-medium tracking-[-0.025em] text-slate-950">Assignment load</h2>
        </div>
        <span className="border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-light uppercase tracking-[0.12em] text-slate-600">
          Live
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {loading && rows.length === 0 ? (
          <div className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-light text-slate-500">
            Loading team workload…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-light text-slate-500">
            No scheduler workload available yet.
          </div>
        ) : (
          rows.slice(0, 9).map((row) => (
            <div key={row.key} className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium tracking-[-0.01em] text-slate-950">{row.name}</div>
                  <div className="mt-0.5 truncate text-[11px] font-light text-slate-500">{row.facility}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-light tabular-nums text-slate-950">{row.count}</div>
                  <div className="text-[10px] font-light uppercase tracking-[0.12em] text-slate-500">Assigned</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function HandoffPathPanel() {
  const steps = [
    { label: "Approved patient", note: "Released from Plexus IQ review" },
    { label: "PCS calls", note: "Patient engagement and call outcome" },
    { label: "Scheduler appointment", note: "Date, facility, and team member alignment" },
    { label: "ACS tests", note: "Ancillary testing handoff" },
  ];

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,.055)]">
      <div className="border-b border-slate-100 pb-4">
        <div className="text-[11px] font-light uppercase tracking-[0.16em] text-slate-500">Handoff path</div>
        <h2 className="mt-2 text-lg font-medium tracking-[-0.025em] text-slate-950">Engagement flow</h2>
      </div>
      <div className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <div key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-6 w-6 items-center justify-center rounded-sm border border-slate-300 bg-slate-50 text-[11px] font-light tabular-nums text-slate-700">
                {index + 1}
              </div>
              {index < steps.length - 1 && <div className="mt-2 h-6 w-px bg-slate-200" />}
            </div>
            <div className="min-w-0 pb-1">
              <div className="text-sm font-medium tracking-[-0.01em] text-slate-950">{step.label}</div>
              <div className="mt-0.5 text-[11px] font-light leading-4 text-slate-500">{step.note}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

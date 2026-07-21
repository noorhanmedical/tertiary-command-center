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
// Layout: a modern 3-zone command center —
//   left   · smart-filter rail (client-side derived buckets)
//   center · patient worklist grouped by due window
//   right  · case detail + assignment panel
//
// Legacy routes:
//   /outreach-center → /scheduler-portal (unchanged)
//   /scheduler-portal → OutreachPage (unchanged)
//   /engagement-center → this page (assignment manager view)

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  resolveEngagementTab,
  buildEngagementTabSearchString,
  ENGAGEMENT_TAB_REPOSITORY,
  type EngagementTab,
} from "@/lib/engagementRepositoryTab";
import { EngagementRepository } from "@/components/engagement/EngagementRepository";
import { Search, Shuffle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EngagementWorklist } from "@/components/engagement/EngagementAssignmentBoard";
import { EngagementDuplicateBanner } from "@/components/engagement/EngagementDuplicateBanner";
import { EngagementFilterRail } from "@/components/engagement/EngagementFilterRail";
import { EngagementCasePanel } from "@/components/engagement/EngagementCasePanel";
import { EngagementCallSettings } from "@/components/engagement/EngagementCallSettings";
import { EngagementDistributionPanel } from "@/components/engagement/EngagementDistributionPanel";
import { EngagementTeamMetrics } from "@/components/engagement/EngagementTeamMetrics";
import {
  type BoardResponse,
  type BoardRow,
  type SchedulerOption,
  type AssignedRole,
  type SmartFilterKey,
  countBySmartFilter,
  matchesSmartFilter,
  buildMemberLoadMap,
} from "@/components/engagement/engagementShared";

const ALL = "__all";

function HeaderMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "rose" | "indigo";
}) {
  const toneClass: Record<typeof tone, string> = {
    slate: "text-slate-900 dark:text-white",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
  };
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900"
      data-testid={`engagement-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass[tone]}`}>
        {value}
      </div>
    </div>
  );
}

export default function EngagementCenterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>(ALL);
  const [teamFilter, setTeamFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [smartFilter, setSmartFilter] = useState<SmartFilterKey>("all");
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  // Exactly three tabs. Distribution is an ACTION inside Assignment Pool
  // (the Auto-Distribute dialog + the per-selection round-robin in the
  // worklist toolbar), never its own tab.
  // Phase 2C — Repository tab wiring. When
  // FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY is ON, the default tab
  // is Repository AND the URL ?tab= param is honored. When OFF, the
  // legacy default ("pool") + existing three tabs are preserved
  // exactly. Stale localStorage referring to "repository" is REJECTED
  // by the resolver while the flag is OFF.
  const multiListFlagOn = (() => {
    try {
      return (import.meta as { env?: Record<string, string | undefined> })?.env
        ?.VITE_FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY === "true";
    } catch {
      return false;
    }
  })();
  const recentListsFlagOn = (() => {
    try {
      return (import.meta as { env?: Record<string, string | undefined> })?.env
        ?.VITE_FEATURE_ENGAGEMENT_RECENT_LISTS === "true";
    } catch {
      return false;
    }
  })();
  const initialTab = (): EngagementTab => {
    if (typeof window === "undefined") return multiListFlagOn ? ENGAGEMENT_TAB_REPOSITORY : "pool";
    // Saved preference is intentionally NOT read from localStorage
    // here — the spec forbids stale saved tabs from overriding the
    // Repository fallback.
    return resolveEngagementTab(window.location.search, multiListFlagOn);
  };
  const [view, setView] = useState<EngagementTab>(initialTab);

  // URL sync (bidirectional): when `setView` is called, mirror to the
  // URL; when the browser back/forward changes the URL, mirror back
  // to state. Only active when the multi-list flag is ON; otherwise
  // legacy behavior is preserved.
  useEffect(() => {
    if (!multiListFlagOn || typeof window === "undefined") return;
    const newSearch = buildEngagementTabSearchString(window.location.search, view);
    if (newSearch !== window.location.search) {
      window.history.replaceState({}, "", `${window.location.pathname}${newSearch}${window.location.hash}`);
    }
  }, [view, multiListFlagOn]);
  useEffect(() => {
    if (!multiListFlagOn || typeof window === "undefined") return;
    const onPop = () => {
      setView(resolveEngagementTab(window.location.search, multiListFlagOn));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [multiListFlagOn]);
  const [distributeOpen, setDistributeOpen] = useState(false);

  const board = useQuery<BoardResponse>({
    queryKey: ["/api/engagement/assignment-board", "command"],
    queryFn: async () => {
      const res = await fetch("/api/engagement/assignment-board", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load board (${res.status})`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const schedulersQuery = useQuery<SchedulerOption[]>({
    queryKey: ["/api/outreach/schedulers"],
  });
  const schedulers = schedulersQuery.data ?? [];

  const allRows = useMemo<BoardRow[]>(() => board.data?.rows ?? [], [board.data]);

  // Board-wide open-case load per team member, so the assignment pickers can
  // show how busy each member already is regardless of the current filter.
  const memberLoad = useMemo(() => buildMemberLoadMap(allRows), [allRows]);

  // Distinct option lists from the live rows.
  const facilityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.facility) set.add(r.facility);
    return Array.from(set).sort();
  }, [allRows]);

  const teamOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRows) {
      if (r.assignedTeamMemberId != null && r.assignedName) {
        map.set(r.assignedTeamMemberId, r.assignedName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allRows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) if (r.engagementStatus) set.add(r.engagementStatus);
    return Array.from(set).sort();
  }, [allRows]);

  // Header filters narrow first; smart-filter counts reflect the
  // header-narrowed set so the rail stays consistent with the toolbar.
  const headerFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allRows.filter((r) => {
      if (clinicFilter !== ALL && r.facility !== clinicFilter) return false;
      if (teamFilter !== ALL && String(r.assignedTeamMemberId ?? "") !== teamFilter)
        return false;
      if (statusFilter !== ALL && r.engagementStatus !== statusFilter) return false;
      if (needle) {
        const hay = [
          r.patientName,
          r.patientDob,
          r.facility,
          r.phoneNumber,
          r.assignedName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, q, clinicFilter, teamFilter, statusFilter]);

  const smartCounts = useMemo(
    () => countBySmartFilter(headerFiltered),
    [headerFiltered],
  );

  const visibleRows = useMemo(
    () => headerFiltered.filter((r) => matchesSmartFilter(r, smartFilter)),
    [headerFiltered, smartFilter],
  );

  const selectedRow = useMemo(
    () => allRows.find((r) => r.executionCaseId === selectedCaseId) ?? null,
    [allRows, selectedCaseId],
  );

  function invalidateBoard() {
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        (query.queryKey[0] === "/api/engagement/assignment-board" ||
          query.queryKey[0] === "/api/engagement/baskets" ||
          query.queryKey[0] === "engagement-assignment" ||
          query.queryKey[0] === "team-workspace-call-list"),
    });
  }

  const assignMutation = useMutation({
    mutationFn: async (vars: {
      patientScreeningIds: number[];
      schedulerId: number;
      assignedRole?: AssignedRole;
      reason?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        "/api/engagement/assignment-board/assign",
        vars,
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateBoard();
      toast({
        title: "Assignment saved",
        description: `${vars.patientScreeningIds.length} patient${
          vars.patientScreeningIds.length === 1 ? "" : "s"
        } assigned.`,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Assignment failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (vars: { executionCaseIds: number[] }) => {
      const res = await apiRequest(
        "POST",
        "/api/engagement/assignment-board/cancel-many",
        vars,
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateBoard();
      if (vars.executionCaseIds.includes(selectedCaseId ?? -1)) {
        setSelectedCaseId(null);
      }
      toast({ title: "Removed from Engagement Center" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function handleAssign(
    patientScreeningIds: number[],
    schedulerId: number,
    opts?: { reason?: string; role?: AssignedRole },
  ) {
    assignMutation.mutate({
      patientScreeningIds,
      schedulerId,
      assignedRole: opts?.role,
      reason: opts?.reason,
    });
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Plexus Ancillary · Engagement Center
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white"
              data-testid="text-engagement-center-title"
            >
              Engagement Center
            </h1>
          </div>

          {/* View switcher — exactly three tabs */}
          <div
            className="ml-auto inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800"
            data-testid="engagement-view-switcher"
          >
            {multiListFlagOn ? (
              <button
                type="button"
                onClick={() => setView("repository")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === "repository"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                data-testid="button-view-repository"
              >
                Repository
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setView("pool")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "pool"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              data-testid="button-view-assignment-pool"
            >
              Assignment Pool
            </button>
            <button
              type="button"
              onClick={() => setView("callResults")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "callResults"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              data-testid="button-view-call-results"
            >
              Call Results
            </button>
            <button
              type="button"
              onClick={() => setView("callSettings")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "callSettings"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
              data-testid="button-view-call-settings"
            >
              Call Settings
            </button>
          </div>

          {/* Distribution as an ACTION inside Assignment Pool */}
          {view === "pool" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => setDistributeOpen(true)}
              data-testid="button-open-auto-distribute"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Auto-Distribute
            </Button>
          ) : null}

          {/* Search */}
          {view === "pool" ? (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, DOB, facility…"
              className="h-9 pl-8 text-sm"
              data-testid="input-engagement-search"
            />
          </div>
          ) : null}

          {/* Header filters */}
          {view === "pool" ? (
          <>
          <Select value={clinicFilter} onValueChange={setClinicFilter}>
            <SelectTrigger className="h-9 w-[150px] text-xs" data-testid="select-engagement-clinic">
              <SelectValue placeholder="All clinics" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All clinics</SelectItem>
              {facilityOptions.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="h-9 w-[150px] text-xs" data-testid="select-engagement-team">
              <SelectValue placeholder="Any team member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any team member</SelectItem>
              {teamOptions.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[140px] text-xs" data-testid="select-engagement-status">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </>
          ) : null}
        </div>

        {/* Summary strip */}
        {view === "pool" ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6">
          <HeaderMetric label="Ready to Assign" value={smartCounts.ready_to_assign} tone="indigo" />
          <HeaderMetric label="Due Today" value={smartCounts.due_today} tone="emerald" />
          <HeaderMetric label="Follow-up" value={smartCounts.follow_up} tone="slate" />
          <HeaderMetric label="Callbacks" value={smartCounts.callbacks} tone="amber" />
          <HeaderMetric label="Blocked" value={smartCounts.blocked} tone="rose" />
        </div>
        ) : null}
      </header>

      {view === "repository" ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <EngagementRepository
              multiListFlagOn={multiListFlagOn}
              recentListsFlagOn={recentListsFlagOn}
            />
          </div>
        </main>
      ) : view === "callSettings" ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <EngagementCallSettings />
          </div>
        </main>
      ) : view === "callResults" ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <EngagementTeamMetrics />
          </div>
        </main>
      ) : (
      /* Assignment Pool — Repository-style 3-zone body */
      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 dark:border-slate-800 dark:bg-slate-900 lg:block">
          <EngagementFilterRail
            counts={smartCounts}
            active={smartFilter}
            onChange={setSmartFilter}
          />
        </aside>

        {/* Center worklist */}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <EngagementDuplicateBanner />
            <EngagementWorklist
              rows={visibleRows}
              loading={board.isLoading}
              schedulers={schedulers}
              memberLoad={memberLoad}
              selectedCaseId={selectedCaseId}
              assigning={assignMutation.isPending}
              cancelling={cancelMutation.isPending}
              removingCaseId={
                cancelMutation.isPending &&
                cancelMutation.variables?.executionCaseIds.length === 1
                  ? cancelMutation.variables.executionCaseIds[0]
                  : null
              }
              onSelectCase={setSelectedCaseId}
              onAssign={handleAssign}
              onCancel={(ids) =>
                cancelMutation.mutate({ executionCaseIds: ids })
              }
            />
          </div>
        </main>

        {/* Right case panel */}
        <aside className="hidden w-[360px] shrink-0 overflow-hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:block">
          <EngagementCasePanel
            row={selectedRow}
            schedulers={schedulers}
            memberLoad={memberLoad}
            assigning={assignMutation.isPending}
            cancelling={cancelMutation.isPending}
            onAssign={handleAssign}
            onCancel={(ids) => cancelMutation.mutate({ executionCaseIds: ids })}
            onClose={() => setSelectedCaseId(null)}
          />
        </aside>
      </div>
      )}

      {/* Auto-Distribute — the distribution engine surfaced as an action
          inside the Assignment Pool (not a standalone tab). */}
      <Dialog open={distributeOpen} onOpenChange={setDistributeOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auto-Distribute Assignments</DialogTitle>
            <DialogDescription>
              Preview and apply a balanced distribution of unassigned cases
              across your team.
            </DialogDescription>
          </DialogHeader>
          <EngagementDistributionPanel />
        </DialogContent>
      </Dialog>
    </div>
  );
}

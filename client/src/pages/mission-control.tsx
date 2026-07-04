// Mission Control — executive operations command center (MONITORING ONLY).
//
// CRITICAL BOUNDARY: Qualification does NOT happen here (that lives in
// Plexus IQ / Admin Review). Mission Control only MONITORS live operations
// after patients/services have entered execution. There are no qualify or
// approve actions on this surface — only observe, triage routing, and
// hand-off (send to Engagement / Scheduler / Billing).
//
// Demo data + domain types live in
// `client/src/lib/enterprise-demo/`. When the backend ships, swap the
// `missionControlDemoData` import for a TanStack Query hook.

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Radar,
  Users,
  PhoneCall,
  CalendarClock,
  FlaskConical,
  FileWarning,
  Receipt,
  DollarSign,
  ShieldAlert,
  TriangleAlert,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  ChevronRight,
  RefreshCw,
  CircleDashed,
  Layers,
  Building2,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MissionControlWorkbench } from "@/components/mission-control/MissionControlWorkbench";
import type {
  LaneStatus,
  Priority,
  Severity,
  QueueKey,
  MissionControlLaneRow,
  MissionControlQueueTile,
  MissionControlKpi,
} from "@/lib/enterprise-demo/types";
// TODO API: replace these demo imports with a TanStack Query call to
// `/api/mission-control/snapshot` (or equivalent) when the backend ships.
import {
  MISSION_CONTROL_CLINICS as CLINICS,
  MISSION_CONTROL_SERVICES as SERVICES,
  MISSION_CONTROL_QUEUE_DEFS as queueDefs,
  MISSION_CONTROL_QUEUE_LABEL as queueLabel,
  MISSION_CONTROL_LANES as LANES,
  MISSION_CONTROL_ALERTS as ALERTS,
  MISSION_CONTROL_SECTIONS as OPS_SECTIONS,
} from "@/lib/enterprise-demo/missionControlDemoData";
import {
  enterpriseBackendPendingToast,
  isEnterpriseDemoFallbackEnabled,
} from "@/lib/enterprise-demo/demoMode";
import { DemoFallbackBanner } from "@/components/enterprise-demo/DemoFallbackBanner";
import { Badge } from "@/components/ui/badge";

/* ───────────────────────── Style maps ───────────────────────── */

const statusStyles: Record<LaneStatus, string> = {
  Watch: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
  Blocked: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  Ready: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Progress": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Complete: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const priorityStyles: Record<Priority, string> = {
  Urgent: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const severityStyles: Record<Severity, string> = {
  Critical: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
};

const severityCardTone: Record<Severity, string> = {
  Critical: "border-red-200 bg-red-50/60",
  High: "border-orange-200 bg-orange-50/60",
  Medium: "border-amber-200 bg-amber-50/60",
  Low: "border-sky-200 bg-sky-50/60",
};


/* ───────────────────────── Helpers ───────────────────────── */

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/* ───────────────────────── Component ───────────────────────── */

export default function MissionControlPage() {
  const { toast } = useToast();

  // Simulated view state to demonstrate loading / empty / error / success.
  const demoFallbackOn = isEnterpriseDemoFallbackEnabled();
  const [view, setView] = useState<"success" | "loading" | "empty" | "error">("success");

  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dueFilter, setDueFilter] = useState<string>("all");
  const [activeQueue, setActiveQueue] = useState<QueueKey | "all">("all");

  const [selected, setSelected] = useState<MissionControlLaneRow | null>(null);

  const baseLanes = view === "empty" ? [] : LANES;

  // Queue tile counts derive from the lane data.
  const queueTiles: MissionControlQueueTile[] = useMemo(() => {
    return queueDefs.map((q) => ({
      key: q.key,
      label: q.label,
      Icon: q.Icon,
      trend: q.trend,
      tone: q.tone,
      count: baseLanes.filter((l) => l.lane === q.key).length,
    }));
  }, [baseLanes]);

  // Executive KPIs derive from lanes + mock revenue figures.
  const kpis: MissionControlKpi[] = useMemo(() => {
    const readyToCall = baseLanes.filter((l) => l.lane === "ready-to-call").length;
    const ancillaryPending = baseLanes.filter((l) => l.lane === "pending-ancillary").length;
    const reportsMissing = baseLanes.filter((l) => l.lane === "no-report").length;
    const billingReady = baseLanes.filter((l) => l.lane === "billing-ready").length;
    const blocked = baseLanes.filter((l) => l.status === "Blocked").length;
    const scheduled = baseLanes.filter((l) => l.imagingStatus === "Scheduled" || l.imagingStatus === "In field").length;
    return [
      { label: "Active Clinics", value: String(CLINICS.length), Icon: Building2, tone: "bg-slate-100 text-slate-700" },
      { label: "In Pipeline", value: String(baseLanes.length), Icon: Users, tone: "bg-indigo-100 text-indigo-700" },
      { label: "Ready to Call", value: String(readyToCall), Icon: PhoneCall, tone: "bg-blue-100 text-blue-700" },
      { label: "Scheduled", value: String(scheduled), Icon: CalendarClock, tone: "bg-violet-100 text-violet-700" },
      { label: "Ancillary Pending", value: String(ancillaryPending), Icon: FlaskConical, tone: "bg-amber-100 text-amber-700" },
      { label: "Reports Missing", value: String(reportsMissing), Icon: FileWarning, tone: "bg-rose-100 text-rose-700" },
      { label: "Billing Ready", value: String(billingReady), Icon: Receipt, tone: "bg-emerald-100 text-emerald-700" },
      { label: "Paid Revenue", value: fmtMoney(248000), Icon: DollarSign, tone: "bg-emerald-100 text-emerald-700" },
      { label: "Blocked Items", value: String(blocked), Icon: ShieldAlert, tone: "bg-red-100 text-red-700" },
      { label: "Urgent Alerts", value: String(ALERTS.filter((a) => a.severity === "Critical" || a.severity === "High").length), Icon: TriangleAlert, tone: "bg-orange-100 text-orange-700" },
    ];
  }, [baseLanes]);

  const filteredLanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseLanes.filter((l) => {
      if (activeQueue !== "all" && l.lane !== activeQueue) return false;
      if (clinicFilter !== "all" && l.clinic !== clinicFilter) return false;
      if (serviceFilter !== "all" && l.service !== serviceFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (priorityFilter !== "all" && l.priority !== priorityFilter) return false;
      if (dueFilter !== "all") {
        const due = new Date(l.dueDate).getTime();
        const today = new Date("2025-06-11").getTime();
        if (dueFilter === "overdue" && !(due < today)) return false;
        if (dueFilter === "today" && new Date(l.dueDate).toDateString() !== new Date("2025-06-11").toDateString()) return false;
        if (dueFilter === "upcoming" && !(due > today)) return false;
      }
      if (q && !(`${l.patient} ${l.patientId} ${l.clinic} ${l.service} ${l.ancillary}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [baseLanes, activeQueue, clinicFilter, serviceFilter, statusFilter, priorityFilter, dueFilter, search]);

  const resetFilters = () => {
    setSearch("");
    setClinicFilter("all");
    setServiceFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDueFilter("all");
    setActiveQueue("all");
  };

  // MVP production-readiness: every action button surfaces an honest
  // "Backend endpoint pending" toast instead of a fake success message.
  // The backend mutation for these routing actions ships separately.
  const fireAction = (action: string) =>
    toast(enterpriseBackendPendingToast(action));

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700">
              <Radar className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-900" data-testid="text-mission-control-title">
                Mission Control
              </h1>
              <p className="text-sm text-slate-500">Executive operations command center</p>
            </div>
          </div>
          {/* Developer preview controls — only visible when the demo
              fallback flag is enabled (localStorage.enterpriseDemoMode=1).
              Hidden in normal production navigation. */}
          {demoFallbackOn && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Developer preview controls</Badge>
              <div className="w-44">
                <Select value={view} onValueChange={(v) => setView(v as typeof view)}>
                  <SelectTrigger data-testid="select-demo-view" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Live data</SelectItem>
                    <SelectItem value="loading">Loading state</SelectItem>
                    <SelectItem value="empty">Empty state</SelectItem>
                    <SelectItem value="error">Error state</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        <DemoFallbackBanner
          testId="mission-control-demo-banner"
          context="Mission Control is monitoring-only. The lanes, queues, alerts, and ops sections below render from local mock data. Backend reads (lanes feed, alerts feed, ops counts) wire in a follow-up PR; backend writes (Mark Ready / Mark Blocked / route handoffs) ship later still."
        />
        {/* LOADING */}
        {view === "loading" && (
          <div className="space-y-6" data-testid="status-mission-control-loading">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}

        {/* ERROR */}
        {view === "error" && (
          <Card className="rounded-xl border-red-200 bg-red-50/60 p-10 text-center" data-testid="status-mission-control-error">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <div className="text-base font-semibold text-red-700">Couldn't load operations data</div>
            <p className="text-sm text-red-600/80 mt-1">A monitoring feed is temporarily unavailable. Please refresh to try again.</p>
            <Button variant="outline" className="mt-4" onClick={() => setView("success")} data-testid="button-retry">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        )}

        {(view === "success" || view === "empty") && (
          <>
            {/* 1. Executive KPI header */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-kpis">
              {kpis.map((k) => (
                <Card key={k.label} className="rounded-xl border-slate-200 p-4 flex items-center gap-3" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${k.tone}`}>
                    <k.Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xl font-bold tabular-nums text-slate-900 truncate">{k.value}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">{k.label}</div>
                  </div>
                </Card>
              ))}
            </div>

            {/* 2. Operational queue tiles */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Operational Queues</h2>
                {activeQueue !== "all" && (
                  <Button variant="ghost" size="sm" onClick={() => setActiveQueue("all")} data-testid="button-clear-queue">
                    Clear queue filter
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-queues">
                {queueTiles.map((t) => {
                  const isActive = activeQueue === t.key;
                  const up = t.trend >= 0;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveQueue(isActive ? "all" : t.key)}
                      className={`text-left rounded-xl border p-4 transition-colors hover-elevate active-elevate-2 ${
                        isActive ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200" : "border-slate-200 bg-white"
                      }`}
                      data-testid={`queue-tile-${t.key}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${t.tone}`}>
                          <t.Icon className="w-4 h-4" />
                        </span>
                        <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {Math.abs(t.trend)}%
                        </span>
                      </div>
                      <div className="text-2xl font-bold tabular-nums text-slate-900 mt-2" data-testid={`queue-count-${t.key}`}>{t.count}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{t.label}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 7. Search & filters */}
            <Card className="rounded-xl border-slate-200 p-4" data-testid="mission-control-filters">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search patient, clinic, or service…"
                    className="pl-9 h-9"
                    data-testid="input-search-lanes"
                  />
                </div>
                <Select value={clinicFilter} onValueChange={setClinicFilter}>
                  <SelectTrigger className="h-9 w-[190px]" data-testid="select-filter-clinic"><SelectValue placeholder="Clinic" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clinics</SelectItem>
                    {CLINICS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-service"><SelectValue placeholder="Service" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    {SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {(["Watch", "Blocked", "Ready", "In Progress", "Complete"] as LaneStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {(["Urgent", "High", "Medium", "Low"] as Priority[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={dueFilter} onValueChange={setDueFilter}>
                  <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-due"><SelectValue placeholder="Due date" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any due date</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="today">Due today</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-9" onClick={resetFilters} data-testid="button-reset-filters">
                  Reset
                </Button>
              </div>
            </Card>

            {/* 3. Operational lanes table */}
            <Card className="rounded-xl border-slate-200 overflow-hidden" data-testid="mission-control-lanes">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-700">Operational Lanes</span>
                  {activeQueue !== "all" && (
                    <span className="rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-xs font-medium">
                      {queueLabel[activeQueue]}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500 tabular-nums" data-testid="text-lane-count">{filteredLanes.length} lanes</span>
              </div>

              {filteredLanes.length === 0 ? (
                <div className="py-16 text-center" data-testid="status-lanes-empty">
                  <CircleDashed className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No lanes match the current filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead>
                        <TableHead>Clinic</TableHead>
                        <TableHead>Service / Ancillary</TableHead>
                        <TableHead>Lane</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Last action</TableHead>
                        <TableHead>Next action</TableHead>
                        <TableHead>Blocker</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLanes.map((l) => (
                        <TableRow
                          key={l.id}
                          className="cursor-pointer"
                          onClick={() => setSelected(l)}
                          data-testid={`lane-row-${l.id}`}
                        >
                          <TableCell>
                            <div className="font-medium text-slate-800">{l.patient}</div>
                            <div className="text-[11px] text-slate-400 tabular-nums">{l.patientId}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{l.clinic}</TableCell>
                          <TableCell>
                            <div className="text-slate-700">{l.service}</div>
                            <div className="text-[11px] text-slate-400">{l.ancillary}</div>
                          </TableCell>
                          <TableCell className="text-slate-600 text-xs">{l.laneLabel}</TableCell>
                          <TableCell><span className={statusStyles[l.status]}>{l.status}</span></TableCell>
                          <TableCell className="text-slate-600 text-xs">{l.owner}</TableCell>
                          <TableCell className="text-slate-500 text-xs">{l.lastAction}</TableCell>
                          <TableCell className="text-slate-700 text-xs">{l.nextAction}</TableCell>
                          <TableCell className="text-xs">
                            {l.blocker ? <span className="text-red-600">{l.blocker}</span> : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className="text-slate-500 text-xs tabular-nums">{l.dueDate}</TableCell>
                          <TableCell><span className={priorityStyles[l.priority]}>{l.priority}</span></TableCell>
                          <TableCell><ChevronRight className="w-4 h-4 text-slate-300" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            {/* 5. Alerts section */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Active Alerts</h2>
              {ALERTS.length === 0 ? (
                <Card className="rounded-xl border-slate-200 p-8 text-center text-sm text-slate-500" data-testid="status-alerts-empty">
                  No active alerts.
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="mission-control-alerts">
                  {ALERTS.map((a) => (
                    <Card key={a.id} className={`rounded-xl border p-4 ${severityCardTone[a.severity]}`} data-testid={`alert-${a.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/70 text-slate-700 shrink-0">
                          <a.Icon className="w-4 h-4" />
                        </span>
                        <span className={severityStyles[a.severity]}>{a.severity}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">{a.title}</div>
                      <p className="text-xs text-slate-600 mt-1">{a.detail}</p>
                      <div className="text-[11px] text-slate-400 mt-2">{a.clinic}</div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* 6. Expandable ops sections */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Operations Detail</h2>
              <Card className="rounded-xl border-slate-200 px-4 py-2" data-testid="mission-control-sections">
                <Accordion type="multiple" className="w-full">
                  {OPS_SECTIONS.map((s) => (
                    <AccordionItem key={s.id} value={s.id} data-testid={`section-${s.id}`}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2 flex-1 mr-3">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-600 shrink-0">
                            <s.Icon className="w-4 h-4" />
                          </span>
                          <span className="text-sm font-medium text-slate-800">{s.title}</span>
                          <div className="ml-auto hidden sm:flex items-center gap-3">
                            {s.metrics.map((m) => (
                              <span key={m.label} className="text-[11px] text-slate-500">
                                {m.label} <span className="font-semibold text-slate-800 tabular-nums">{m.value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="overflow-x-auto pb-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Metric</TableHead>
                                <TableHead>Value</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {s.rows.map((r) => (
                                <TableRow key={r.label} data-testid={`section-row-${s.id}-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                                  <TableCell className="text-slate-700">{r.label}</TableCell>
                                  <TableCell className="text-slate-800 tabular-nums">{r.value}</TableCell>
                                  <TableCell><span className={statusStyles[r.status]}>{r.status}</span></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </Card>
            </section>
          </>
        )}
      </main>

      {/* 4. Lane Workbench (right Sheet) — extracted to its own component. */}
      <MissionControlWorkbench
        selected={selected}
        onClose={() => setSelected(null)}
        onAction={fireAction}
      />
    </div>
  );
}

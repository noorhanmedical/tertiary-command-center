// Mission Control — executive operations command center (MONITORING ONLY).
//
// CRITICAL BOUNDARY: Qualification does NOT happen here (that lives in
// Plexus IQ / Admin Review). Mission Control only MONITORS live operations
// after patients/services have entered execution. There are no qualify or
// approve actions on this surface — only observe, triage routing, and
// hand-off (send to Engagement / Scheduler / Billing).
//
// All data is sourced live from GET /api/mission-control/spine. Sections
// that have no underlying source yet render an honest "Not available" state
// via the { value, sourceMissing } wrappers — never a fabricated number.

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
  Search,
  ChevronRight,
  Activity,
  ClipboardList,
  RefreshCw,
  XCircle,
  CircleDashed,
  Send,
  UserCog,
  Layers,
  AlertTriangle,
  PhoneOff,
  ExternalLink,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useMissionControlSpine,
  type MissionControlSpine,
  type MissionLaneRow,
  type MissionLaneKey,
  type MissionLaneStatus,
  type MissionPriority,
  type Wrapped,
} from "@/hooks/api/missionControl";
import { formatCurrency } from "@/lib/format";

/* ───────────────────────── Style maps ───────────────────────── */

const statusStyles: Record<MissionLaneStatus, string> = {
  Watch: "rounded-md bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs font-medium",
  Blocked: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  Ready: "rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium",
  "In Progress": "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Complete: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

const priorityStyles: Record<MissionPriority, string> = {
  Urgent: "rounded-md bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-xs font-medium",
  High: "rounded-md bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 text-xs font-medium",
  Medium: "rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium",
  Low: "rounded-md bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 text-xs font-medium",
};

/* ───────────────────────── Spine card config ───────────────────────── */

type QueueKey = MissionLaneKey | "tasks";

const SPINE_CARDS: {
  key: QueueKey;
  spineKey: keyof MissionControlSpine["spine"];
  laneKey?: MissionLaneKey;
  label: string;
  Icon: typeof Users;
  tone: string;
}[] = [
  { key: "prescreen", spineKey: "prescreen", laneKey: "prescreen", label: "Prescreen", Icon: ClipboardList, tone: "bg-slate-100 text-slate-700" },
  { key: "ready-to-call", spineKey: "readyToCall", laneKey: "ready-to-call", label: "Ready to Call", Icon: PhoneCall, tone: "bg-blue-100 text-blue-700" },
  { key: "follow-up", spineKey: "followUp", laneKey: "follow-up", label: "Follow-up", Icon: RefreshCw, tone: "bg-indigo-100 text-indigo-700" },
  { key: "callbacks", spineKey: "callbacks", laneKey: "callbacks", label: "Callbacks", Icon: PhoneCall, tone: "bg-violet-100 text-violet-700" },
  { key: "pending-ancillary", spineKey: "pending", laneKey: "pending-ancillary", label: "Pending Ancillary", Icon: FlaskConical, tone: "bg-amber-100 text-amber-700" },
  { key: "no-report", spineKey: "noReport", laneKey: "no-report", label: "No Report", Icon: FileWarning, tone: "bg-rose-100 text-rose-700" },
  { key: "re-eligible", spineKey: "reEligible", laneKey: "re-eligible", label: "Re-Eligible", Icon: Activity, tone: "bg-teal-100 text-teal-700" },
  { key: "declined", spineKey: "declined", laneKey: "declined", label: "Declined", Icon: XCircle, tone: "bg-slate-100 text-slate-600" },
  { key: "billing-ready", spineKey: "readyForBilling", laneKey: "billing-ready", label: "Billing Ready", Icon: Receipt, tone: "bg-emerald-100 text-emerald-700" },
  { key: "tasks", spineKey: "tasks", label: "Open Tasks", Icon: Layers, tone: "bg-orange-100 text-orange-700" },
];

const laneLabel: Record<MissionLaneKey, string> = {
  "prescreen": "Prescreen",
  "ready-to-call": "Ready to Call",
  "follow-up": "Follow-up",
  "callbacks": "Callbacks",
  "pending-ancillary": "Pending Ancillary",
  "no-report": "No Report",
  "re-eligible": "Re-Eligible",
  "declined": "Declined",
  "billing-ready": "Billing Ready",
  "blocked": "Blocked",
};

/* ───────────────────────── Helpers ───────────────────────── */

function WrappedValue({ w, fmt }: { w: Wrapped<number>; fmt?: (n: number) => string }) {
  if (w.sourceMissing) {
    return <span className="text-slate-300 text-base font-medium">N/A</span>;
  }
  return <>{fmt ? fmt(w.value) : w.value.toLocaleString("en-US")}</>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

function SourceMissingNote() {
  return <span className="text-[11px] text-slate-400 italic">No source connected yet</span>;
}

/* ───────────────────────── Component ───────────────────────── */

export default function MissionControlPage() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useMissionControlSpine();

  const [search, setSearch] = useState("");
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [activeQueue, setActiveQueue] = useState<MissionLaneKey | "all">("all");
  const [selected, setSelected] = useState<MissionLaneRow | null>(null);

  const lanes = data?.lanes ?? [];

  const filteredLanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lanes.filter((l) => {
      if (activeQueue !== "all" && l.lane !== activeQueue) return false;
      if (clinicFilter !== "all" && l.clinic !== clinicFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (priorityFilter !== "all" && l.priority !== priorityFilter) return false;
      if (ownerFilter !== "all" && l.owner !== ownerFilter) return false;
      if (q && !(`${l.patient} ${l.clinic} ${l.service} ${l.owner}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [lanes, activeQueue, clinicFilter, statusFilter, priorityFilter, ownerFilter, search]);

  const resetFilters = () => {
    setSearch("");
    setClinicFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
    setOwnerFilter("all");
    setActiveQueue("all");
  };

  const fireAction = (title: string, description: string) => toast({ title, description });

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader onRefresh={refetch} isFetching={isFetching} />
        <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6" data-testid="status-mission-control-loading">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </main>
      </div>
    );
  }

  /* ── Error ── */
  if (isError || !data) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader onRefresh={refetch} isFetching={isFetching} />
        <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6">
          <Card className="rounded-xl border-red-200 bg-red-50/60 p-10 text-center" data-testid="status-mission-control-error">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <div className="text-base font-semibold text-red-700">Couldn't load operations data</div>
            <p className="text-sm text-red-600/80 mt-1">A monitoring feed is temporarily unavailable. Please refresh to try again.</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()} data-testid="button-retry">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const { spine, sections, roleQueues, ringCentral } = data;
  const clinics = data.clinics;
  const owners = data.owners;

  return (
    <div className="flex flex-col h-full">
      <PageHeader onRefresh={refetch} isFetching={isFetching} generatedAt={data.generatedAt} />

      <main className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6 space-y-6">
        {/* 1. Execution spine summary */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Execution Spine</h2>
            {activeQueue !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setActiveQueue("all")} data-testid="button-clear-queue">
                Clear queue filter
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-spine">
            {SPINE_CARDS.map((c) => {
              const w = spine[c.spineKey];
              const clickable = !!c.laneKey;
              const isActive = c.laneKey && activeQueue === c.laneKey;
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => c.laneKey && setActiveQueue(isActive ? "all" : c.laneKey)}
                  className={`text-left rounded-xl border p-4 transition-colors ${clickable ? "hover-elevate active-elevate-2" : "cursor-default"} ${
                    isActive ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200" : "border-slate-200 bg-white"
                  }`}
                  data-testid={`spine-card-${c.key}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${c.tone}`}>
                      <c.Icon className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-slate-900 mt-2" data-testid={`spine-count-${c.key}`}>
                    <WrappedValue w={w} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{c.label}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Search & filters */}
        <Card className="rounded-xl border-slate-200 p-4" data-testid="mission-control-filters">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient, clinic, service, or owner…"
                className="pl-9 h-9"
                data-testid="input-search-lanes"
              />
            </div>
            <Select value={clinicFilter} onValueChange={setClinicFilter}>
              <SelectTrigger className="h-9 w-[190px]" data-testid="select-filter-clinic"><SelectValue placeholder="Clinic" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clinics</SelectItem>
                {clinics.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="h-9 w-[170px]" data-testid="select-filter-owner"><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(["Watch", "Blocked", "Ready", "In Progress", "Complete"] as MissionLaneStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {(["Urgent", "High", "Medium", "Low"] as MissionPriority[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
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
                  {laneLabel[activeQueue]}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-500 tabular-nums" data-testid="text-lane-count">{filteredLanes.length} lanes</span>
          </div>

          {filteredLanes.length === 0 ? (
            <div className="py-16 text-center" data-testid="status-lanes-empty">
              <CircleDashed className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {lanes.length === 0 ? "No active execution cases yet." : "No lanes match the current filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Clinic</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
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
                      </TableCell>
                      <TableCell className="text-slate-600">{l.clinic}</TableCell>
                      <TableCell className="text-slate-700 text-xs max-w-[180px] truncate">{l.service}</TableCell>
                      <TableCell className="text-slate-600 text-xs">{laneLabel[l.lane]}</TableCell>
                      <TableCell><span className={statusStyles[l.status]}>{l.status}</span></TableCell>
                      <TableCell className="text-slate-600 text-xs">{l.owner}</TableCell>
                      <TableCell className="text-slate-700 text-xs">{l.nextAction}</TableCell>
                      <TableCell className="text-xs">
                        {l.blocker ? <span className="text-red-600">{l.blocker}</span> : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="text-slate-500 text-xs tabular-nums">{l.dueDate ?? "—"}</TableCell>
                      <TableCell><span className={priorityStyles[l.priority]}>{l.priority}</span></TableCell>
                      <TableCell><ChevronRight className="w-4 h-4 text-slate-300" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* 4. Role queue board */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Role Queues</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="mission-control-role-queues">
            {roleQueues.map((r) => (
              <Card key={r.role} className="rounded-xl border-slate-200 p-4" data-testid={`role-queue-${r.role}`}>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-700">
                    <UserCog className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{r.label}</span>
                </div>
                {r.sourceMissing ? (
                  <div className="mt-3"><SourceMissingNote /></div>
                ) : (
                  <>
                    <div className="text-2xl font-bold tabular-nums text-slate-900 mt-3">{r.total}</div>
                    <div className="text-[11px] text-slate-500">cases assigned</div>
                    <div className="flex items-center gap-3 mt-2 text-[11px]">
                      <span className="text-red-600">{r.urgent} urgent</span>
                      <span className="text-amber-600">{r.blocked} blocked</span>
                      <span className="text-emerald-600">{r.ready} ready</span>
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* 5. Metric sections */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Operations Detail</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="mission-control-sections">
            <MetricSection title="Calls & Communication" Icon={PhoneCall} missing={sections.calls.sourceMissing}
              metrics={[
                { label: "Made today", value: sections.calls.madeToday },
                { label: "Reached today", value: sections.calls.reachedToday },
                { label: "Callbacks pending", value: sections.calls.callbacksPending },
                { label: "Made (7d)", value: sections.calls.madeLast7 },
              ]} />
            <MetricSection title="Patient Services" Icon={Users} missing={sections.patientServices.sourceMissing}
              metrics={[
                { label: "In pipeline", value: sections.patientServices.inPipeline },
                { label: "Prescreen backlog", value: sections.patientServices.prescreenBacklog },
                { label: "Pending ancillary", value: sections.patientServices.pendingAncillary },
                { label: "Declined (7d)", value: sections.patientServices.declinedLast7 },
              ]} />
            <MetricSection title="Finance & Revenue" Icon={DollarSign} missing={sections.finance.sourceMissing}
              metrics={[
                { label: "Billing ready", value: sections.finance.billingReady },
                { label: "Invoices submitted", value: sections.finance.invoicesSubmitted },
                { label: "Paid", value: formatCurrency(sections.finance.paidAmount) },
                { label: "Outstanding", value: formatCurrency(sections.finance.outstandingBalance) },
              ]} />
            <MetricSection title="Operations & Logistics" Icon={Layers} missing={sections.operations.sourceMissing}
              metrics={[
                { label: "Tasks open", value: sections.operations.tasksOpen },
                { label: "Overdue", value: sections.operations.tasksOverdue },
                { label: "High priority", value: sections.operations.tasksHighPriority },
              ]} />
            <MetricSection title="Today's Ancillary Ops" Icon={FlaskConical} missing={sections.ancillaryToday.sourceMissing}
              metrics={[
                { label: "Scheduled today", value: sections.ancillaryToday.scheduledToday },
                { label: "Completed today", value: sections.ancillaryToday.completedToday },
                { label: "Cancelled today", value: sections.ancillaryToday.cancelledToday },
              ]} />
            {/* RingCentral integration */}
            <Card className="rounded-xl border-slate-200 p-4" data-testid="section-ringcentral">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-700">
                  <PhoneOff className="w-4 h-4" />
                </span>
                <span className="text-sm font-semibold text-slate-800">RingCentral Telephony</span>
              </div>
              {!ringCentral.connected && (
                <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center" data-testid="status-ringcentral-disconnected">
                  <PhoneOff className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <div className="text-sm font-medium text-slate-600">Not connected</div>
                  <p className="text-xs text-slate-400 mt-1">Connect RingCentral to surface live call activity and dialer controls here.</p>
                </div>
              )}
            </Card>
          </div>
        </section>
      </main>

      {/* Lane Workbench slide-over */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="lane-workbench">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.patient}
                  <span className={priorityStyles[selected.priority]}>{selected.priority}</span>
                </SheetTitle>
                <SheetDescription>
                  {selected.clinic} · {laneLabel[selected.lane]}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Status" value={<span className={statusStyles[selected.status]}>{selected.status}</span>} />
                  <Field label="Owner" value={selected.owner} />
                  <Field label="Team" value={selected.team} />
                  <Field label="Due" value={selected.dueDate ?? "—"} />
                </div>
                <Separator />
                <Field label="Service(s)" value={selected.service} />
                <Field label="Next action" value={selected.nextAction} />
                {selected.blocker && <Field label="Blocker" value={<span className="text-red-600">{selected.blocker}</span>} />}
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Call result" value={selected.callResult} />
                  <Field label="Call attempts" value={String(selected.callAttempts)} />
                  <Field label="Last contact" value={selected.lastContact ?? "—"} />
                  <Field label="Report" value={selected.reportReadiness} />
                  <Field label="Billing" value={selected.billingReadiness} />
                </div>
                <Separator />

                {/* Triage hand-off (MONITORING ONLY — routing, never qualifying). */}
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Triage hand-off</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => fireAction("Routed to Engagement", `${selected.patient} flagged for outreach follow-up.`)} data-testid="button-route-engagement">
                      <PhoneCall className="w-4 h-4 mr-1.5" /> Engagement
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => fireAction("Routed to Scheduler", `${selected.patient} flagged for scheduling.`)} data-testid="button-route-scheduler">
                      <CalendarClock className="w-4 h-4 mr-1.5" /> Scheduler
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => fireAction("Routed to Billing", `${selected.patient} flagged for billing review.`)} data-testid="button-route-billing">
                      <Receipt className="w-4 h-4 mr-1.5" /> Billing
                    </Button>
                  </div>
                </div>

                {selected.patientScreeningId != null && (
                  <Link href={`/patient-directory?patientId=${selected.patientScreeningId}`}>
                    <Button variant="ghost" size="sm" className="w-full justify-between" data-testid="button-open-patient">
                      <span className="flex items-center"><Send className="w-4 h-4 mr-1.5" /> Open patient record</span>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </Link>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ───────────────────────── Sub-components ───────────────────────── */

function PageHeader({ onRefresh, isFetching, generatedAt }: { onRefresh: () => void; isFetching: boolean; generatedAt?: string }) {
  return (
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
            <p className="text-sm text-slate-500">
              Executive operations command center · monitoring only
              {generatedAt && <span className="text-slate-400"> · updated {new Date(generatedAt).toLocaleTimeString()}</span>}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={onRefresh} disabled={isFetching} data-testid="button-refresh">
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
    </header>
  );
}

function MetricSection({
  title,
  Icon,
  metrics,
  missing,
}: {
  title: string;
  Icon: typeof Activity;
  metrics: { label: string; value: React.ReactNode }[];
  missing: boolean;
}) {
  const testId = title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  return (
    <Card className="rounded-xl border-slate-200 p-4" data-testid={`section-${testId}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-700">
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-sm font-semibold text-slate-800">{title}</span>
      </div>
      {missing ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
          <ShieldAlert className="w-5 h-5 text-slate-300 mx-auto mb-1" />
          <div className="text-xs text-slate-500">No data available yet</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mt-4">
          {metrics.map((m) => (
            <div key={m.label}>
              <div className="text-lg font-bold tabular-nums text-slate-900">{m.value}</div>
              <div className="text-[11px] text-slate-500 leading-tight">{m.label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

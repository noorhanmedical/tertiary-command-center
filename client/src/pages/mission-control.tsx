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
import { useQuery } from "@tanstack/react-query";
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
  Building2,
  ShieldCheck,
  MessageSquare,
  BadgeCheck,
  Lock,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { qk } from "@/hooks/api/keys";
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

/* ───────────────────────── Access preview ───────────────────────── */
// Role → capability preview. Derived from the live session role returned by
// GET /api/auth/me — never hard-coded to a specific user. Mission Control's
// spine endpoint is admin-gated, so in practice this renders the admin set,
// but the mapping reflects the documented RBAC tiers so the preview stays
// honest if access ever widens.

const CAPABILITIES = [
  "view",
  "edit",
  "approve",
  "upload",
  "generate",
  "finalize",
  "export",
] as const;
type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPS: Record<string, Capability[]> = {
  admin: ["view", "edit", "approve", "upload", "generate", "finalize", "export"],
  manager: ["view", "edit", "approve", "upload", "generate"],
  clinician: ["view", "edit", "approve", "upload", "generate"],
  scheduler: ["view", "edit", "upload"],
  biller: ["view", "generate", "finalize", "export"],
};

/* ───────────────────────── Component ───────────────────────── */

export default function MissionControlPage() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useMissionControlSpine();

  const [search, setSearch] = useState("");
  const [facilityScope, setFacilityScope] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [activeQueue, setActiveQueue] = useState<MissionLaneKey | "all">("all");
  const [selected, setSelected] = useState<MissionLaneRow | null>(null);

  // Header surfaces: access preview, global patient search, Plexus Chat.
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  const meQuery = useQuery<{ id: string; username: string; role: string }>({
    queryKey: qk.auth.me(),
  });
  // Only expose the access preview once the real role resolves — never assume
  // admin while loading, or the preview would misrepresent permissions.
  const role = meQuery.isSuccess ? meQuery.data.role : undefined;
  const caps = role ? (ROLE_CAPS[role] ?? null) : null;

  const patientResults = useQuery<
    { id: number; name: string; dob: string | null; insurance: string | null }[]
  >({
    queryKey: ["/api/plexus/patients/search", patientQuery],
    queryFn: async () => {
      const r = await fetch(
        `/api/plexus/patients/search?q=${encodeURIComponent(patientQuery.trim())}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Patient search failed");
      return r.json();
    },
    enabled: patientSearchOpen && patientQuery.trim().length >= 2,
    staleTime: 10_000,
  });

  const lanes = data?.lanes ?? [];

  // Facility scope is the top-level lens for the case-derived spine: lanes,
  // spine counts, role queues and patient services all reflect it. Metrics
  // sourced from non-case tables (calls, finance) stay account-wide and are
  // labelled as such.
  const lanesForScope = useMemo(
    () => (facilityScope === "all" ? lanes : lanes.filter((l) => l.clinic === facilityScope)),
    [lanes, facilityScope],
  );

  const filteredLanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lanesForScope.filter((l) => {
      if (activeQueue !== "all" && l.lane !== activeQueue) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (priorityFilter !== "all" && l.priority !== priorityFilter) return false;
      if (ownerFilter !== "all" && l.owner !== ownerFilter) return false;
      if (q && !(`${l.patient} ${l.clinic} ${l.service} ${l.owner}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [lanesForScope, activeQueue, statusFilter, priorityFilter, ownerFilter, search]);

  const resetFilters = () => {
    setSearch("");
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
      <PageHeader
        onRefresh={refetch}
        isFetching={isFetching}
        generatedAt={data.generatedAt}
        clinics={clinics}
        facilityScope={facilityScope}
        onFacilityChange={setFacilityScope}
        role={role}
        caps={caps ?? undefined}
        onOpenSearch={() => setPatientSearchOpen(true)}
        onOpenChat={() => setChatOpen(true)}
      />

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
              const serverW = spine[c.spineKey];
              // When a facility is selected, lane-derived cards recompute from
              // the scoped lanes (honest: same case rows). Cards with no source
              // (sourceMissing) stay N/A; the non-lane "tasks" card stays
              // account-wide as the server reports it.
              const w: Wrapped<number> =
                facilityScope !== "all" && c.laneKey && !serverW.sourceMissing
                  ? { value: lanesForScope.filter((l) => l.lane === c.laneKey).length, sourceMissing: false }
                  : serverW;
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${ringCentral.connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                    {ringCentral.connected ? <PhoneCall className="w-4 h-4" /> : <PhoneOff className="w-4 h-4" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">RingCentral Telephony</span>
                </div>
                {ringCentral.connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium" data-testid="badge-ringcentral-live">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 text-[11px] font-medium" data-testid="badge-ringcentral-offline">
                    Offline
                  </span>
                )}
              </div>
              {!ringCentral.connected && (
                <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center" data-testid="status-ringcentral-disconnected">
                  <PhoneOff className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <div className="text-sm font-medium text-slate-600">Not connected</div>
                  <p className="text-xs text-slate-400 mt-1">Connect RingCentral to surface live call activity and dialer controls here.</p>
                </div>
              )}
              <a
                href="https://developers.ringcentral.com/api-reference"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                data-testid="link-ringcentral-docs"
              >
                <ExternalLink className="w-3.5 h-3.5" /> RingCentral API docs
              </a>
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

      {/* Global patient search */}
      <Sheet open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="patient-search-overlay">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Search className="w-4 h-4" /> Find patient
            </SheetTitle>
            <SheetDescription>Search the patient directory by name, then open the record.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <Input
              autoFocus
              value={patientQuery}
              onChange={(e) => setPatientQuery(e.target.value)}
              placeholder="Type at least 2 characters…"
              className="h-9"
              data-testid="input-patient-search"
            />
            <div className="space-y-1.5">
              {patientQuery.trim().length < 2 && (
                <p className="text-xs text-slate-400" data-testid="text-patient-search-hint">
                  Enter a patient name to search.
                </p>
              )}
              {patientQuery.trim().length >= 2 && patientResults.isLoading && (
                <div className="space-y-2" data-testid="status-patient-search-loading">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              )}
              {patientQuery.trim().length >= 2 && patientResults.isError && (
                <p className="text-xs text-red-500" data-testid="status-patient-search-error">
                  Search is temporarily unavailable. Please try again.
                </p>
              )}
              {patientQuery.trim().length >= 2 && !patientResults.isLoading && !patientResults.isError && (patientResults.data?.length ?? 0) === 0 && (
                <p className="text-xs text-slate-400" data-testid="status-patient-search-empty">
                  No patients match “{patientQuery.trim()}”.
                </p>
              )}
              {patientResults.data?.map((p) => (
                <Link key={p.id} href={`/patient-directory?patientId=${p.id}`}>
                  <button
                    type="button"
                    onClick={() => setPatientSearchOpen(false)}
                    className="w-full text-left rounded-lg border border-slate-200 bg-white p-3 hover-elevate active-elevate-2"
                    data-testid={`patient-search-result-${p.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{p.name}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {p.dob ? `DOB ${p.dob}` : "DOB —"}{p.insurance ? ` · ${p.insurance}` : ""}
                    </div>
                  </button>
                </Link>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Plexus Chat overlay — honest boundary: no assistant backend wired yet,
          so this is an entry point, not fabricated responses. */}
      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="plexus-chat-overlay">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Plexus Chat
            </SheetTitle>
            <SheetDescription>Operations assistant overlay.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8" data-testid="status-chat-not-connected">
            <MessageSquare className="w-7 h-7 text-slate-300 mb-3" />
            <div className="text-sm font-medium text-slate-600">Assistant not connected yet</div>
            <p className="text-xs text-slate-400 mt-1">
              Plexus Chat will let you ask questions about the operations spine once an assistant backend is wired. No responses are generated until then.
            </p>
          </div>
          <div className="mt-4">
            <Input disabled placeholder="Ask Plexus… (coming soon)" className="h-9" data-testid="input-chat-disabled" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ───────────────────────── Sub-components ───────────────────────── */

function PageHeader({
  onRefresh,
  isFetching,
  generatedAt,
  clinics,
  facilityScope,
  onFacilityChange,
  role,
  caps,
  onOpenSearch,
  onOpenChat,
}: {
  onRefresh: () => void;
  isFetching: boolean;
  generatedAt?: string;
  clinics?: string[];
  facilityScope?: string;
  onFacilityChange?: (v: string) => void;
  role?: string;
  caps?: readonly Capability[];
  onOpenSearch?: () => void;
  onOpenChat?: () => void;
}) {
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
        <div className="flex items-center gap-2 flex-wrap">
          {onOpenSearch && (
            <Button variant="outline" size="sm" className="h-9" onClick={onOpenSearch} data-testid="button-open-patient-search">
              <Search className="w-4 h-4 mr-2" /> Find patient
            </Button>
          )}
          {clinics && onFacilityChange && (
            <Select value={facilityScope ?? "all"} onValueChange={onFacilityChange}>
              <SelectTrigger className="h-9 w-[200px]" data-testid="select-facility-scope">
                <span className="flex items-center gap-2 truncate">
                  <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                  <SelectValue placeholder="Facility" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                {clinics.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {role && caps && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9" data-testid="button-access-preview">
                  <ShieldCheck className="w-4 h-4 mr-2 text-emerald-600" />
                  Access
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72" data-testid="popover-access-preview">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Access preview</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Role-based capabilities for your session — <span className="font-medium capitalize">{role}</span>.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {CAPABILITIES.map((cap) => {
                      const allowed = caps.includes(cap);
                      return (
                        <div key={cap} className="flex items-center justify-between text-xs" data-testid={`access-cap-${cap}`}>
                          <span className="capitalize text-slate-600">{cap}</span>
                          {allowed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <BadgeCheck className="w-3.5 h-3.5" /> Allowed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              <Lock className="w-3.5 h-3.5" /> Restricted
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {onOpenChat && (
            <Button variant="outline" size="sm" className="h-9" onClick={onOpenChat} data-testid="button-open-chat">
              <MessageSquare className="w-4 h-4 mr-2" /> Plexus Chat
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={onRefresh} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
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

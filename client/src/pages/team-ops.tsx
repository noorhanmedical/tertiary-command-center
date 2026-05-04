import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users2,
  Building2,
  Brain,
  Activity,
  CalendarCheck,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  UserCheck,
  CalendarDays,
  Palmtree,
  Stethoscope,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Sun,
  CloudOff,
  Hourglass,
  ClipboardList,
  Sparkles,
  CalendarRange,
  Send,
  Plane,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import type {
  OutreachScheduler,
  AncillaryAppointment,
  PtoRequest,
} from "@shared/schema";
import { VALID_FACILITIES } from "@shared/plexus";
import { isBrainWave, formatTime12, toDateKey } from "@/components/clinic-calendar";
import type { DateRange } from "react-day-picker";

// ─── Helpers ────────────────────────────────────────────────────────────────

function shellClass() {
  return "rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)]";
}

function facilityColor(facility: string) {
  if (facility.includes("Taylor")) return "bg-blue-600/10 text-blue-700 border-blue-200";
  if (facility.includes("Spring")) return "bg-emerald-600/10 text-emerald-700 border-emerald-200";
  if (facility.includes("Veteran")) return "bg-violet-600/10 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function facilityAccent(facility: string) {
  if (facility.includes("Taylor")) return "bg-blue-600";
  if (facility.includes("Spring")) return "bg-emerald-600";
  if (facility.includes("Veteran")) return "bg-violet-600";
  return "bg-slate-500";
}

function isUltrasoundTest(testType: string): boolean {
  const t = (testType || "").toLowerCase();
  if (t.includes("brainwave") || t === "vitalwave") return false;
  return (
    t.includes("ultrasound") ||
    t.includes("duplex") ||
    t.includes("echocardiogram") ||
    t.includes("doppler") ||
    t.includes("aneurysm")
  );
}

function dateKeyFromDate(d: Date): string {
  return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function dateInRange(dateKey: string, startKey: string, endKey: string): boolean {
  return dateKey >= startKey && dateKey <= endKey;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeek(d: Date) {
  const r = new Date(d);
  r.setDate(d.getDate() - d.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}
function formatRange(start?: string, end?: string) {
  if (!start || !end) return "";
  if (start === end) return parseDateKey(start).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${parseDateKey(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} → ${parseDateKey(end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type AuthUser = { id: string; username: string; role: string };
type TeamMember = { id: string; username: string };
type Tab = "dashboard" | "calendar" | "pto" | "coverage" | "technician";

// ─── Main page ──────────────────────────────────────────────────────────────

export default function TeamOpsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  // Coverage assignment dialog state
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; editing: OutreachScheduler | null }>({
    open: false,
    editing: null,
  });
  const [formName, setFormName] = useState("");
  const [formFacility, setFormFacility] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<OutreachScheduler | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: me } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
  });
  const isAdmin = me?.role === "admin";

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/audit-log/users"],
  });

  const { data: schedulers = [] } = useQuery<OutreachScheduler[]>({
    queryKey: ["/api/outreach/schedulers"],
    refetchInterval: 60_000,
  });

  const { data: ptoMine = [] } = useQuery<PtoRequest[]>({
    queryKey: ["/api/pto-requests", "scope=mine"],
    queryFn: async () => {
      const res = await fetch(`/api/pto-requests?scope=mine`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load PTO");
      return res.json();
    },
  });

  // Team-wide approved PTO — visible to ALL staff so the Dashboard and
  // Staffing Calendar can show who is off today / this week. Non-admins
  // get only approved entries (their own pending stays private under
  // ptoMine); admins receive every approved entry too.
  const { data: ptoTeamApproved = [] } = useQuery<PtoRequest[]>({
    queryKey: ["/api/pto-requests", "scope=approved-team"],
    queryFn: async () => {
      const res = await fetch(`/api/pto-requests?scope=approved-team`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team PTO");
      return res.json();
    },
  });

  // Admin-only: every PTO request (any status). Used to power the
  // approve/deny queue and the "All Requests" admin view.
  const { data: ptoAdminAll = [] } = useQuery<PtoRequest[]>({
    queryKey: ["/api/pto-requests", "all"],
    enabled: isAdmin,
    queryFn: async () => {
      const res = await fetch(`/api/pto-requests`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load PTO");
      return res.json();
    },
  });

  const { data: apptsTaylor = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "Taylor Family Practice"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("Taylor Family Practice")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const { data: apptsSpring = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "NWPG - Spring"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("NWPG - Spring")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const { data: apptsVets = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", "NWPG - Veterans"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent("NWPG - Veterans")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const allAppointments: Record<string, AncillaryAppointment[]> = {
    "Taylor Family Practice": apptsTaylor,
    "NWPG - Spring": apptsSpring,
    "NWPG - Veterans": apptsVets,
  };

  // ── Derived ─────────────────────────────────────────────────────────────
  const _now = new Date();
  const todayStr = dateKeyFromDate(_now);

  const usernameById = useMemo(() => {
    const m = new Map<string, string>();
    teamMembers.forEach((t) => m.set(t.id, t.username));
    return m;
  }, [teamMembers]);

  const approvedPtoAll = useMemo(
    () => ptoTeamApproved.filter((p) => p.status === "approved"),
    [ptoTeamApproved],
  );

  function approvedPtoOnDate(dateKey: string, userId?: string): PtoRequest[] {
    return approvedPtoAll.filter((p) =>
      dateInRange(dateKey, p.startDate, p.endDate) &&
      (userId ? p.userId === userId : true)
    );
  }

  // Off / On today
  const offTodayRequests = useMemo(() => approvedPtoOnDate(todayStr), [approvedPtoAll, todayStr]);
  const offTodayUserIds = new Set(offTodayRequests.map((p) => p.userId));
  const onTodayMembers = teamMembers.filter((t) => !offTodayUserIds.has(t.id));

  // Metrics
  const monthStart = startOfMonth(_now);
  const monthEnd = endOfMonth(_now);
  const monthStartKey = dateKeyFromDate(monthStart);
  const monthEndKey = dateKeyFromDate(monthEnd);
  const weekStart = startOfWeek(_now);
  const weekEnd = addDays(weekStart, 6);
  const weekStartKey = dateKeyFromDate(weekStart);
  const weekEndKey = dateKeyFromDate(weekEnd);

  const activeStaffThisMonth = teamMembers.length;

  const coveredFacilitiesThisWeek = useMemo(() => {
    // Facilities that have an assigned scheduler whose user (if any) is not on
    // approved PTO for the entire week. If no userId is linked, we treat the
    // facility as covered.
    let count = 0;
    for (const f of VALID_FACILITIES) {
      const sc = schedulers.find((s) => s.facility === f);
      if (!sc) continue;
      const linkedUserId = sc.userId ?? null;
      if (!linkedUserId) {
        count++;
        continue;
      }
      // covered if at least one weekday is not on PTO
      let anyDayCovered = false;
      for (let i = 0; i < 7; i++) {
        const k = dateKeyFromDate(addDays(weekStart, i));
        if (!approvedPtoOnDate(k, linkedUserId).length) {
          anyDayCovered = true;
          break;
        }
      }
      if (anyDayCovered) count++;
    }
    return count;
  }, [schedulers, approvedPtoAll, weekStart]);

  const ultrasoundDaysThisMonth = useMemo(() => {
    const days = new Set<string>();
    for (const f of VALID_FACILITIES) {
      for (const a of allAppointments[f] ?? []) {
        if (a.status !== "scheduled") continue;
        if (!isUltrasoundTest(a.testType)) continue;
        if (a.scheduledDate >= monthStartKey && a.scheduledDate <= monthEndKey) {
          days.add(a.scheduledDate);
        }
      }
    }
    return days.size;
  }, [allAppointments, monthStartKey, monthEndKey]);

  const openPtoCount = useMemo(
    () => (isAdmin ? ptoAdminAll : ptoMine).filter((p) => p.status === "pending").length,
    [isAdmin, ptoAdminAll, ptoMine],
  );

  // ── Mutations: schedulers ───────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: { name: string; facility: string }) =>
      apiRequest("POST", "/api/outreach/schedulers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Scheduler assigned", description: `${formName} → ${formFacility}.` });
      closeAssignDialog();
    },
    onError: () => toast({ title: "Error", description: "Could not save assignment.", variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; facility: string } }) =>
      apiRequest("PATCH", `/api/outreach/schedulers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Assignment updated" });
      closeAssignDialog();
    },
    onError: () => toast({ title: "Error", description: "Could not update assignment.", variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outreach/schedulers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/schedulers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      toast({ title: "Assignment removed" });
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Error", description: "Could not remove.", variant: "destructive" }),
  });

  function openAddDialog() {
    setFormName("");
    setFormFacility("");
    setAssignDialog({ open: true, editing: null });
  }
  function openEditDialog(sc: OutreachScheduler) {
    setFormName(sc.name);
    setFormFacility(sc.facility);
    setAssignDialog({ open: true, editing: sc });
  }
  function closeAssignDialog() {
    setAssignDialog({ open: false, editing: null });
    setFormName("");
    setFormFacility("");
  }
  function handleSave() {
    if (!formName.trim() || !formFacility) return;
    if (assignDialog.editing) {
      updateMutation.mutate({ id: assignDialog.editing.id, data: { name: formName.trim(), facility: formFacility } });
    } else {
      createMutation.mutate({ name: formName.trim(), facility: formFacility });
    }
  }

  function getSchedulerForFacility(facility: string) {
    return schedulers.find((s) => s.facility === facility) ?? null;
  }

  function todayAppts(facility: string) {
    return (allAppointments[facility] ?? []).filter(
      (a) => a.scheduledDate === todayStr && a.status === "scheduled",
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-6">

        {/* Header */}
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · TEAM OPS"
          icon={Users2}
          iconAccent="bg-violet-600/10 text-violet-700"
          title="Team Ops"
          subtitle="Staffing command center — who's on, who's off, and who's covering what."
          actions={
            activeTab === "coverage" ? (
              <Button
                data-testid="button-add-scheduler"
                onClick={openAddDialog}
                className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white gap-2"
              >
                <Plus className="h-4 w-4" />
                Assign Scheduler
              </Button>
            ) : null
          }
        />

        {/* Metrics strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Active Staff This Month", value: activeStaffThisMonth, Icon: Users2, color: "bg-violet-600/10 text-violet-700", testId: "metric-active-staff" },
            { label: "Covered Facilities This Week", value: `${coveredFacilitiesThisWeek}/${VALID_FACILITIES.length}`, Icon: Building2, color: "bg-blue-600/10 text-blue-700", testId: "metric-covered-facilities" },
            { label: "Ultrasound Tech Days This Month", value: ultrasoundDaysThisMonth, Icon: Stethoscope, color: "bg-emerald-600/10 text-emerald-700", testId: "metric-ultrasound-days" },
            { label: "Open PTO Requests", value: openPtoCount, Icon: Hourglass, color: "bg-amber-500/10 text-amber-700", testId: "metric-open-pto" },
          ].map(({ label, value, Icon, color, testId }) => (
            <Card key={label} className={`${shellClass()} flex items-center gap-3 px-4 py-3`}>
              <div className={`rounded-xl p-2 ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
                <p className="text-xl font-bold text-slate-900 leading-none mt-0.5" data-testid={testId}>{value}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-2xl bg-white/60 border border-white/60 backdrop-blur p-1 w-fit">
          {([
            { id: "dashboard" as Tab, label: "Dashboard", Icon: Sparkles },
            { id: "calendar" as Tab, label: "Staffing Calendar", Icon: CalendarDays },
            { id: "pto" as Tab, label: "PTO & Time Off", Icon: Plane },
            { id: "coverage" as Tab, label: "Coverage & Assignments", Icon: Building2 },
            { id: "technician" as Tab, label: "Technician Schedule", Icon: Stethoscope },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              data-testid={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-white shadow-sm text-slate-900"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ─── Dashboard tab ─────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <DashboardTab
            teamMembers={teamMembers}
            schedulers={schedulers}
            usernameById={usernameById}
            onTodayMembers={onTodayMembers}
            offTodayRequests={offTodayRequests}
            todayStr={todayStr}
          />
        )}

        {/* ─── Staffing Calendar tab ────────────────────────────────────── */}
        {activeTab === "calendar" && (
          <StaffingCalendarTab
            schedulers={schedulers}
            approvedPtoAll={approvedPtoAll}
            usernameById={usernameById}
            allAppointments={allAppointments}
          />
        )}

        {/* ─── PTO tab ──────────────────────────────────────────────────── */}
        {activeTab === "pto" && (
          <PtoTab
            me={me ?? null}
            isAdmin={!!isAdmin}
            ptoMine={ptoMine}
            ptoAll={ptoAdminAll}
            usernameById={usernameById}
          />
        )}

        {/* ─── Coverage tab ─────────────────────────────────────────────── */}
        {activeTab === "coverage" && (
          <CoverageTab
            schedulers={schedulers}
            getSchedulerForFacility={getSchedulerForFacility}
            openEditDialog={openEditDialog}
            setDeleteTarget={setDeleteTarget}
          />
        )}

        {/* ─── Technician schedule tab ──────────────────────────────────── */}
        {activeTab === "technician" && (
          <TechnicianTab
            allAppointments={allAppointments}
            todayStr={todayStr}
            todayAppts={todayAppts}
            getSchedulerForFacility={getSchedulerForFacility}
          />
        )}
      </div>

      {/* Assign / Edit Dialog */}
      <Dialog open={assignDialog.open} onOpenChange={(open) => { if (!open) closeAssignDialog(); }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{assignDialog.editing ? "Edit Scheduler Assignment" : "Assign Scheduler"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheduler-name">Scheduler Name</Label>
              <Input
                id="scheduler-name"
                data-testid="input-scheduler-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scheduler-facility">Facility</Label>
              <Select value={formFacility} onValueChange={setFormFacility}>
                <SelectTrigger id="scheduler-facility" data-testid="select-facility">
                  <SelectValue placeholder="Select a facility" />
                </SelectTrigger>
                <SelectContent>
                  {VALID_FACILITIES.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={closeAssignDialog}>
              Cancel
            </Button>
            <Button
              data-testid="button-save-assignment"
              className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!formName.trim() || !formFacility || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {assignDialog.editing ? "Save Changes" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Assignment?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 py-1">
            This will remove <span className="font-semibold text-slate-700">{deleteTarget?.name}</span> from{" "}
            <span className="font-semibold text-slate-700">{deleteTarget?.facility}</span>. The facility will show as unassigned.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              data-testid="button-confirm-delete"
              variant="destructive"
              className="rounded-2xl"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Dashboard tab ──────────────────────────────────────────────────────────

function DashboardTab({
  teamMembers,
  schedulers,
  usernameById,
  onTodayMembers,
  offTodayRequests,
  todayStr,
}: {
  teamMembers: TeamMember[];
  schedulers: OutreachScheduler[];
  usernameById: Map<string, string>;
  onTodayMembers: TeamMember[];
  offTodayRequests: PtoRequest[];
  todayStr: string;
}) {
  const today = new Date();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* On Today */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-on-today">
        <div className="flex items-center gap-2">
          <div className="rounded-xl p-2 bg-emerald-600/10 text-emerald-700">
            <Sun className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">On Today</p>
            <p className="text-sm font-semibold text-slate-800">{today.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
          </div>
          <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-on-count">{onTodayMembers.length}</Badge>
        </div>
        {teamMembers.length === 0 ? (
          <p className="text-xs italic text-slate-400">No team members loaded.</p>
        ) : onTodayMembers.length === 0 ? (
          <p className="text-xs italic text-slate-400">Everyone is off today.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {onTodayMembers.map((m) => (
              <div
                key={m.id}
                data-testid={`row-on-today-${m.id}`}
                className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2"
              >
                <div className="h-7 w-7 rounded-full bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center">
                  {m.username.slice(0, 1).toUpperCase()}
                </div>
                <p className="text-sm font-medium text-slate-700 truncate">{m.username}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Off Today */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-off-today">
        <div className="flex items-center gap-2">
          <div className="rounded-xl p-2 bg-amber-500/10 text-amber-700">
            <CloudOff className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Off Today</p>
            <p className="text-sm font-semibold text-slate-800">Approved PTO</p>
          </div>
          <Badge className="ml-auto bg-amber-100 text-amber-700 border-amber-200" data-testid="badge-off-count">{offTodayRequests.length}</Badge>
        </div>
        {offTodayRequests.length === 0 ? (
          <p className="text-xs italic text-slate-400">No one is off today.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {offTodayRequests.map((p) => (
              <div
                key={p.id}
                data-testid={`row-off-today-${p.id}`}
                className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2"
              >
                <div className="h-7 w-7 rounded-full bg-amber-500 text-white text-xs font-semibold flex items-center justify-center">
                  {(usernameById.get(p.userId) ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">{usernameById.get(p.userId) ?? "Unknown"}</p>
                  <p className="text-[10px] text-slate-500 truncate">{formatRange(p.startDate, p.endDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Facility Coverage */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-coverage">
        <div className="flex items-center gap-2">
          <div className="rounded-xl p-2 bg-blue-600/10 text-blue-700">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">Facility Coverage</p>
            <p className="text-sm font-semibold text-slate-800">Scheduler → Facility</p>
          </div>
        </div>
        <div className="space-y-2">
          {VALID_FACILITIES.map((f) => {
            const sc = schedulers.find((s) => s.facility === f);
            const linkedUserId = sc?.userId ?? null;
            const onPto = sc && linkedUserId
              ? !!offTodayRequests.find((p) => p.userId === linkedUserId)
              : false;
            return (
              <div
                key={f}
                data-testid={`coverage-row-${f.toLowerCase().replace(/\s+/g, "-")}`}
                className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5"
              >
                <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${facilityAccent(f)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-700 truncate">{f}</p>
                  <p className={`text-[11px] truncate ${sc ? "text-slate-500" : "text-amber-600 italic font-medium"}`}>
                    {sc ? sc.name : "Unassigned"}
                    {onPto && <span className="ml-1 text-amber-600 font-medium">· On PTO</span>}
                  </p>
                </div>
                {!sc ? (
                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <UserCheck className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Staffing Calendar tab ──────────────────────────────────────────────────

function StaffingCalendarTab({
  schedulers,
  approvedPtoAll,
  usernameById,
  allAppointments,
}: {
  schedulers: OutreachScheduler[];
  approvedPtoAll: PtoRequest[];
  usernameById: Map<string, string>;
  allAppointments: Record<string, AncillaryAppointment[]>;
}) {
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date>(new Date());

  const days = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    // Month view: render full weeks covering the month
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = startOfWeek(monthEnd);
    const totalDays = Math.ceil((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 7;
    return Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i));
  }, [view, anchor]);

  function ultrasoundCountFor(dateKey: string) {
    let n = 0;
    for (const f of VALID_FACILITIES) {
      for (const a of allAppointments[f] ?? []) {
        if (a.status === "scheduled" && a.scheduledDate === dateKey && isUltrasoundTest(a.testType)) n++;
      }
    }
    return n;
  }

  function ptoOnDay(dateKey: string) {
    return approvedPtoAll.filter((p) => dateInRange(dateKey, p.startDate, p.endDate));
  }

  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekRangeLabel = (() => {
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  })();

  const todayKey = dateKeyFromDate(new Date());

  return (
    <Card className={`${shellClass()} p-5 flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            data-testid="button-cal-prev"
            variant="outline"
            size="sm"
            className="rounded-xl h-8 w-8 p-0"
            onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            data-testid="button-cal-next"
            variant="outline"
            size="sm"
            className="rounded-xl h-8 w-8 p-0"
            onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            data-testid="button-cal-today"
            variant="ghost"
            size="sm"
            className="rounded-xl text-xs ml-1"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
        </div>
        <h2 className="text-base font-semibold text-slate-800" data-testid="text-cal-label">
          {view === "month" ? monthLabel : weekRangeLabel}
        </h2>
        <div className="ml-auto flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              data-testid={`button-view-${v}`}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs font-medium rounded-lg ${view === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        {VALID_FACILITIES.map((f) => (
          <div key={f} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${facilityAccent(f)}`} />
            <span>{f}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <Palmtree className="h-3 w-3 text-amber-500" />
          <span>PTO</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Stethoscope className="h-3 w-3 text-emerald-600" />
          <span>Ultrasound day</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold text-center">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const k = dateKeyFromDate(d);
          const inMonth = view === "week" || d.getMonth() === anchor.getMonth();
          const ptoToday = ptoOnDay(k);
          const usCount = ultrasoundCountFor(k);
          const isToday = k === todayKey;
          return (
            <Popover key={k}>
              <PopoverTrigger asChild>
                <button
                  data-testid={`cal-day-${k}`}
                  className={`min-h-[88px] rounded-xl border text-left p-1.5 flex flex-col gap-1 transition hover:border-violet-300 hover:bg-violet-50/60 ${
                    inMonth ? "bg-white border-slate-100" : "bg-slate-50/60 border-slate-100 text-slate-300"
                  } ${isToday ? "ring-2 ring-violet-400 ring-offset-1" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${inMonth ? "text-slate-700" : "text-slate-300"}`}>{d.getDate()}</span>
                    {usCount > 0 && (
                      <Badge
                        data-testid={`cal-us-${k}`}
                        className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px] px-1.5 py-0 gap-0.5"
                      >
                        <Stethoscope className="h-2.5 w-2.5" />
                        {usCount}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {schedulers.slice(0, 3).map((sc) => (
                      <div
                        key={sc.id}
                        className={`text-[9px] px-1.5 py-0.5 rounded-md text-white truncate ${facilityAccent(sc.facility)}`}
                        title={`${sc.name} → ${sc.facility}`}
                      >
                        {sc.name.split(" ")[0]}
                      </div>
                    ))}
                    {ptoToday.slice(0, 2).map((p) => (
                      <div
                        key={p.id}
                        className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-200 text-amber-900 truncate flex items-center gap-1"
                      >
                        <Palmtree className="h-2 w-2" />
                        {usernameById.get(p.userId) ?? "?"}
                      </div>
                    ))}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 rounded-2xl" align="start">
                <p className="text-sm font-semibold text-slate-800 mb-2">
                  {d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
                </p>
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1">Coverage</p>
                    {schedulers.length === 0 ? (
                      <p className="text-slate-400 italic">No assignments.</p>
                    ) : (
                      schedulers.map((sc) => (
                        <div key={sc.id} className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${facilityAccent(sc.facility)}`} />
                          <span className="text-slate-700"><span className="font-medium">{sc.name}</span> · {sc.facility}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {ptoToday.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1">Off (PTO)</p>
                      {ptoToday.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 text-amber-700">
                          <Palmtree className="h-3 w-3" />
                          <span>{usernameById.get(p.userId) ?? "Unknown"} {p.note && `— ${p.note}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {usCount > 0 && (
                    <div className="flex items-center gap-2 text-emerald-700">
                      <Stethoscope className="h-3 w-3" />
                      <span>{usCount} ultrasound appointment{usCount !== 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </Card>
  );
}

// ─── PTO tab ────────────────────────────────────────────────────────────────

function PtoTab({
  me,
  isAdmin,
  ptoMine,
  ptoAll,
  usernameById,
}: {
  me: AuthUser | null;
  isAdmin: boolean;
  ptoMine: PtoRequest[];
  ptoAll: PtoRequest[];
  usernameById: Map<string, string>;
}) {
  const { toast } = useToast();
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [note, setNote] = useState("");
  const [adminScope, setAdminScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");

  const submitMutation = useMutation({
    mutationFn: (data: { startDate: string; endDate: string; note: string }) =>
      apiRequest("POST", "/api/pto-requests", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=approved-team"] });
      toast({ title: "Time-off request submitted" });
      setSubmitOpen(false);
      setRange(undefined);
      setNote("");
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "Please try again.";
      toast({ title: "Could not submit", description: message, variant: "destructive" });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "denied" }) =>
      apiRequest("PATCH", `/api/pto-requests/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=approved-team"] });
      toast({ title: "Request updated" });
    },
    onError: () => toast({ title: "Could not update request", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/pto-requests/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pto-requests", "scope=approved-team"] });
      toast({ title: "Request withdrawn" });
    },
  });

  function openSubmit() {
    if (!range?.from || !range?.to) {
      toast({ title: "Select a date range first", description: "Click or drag dates on the calendar." });
      return;
    }
    setSubmitOpen(true);
  }

  function handleSubmit() {
    if (!range?.from || !range?.to) return;
    submitMutation.mutate({
      startDate: dateKeyFromDate(range.from),
      endDate: dateKeyFromDate(range.to),
      note: note.trim(),
    });
  }

  const visibleRequests = isAdmin ? (adminScope === "all" ? ptoAll : ptoMine) : ptoMine;
  const pendingForAdmin = isAdmin ? ptoAll.filter((p) => p.status === "pending") : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`}>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-slate-800">Request Time Off</h2>
        </div>
        <p className="text-xs text-slate-500">
          Click a start date, then click an end date to highlight the range you'd like off.
        </p>
        <div className="flex justify-center">
          <CalendarPicker
            mode="range"
            selected={range}
            onSelect={setRange}
            data-testid="calendar-pto"
            numberOfMonths={1}
          />
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {range?.from && range?.to ? (
            <span data-testid="text-pto-range">
              <span className="font-semibold">Selected:</span> {formatRange(dateKeyFromDate(range.from), dateKeyFromDate(range.to))}
            </span>
          ) : (
            <span className="text-slate-400 italic">No range selected.</span>
          )}
        </div>
        <Button
          data-testid="button-pto-submit-open"
          onClick={openSubmit}
          disabled={!range?.from || !range?.to}
          className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white gap-2"
        >
          <Send className="h-4 w-4" />
          Submit Request
        </Button>
      </Card>

      <div className="flex flex-col gap-4">
        {isAdmin && pendingForAdmin.length > 0 && (
          <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-pending-admin">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-slate-800">Pending Approval</h2>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 ml-1">{pendingForAdmin.length}</Badge>
            </div>
            <div className="space-y-2">
              {pendingForAdmin.map((p) => (
                <div
                  key={p.id}
                  data-testid={`row-pending-${p.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50/60 border border-amber-100 px-3 py-2.5"
                >
                  <div className="h-8 w-8 rounded-full bg-amber-500 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                    {(usernameById.get(p.userId) ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {usernameById.get(p.userId) ?? "Unknown"}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {formatRange(p.startDate, p.endDate)}
                      {p.note && <span className="ml-1 italic">— {p.note}</span>}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      data-testid={`button-approve-${p.id}`}
                      size="sm"
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1"
                      disabled={reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: p.id, status: "approved" })}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      data-testid={`button-deny-${p.id}`}
                      size="sm"
                      variant="outline"
                      className="rounded-xl h-8 gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      disabled={reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: p.id, status: "denied" })}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-requests">
          <div className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-slate-800">{isAdmin && adminScope === "all" ? "All Requests" : "My Requests"}</h2>
            {isAdmin && (
              <div className="ml-auto flex gap-1 rounded-xl bg-slate-100 p-1">
                {(["all", "mine"] as const).map((v) => (
                  <button
                    key={v}
                    data-testid={`button-scope-${v}`}
                    onClick={() => setAdminScope(v)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg ${adminScope === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    {v === "all" ? "All" : "Mine"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {visibleRequests.length === 0 ? (
            <p className="text-xs italic text-slate-400">No requests yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleRequests.map((p) => {
                const isMine = p.userId === me?.id;
                return (
                  <div
                    key={p.id}
                    data-testid={`row-request-${p.id}`}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {usernameById.get(p.userId) ?? "Unknown"}
                        {isMine && <span className="ml-2 text-[10px] uppercase tracking-wide text-violet-600 font-semibold">(you)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {formatRange(p.startDate, p.endDate)}
                        {p.note && <span className="ml-1 italic">— {p.note}</span>}
                      </p>
                    </div>
                    <Badge
                      className={`text-[10px] px-2 py-0.5 ${
                        p.status === "approved"
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : p.status === "denied"
                          ? "bg-red-100 text-red-700 border-red-200"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      }`}
                    >
                      {p.status}
                    </Badge>
                    {isMine && p.status === "pending" && (
                      <Button
                        data-testid={`button-cancel-${p.id}`}
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 rounded-lg text-slate-500 hover:text-red-600"
                        onClick={() => cancelMutation.mutate(p.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Submit dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Time-Off Request</DialogTitle>
            <DialogDescription>
              {range?.from && range?.to && formatRange(dateKeyFromDate(range.from), dateKeyFromDate(range.to))}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="pto-note">Note (optional)</Label>
            <Textarea
              id="pto-note"
              data-testid="textarea-pto-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Vacation, doctor's appointment, family event…"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={() => setSubmitOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-pto-submit-confirm"
              className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Coverage tab (existing facility cards, calls metrics removed) ──────────

function CoverageTab({
  schedulers,
  getSchedulerForFacility,
  openEditDialog,
  setDeleteTarget,
}: {
  schedulers: OutreachScheduler[];
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  openEditDialog: (sc: OutreachScheduler) => void;
  setDeleteTarget: (sc: OutreachScheduler | null) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        {VALID_FACILITIES.map((facility) => {
          const sc = getSchedulerForFacility(facility);
          return (
            <Card
              key={facility}
              data-testid={`coverage-card-${facility.toLowerCase().replace(/\s+/g, "-")}`}
              className={`${shellClass()} p-5 flex flex-col gap-4`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${facilityAccent(facility)}`} />
                  <span className="text-sm font-semibold text-slate-800 truncate">{facility}</span>
                </div>
                <Badge className={`text-[10px] px-2 py-0.5 border ${facilityColor(facility)} flex-shrink-0`}>
                  {sc ? "Covered" : "Unassigned"}
                </Badge>
              </div>

              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
                <div className={`rounded-xl p-1.5 ${sc ? "bg-violet-100 text-violet-600" : "bg-slate-200 text-slate-400"}`}>
                  <UserCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400">Scheduler</p>
                  <p className={`text-sm font-semibold truncate ${sc ? "text-slate-800" : "text-slate-400 italic"}`}>
                    {sc ? sc.name : "Unassigned"}
                  </p>
                </div>
                {sc && (
                  <div className="ml-auto flex gap-1">
                    <button
                      data-testid={`button-edit-scheduler-${sc.id}`}
                      onClick={() => openEditDialog(sc)}
                      className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      data-testid={`button-delete-scheduler-${sc.id}`}
                      onClick={() => setDeleteTarget(sc)}
                      className="rounded-lg p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {!sc && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-amber-700">No scheduler assigned</span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {schedulers.length > 0 && (
        <Card className={`${shellClass()} p-5`}>
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Users2 className="h-4 w-4 text-violet-600" />
            Scheduler Roster
          </h2>
          <div className="divide-y divide-slate-100">
            {schedulers.map((sc) => (
              <div
                key={sc.id}
                data-testid={`roster-row-${sc.id}`}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${facilityAccent(sc.facility)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{sc.name}</p>
                  <p className="text-xs text-slate-400">{sc.facility}</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    data-testid={`button-edit-roster-${sc.id}`}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 rounded-lg text-slate-500 hover:text-slate-700"
                    onClick={() => openEditDialog(sc)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    data-testid={`button-delete-roster-${sc.id}`}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 rounded-lg text-slate-500 hover:text-red-600"
                    onClick={() => setDeleteTarget(sc)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Technician schedule tab (kept) ─────────────────────────────────────────

function TechnicianTab({
  allAppointments,
  todayStr,
  todayAppts,
  getSchedulerForFacility,
}: {
  allAppointments: Record<string, AncillaryAppointment[]>;
  todayStr: string;
  todayAppts: (facility: string) => AncillaryAppointment[];
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-3">
        {VALID_FACILITIES.map((facility) => {
          const appts = allAppointments[facility] ?? [];
          const todayList = todayAppts(facility);
          const bwCount = todayList.filter((a) => isBrainWave(a.testType)).length;
          const vwCount = todayList.filter((a) => !isBrainWave(a.testType)).length;
          const sc = getSchedulerForFacility(facility);

          return (
            <Card
              key={facility}
              data-testid={`tech-card-${facility.toLowerCase().replace(/\s+/g, "-")}`}
              className={`${shellClass()} p-5 flex flex-col gap-4`}
            >
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${facilityAccent(facility)}`} />
                <span className="text-sm font-semibold text-slate-800">{facility}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-violet-50 px-3 py-2.5 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-600 flex-shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-violet-700 leading-none">{bwCount}</p>
                    <p className="text-[9px] uppercase tracking-wide text-violet-400 mt-0.5">BrainWave</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-red-50 px-3 py-2.5 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-red-500 flex-shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-red-600 leading-none">{vwCount}</p>
                    <p className="text-[9px] uppercase tracking-wide text-red-400 mt-0.5">VitalWave</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <UserCheck className={`h-3.5 w-3.5 flex-shrink-0 ${sc ? "text-violet-500" : "text-slate-300"}`} />
                <span className={`text-xs font-medium ${sc ? "text-slate-700" : "text-slate-400 italic"}`}>
                  {sc ? `Scheduler: ${sc.name}` : "No scheduler assigned"}
                </span>
              </div>

              {todayList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-5 text-slate-400 gap-2">
                  <CalendarCheck className="h-7 w-7 opacity-30" />
                  <p className="text-xs">No appointments today</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {todayList
                    .slice()
                    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
                    .map((appt) => (
                      <div
                        key={appt.id}
                        data-testid={`appt-row-${appt.id}`}
                        className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2 gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-700 truncate">{appt.patientName}</p>
                          <p className="text-[10px] text-slate-400">{formatTime12(appt.scheduledTime)}</p>
                        </div>
                        <Badge
                          className={`text-[9px] px-1.5 py-0 flex-shrink-0 ${isBrainWave(appt.testType) ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-red-100 text-red-600 border-red-200"}`}
                        >
                          {isBrainWave(appt.testType) ? "BW" : "VW"}
                        </Badge>
                      </div>
                    ))}
                </div>
              )}

              <p className="text-[10px] text-slate-400 text-right">
                {appts.filter((a) => a.status === "scheduled").length} total scheduled (all dates)
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

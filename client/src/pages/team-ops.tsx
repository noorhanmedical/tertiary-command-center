import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users2,
  Building2,
  Brain,
  Activity,
  AlertCircle,
  AlertTriangle,
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
  Hourglass,
  ClipboardList,
  LayoutDashboard,
  ShieldAlert,
  Plane,
  Send,
  Activity as ActivityIcon,
  Waves,
  X,
  CalendarPlus,
  ArrowRightLeft,
  StickyNote,
  Filter,
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
import { isBrainWave, isVitalWave, formatTime12, toDateKey } from "@/components/clinic-calendar";
import type { DateRange } from "react-day-picker";

// ─── Helpers ────────────────────────────────────────────────────────────────

function shellClass() {
  return "rounded-3xl border border-slate-200/70 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.06)]";
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

type ServiceBucket = "BrainWave" | "VitalWave" | "Ultrasound" | "Other";

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

function serviceBucket(testType: string): ServiceBucket {
  if (isBrainWave(testType)) return "BrainWave";
  if (isVitalWave(testType)) return "VitalWave";
  if (isUltrasoundTest(testType)) return "Ultrasound";
  return "Other";
}

const SERVICE_STYLES: Record<ServiceBucket, { dot: string; chip: string; Icon: typeof Brain }> = {
  BrainWave: { dot: "bg-violet-600", chip: "bg-violet-100 text-violet-700 border-violet-200", Icon: Brain },
  VitalWave: { dot: "bg-red-500", chip: "bg-red-100 text-red-600 border-red-200", Icon: Activity },
  Ultrasound: { dot: "bg-emerald-600", chip: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: Waves },
  Other: { dot: "bg-slate-500", chip: "bg-slate-100 text-slate-600 border-slate-200", Icon: ActivityIcon },
};

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
function isWeekday(d: Date) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}
function formatRange(start?: string, end?: string) {
  if (!start || !end) return "";
  if (start === end) return parseDateKey(start).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${parseDateKey(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} → ${parseDateKey(end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

// Standard clinic operating window used to represent a scheduler's coverage
// shift (the system has no per-shift time field — coverage spans clinic hours).
const CLINIC_HOURS = "8:00a–5:00p";

function apptTimeRange(appts: AncillaryAppointment[]): string {
  const times = appts.map((a) => a.scheduledTime).filter(Boolean).sort();
  if (times.length === 0) return "All day";
  if (times.length === 1) return formatTime12(times[0]);
  return `${formatTime12(times[0])}–${formatTime12(times[times.length - 1])}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type AuthUser = { id: string; username: string; role: string };
type TeamMember = { id: string; username: string };
type Section = "overview" | "calendar" | "coverage" | "pto" | "technicians" | "conflicts";
type CalView = "day" | "week" | "month";

type Conflict = {
  id: string;
  severity: "high" | "medium" | "low";
  type: string;
  facility: string;
  dateKey: string;
  owner: string;
  suggestion: string;
  resolvable: boolean;
};

type BlockKind = "covered" | "needs_coverage" | "pto" | "tech" | "conflict";
type CalBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  role?: string;
  clinic?: string;
  time?: string;
  subtitle?: string;
  facility?: string;
  count?: number;
};

const BLOCK_STYLES: Record<BlockKind, string> = {
  covered: "bg-emerald-50 border-emerald-200 text-emerald-800",
  needs_coverage: "bg-amber-50 border-amber-200 text-amber-800",
  pto: "bg-sky-50 border-sky-200 text-sky-800",
  tech: "bg-violet-50 border-violet-200 text-violet-800",
  conflict: "bg-red-50 border-red-200 text-red-800",
};

const BLOCK_STRIP: Record<BlockKind, string> = {
  covered: "bg-emerald-500",
  needs_coverage: "bg-amber-500",
  pto: "bg-sky-500",
  tech: "bg-violet-500",
  conflict: "bg-red-500",
};

const BLOCK_LABEL: Record<BlockKind, string> = {
  covered: "covered",
  needs_coverage: "needs coverage",
  pto: "PTO",
  tech: "technician",
  conflict: "conflict",
};

// ─── Main page ──────────────────────────────────────────────────────────────

export default function TeamOpsPage() {
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("overview");

  // Filters
  const [filterFacility, setFilterFacility] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterMember, setFilterMember] = useState<string>("all");

  // Calendar state
  const [view, setView] = useState<CalView>("month");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedKey, setSelectedKey] = useState<string>(dateKeyFromDate(new Date()));
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

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

  const { data: ptoTeamApproved = [] } = useQuery<PtoRequest[]>({
    queryKey: ["/api/pto-requests", "scope=approved-team"],
    queryFn: async () => {
      const res = await fetch(`/api/pto-requests?scope=approved-team`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team PTO");
      return res.json();
    },
  });

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

  // ── Derived: identity / role ──────────────────────────────────────────────
  const _now = new Date();
  const todayStr = dateKeyFromDate(_now);

  const usernameById = useMemo(() => {
    const m = new Map<string, string>();
    teamMembers.forEach((t) => m.set(t.id, t.username));
    return m;
  }, [teamMembers]);

  const schedulerUserIds = useMemo(
    () => new Set(schedulers.map((s) => s.userId).filter(Boolean) as string[]),
    [schedulers],
  );

  function memberRole(id: string): "scheduler" | "team" {
    return schedulerUserIds.has(id) ? "scheduler" : "team";
  }

  // Facilities respecting the facility filter
  const visibleFacilities = useMemo(
    () => (filterFacility === "all" ? [...VALID_FACILITIES] : VALID_FACILITIES.filter((f) => f === filterFacility)),
    [filterFacility],
  );

  const approvedPtoAll = useMemo(
    () => ptoTeamApproved.filter((p) => p.status === "approved"),
    [ptoTeamApproved],
  );

  // PTO filtered by role + member filter (for calendar / overview displays)
  const approvedPtoFiltered = useMemo(() => {
    return approvedPtoAll.filter((p) => {
      if (filterMember !== "all" && p.userId !== filterMember) return false;
      if (filterRole !== "all" && memberRole(p.userId) !== filterRole) return false;
      return true;
    });
  }, [approvedPtoAll, filterMember, filterRole, schedulerUserIds]);

  function approvedPtoOnDate(dateKey: string, list: PtoRequest[], userId?: string): PtoRequest[] {
    return list.filter((p) =>
      dateInRange(dateKey, p.startDate, p.endDate) &&
      (userId ? p.userId === userId : true)
    );
  }

  // schedulers respecting filters
  const filteredSchedulers = useMemo(() => {
    return schedulers.filter((s) => {
      if (filterFacility !== "all" && s.facility !== filterFacility) return false;
      if (filterMember !== "all" && s.userId !== filterMember) return false;
      if (filterRole === "team") return false; // schedulers are scheduler-role
      return true;
    });
  }, [schedulers, filterFacility, filterMember, filterRole]);

  function getSchedulerForFacility(facility: string) {
    return schedulers.find((s) => s.facility === facility) ?? null;
  }

  function apptsOnDate(facility: string, dateKey: string) {
    return (allAppointments[facility] ?? []).filter(
      (a) => a.scheduledDate === dateKey && a.status === "scheduled",
    );
  }

  function schedulerOnPto(sc: OutreachScheduler | null, dateKey: string): boolean {
    if (!sc || !sc.userId) return false;
    return approvedPtoOnDate(dateKey, approvedPtoAll, sc.userId).length > 0;
  }

  // ── Metrics (today) ───────────────────────────────────────────────────────
  const offTodayRequests = useMemo(
    () => approvedPtoOnDate(todayStr, approvedPtoAll),
    [approvedPtoAll, todayStr],
  );
  const offTodayUserIds = new Set(offTodayRequests.map((p) => p.userId));
  const onTodayMembers = teamMembers.filter((t) => !offTodayUserIds.has(t.id));

  const coveredTodayCount = useMemo(() => {
    let n = 0;
    for (const f of VALID_FACILITIES) {
      const sc = getSchedulerForFacility(f);
      if (sc && !schedulerOnPto(sc, todayStr)) n++;
    }
    return n;
  }, [schedulers, approvedPtoAll, todayStr]);

  const openShiftsCount = useMemo(
    () => VALID_FACILITIES.filter((f) => !getSchedulerForFacility(f)).length,
    [schedulers],
  );

  const technicianGapsCount = useMemo(() => {
    let n = 0;
    for (const f of VALID_FACILITIES) {
      const hasAppts = apptsOnDate(f, todayStr).length > 0;
      if (!hasAppts) continue;
      const sc = getSchedulerForFacility(f);
      if (!sc || schedulerOnPto(sc, todayStr)) n++;
    }
    return n;
  }, [schedulers, allAppointments, approvedPtoAll, todayStr]);

  const clinicsAtRiskCount = useMemo(() => {
    let n = 0;
    for (const f of VALID_FACILITIES) {
      const sc = getSchedulerForFacility(f);
      if (!sc || schedulerOnPto(sc, todayStr)) n++;
    }
    return n;
  }, [schedulers, approvedPtoAll, todayStr]);

  const pendingPtoCount = useMemo(
    () => (isAdmin ? ptoAdminAll : ptoMine).filter((p) => p.status === "pending").length,
    [isAdmin, ptoAdminAll, ptoMine],
  );

  // ── Conflicts derivation ──────────────────────────────────────────────────
  const conflicts = useMemo<Conflict[]>(() => {
    const out: Conflict[] = [];
    const horizonEnd = dateKeyFromDate(addDays(_now, 14));

    // 1. Clinic with no scheduler but upcoming appointments
    for (const f of VALID_FACILITIES) {
      const sc = getSchedulerForFacility(f);
      if (sc) continue;
      const upcoming = (allAppointments[f] ?? []).filter(
        (a) => a.status === "scheduled" && a.scheduledDate >= todayStr && a.scheduledDate <= horizonEnd,
      );
      if (upcoming.length > 0) {
        out.push({
          id: `noclinic-${f}`,
          severity: "high",
          type: "Clinic without coverage",
          facility: f,
          dateKey: upcoming.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0].scheduledDate,
          owner: "Unassigned",
          suggestion: `Assign a scheduler to ${f} — ${upcoming.length} appointment${upcoming.length !== 1 ? "s" : ""} pending.`,
          resolvable: true,
        });
      }
    }

    // 2. PTO without coverage — scheduler's linked user is off while the clinic has appts
    for (const sc of schedulers) {
      if (!sc.userId) continue;
      const ptos = approvedPtoAll.filter((p) => p.userId === sc.userId && p.endDate >= todayStr);
      for (const p of ptos) {
        const apptsDuring = (allAppointments[sc.facility] ?? []).filter(
          (a) => a.status === "scheduled" && dateInRange(a.scheduledDate, p.startDate, p.endDate) && a.scheduledDate >= todayStr,
        );
        if (apptsDuring.length > 0) {
          out.push({
            id: `pto-${sc.id}-${p.id}`,
            severity: "high",
            type: "PTO without coverage",
            facility: sc.facility,
            dateKey: p.startDate >= todayStr ? p.startDate : todayStr,
            owner: sc.name,
            suggestion: `${sc.name} is on PTO (${formatRange(p.startDate, p.endDate)}) while ${apptsDuring.length} appointment${apptsDuring.length !== 1 ? "s" : ""} remain at ${sc.facility}.`,
            resolvable: true,
          });
        }
      }
    }

    // 3. Double-booked scheduler — same linked user across multiple facilities
    const byUser = new Map<string, OutreachScheduler[]>();
    for (const sc of schedulers) {
      if (!sc.userId) continue;
      const arr = byUser.get(sc.userId) ?? [];
      arr.push(sc);
      byUser.set(sc.userId, arr);
    }
    for (const [userId, list] of byUser) {
      if (list.length > 1) {
        out.push({
          id: `double-${userId}`,
          severity: "medium",
          type: "Double-booked staff",
          facility: list.map((s) => s.facility).join(", "),
          dateKey: todayStr,
          owner: list[0].name,
          suggestion: `${list[0].name} is assigned to ${list.length} facilities at once. Split coverage to avoid conflicts.`,
          resolvable: false,
        });
      }
    }

    return out.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity] || a.dateKey.localeCompare(b.dateKey);
    });
  }, [schedulers, allAppointments, approvedPtoAll, todayStr]);

  const conflictsCount = conflicts.length;

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

  function openAddDialog(prefillFacility?: string) {
    setFormName("");
    setFormFacility(prefillFacility && VALID_FACILITIES.includes(prefillFacility as any) ? prefillFacility : "");
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

  // ── PTO review mutation (shared) ─────────────────────────────────────────
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

  function notImplemented(label: string) {
    toast({ title: `${label} — coming soon`, description: "This action isn't wired to a backend yet." });
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const metrics = [
    { label: "Covered Today", value: `${coveredTodayCount}/${VALID_FACILITIES.length}`, Icon: UserCheck, color: "bg-emerald-600/10 text-emerald-700", testId: "metric-covered-today" },
    { label: "PTO Today", value: offTodayRequests.length, Icon: Palmtree, color: "bg-sky-600/10 text-sky-700", testId: "metric-pto-today" },
    { label: "Open Shifts", value: openShiftsCount, Icon: CalendarPlus, color: "bg-amber-500/10 text-amber-700", testId: "metric-open-shifts" },
    { label: "Technician Gaps", value: technicianGapsCount, Icon: Stethoscope, color: "bg-orange-500/10 text-orange-700", testId: "metric-tech-gaps" },
    { label: "Clinics at Risk", value: clinicsAtRiskCount, Icon: ShieldAlert, color: "bg-red-500/10 text-red-700", testId: "metric-clinics-risk" },
    { label: "Pending PTO", value: pendingPtoCount, Icon: Hourglass, color: "bg-violet-600/10 text-violet-700", testId: "metric-pending-pto" },
  ];

  const sectionTabs: { id: Section; label: string; Icon: typeof Brain; badge?: number }[] = [
    { id: "overview", label: "Overview", Icon: LayoutDashboard },
    { id: "calendar", label: "Calendar", Icon: CalendarDays },
    { id: "coverage", label: "Coverage", Icon: Building2 },
    { id: "pto", label: "PTO", Icon: Plane, badge: pendingPtoCount || undefined },
    { id: "technicians", label: "Technicians", Icon: Stethoscope },
    { id: "conflicts", label: "Conflicts", Icon: AlertTriangle, badge: conflictsCount || undefined },
  ];

  return (
    <div className="finance-page">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-6 py-6">

        {/* Header */}
        <PageHeader
          eyebrow="PLEXUS ANCILLARY · TEAM OPS"
          icon={Users2}
          iconAccent="bg-violet-600/10 text-violet-700"
          title="Team Ops"
          subtitle="Calendar-first staffing command center — shifts, PTO, coverage and technician load at a glance."
          actions={
            <Button
              data-testid="button-add-shift"
              onClick={() => openAddDialog(filterFacility !== "all" ? filterFacility : undefined)}
              className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Shift / Assign Coverage
            </Button>
          }
        />

        {/* Command bar: filters + view toggle */}
        <Card className={`${shellClass()} flex flex-wrap items-center gap-3 px-4 py-3`}>
          <div className="flex items-center gap-1.5 text-slate-400">
            <Filter className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Filters</span>
          </div>
          <Select value={filterFacility} onValueChange={setFilterFacility}>
            <SelectTrigger data-testid="filter-facility" className="h-9 w-auto min-w-[160px] rounded-xl text-sm">
              <SelectValue placeholder="Facility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All facilities</SelectItem>
              {VALID_FACILITIES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger data-testid="filter-role" className="h-9 w-auto min-w-[130px] rounded-xl text-sm">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="scheduler">Schedulers</SelectItem>
              <SelectItem value="team">Team members</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMember} onValueChange={setFilterMember}>
            <SelectTrigger data-testid="filter-member" className="h-9 w-auto min-w-[150px] rounded-xl text-sm">
              <SelectValue placeholder="Team member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {teamMembers.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                data-testid="button-date-range"
                variant="outline"
                size="sm"
                className={`h-9 rounded-xl text-sm gap-1.5 ${dateRange?.from ? "border-violet-300 text-violet-700" : "text-slate-600"}`}
              >
                <CalendarDays className="h-4 w-4" />
                {dateRange?.from && dateRange?.to
                  ? formatRange(dateKeyFromDate(dateRange.from), dateKeyFromDate(dateRange.to))
                  : "Date range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2 rounded-2xl" align="start">
              <CalendarPicker
                mode="range"
                selected={dateRange}
                onSelect={(r) => {
                  setDateRange(r);
                  if (r?.from) {
                    setAnchor(r.from);
                    setSelectedKey(dateKeyFromDate(r.from));
                    setSection("calendar");
                  }
                }}
                numberOfMonths={2}
                data-testid="calendar-date-range"
              />
              {dateRange?.from && (
                <div className="flex justify-end px-1 pb-1">
                  <Button
                    data-testid="button-clear-date-range"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-slate-500"
                    onClick={() => setDateRange(undefined)}
                  >
                    Clear range
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
          {(filterFacility !== "all" || filterRole !== "all" || filterMember !== "all") && (
            <Button
              data-testid="button-clear-filters"
              variant="ghost"
              size="sm"
              className="h-9 rounded-xl text-xs text-slate-500"
              onClick={() => { setFilterFacility("all"); setFilterRole("all"); setFilterMember("all"); }}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
          <div className="ml-auto flex gap-1 rounded-xl bg-slate-100 p-1">
            {(["day", "week", "month"] as CalView[]).map((v) => (
              <button
                key={v}
                data-testid={`button-view-${v}`}
                onClick={() => { setView(v); setSection("calendar"); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition ${
                  view === v && section === "calendar" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </Card>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map(({ label, value, Icon, color, testId }) => (
            <Card key={label} className={`${shellClass()} flex items-center gap-3 px-4 py-3`}>
              <div className={`rounded-xl p-2 ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
                <p className="text-xl font-bold text-slate-900 leading-none mt-0.5" data-testid={testId}>{value}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Section nav */}
        <div className="flex flex-wrap gap-1 rounded-2xl bg-white border border-slate-200/70 p-1 w-fit shadow-sm">
          {sectionTabs.map(({ id, label, Icon, badge }) => (
            <button
              key={id}
              data-testid={`section-${id}`}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                section === id ? "bg-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {badge ? (
                <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${section === id ? "bg-white/25 text-white" : "bg-violet-100 text-violet-700"}`}>
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── Sections ──────────────────────────────────────────────────── */}
        {section === "overview" && (
          <OverviewSection
            teamMembers={teamMembers}
            onTodayMembers={onTodayMembers}
            offTodayRequests={offTodayRequests}
            usernameById={usernameById}
            schedulers={schedulers}
            schedulerOnPto={schedulerOnPto}
            getSchedulerForFacility={getSchedulerForFacility}
            conflicts={conflicts}
            pendingPtoCount={pendingPtoCount}
            allAppointments={allAppointments}
            todayStr={todayStr}
            onGoTo={setSection}
            onAssign={openAddDialog}
          />
        )}

        {section === "calendar" && (
          <CalendarSection
            view={view}
            anchor={anchor}
            setAnchor={setAnchor}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            dateRange={dateRange}
            visibleFacilities={visibleFacilities}
            filteredSchedulers={filteredSchedulers}
            approvedPtoFiltered={approvedPtoFiltered}
            usernameById={usernameById}
            allAppointments={allAppointments}
            apptsOnDate={apptsOnDate}
            schedulerOnPto={schedulerOnPto}
            getSchedulerForFacility={getSchedulerForFacility}
            isAdmin={!!isAdmin}
            ptoAdminAll={ptoAdminAll}
            reviewMutation={reviewMutation}
            onAssign={openAddDialog}
            notImplemented={notImplemented}
          />
        )}

        {section === "coverage" && (
          <CoverageSection
            schedulers={schedulers}
            getSchedulerForFacility={getSchedulerForFacility}
            schedulerOnPto={schedulerOnPto}
            openEditDialog={openEditDialog}
            openAddDialog={openAddDialog}
            setDeleteTarget={setDeleteTarget}
            allAppointments={allAppointments}
            todayStr={todayStr}
            usernameById={usernameById}
            notImplemented={notImplemented}
          />
        )}

        {section === "pto" && (
          <PtoSection
            me={me ?? null}
            isAdmin={!!isAdmin}
            ptoMine={ptoMine}
            ptoAll={ptoAdminAll}
            usernameById={usernameById}
            reviewMutation={reviewMutation}
          />
        )}

        {section === "technicians" && (
          <TechniciansSection
            anchor={anchor}
            setAnchor={setAnchor}
            dateRange={dateRange}
            visibleFacilities={visibleFacilities}
            allAppointments={allAppointments}
            getSchedulerForFacility={getSchedulerForFacility}
            schedulerOnPto={schedulerOnPto}
            notImplemented={notImplemented}
          />
        )}

        {section === "conflicts" && (
          <ConflictsSection
            conflicts={conflicts}
            onAssign={openAddDialog}
            notImplemented={notImplemented}
          />
        )}
      </div>

      {/* Assign / Edit Dialog */}
      <Dialog open={assignDialog.open} onOpenChange={(open) => { if (!open) closeAssignDialog(); }}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{assignDialog.editing ? "Edit Coverage Assignment" : "Add Shift / Assign Coverage"}</DialogTitle>
            <DialogDescription>
              Assign a scheduler to cover a facility. They become the owner for that clinic's coverage.
            </DialogDescription>
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

// ─── Shared bits ──────────────────────────────────────────────────────────

function SectionTitle({ Icon, title, sub, action }: { Icon: typeof Brain; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="rounded-xl p-2 bg-violet-600/10 text-violet-700">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-800 leading-tight">{title}</h2>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function EmptyState({ Icon, title, sub }: { Icon: typeof Brain; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-300">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {sub && <p className="text-xs text-slate-400 max-w-xs">{sub}</p>}
    </div>
  );
}

function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <div className={`h-7 w-7 rounded-full bg-violet-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0 ${className}`}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

// ─── Overview section ─────────────────────────────────────────────────────

function OverviewSection({
  teamMembers,
  onTodayMembers,
  offTodayRequests,
  usernameById,
  schedulers,
  schedulerOnPto,
  getSchedulerForFacility,
  conflicts,
  pendingPtoCount,
  allAppointments,
  todayStr,
  onGoTo,
  onAssign,
}: {
  teamMembers: TeamMember[];
  onTodayMembers: TeamMember[];
  offTodayRequests: PtoRequest[];
  usernameById: Map<string, string>;
  schedulers: OutreachScheduler[];
  schedulerOnPto: (sc: OutreachScheduler | null, dateKey: string) => boolean;
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  conflicts: Conflict[];
  pendingPtoCount: number;
  allAppointments: Record<string, AncillaryAppointment[]>;
  todayStr: string;
  onGoTo: (s: Section) => void;
  onAssign: (f?: string) => void;
}) {
  const today = new Date();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Today's coverage health */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3 lg:col-span-2`} data-testid="panel-coverage-health">
        <SectionTitle
          Icon={Building2}
          title="Today's Coverage"
          sub={today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        />
        <div className="grid gap-2.5 sm:grid-cols-3">
          {VALID_FACILITIES.map((f) => {
            const sc = getSchedulerForFacility(f);
            const onPto = schedulerOnPto(sc, todayStr);
            const apptCount = (allAppointments[f] ?? []).filter((a) => a.scheduledDate === todayStr && a.status === "scheduled").length;
            const status = !sc ? "unassigned" : onPto ? "at-risk" : "covered";
            return (
              <div
                key={f}
                data-testid={`overview-facility-${f.toLowerCase().replace(/\s+/g, "-")}`}
                className={`rounded-2xl border p-3.5 flex flex-col gap-2 ${
                  status === "covered" ? "border-emerald-200 bg-emerald-50/50"
                  : status === "at-risk" ? "border-amber-200 bg-amber-50/50"
                  : "border-red-200 bg-red-50/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${facilityAccent(f)}`} />
                  <p className="text-xs font-bold text-slate-700 truncate">{f}</p>
                </div>
                <p className={`text-sm font-semibold truncate ${sc ? "text-slate-800" : "text-red-600 italic"}`}>
                  {sc ? sc.name : "Unassigned"}
                </p>
                <div className="flex items-center justify-between">
                  <Badge className={`text-[10px] px-2 py-0 border ${
                    status === "covered" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : status === "at-risk" ? "bg-amber-100 text-amber-700 border-amber-200"
                    : "bg-red-100 text-red-700 border-red-200"
                  }`}>
                    {status === "covered" ? "Covered" : status === "at-risk" ? "On PTO" : "Open shift"}
                  </Badge>
                  <span className="text-[10px] text-slate-400">{apptCount} appt{apptCount !== 1 ? "s" : ""}</span>
                </div>
                {!sc && (
                  <Button
                    data-testid={`overview-assign-${f.toLowerCase().replace(/\s+/g, "-")}`}
                    size="sm"
                    className="h-7 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1 mt-0.5"
                    onClick={() => onAssign(f)}
                  >
                    <Plus className="h-3 w-3" /> Assign
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Conflicts / risks summary */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-risks">
        <SectionTitle Icon={AlertTriangle} title="Open Risks" sub="Needs attention" />
        {conflicts.length === 0 ? (
          <EmptyState Icon={CheckCircle2} title="No conflicts" sub="Coverage looks healthy across all clinics." />
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {conflicts.slice(0, 6).map((c) => (
              <button
                key={c.id}
                data-testid={`overview-risk-${c.id}`}
                onClick={() => onGoTo("conflicts")}
                className="w-full text-left rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 hover:border-violet-200 hover:bg-violet-50/40 transition"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.severity === "high" ? "bg-red-500" : c.severity === "medium" ? "bg-amber-500" : "bg-slate-400"}`} />
                  <p className="text-xs font-semibold text-slate-700 truncate">{c.type}</p>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{c.facility} · {c.owner}</p>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* On today */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-on-today">
        <SectionTitle Icon={Sun} title="On Today" sub={`${onTodayMembers.length} working`} />
        {teamMembers.length === 0 ? (
          <EmptyState Icon={Users2} title="No team members loaded" />
        ) : onTodayMembers.length === 0 ? (
          <EmptyState Icon={Palmtree} title="Everyone is off today" />
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {onTodayMembers.map((m) => (
              <div key={m.id} data-testid={`row-on-today-${m.id}`} className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                <Avatar name={m.username} className="bg-emerald-600 h-7 w-7" />
                <p className="text-sm font-medium text-slate-700 truncate">{m.username}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Off today */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-off-today">
        <SectionTitle Icon={Palmtree} title="Off Today" sub="Approved PTO" />
        {offTodayRequests.length === 0 ? (
          <EmptyState Icon={Sun} title="No one is off today" />
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {offTodayRequests.map((p) => (
              <div key={p.id} data-testid={`row-off-today-${p.id}`} className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2">
                <Avatar name={usernameById.get(p.userId) ?? "?"} className="bg-sky-500 h-7 w-7" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">{usernameById.get(p.userId) ?? "Unknown"}</p>
                  <p className="text-[10px] text-slate-500 truncate">{formatRange(p.startDate, p.endDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pending PTO shortcut */}
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-pending-pto">
        <SectionTitle Icon={Hourglass} title="Pending PTO" sub="Awaiting review" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4">
          <p className="text-4xl font-bold text-slate-800" data-testid="text-pending-pto-count">{pendingPtoCount}</p>
          <p className="text-xs text-slate-400">request{pendingPtoCount !== 1 ? "s" : ""} waiting</p>
          <Button
            data-testid="button-go-pto"
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            onClick={() => onGoTo("pto")}
          >
            Review requests
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Calendar section ─────────────────────────────────────────────────────

function CalendarSection({
  view,
  anchor,
  setAnchor,
  selectedKey,
  setSelectedKey,
  dateRange,
  visibleFacilities,
  filteredSchedulers,
  approvedPtoFiltered,
  usernameById,
  allAppointments,
  apptsOnDate,
  schedulerOnPto,
  getSchedulerForFacility,
  isAdmin,
  ptoAdminAll,
  reviewMutation,
  onAssign,
  notImplemented,
}: {
  view: CalView;
  anchor: Date;
  setAnchor: (d: Date) => void;
  selectedKey: string;
  setSelectedKey: (k: string) => void;
  dateRange: DateRange | undefined;
  visibleFacilities: string[];
  filteredSchedulers: OutreachScheduler[];
  approvedPtoFiltered: PtoRequest[];
  usernameById: Map<string, string>;
  allAppointments: Record<string, AncillaryAppointment[]>;
  apptsOnDate: (f: string, k: string) => AncillaryAppointment[];
  schedulerOnPto: (sc: OutreachScheduler | null, dateKey: string) => boolean;
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  isAdmin: boolean;
  ptoAdminAll: PtoRequest[];
  reviewMutation: ReturnType<typeof useMutation<any, any, { id: number; status: "approved" | "denied" }>>;
  onAssign: (f?: string) => void;
  notImplemented: (label: string) => void;
}) {
  const todayKey = dateKeyFromDate(new Date());

  const days = useMemo(() => {
    if (view === "day") return [parseDateKey(selectedKey)];
    if (view === "week") {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = startOfWeek(monthEnd);
    const totalDays = Math.ceil((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 7;
    return Array.from({ length: totalDays }, (_, i) => addDays(gridStart, i));
  }, [view, anchor, selectedKey]);

  const rangeStartKey = dateRange?.from ? dateKeyFromDate(dateRange.from) : null;
  const rangeEndKey = dateRange?.to ? dateKeyFromDate(dateRange.to) : (dateRange?.from ? dateKeyFromDate(dateRange.from) : null);
  function inSelectedRange(k: string): boolean {
    if (!rangeStartKey || !rangeEndKey) return true;
    return dateInRange(k, rangeStartKey, rangeEndKey);
  }

  function blocksForDay(d: Date): CalBlock[] {
    const k = dateKeyFromDate(d);
    if (!inSelectedRange(k)) return [];
    const blocks: CalBlock[] = [];
    // Coverage blocks (weekdays only). Each carries name + role + clinic +
    // shift window + status (via the colored strip).
    if (isWeekday(d)) {
      for (const f of visibleFacilities) {
        const sc = filteredSchedulers.find((s) => s.facility === f) ?? null;
        if (!sc) continue;
        const onPto = schedulerOnPto(sc, k);
        blocks.push({
          id: `cov-${sc.id}-${k}`,
          kind: onPto ? "needs_coverage" : "covered",
          title: sc.name,
          role: onPto ? "Scheduler · PTO conflict" : "Scheduler",
          clinic: f,
          time: CLINIC_HOURS,
          subtitle: `Scheduler · ${f}`,
          facility: f,
        });
      }
    }
    // PTO blocks
    for (const p of approvedPtoFiltered.filter((p) => dateInRange(k, p.startDate, p.endDate))) {
      blocks.push({
        id: `pto-${p.id}-${k}`,
        kind: "pto",
        title: usernameById.get(p.userId) ?? "Unknown",
        role: "Time off",
        time: p.startDate === p.endDate ? "All day" : formatRange(p.startDate, p.endDate),
        subtitle: "Time off",
      });
    }
    // Technician blocks (per facility, aggregated) with real appointment times.
    for (const f of visibleFacilities) {
      const appts = apptsOnDate(f, k);
      if (appts.length === 0) continue;
      blocks.push({
        id: `tech-${f}-${k}`,
        kind: "tech",
        title: `${appts.length} appt${appts.length !== 1 ? "s" : ""}`,
        role: "Technician",
        clinic: f,
        time: apptTimeRange(appts),
        subtitle: f,
        facility: f,
        count: appts.length,
      });
    }
    return blocks;
  }

  const headerLabel = (() => {
    if (view === "day") return parseDateKey(selectedKey).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") {
      const s = startOfWeek(anchor);
      const e = addDays(s, 6);
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  })();

  function navigate(dir: -1 | 1) {
    if (view === "day") {
      const next = addDays(parseDateKey(selectedKey), dir);
      setSelectedKey(dateKeyFromDate(next));
      setAnchor(next);
    } else if (view === "week") {
      setAnchor(addDays(anchor, dir * 7));
    } else {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className={`${shellClass()} p-5 flex flex-col gap-4`}>
        {/* Calendar controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button data-testid="button-cal-prev" variant="outline" size="sm" className="rounded-xl h-8 w-8 p-0" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button data-testid="button-cal-next" variant="outline" size="sm" className="rounded-xl h-8 w-8 p-0" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              data-testid="button-cal-today"
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs ml-1"
              onClick={() => { setAnchor(new Date()); setSelectedKey(todayKey); }}
            >
              Today
            </Button>
          </div>
          <h2 className="text-base font-bold text-slate-800" data-testid="text-cal-label">{headerLabel}</h2>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
          {(["covered", "needs_coverage", "pto", "tech", "conflict"] as BlockKind[]).map((kind) => (
            <div key={kind} className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-sm ${BLOCK_STRIP[kind]}`} />
              <span className="capitalize">{BLOCK_LABEL[kind]}</span>
            </div>
          ))}
        </div>

        {/* Calendar body */}
        {view === "day" ? (
          <DayColumn blocks={blocksForDay(parseDateKey(selectedKey))} />
        ) : view === "week" ? (
          <div className="grid grid-cols-7 gap-2">
            {days.map((d) => {
              const k = dateKeyFromDate(d);
              const isToday = k === todayKey;
              const isSelected = k === selectedKey;
              const blocks = blocksForDay(d);
              return (
                <button
                  key={k}
                  data-testid={`cal-day-${k}`}
                  onClick={() => setSelectedKey(k)}
                  className={`min-h-[200px] rounded-2xl border text-left p-2 flex flex-col gap-1.5 transition ${
                    isSelected ? "border-violet-400 ring-2 ring-violet-200" : "border-slate-100 hover:border-violet-200"
                  } ${isToday ? "bg-violet-50/40" : "bg-white"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className={`text-xs font-bold ${isToday ? "text-violet-700" : "text-slate-600"}`}>{d.getDate()}</span>
                  </div>
                  <div className="flex flex-col gap-1 overflow-hidden">
                    {blocks.slice(0, 4).map((b) => <WeekBlock key={b.id} block={b} />)}
                    {blocks.length > 4 && <span className="text-[10px] text-slate-400 pl-1">+{blocks.length - 4} more</span>}
                    {blocks.length === 0 && <span className="text-[10px] text-slate-300 italic pl-1">—</span>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold text-center pb-1">{d}</div>
            ))}
            {days.map((d) => {
              const k = dateKeyFromDate(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = k === todayKey;
              const isSelected = k === selectedKey;
              const blocks = blocksForDay(d);
              return (
                <button
                  key={k}
                  data-testid={`cal-day-${k}`}
                  onClick={() => setSelectedKey(k)}
                  className={`min-h-[110px] rounded-xl border text-left p-1.5 flex flex-col gap-1 transition ${
                    isSelected ? "border-violet-400 ring-2 ring-violet-200" : "border-slate-100 hover:border-violet-200"
                  } ${inMonth ? (isToday ? "bg-violet-50/50" : "bg-white") : "bg-slate-50/60"}`}
                >
                  <span className={`text-xs font-bold ${!inMonth ? "text-slate-300" : isToday ? "text-violet-700" : "text-slate-600"}`}>
                    {d.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {blocks.slice(0, 3).map((b) => <BlockChip key={b.id} block={b} compact />)}
                    {blocks.length > 3 && <span className="text-[9px] text-slate-400 pl-1">+{blocks.length - 3}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Right detail panel */}
      <DayDetailPanel
        dateKey={selectedKey}
        visibleFacilities={visibleFacilities}
        filteredSchedulers={filteredSchedulers}
        approvedPtoFiltered={approvedPtoFiltered}
        usernameById={usernameById}
        apptsOnDate={apptsOnDate}
        schedulerOnPto={schedulerOnPto}
        getSchedulerForFacility={getSchedulerForFacility}
        isAdmin={isAdmin}
        ptoAdminAll={ptoAdminAll}
        reviewMutation={reviewMutation}
        onAssign={onAssign}
        notImplemented={notImplemented}
      />
    </div>
  );
}

function BlockChip({ block, compact = false }: { block: CalBlock; compact?: boolean }) {
  return (
    <div
      data-testid={`block-${block.id}`}
      className={`rounded-md border px-1.5 ${compact ? "py-0.5" : "py-1"} flex items-center gap-1 overflow-hidden ${BLOCK_STYLES[block.kind]}`}
      title={`${block.title}${block.role ? " · " + block.role : ""}${block.clinic ? " · " + block.clinic : ""}${block.time ? " · " + block.time : ""}`}
    >
      <span className={`h-2.5 w-1 rounded-full flex-shrink-0 ${BLOCK_STRIP[block.kind]}`} />
      {block.time && <span className="text-[8px] font-semibold opacity-70 flex-shrink-0">{block.time.split("–")[0]}</span>}
      <span className={`font-semibold truncate ${compact ? "text-[9px]" : "text-[10px]"}`}>{block.title}</span>
    </div>
  );
}

function WeekBlock({ block }: { block: CalBlock }) {
  return (
    <div
      data-testid={`block-${block.id}`}
      className={`relative rounded-lg border pl-2 pr-1.5 py-1 overflow-hidden ${BLOCK_STYLES[block.kind]}`}
      title={`${block.title}${block.role ? " · " + block.role : ""}${block.clinic ? " · " + block.clinic : ""}${block.time ? " · " + block.time : ""}`}
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${BLOCK_STRIP[block.kind]}`} />
      <p className="text-[10px] font-bold truncate leading-tight">{block.title}</p>
      {(block.role || block.clinic) && (
        <p className="text-[8px] opacity-80 truncate leading-tight">
          {[block.role, block.clinic].filter(Boolean).join(" · ")}
        </p>
      )}
      {block.time && <p className="text-[8px] font-medium opacity-70 leading-tight">{block.time}</p>}
    </div>
  );
}

function DayColumn({ blocks }: { blocks: CalBlock[] }) {
  if (blocks.length === 0) {
    return <EmptyState Icon={CalendarDays} title="Nothing scheduled" sub="No coverage, PTO or technician load for this day." />;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {blocks.map((b) => (
        <div
          key={b.id}
          data-testid={`day-block-${b.id}`}
          className={`relative rounded-2xl border p-3.5 pl-4 overflow-hidden ${BLOCK_STYLES[b.kind]}`}
        >
          <span className={`absolute left-0 top-0 h-full w-1.5 ${BLOCK_STRIP[b.kind]}`} />
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold truncate">{b.title}</p>
            {b.time && <span className="text-[10px] font-semibold opacity-70 flex-shrink-0">{b.time}</span>}
          </div>
          {b.role && <p className="text-xs font-medium opacity-90 truncate">{b.role}</p>}
          {b.clinic && <p className="text-xs opacity-75 truncate">{b.clinic}</p>}
          <Badge className="mt-2 bg-white/70 text-current border-current/20 text-[10px] capitalize">{BLOCK_LABEL[b.kind]}</Badge>
        </div>
      ))}
    </div>
  );
}

function DayDetailPanel({
  dateKey,
  visibleFacilities,
  filteredSchedulers,
  approvedPtoFiltered,
  usernameById,
  apptsOnDate,
  schedulerOnPto,
  getSchedulerForFacility,
  isAdmin,
  ptoAdminAll,
  reviewMutation,
  onAssign,
  notImplemented,
}: {
  dateKey: string;
  visibleFacilities: string[];
  filteredSchedulers: OutreachScheduler[];
  approvedPtoFiltered: PtoRequest[];
  usernameById: Map<string, string>;
  apptsOnDate: (f: string, k: string) => AncillaryAppointment[];
  schedulerOnPto: (sc: OutreachScheduler | null, dateKey: string) => boolean;
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  isAdmin: boolean;
  ptoAdminAll: PtoRequest[];
  reviewMutation: ReturnType<typeof useMutation<any, any, { id: number; status: "approved" | "denied" }>>;
  onAssign: (f?: string) => void;
  notImplemented: (label: string) => void;
}) {
  const d = parseDateKey(dateKey);
  const isWeekdayDate = isWeekday(d);

  const working = isWeekdayDate
    ? visibleFacilities.map((f) => ({ f, sc: filteredSchedulers.find((s) => s.facility === f) ?? null })).filter((x) => x.sc && !schedulerOnPto(x.sc, dateKey))
    : [];
  const ptoToday = approvedPtoFiltered.filter((p) => dateInRange(dateKey, p.startDate, p.endDate));
  const openShifts = isWeekdayDate ? visibleFacilities.filter((f) => !getSchedulerForFacility(f)) : [];
  const techByFacility = visibleFacilities
    .map((f) => ({ f, appts: apptsOnDate(f, dateKey) }))
    .filter((x) => x.appts.length > 0);
  const pendingPtoOnDate = isAdmin
    ? ptoAdminAll.filter((p) => p.status === "pending" && dateInRange(dateKey, p.startDate, p.endDate))
    : [];

  return (
    <Card className={`${shellClass()} p-5 flex flex-col gap-4 self-start sticky top-4`} data-testid="day-detail-panel">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Day detail</p>
        <h3 className="text-base font-bold text-slate-800" data-testid="detail-date">
          {d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </h3>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button data-testid="action-add-shift" size="sm" className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] gap-1 px-2" onClick={() => onAssign()}>
          <CalendarPlus className="h-3.5 w-3.5" /> Add Shift
        </Button>
        <Button data-testid="action-assign-coverage" size="sm" variant="outline" className="rounded-xl text-[11px] gap-1 px-2" onClick={() => onAssign()}>
          <UserCheck className="h-3.5 w-3.5" /> Assign
        </Button>
        <Button
          data-testid="action-approve-pto"
          size="sm"
          variant="outline"
          className="rounded-xl text-[11px] gap-1 px-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
          disabled={!isAdmin || pendingPtoOnDate.length === 0 || reviewMutation.isPending}
          onClick={() => pendingPtoOnDate.forEach((p) => reviewMutation.mutate({ id: p.id, status: "approved" }))}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Approve PTO{pendingPtoOnDate.length ? ` (${pendingPtoOnDate.length})` : ""}
        </Button>
        <Button data-testid="action-move-tech" size="sm" variant="outline" className="rounded-xl text-[11px] gap-1 px-2" onClick={() => notImplemented("Move technician")}>
          <ArrowRightLeft className="h-3.5 w-3.5" /> Move Tech
        </Button>
        <Button data-testid="action-mark-resolved" size="sm" variant="outline" className="rounded-xl text-[11px] gap-1 px-2" onClick={() => notImplemented("Mark resolved")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
        </Button>
        <Button data-testid="action-add-note" size="sm" variant="outline" className="rounded-xl text-[11px] gap-1 px-2" onClick={() => notImplemented("Add note")}>
          <StickyNote className="h-3.5 w-3.5" /> Add Note
        </Button>
      </div>

      {/* Working staff */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Working ({working.length})</p>
        {working.length === 0 ? (
          <p className="text-xs italic text-slate-400">{isWeekdayDate ? "No assigned coverage." : "Weekend — no shifts."}</p>
        ) : (
          working.map(({ f, sc }) => (
            <div key={f} className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
              <Avatar name={sc!.name} className="bg-emerald-600 h-6 w-6 text-[10px]" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">{sc!.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{f}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* PTO */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Off — PTO ({ptoToday.length})</p>
        {ptoToday.length === 0 ? (
          <p className="text-xs italic text-slate-400">No one off this day.</p>
        ) : (
          ptoToday.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2">
              <Palmtree className="h-3.5 w-3.5 text-sky-600 flex-shrink-0" />
              <span className="text-xs text-slate-700 truncate">{usernameById.get(p.userId) ?? "Unknown"}{p.note ? ` — ${p.note}` : ""}</span>
            </div>
          ))
        )}
      </div>

      {/* Pending PTO approvals on this date (admin) */}
      {isAdmin && pendingPtoOnDate.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-amber-500 font-semibold">Pending approval ({pendingPtoOnDate.length})</p>
          {pendingPtoOnDate.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-2.5 py-2">
              <span className="text-xs text-slate-700 truncate flex-1">{usernameById.get(p.userId) ?? "Unknown"}</span>
              <Button data-testid={`detail-approve-${p.id}`} size="sm" className="h-6 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px]" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: p.id, status: "approved" })}>
                Approve
              </Button>
              <Button data-testid={`detail-deny-${p.id}`} size="sm" variant="outline" className="h-6 px-2 rounded-lg text-red-600 border-red-200 text-[10px]" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: p.id, status: "denied" })}>
                Deny
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Open shifts */}
      {openShifts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-red-500 font-semibold">Open shifts ({openShifts.length})</p>
          {openShifts.map((f) => (
            <div key={f} className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
              <span className="text-xs text-slate-700 truncate flex-1">{f}</span>
              <Button data-testid={`detail-assign-${f.toLowerCase().replace(/\s+/g, "-")}`} size="sm" className="h-6 px-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px]" onClick={() => onAssign(f)}>
                Assign
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Technician load */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Technician load</p>
        {techByFacility.length === 0 ? (
          <p className="text-xs italic text-slate-400">No appointments scheduled.</p>
        ) : (
          techByFacility.map(({ f, appts }) => {
            const buckets = appts.reduce((acc, a) => {
              const b = serviceBucket(a.testType);
              acc[b] = (acc[b] ?? 0) + 1;
              return acc;
            }, {} as Record<ServiceBucket, number>);
            return (
              <div key={f} className="rounded-xl bg-violet-50/60 border border-violet-100 px-3 py-2">
                <p className="text-xs font-semibold text-slate-700 truncate">{f}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(Object.keys(buckets) as ServiceBucket[]).map((b) => (
                    <Badge key={b} className={`text-[9px] px-1.5 py-0 border ${SERVICE_STYLES[b].chip}`}>{buckets[b]} {b}</Badge>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ─── Coverage section ─────────────────────────────────────────────────────

function CoverageSection({
  schedulers,
  getSchedulerForFacility,
  schedulerOnPto,
  openEditDialog,
  openAddDialog,
  setDeleteTarget,
  allAppointments,
  todayStr,
  usernameById,
  notImplemented,
}: {
  schedulers: OutreachScheduler[];
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  schedulerOnPto: (sc: OutreachScheduler | null, dateKey: string) => boolean;
  openEditDialog: (sc: OutreachScheduler) => void;
  openAddDialog: (f?: string) => void;
  setDeleteTarget: (sc: OutreachScheduler | null) => void;
  allAppointments: Record<string, AncillaryAppointment[]>;
  todayStr: string;
  usernameById: Map<string, string>;
  notImplemented: (label: string) => void;
}) {
  // Facilities that need attention today: unassigned (open shift) or the
  // assigned scheduler is absent on PTO.
  const needsAttention = VALID_FACILITIES.map((f) => {
    const sc = getSchedulerForFacility(f);
    const onPto = schedulerOnPto(sc, todayStr);
    if (!sc) return { f, sc: null as OutreachScheduler | null, reason: "open" as const };
    if (onPto) return { f, sc, reason: "absent" as const };
    return null;
  }).filter(Boolean) as { f: string; sc: OutreachScheduler | null; reason: "open" | "absent" }[];

  return (
    <div className="flex flex-col gap-5">
      {needsAttention.length > 0 && (
        <Card className={`${shellClass()} p-5 flex flex-col gap-3 border-amber-200`} data-testid="panel-needs-attention">
          <SectionTitle Icon={AlertTriangle} title="Needs Attention" sub={`${needsAttention.length} clinic${needsAttention.length !== 1 ? "s" : ""} without active coverage today`} />
          <div className="flex flex-col gap-2">
            {needsAttention.map(({ f, sc, reason }) => (
              <div key={f} data-testid={`attention-row-${f.toLowerCase().replace(/\s+/g, "-")}`} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${reason === "open" ? "border-red-200 bg-red-50/50" : "border-amber-200 bg-amber-50/50"}`}>
                <div className={`h-2 w-2 rounded-full ${facilityAccent(f)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{f}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {reason === "open" ? "No scheduler assigned" : `${sc?.name} is on PTO — coverage absent`}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {reason === "open" ? (
                    <Button data-testid={`attention-assign-${f.toLowerCase().replace(/\s+/g, "-")}`} size="sm" className="h-8 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1" onClick={() => openAddDialog(f)}>
                      <Plus className="h-3.5 w-3.5" /> Assign
                    </Button>
                  ) : (
                    sc && (
                      <Button data-testid={`attention-change-${f.toLowerCase().replace(/\s+/g, "-")}`} size="sm" variant="outline" className="h-8 rounded-xl text-xs gap-1" onClick={() => openEditDialog(sc)}>
                        <Pencil className="h-3.5 w-3.5" /> Change
                      </Button>
                    )
                  )}
                  <Button data-testid={`attention-resolve-${f.toLowerCase().replace(/\s+/g, "-")}`} size="sm" variant="outline" className="h-8 rounded-xl text-xs gap-1" onClick={() => notImplemented("Mark resolved")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {VALID_FACILITIES.map((facility) => {
          const sc = getSchedulerForFacility(facility);
          const onPto = schedulerOnPto(sc, todayStr);
          const apptCount = (allAppointments[facility] ?? []).filter((a) => a.scheduledDate === todayStr && a.status === "scheduled").length;
          const risk = !sc ? "open" : onPto ? "risk" : "ok";
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
                <Badge className={`text-[10px] px-2 py-0.5 border flex-shrink-0 ${
                  risk === "ok" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : risk === "risk" ? "bg-amber-100 text-amber-700 border-amber-200"
                  : "bg-red-100 text-red-700 border-red-200"
                }`}>
                  {risk === "ok" ? "Covered" : risk === "risk" ? "At risk" : "Open shift"}
                </Badge>
              </div>

              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
                <div className={`rounded-xl p-1.5 ${sc ? "bg-violet-100 text-violet-600" : "bg-slate-200 text-slate-400"}`}>
                  <UserCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wide font-medium text-slate-400">Scheduler</p>
                  <p className={`text-sm font-semibold truncate ${sc ? "text-slate-800" : "text-slate-400 italic"}`}>
                    {sc ? sc.name : "Unassigned"}
                  </p>
                  {onPto && sc?.userId && (
                    <p className="text-[10px] text-amber-600 font-medium">On PTO today</p>
                  )}
                </div>
                {sc ? (
                  <div className="ml-auto flex gap-1">
                    <button data-testid={`button-edit-scheduler-${sc.id}`} onClick={() => openEditDialog(sc)} className="rounded-lg p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button data-testid={`button-delete-scheduler-${sc.id}`} onClick={() => setDeleteTarget(sc)} className="rounded-lg p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{apptCount} appointment{apptCount !== 1 ? "s" : ""} today</span>
                {!sc && (
                  <Button data-testid={`coverage-assign-${facility.toLowerCase().replace(/\s+/g, "-")}`} size="sm" className="h-7 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1" onClick={() => openAddDialog(facility)}>
                    <Plus className="h-3 w-3" /> Assign
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className={`${shellClass()} p-5`}>
        <SectionTitle
          Icon={Users2}
          title="Scheduler Roster"
          sub={`${schedulers.length} assignment${schedulers.length !== 1 ? "s" : ""}`}
          action={
            <Button data-testid="button-roster-add" size="sm" className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1" onClick={() => openAddDialog()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />
        {schedulers.length === 0 ? (
          <EmptyState Icon={Users2} title="No schedulers assigned" sub="Assign a scheduler to a facility to start tracking coverage." />
        ) : (
          <div className="divide-y divide-slate-100 mt-2">
            {schedulers.map((sc) => (
              <div key={sc.id} data-testid={`roster-row-${sc.id}`} className="flex flex-wrap items-center gap-3 py-3">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${facilityAccent(sc.facility)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{sc.name}</p>
                  <p className="text-xs text-slate-400">{sc.facility}{sc.userId ? ` · linked to ${usernameById.get(sc.userId) ?? "user"}` : ""}</p>
                </div>
                <div className="flex gap-1">
                  <Button data-testid={`button-edit-roster-${sc.id}`} variant="ghost" size="sm" className="h-7 px-2 rounded-lg text-slate-500 hover:text-slate-700" onClick={() => openEditDialog(sc)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button data-testid={`button-delete-roster-${sc.id}`} variant="ghost" size="sm" className="h-7 px-2 rounded-lg text-slate-500 hover:text-red-600" onClick={() => setDeleteTarget(sc)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── PTO section ──────────────────────────────────────────────────────────

function PtoSection({
  me,
  isAdmin,
  ptoMine,
  ptoAll,
  usernameById,
  reviewMutation,
}: {
  me: AuthUser | null;
  isAdmin: boolean;
  ptoMine: PtoRequest[];
  ptoAll: PtoRequest[];
  usernameById: Map<string, string>;
  reviewMutation: ReturnType<typeof useMutation<any, any, { id: number; status: "approved" | "denied" }>>;
}) {
  const { toast } = useToast();
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [note, setNote] = useState("");
  const [statusTab, setStatusTab] = useState<"pending" | "approved" | "denied">("pending");
  const [scope, setScope] = useState<"all" | "mine">(isAdmin ? "all" : "mine");

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
      toast({ title: "Select a date range first", description: "Click a start and end date on the calendar." });
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

  const sourceList = isAdmin ? (scope === "all" ? ptoAll : ptoMine) : ptoMine;
  const filtered = sourceList.filter((p) => p.status === statusTab);
  const counts = {
    pending: sourceList.filter((p) => p.status === "pending").length,
    approved: sourceList.filter((p) => p.status === "approved").length,
    denied: sourceList.filter((p) => p.status === "denied").length,
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
      <Card className={`${shellClass()} p-5 flex flex-col gap-3`}>
        <SectionTitle Icon={Send} title="Request Time Off" sub="Pick a date range" />
        <div className="flex justify-center">
          <CalendarPicker mode="range" selected={range} onSelect={setRange} data-testid="calendar-pto" numberOfMonths={1} />
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {range?.from && range?.to ? (
            <span data-testid="text-pto-range"><span className="font-semibold">Selected:</span> {formatRange(dateKeyFromDate(range.from), dateKeyFromDate(range.to))}</span>
          ) : (
            <span className="text-slate-400 italic">No range selected.</span>
          )}
        </div>
        <Button data-testid="button-pto-submit-open" onClick={openSubmit} disabled={!range?.from || !range?.to} className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white gap-2">
          <Send className="h-4 w-4" /> Submit Request
        </Button>
      </Card>

      <Card className={`${shellClass()} p-5 flex flex-col gap-3`} data-testid="panel-requests">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle Icon={Plane} title="Requests" />
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && (
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {(["all", "mine"] as const).map((v) => (
                  <button key={v} data-testid={`button-scope-${v}`} onClick={() => setScope(v)} className={`px-3 py-1 text-xs font-medium rounded-lg capitalize ${scope === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{v}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {(["pending", "approved", "denied"] as const).map((s) => (
            <button key={s} data-testid={`pto-tab-${s}`} onClick={() => setStatusTab(s)} className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize ${statusTab === s ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {s} {counts[s] > 0 && <span className="ml-1 text-slate-400">{counts[s]}</span>}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState Icon={Plane} title={`No ${statusTab} requests`} />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((p) => {
              const isMine = p.userId === me?.id;
              const canReview = isAdmin && p.status === "pending";
              return (
                <div key={p.id} data-testid={`row-request-${p.id}`} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={usernameById.get(p.userId) ?? "?"} className="bg-violet-500 h-8 w-8" />
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
                  <Badge className={`text-[10px] px-2 py-0.5 ${
                    p.status === "approved" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : p.status === "denied" ? "bg-red-100 text-red-700 border-red-200"
                    : "bg-amber-100 text-amber-700 border-amber-200"
                  }`}>
                    {p.status}
                  </Badge>
                  {canReview && (
                    <div className="flex gap-1.5">
                      <Button data-testid={`button-approve-${p.id}`} size="sm" className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: p.id, status: "approved" })}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button data-testid={`button-deny-${p.id}`} size="sm" variant="outline" className="rounded-xl h-8 gap-1 text-red-600 border-red-200 hover:bg-red-50" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ id: p.id, status: "denied" })}>
                        <XCircle className="h-3.5 w-3.5" /> Deny
                      </Button>
                    </div>
                  )}
                  {isMine && p.status === "pending" && !canReview && (
                    <Button data-testid={`button-cancel-${p.id}`} variant="ghost" size="sm" className="h-7 px-2 rounded-lg text-slate-500 hover:text-red-600" onClick={() => cancelMutation.mutate(p.id)} disabled={cancelMutation.isPending}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Submit dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Time-Off Request</DialogTitle>
            <DialogDescription>{range?.from && range?.to && formatRange(dateKeyFromDate(range.from), dateKeyFromDate(range.to))}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="pto-note">Note (optional)</Label>
            <Textarea id="pto-note" data-testid="textarea-pto-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vacation, doctor's appointment, family event…" rows={3} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={() => setSubmitOpen(false)}>Cancel</Button>
            <Button data-testid="button-pto-submit-confirm" className="rounded-2xl bg-violet-600 hover:bg-violet-700 text-white" onClick={handleSubmit} disabled={submitMutation.isPending}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Technicians section ──────────────────────────────────────────────────

function TechniciansSection({
  anchor,
  setAnchor,
  dateRange,
  visibleFacilities,
  allAppointments,
  getSchedulerForFacility,
  schedulerOnPto,
  notImplemented,
}: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  dateRange: DateRange | undefined;
  visibleFacilities: string[];
  allAppointments: Record<string, AncillaryAppointment[]>;
  getSchedulerForFacility: (f: string) => OutreachScheduler | null;
  schedulerOnPto: (sc: OutreachScheduler | null, dateKey: string) => boolean;
  notImplemented: (label: string) => void;
}) {
  const rangeStartKey = dateRange?.from ? dateKeyFromDate(dateRange.from) : null;
  const rangeEndKey = dateRange?.to ? dateKeyFromDate(dateRange.to) : (dateRange?.from ? dateKeyFromDate(dateRange.from) : null);
  const weekStart = startOfWeek(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = dateKeyFromDate(new Date());
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const hasAnyAppts = visibleFacilities.some((f) => (allAppointments[f] ?? []).some((a) => a.status === "scheduled"));

  return (
    <Card className={`${shellClass()} p-5 flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle Icon={Stethoscope} title="Technician Schedule" sub="Weekly load by clinic and service type" />
        <div className="ml-auto flex items-center gap-1">
          <Button data-testid="button-tech-prev" variant="outline" size="sm" className="rounded-xl h-8 w-8 p-0" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs font-semibold text-slate-700 px-2" data-testid="text-tech-week">{weekLabel}</span>
          <Button data-testid="button-tech-next" variant="outline" size="sm" className="rounded-xl h-8 w-8 p-0" onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight className="h-4 w-4" /></Button>
          <Button data-testid="button-tech-today" variant="ghost" size="sm" className="rounded-xl text-xs" onClick={() => setAnchor(new Date())}>Today</Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        {(["BrainWave", "VitalWave", "Ultrasound", "Other"] as ServiceBucket[]).map((b) => (
          <div key={b} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-full ${SERVICE_STYLES[b].dot}`} />
            <span>{b}</span>
          </div>
        ))}
      </div>

      {!hasAnyAppts ? (
        <EmptyState Icon={Stethoscope} title="No technician appointments" sub="Scheduled ancillary appointments will appear here as a weekly grid." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Header row */}
            <div className="grid grid-cols-[170px_repeat(7,1fr)] gap-1.5 mb-1.5">
              <div />
              {weekDays.map((d) => {
                const k = dateKeyFromDate(d);
                return (
                  <div key={k} className={`text-center rounded-lg py-1 ${k === todayKey ? "bg-violet-100 text-violet-700" : "text-slate-400"}`}>
                    <p className="text-[10px] uppercase tracking-wide font-semibold">{d.toLocaleDateString(undefined, { weekday: "short" })}</p>
                    <p className="text-xs font-bold">{d.getDate()}</p>
                  </div>
                );
              })}
            </div>
            {/* Facility rows */}
            {visibleFacilities.map((f) => {
              const sc = getSchedulerForFacility(f);
              const onPtoToday = schedulerOnPto(sc, todayKey);
              const covStatus = !sc ? "open" : onPtoToday ? "risk" : "ok";
              const target = sc?.dailyTarget ?? null;
              return (
                <div key={f} className="grid grid-cols-[170px_repeat(7,1fr)] gap-1.5 mb-1.5">
                  <div className="flex flex-col justify-center rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${facilityAccent(f)}`} />
                      <p className="text-xs font-bold text-slate-700 truncate">{f}</p>
                    </div>
                    <p className={`text-[10px] truncate ${sc ? "text-slate-400" : "text-red-500 italic"}`}>{sc ? sc.name : "No scheduler"}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Badge className={`text-[8px] px-1.5 py-0 border ${
                        covStatus === "ok" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                        : covStatus === "risk" ? "bg-amber-100 text-amber-700 border-amber-200"
                        : "bg-red-100 text-red-700 border-red-200"
                      }`}>
                        {covStatus === "ok" ? "Covered" : covStatus === "risk" ? "At risk" : "Open"}
                      </Badge>
                      {target != null && <span className="text-[8px] text-slate-400">cap {target}/day</span>}
                    </div>
                  </div>
                  {weekDays.map((d) => {
                    const k = dateKeyFromDate(d);
                    const inRange = !rangeStartKey || !rangeEndKey || dateInRange(k, rangeStartKey, rangeEndKey);
                    const appts = (allAppointments[f] ?? []).filter((a) => a.scheduledDate === k && a.status === "scheduled");
                    const onPto = schedulerOnPto(sc, k);
                    const buckets = appts.reduce((acc, a) => {
                      const b = serviceBucket(a.testType);
                      acc[b] = (acc[b] ?? 0) + 1;
                      return acc;
                    }, {} as Record<ServiceBucket, number>);
                    const gap = appts.length > 0 && (!sc || onPto);
                    const capPct = target && target > 0 ? Math.min(100, Math.round((appts.length / target) * 100)) : null;
                    return (
                      <div
                        key={k}
                        data-testid={`tech-cell-${f.toLowerCase().replace(/\s+/g, "-")}-${k}`}
                        className={`min-h-[72px] rounded-xl border p-1.5 flex flex-col gap-1 ${!inRange ? "opacity-30" : ""} ${gap ? "border-red-200 bg-red-50/50" : appts.length > 0 ? "border-slate-100 bg-white" : "border-slate-100/70 bg-slate-50/40"}`}
                      >
                        {appts.length === 0 ? (
                          <span className="text-[10px] text-slate-300 m-auto">—</span>
                        ) : (
                          <>
                            {(Object.keys(buckets) as ServiceBucket[]).map((b) => (
                              <div key={b} className={`flex items-center gap-1 rounded-md border px-1 py-0.5 ${SERVICE_STYLES[b].chip}`}>
                                <div className={`h-1.5 w-1.5 rounded-full ${SERVICE_STYLES[b].dot}`} />
                                <span className="text-[9px] font-semibold">{buckets[b]} {b.slice(0, 5)}</span>
                              </div>
                            ))}
                            {/* Capacity indicator vs scheduler daily target */}
                            {capPct != null && (
                              <div className="flex items-center gap-1" title={`${appts.length} of ${target} capacity`}>
                                <div className="h-1 flex-1 rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full ${capPct >= 100 ? "bg-red-500" : capPct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${capPct}%` }} />
                                </div>
                                <span className="text-[8px] font-semibold text-slate-500">{appts.length}/{target}</span>
                              </div>
                            )}
                            {gap && (
                              <button
                                data-testid={`tech-gap-${f.toLowerCase().replace(/\s+/g, "-")}-${k}`}
                                onClick={() => notImplemented("Resolve technician gap")}
                                className="flex items-center gap-1 text-[9px] font-semibold text-red-600"
                              >
                                <AlertCircle className="h-2.5 w-2.5" /> gap
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Conflicts section ────────────────────────────────────────────────────

function ConflictsSection({
  conflicts,
  onAssign,
  notImplemented,
}: {
  conflicts: Conflict[];
  onAssign: (f?: string) => void;
  notImplemented: (label: string) => void;
}) {
  if (conflicts.length === 0) {
    return (
      <Card className={`${shellClass()} p-5`}>
        <EmptyState Icon={CheckCircle2} title="No conflicts detected" sub="Every clinic has coverage, no PTO collides with appointments, and no scheduler is double-booked." />
      </Card>
    );
  }
  const sevStyle = {
    high: { chip: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500", Icon: ShieldAlert },
    medium: { chip: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500", Icon: AlertTriangle },
    low: { chip: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400", Icon: AlertCircle },
  } as const;

  return (
    <Card className={`${shellClass()} p-5 flex flex-col gap-3`}>
      <SectionTitle Icon={AlertTriangle} title="Operational Conflicts" sub={`${conflicts.length} issue${conflicts.length !== 1 ? "s" : ""} need attention`} />
      <div className="flex flex-col gap-2.5">
        {conflicts.map((c) => {
          const s = sevStyle[c.severity];
          return (
            <div
              key={c.id}
              data-testid={`conflict-${c.id}`}
              className="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4"
            >
              <div className={`rounded-xl p-2 ${s.chip} border`}>
                <s.Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-slate-800">{c.type}</p>
                  <Badge className={`text-[10px] px-2 py-0 border capitalize ${s.chip}`}>{c.severity}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-600">{c.facility}</span>
                  {" · "}{c.owner}
                  {" · "}{parseDateKey(c.dateKey).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
                <p className="text-xs text-slate-600 mt-1.5">{c.suggestion}</p>
              </div>
              <div className="flex gap-1.5">
                {c.resolvable && c.facility && VALID_FACILITIES.includes(c.facility as any) && (
                  <Button data-testid={`conflict-assign-${c.id}`} size="sm" className="h-8 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1" onClick={() => onAssign(c.facility)}>
                    <UserCheck className="h-3.5 w-3.5" /> Assign
                  </Button>
                )}
                <Button data-testid={`conflict-resolve-${c.id}`} size="sm" variant="outline" className="h-8 rounded-xl text-xs gap-1" onClick={() => notImplemented("Mark resolved")}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

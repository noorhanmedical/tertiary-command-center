import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Brain,
  Activity,
  Calendar,
  CalendarPlus,
  Clock,
  MapPin,
  X,
  Phone,
  Building2,
  Stethoscope,
  CalendarCheck,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Users,
  ListTodo,
  FileText,
  Sparkles,
  PhoneCall,
  History as HistoryIcon,
  ArrowRight,
  Keyboard,
  Megaphone,
  TrendingUp,
  ShieldCheck,
  Send,
  Loader2,
  Wand2,
  Trash2,
  Mail,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AncillaryAppointment, OutreachCall } from "@shared/schema";
import {
  MiniCalendar,
  SlotGrid,
  toDateKey,
  formatTime12,
  isBrainWave,
  isVitalWave,
  BRAINWAVE_SLOTS as BW_SLOTS,
  VITALWAVE_SLOTS as VW_SLOTS,
} from "@/components/clinic-calendar";
import type { BookingSlot } from "@/components/clinic-calendar";
import { VALID_FACILITIES } from "@shared/plexus";
import { SchedulerIcon } from "@/components/plexus/SchedulerIcon";
import { TaskDrawer } from "@/components/plexus/TaskDrawer";
import type { PlexusTaskSummary, UserEntry } from "@/components/plexus/SchedulerIcon";
import type { AuthUser } from "@/App";
import { DispositionSheet } from "@/components/outreach/DispositionSheet";
import { getScriptForTest, fillScript } from "@/lib/outreachScripts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Facility = (typeof VALID_FACILITIES)[number];

type PriorTestEntry = {
  testName: string;
  dateOfService: string;
  clinic: string | null;
  notes: string | null;
};

type ReasoningEntry = {
  testName: string;
  text: string;
  pearls?: string[];
  qualifyingFactors?: string[];
};

type OutreachCallItem = {
  id: string;
  patientId: number;
  patientName: string;
  facility: string;
  phoneNumber: string;
  insurance: string;
  qualifyingTests: string[];
  appointmentStatus: string;
  patientType: string;
  batchId: number;
  scheduleDate: string;
  time: string;
  providerName: string;
  notes: string | null;
  dob: string | null;
  age: number | null;
  gender: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  previousTests: string | null;
  previousTestsDate: string | null;
  noPreviousTests: boolean;
  reasoning: ReasoningEntry[];
  priorTestHistory: PriorTestEntry[];
};

type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
  capacityPercent: number;
  totalPatients: number;
  touchedCount: number;
  scheduledCount: number;
  pendingCount: number;
  conversionRate: number;
  callList: OutreachCallItem[];
};

type OutreachDashboard = {
  today: string;
  metrics: {
    schedulerCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
  };
  schedulerCards: OutreachSchedulerCard[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function statusBadgeClass(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n.includes("scheduled") || n.includes("booked")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (n.includes("complete")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (n.includes("decline") || n.includes("cancel")) return "bg-red-100 text-red-700 border-red-200";
  if (n === "no_answer") return "bg-slate-100 text-slate-600 border-slate-200";
  if (n === "callback") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusLabel(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n === "no_answer") return "No answer";
  if (n === "callback") return "Callback";
  if (n === "pending") return "Not called";
  if (n === "scheduled") return "Scheduled";
  if (n === "declined") return "Declined";
  return status || "Pending";
}

function urgencyBadgeClass(urgency: string) {
  if (urgency === "EOD") return "bg-amber-100 text-amber-700 border-amber-200";
  if (urgency === "within 3 hours") return "bg-orange-100 text-orange-700 border-orange-200";
  if (urgency === "within 1 hour") return "bg-red-100 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function urgencyShortLabel(urgency: string) {
  if (urgency === "EOD") return "EOD";
  if (urgency === "within 3 hours") return "3 hr";
  if (urgency === "within 1 hour") return "1 hr";
  return urgency;
}

function calcTimeRemaining(urgency: string, createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  let deadline: number;
  if (urgency === "within 1 hour") deadline = created + 60 * 60 * 1000;
  else if (urgency === "within 3 hours") deadline = created + 3 * 60 * 60 * 1000;
  else {
    const eod = new Date();
    eod.setHours(17, 0, 0, 0);
    deadline = eod.getTime();
  }
  const diff = deadline - now;
  if (diff <= 0) return "Overdue";
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

function digitsOnly(phone: string): string {
  return (phone || "").replace(/[^0-9+]/g, "");
}

function formatAppointmentBadge(scheduledDate: string, scheduledTime: string, testType: string): string {
  const [y, m, d] = scheduledDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = formatTime12(scheduledTime);
  const typeLabel = isBrainWave(testType) ? "BrainWave" : "VitalWave";
  return `${dateLabel} · ${timeLabel} · ${typeLabel}`;
}

function formatRelative(iso: string | Date): string {
  const t = (iso instanceof Date ? iso : new Date(iso)).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

// Outcome -> bucket used by the priority sort.
type CallBucket = "callback_due" | "never_called" | "no_answer" | "contacted" | "scheduled" | "declined";

// "Callback due" includes anything currently overdue OR coming due within
// the next 30 minutes — matches the spec for the header callback badge.
const CALLBACK_DUE_WINDOW_MS = 30 * 60 * 1000;

function callbackIsDueSoon(latestCall: OutreachCall | undefined): boolean {
  if (!latestCall || latestCall.outcome !== "callback" || !latestCall.callbackAt) return false;
  const due = new Date(latestCall.callbackAt as unknown as string).getTime();
  return due - Date.now() <= CALLBACK_DUE_WINDOW_MS;
}

const NO_ANSWER_OUTCOMES = new Set([
  "no_answer", "voicemail", "mailbox_full", "busy", "hung_up", "disconnected",
]);

function bucketForItem(item: OutreachCallItem, latestCall: OutreachCall | undefined): CallBucket {
  const status = item.appointmentStatus.toLowerCase();
  if (status === "scheduled") return "scheduled";
  if (status === "declined") return "declined";
  if (callbackIsDueSoon(latestCall)) return "callback_due";
  if (!latestCall) return "never_called";
  if (status === "no_answer" || NO_ANSWER_OUTCOMES.has(latestCall.outcome)) return "no_answer";
  return "contacted";
}

const BUCKET_RANK: Record<CallBucket, number> = {
  callback_due: 0,
  never_called: 1,
  no_answer: 2,
  contacted: 3,
  scheduled: 4,
  declined: 5,
};

const FILTER_CHIPS: { id: "all" | CallBucket; label: string }[] = [
  { id: "all",           label: "All" },
  { id: "callback_due",  label: "Callbacks due" },
  { id: "never_called",  label: "Never called" },
  { id: "no_answer",     label: "No answer" },
  { id: "contacted",     label: "Contacted" },
  { id: "scheduled",     label: "Scheduled" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OutreachSchedulerPortalPage() {
  const params = useParams<{ id: string }>();
  const schedulerId = params.id ?? "";

  // Calendar (booking) state
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [bookSlot, setBookSlot] = useState<BookingSlot | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookLinkedPatient, setBookLinkedPatient] = useState<OutreachCallItem | null>(null);
  const [bookPatientSearch, setBookPatientSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AncillaryAppointment | null>(null);
  const [callListBookPatient, setCallListBookPatient] = useState<OutreachCallItem | null>(null);
  const [callListBookTestType, setCallListBookTestType] = useState<"BrainWave" | "VitalWave">("BrainWave");
  const [callListBookTime, setCallListBookTime] = useState<string>("");
  const [scrollToSlot, setScrollToSlot] = useState<{ time: string; testType: string } | null>(null);
  const [bookingPanelOpen, setBookingPanelOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"calendar" | "email" | "materials" | null>(null);

  // Call flow state
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | CallBucket>("all");
  const [clinicFilter, setClinicFilter] = useState<string | null>(null);
  const [testFilter, setTestFilter] = useState<string | null>(null);
  const [expandedTimeline, setExpandedTimeline] = useState<Set<number>>(new Set());
  const [scriptOpen, setScriptOpen] = useState(false);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Tasks tile + urgent panel
  const [taskDrawerPatientId, setTaskDrawerPatientId] = useState<number | null>(null);
  const [taskDrawerTasks, setTaskDrawerTasks] = useState<PlexusTaskSummary[]>([]);
  const [taskDrawerPatientName, setTaskDrawerPatientName] = useState<string>("");

  const { toast } = useToast();
  const queryClientLocal = useQueryClient();

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: dashboard, isLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const card = useMemo(
    () => dashboard?.schedulerCards.find((c) => c.id === schedulerId) ?? null,
    [dashboard, schedulerId],
  );

  const facility = card?.facility as Facility | undefined;

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!facility,
    refetchInterval: 30_000,
  });

  const { data: currentUser } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: users = [] } = useQuery<UserEntry[]>({
    queryKey: ["/api/plexus/users"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: myWorkTasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks/my-work"],
    refetchInterval: 60_000,
  });
  const { data: urgentTasks = [] } = useQuery<PlexusTaskSummary[]>({
    queryKey: ["/api/plexus/tasks/urgent"],
    refetchInterval: 30_000,
  });
  const { data: unreadPerTask = [] } = useQuery<{ taskId: number; unreadCount: number }[]>({
    queryKey: ["/api/plexus/tasks/unread-per-task"],
    refetchInterval: 60_000,
  });

  const unreadTaskIds = useMemo(() => {
    const s = new Set<number>();
    for (const u of unreadPerTask) if (u.unreadCount > 0) s.add(u.taskId);
    return s;
  }, [unreadPerTask]);

  const openTasks = useMemo(
    () => myWorkTasks.filter((t) => t.status === "open" || t.status === "in_progress"),
    [myWorkTasks],
  );

  // Today's calls for THIS scheduler — drives the header metrics strip.
  const { data: todayCalls = [] } = useQuery<OutreachCall[]>({
    queryKey: ["/api/outreach/calls/today", currentUser?.id],
    queryFn: async () => {
      const res = await fetch(`/api/outreach/calls/today?schedulerUserId=${encodeURIComponent(currentUser!.id)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!currentUser?.id,
    refetchInterval: 30_000,
  });

  // Per-patient latest call — used for priority sort + bucket badges.
  const patientIds = useMemo(() => (card?.callList ?? []).map((p) => p.patientId), [card]);

  // Active scheduler-engine assignments for today — used to overlay the
  // "↩ from <name>" lineage pill on rows that were reassigned away from
  // a teammate (PTO, absence, manual move).
  const { data: assignmentRows = [] } = useQuery<Array<{
    id: number;
    patientScreeningId: number;
    schedulerId: number;
    source: string;
    originalSchedulerId: number | null;
    reason: string | null;
  }>>({
    queryKey: ["/api/scheduler-assignments"],
    refetchInterval: 60_000,
  });
  const assignmentByPatient = useMemo(() => {
    const m = new Map<number, typeof assignmentRows[number]>();
    for (const a of assignmentRows) m.set(a.patientScreeningId, a);
    return m;
  }, [assignmentRows]);

  // Tiny lookup for scheduler names so the lineage pill can render
  // "↩ from <name>" instead of an opaque numeric id.
  const { data: allSchedulerCards = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/outreach/schedulers"],
    staleTime: 5 * 60 * 1000,
  });
  const schedulerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const sc of allSchedulerCards) m.set(sc.id, sc.name);
    return m;
  }, [allSchedulerCards]);

  const { data: callsByPatient = {} } = useQuery<Record<number, OutreachCall[]>>({
    queryKey: ["/api/outreach/calls/by-patients", patientIds.join(",")],
    queryFn: async () => {
      // Single bulk fetch — server returns { [id]: OutreachCall[] }.
      const res = await fetch(`/api/outreach/calls/by-patients?ids=${patientIds.join(",")}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load calls");
      return res.json();
    },
    enabled: patientIds.length > 0,
    refetchInterval: 60_000,
  });

  const latestCallByPatient = useMemo(() => {
    const m = new Map<number, OutreachCall>();
    for (const [pid, calls] of Object.entries(callsByPatient)) {
      if (calls.length > 0) m.set(Number(pid), calls[0]);
    }
    return m;
  }, [callsByPatient]);

  // ── Selected patient (Current Call) — URL hash drives selection ────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    function readHash() {
      const h = window.location.hash.replace(/^#/, "");
      const m = h.match(/^p(\d+)$/);
      setSelectedId(m ? Number(m[1]) : null);
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  function selectPatient(patientId: number | null) {
    if (patientId == null) {
      window.location.hash = "";
    } else {
      window.location.hash = `p${patientId}`;
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const bookMutation = useMutation({
    mutationFn: async ({ patientName, testType, scheduledTime, patientId }: { patientName: string; testType: string; scheduledTime: string; patientId?: number }) => {
      const scheduledDate = toDateKey(calYear, calMonth, selectedDay!);
      const res = await apiRequest("POST", "/api/appointments", { patientName, facility, scheduledDate, scheduledTime, testType });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to book"); }
      const appt = await res.json();
      // Persist a "scheduled" call event so call history reflects the booking.
      // Booking already succeeded — surface (don't swallow) any logging error
      // as a non-blocking warning toast so the operator can retry if needed.
      if (patientId != null) {
        try {
          const callRes = await apiRequest("POST", "/api/outreach/calls", {
            patientScreeningId: patientId,
            outcome: "scheduled",
            notes: `Booked ${testType} on ${scheduledDate} at ${scheduledTime}`,
            schedulerUserId: currentUser?.id,
          });
          if (!callRes.ok) {
            const e = await callRes.json().catch(() => ({}));
            toast({
              title: "Booking saved, but call history not updated",
              description: e.error || "You may need to log this call manually.",
              variant: "destructive",
            });
          }
        } catch (err: any) {
          toast({
            title: "Booking saved, but call history not updated",
            description: err?.message || "You may need to log this call manually.",
            variant: "destructive",
          });
        }
      }
      return appt;
    },
    onSuccess: () => {
      queryClientLocal.invalidateQueries({ queryKey: ["/api/appointments"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/by-patients"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/calls/today"] });
      toast({ title: "Appointment booked" });
      setBookSlot(null);
      setBookName("");
      setBookLinkedPatient(null);
      setBookPatientSearch("");
      setCallListBookPatient(null);
      setCallListBookTime("");
    },
    onError: (e: Error) => toast({ title: "Booking failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}`, { status: "cancelled" });
      return res.json();
    },
    onSuccess: () => {
      queryClientLocal.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Appointment cancelled" });
      setCancelTarget(null);
    },
    onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const helpMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await apiRequest("POST", `/api/plexus/tasks/${taskId}/collaborators`, { role: "collaborator" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "You've been added as a collaborator" });
      queryClientLocal.invalidateQueries({ queryKey: ["/api/plexus/tasks/urgent"] });
    },
    onError: (e: Error) => toast({ title: "Could not join task", description: e.message, variant: "destructive" }),
  });

  function openTaskDrawer(task: PlexusTaskSummary) {
    setTaskDrawerPatientId(task.patientScreeningId ?? 0);
    setTaskDrawerTasks([task]);
    setTaskDrawerPatientName(task.patientName ?? "");
  }

  // ── Derived data ────────────────────────────────────────────────────────────
  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate),
  );
  const selectedDateStr = selectedDay ? toDateKey(calYear, calMonth, selectedDay) : null;
  const todayDateStr = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const todayAppointments = (appointments || [])
    .filter((a) => a.scheduledDate === todayDateStr && a.status === "scheduled")
    .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  // Distinct clinic + qualifying-test options for the filter chips.
  const clinicOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of card?.callList ?? []) if (p.facility) set.add(p.facility);
    return Array.from(set).sort();
  }, [card]);
  const testOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of card?.callList ?? []) for (const t of p.qualifyingTests) set.add(t);
    return Array.from(set).sort();
  }, [card]);

  // ENGINE-DRIVEN OWNERSHIP — assignments are the SOLE source of truth for
  // who owns which patient on the call list. The /api/scheduler-assignments
  // endpoint is server-side scoped to the session scheduler, so assignmentRows
  // already contains only this scheduler's active rows for today. We always
  // restrict the visible call list to that set — even when it's empty — so a
  // scheduler with zero assignments never sees the full facility queue.
  const myEngineAssignedIds = useMemo(() => {
    return new Set(assignmentRows.map((a) => a.patientScreeningId));
  }, [assignmentRows]);

  // Search + clinic + test + bucket filter + priority sort.
  const sortedCallList = useMemo(() => {
    const list = card?.callList ?? [];
    const q = search.trim().toLowerCase();
    const filtered = list
      .filter((item) => {
        // Engine ownership filter — assignments are authoritative. Patients
        // not on this scheduler's active assignment list are hidden.
        if (!myEngineAssignedIds.has(item.patientId)) return false;
        if (clinicFilter && item.facility !== clinicFilter) return false;
        if (testFilter && !item.qualifyingTests.includes(testFilter)) return false;
        if (!q) return true;
        return (
          item.patientName.toLowerCase().includes(q) ||
          item.facility.toLowerCase().includes(q) ||
          item.providerName.toLowerCase().includes(q) ||
          item.qualifyingTests.join(" ").toLowerCase().includes(q) ||
          (item.diagnoses ?? "").toLowerCase().includes(q) ||
          (item.insurance ?? "").toLowerCase().includes(q)
        );
      })
      .map((item) => {
        const latest = latestCallByPatient.get(item.patientId);
        return { item, latest, bucket: bucketForItem(item, latest) };
      })
      .filter(({ bucket }) => filter === "all" || bucket === filter)
      .sort((a, b) => {
        const r = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
        if (r !== 0) return r;
        // Callback_due: nearest callback first
        if (a.bucket === "callback_due" && b.bucket === "callback_due" && a.latest?.callbackAt && b.latest?.callbackAt) {
          return new Date(a.latest.callbackAt as unknown as string).getTime() - new Date(b.latest.callbackAt as unknown as string).getTime();
        }
        return a.item.patientName.localeCompare(b.item.patientName);
      });
    return filtered;
  }, [card, search, filter, clinicFilter, testFilter, latestCallByPatient, myEngineAssignedIds]);

  // Header badge: "callbacks due in next 30 min" (or already overdue) — global
  // across all patients on the call list, not just the current filtered view.
  const callbacksDue = useMemo(() => {
    let count = 0;
    for (const p of card?.callList ?? []) {
      if (callbackIsDueSoon(latestCallByPatient.get(p.patientId))) count++;
    }
    return count;
  }, [card, latestCallByPatient]);

  // Auto-select the top-priority patient on first load when no #p<id> hash
  // has placed the cursor anywhere — the top slot is always Current Call.
  useEffect(() => {
    if (selectedId == null && sortedCallList.length > 0 && !isLoading) {
      const top = sortedCallList[0]?.item.patientId;
      if (top != null) selectPatient(top);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCallList, isLoading]);

  const selectedItem = useMemo(
    () => (card?.callList ?? []).find((p) => p.patientId === selectedId) ?? null,
    [card, selectedId],
  );

  const selectedCalls = selectedId != null ? callsByPatient[selectedId] ?? [] : [];
  const selectedAssignment = selectedId != null ? assignmentByPatient.get(selectedId) ?? null : null;
  const selectedLineageFromName =
    selectedAssignment?.source === "reassigned" && selectedAssignment.originalSchedulerId
      ? schedulerNameById.get(selectedAssignment.originalSchedulerId) ?? `#${selectedAssignment.originalSchedulerId}`
      : null;

  // Header metrics for THIS scheduler today.
  const callsMade = todayCalls.length;
  const reachedCount = todayCalls.filter((c) =>
    ["reached", "scheduled", "callback", "declined", "not_interested", "language_barrier"].includes(c.outcome),
  ).length;
  const scheduledFromCalls = todayCalls.filter((c) => c.outcome === "scheduled").length;
  const conversionPct = callsMade === 0 ? 0 : Math.round((scheduledFromCalls / callsMade) * 100);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (isTyping) return;
      if (e.key === "?") {
        setShortcutsOpen(true);
        return;
      }
      if (!selectedItem) return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDispositionOpen(true);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setBookingPanelOpen(true);
        setCallListBookPatient(selectedItem);
        setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
        setCallListBookTime("");
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
        const next = sortedCallList[idx + 1] ?? sortedCallList[0];
        if (next) selectPatient(next.item.patientId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedItem, sortedCallList]);

  // Booking dialogs derived state
  const bookPatientResults = useMemo(() => {
    const q = bookPatientSearch.trim().toLowerCase();
    const list = card?.callList ?? [];
    if (!q) return list.slice(0, 8);
    return list.filter((p) => p.patientName.toLowerCase().includes(q)).slice(0, 8);
  }, [bookPatientSearch, card]);
  const effectiveBookName = bookLinkedPatient?.patientName ?? bookName;
  const scheduledCallListNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of card?.callList ?? []) {
      if (item.appointmentStatus?.toLowerCase() === "scheduled") names.add(item.patientName.trim().toLowerCase());
    }
    return names;
  }, [card?.callList]);

  // Loading / not-found
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
        Loading scheduler portal…
      </div>
    );
  }
  if (!card) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-slate-500 text-sm">
        <p>Scheduler not found.</p>
        <Button asChild variant="outline" className="rounded-2xl">
          <Link href="/outreach"><ArrowLeft className="mr-2 h-4 w-4" />Back to Outreach</Link>
        </Button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full flex-1 overflow-auto xl:h-full xl:min-h-0 xl:overflow-hidden flex flex-col bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6 xl:flex-1 xl:min-h-0">

        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <Phone className="h-4 w-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <h1
                className="truncate text-base font-semibold text-slate-900"
                data-testid="text-calendar-header-title"
              >
                {card.name}
              </h1>
              <p className="truncate text-xs text-slate-500">
                {card.facility} · {card.totalPatients} patient{card.totalPatients !== 1 ? "s" : ""} today
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              System active
            </span>
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              data-testid="portal-shortcuts-btn"
            >
              <Keyboard className="h-3.5 w-3.5" /> Shortcuts
            </button>
            <Link
              href="/outreach"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              data-testid="link-back-outreach"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Outreach
            </Link>
          </div>
        </header>

        {/* ── Cockpit grid: 25% / 50% / 25% — exactly three flat panels ── */}
        <div className="grid gap-5 xl:grid-cols-[1fr_2fr_1fr] xl:flex-1 xl:min-h-0">

          {/* ─── LEFT PANEL: Tri-clinic calendar + Communication hub ─── */}
          <div className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl divide-y divide-slate-100/80 overflow-hidden xl:flex xl:flex-col xl:min-h-0 xl:overflow-y-auto">
            <ToolsPanel
              facility={card.facility}
              todayAppointments={todayAppointments}
              onCancelAppointment={(a) => setCancelTarget(a)}
              selectedItem={selectedItem}
              bookingPanelOpen={bookingPanelOpen}
              setBookingPanelOpen={setBookingPanelOpen}
              calYear={calYear}
              calMonth={calMonth}
              setCalMonth={setCalMonth}
              setCalYear={setCalYear}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              bookedDates={bookedDates}
              appointments={appointments}
              selectedDateStr={selectedDateStr}
              setBookSlot={setBookSlot}
              setBookName={setBookName}
              setBookLinkedPatient={setBookLinkedPatient}
              setBookPatientSearch={setBookPatientSearch}
              setCancelTarget={setCancelTarget}
              scrollToSlot={scrollToSlot}
              expandedSection={expandedSection}
              setExpandedSection={setExpandedSection}
            />
          </div>

          {/* ─── CENTER PANEL: Active patient + AI co-pilot + Mission control (sticky metrics float above) ─── */}
          <div className="min-w-0 flex flex-col gap-4 xl:min-h-0">
            {/* Sticky top-center metrics pill — floats above the panel */}
            <div className="sticky top-2 z-20 flex justify-center">
              <FloatingMetricsTile
                callsMade={callsMade}
                reachedCount={reachedCount}
                scheduledFromCalls={scheduledFromCalls}
                conversionPct={conversionPct}
                callbacksDue={callbacksDue}
              />
            </div>

            {expandedSection ? (
              <ExpandedSectionView
                section={expandedSection}
                onClose={() => setExpandedSection(null)}
                facility={card.facility}
                appointments={appointments}
                selectedItem={selectedItem}
                calYear={calYear}
                calMonth={calMonth}
                setCalMonth={setCalMonth}
                setCalYear={setCalYear}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                onConfirmSlot={(slot) => {
                  setBookSlot(slot);
                  if (selectedItem) {
                    setBookLinkedPatient(selectedItem);
                    setBookName("");
                    setBookPatientSearch("");
                  }
                }}
              />
            ) : (
            <div className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden divide-y divide-slate-100/80 xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
            <CurrentCallCard
              item={selectedItem}
              latestCall={selectedItem ? latestCallByPatient.get(selectedItem.patientId) : undefined}
              schedulerName={card.name}
              facilityName={card.facility}
              lineageFromName={selectedLineageFromName}
              lineageReason={selectedAssignment?.reason ?? null}
              scriptOpen={scriptOpen}
              setScriptOpen={setScriptOpen}
              onDisposition={() => setDispositionOpen(true)}
              onBook={() => {
                if (!selectedItem) return;
                setBookingPanelOpen(true);
                setCallListBookPatient(selectedItem);
                setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
                setCallListBookTime("");
              }}
              onSkip={() => {
                if (!selectedItem) return;
                const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
                const next = sortedCallList[idx + 1] ?? sortedCallList[0];
                if (next) selectPatient(next.item.patientId);
              }}
            />

            {/* ── AI bar (anchored above mission control, with conversation history) ── */}
            <AiBar
              selectedItem={selectedItem}
              callListContext={sortedCallList.slice(0, 25).map(({ item, bucket }) => ({
                name: item.patientName,
                bucket,
                qualifyingTests: item.qualifyingTests,
              }))}
            />

            {/* ── Mission Control bar (next/skip/disposition/book) ── */}
            <MissionControlBar
              selectedItem={selectedItem}
              onDisposition={() => setDispositionOpen(true)}
              onBook={() => {
                if (!selectedItem) return;
                setBookingPanelOpen(true);
                setCallListBookPatient(selectedItem);
                setCallListBookTestType(selectedItem.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave");
                setCallListBookTime("");
              }}
              onSkip={() => {
                if (!selectedItem) return;
                const idx = sortedCallList.findIndex((r) => r.item.patientId === selectedItem.patientId);
                const next = sortedCallList[idx + 1] ?? sortedCallList[0];
                if (next) selectPatient(next.item.patientId);
              }}
            />
            </div>
            )}
          </div>

          {/* ─── RIGHT PANEL: Call list + Tasks (Urgent folded in) ────── */}
          <div className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden divide-y divide-slate-100/80 flex flex-col min-w-0 max-h-[calc(100vh-220px)] xl:max-h-none xl:min-h-0">
            <div className="px-5 pt-5 pb-4 flex flex-col flex-1 min-h-0">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Call list</h2>
              <Badge variant="outline" className="rounded-full text-[11px] text-slate-500">
                {sortedCallList.length} {sortedCallList.length === 1 ? "patient" : "patients"}
              </Badge>
              <div className="ml-auto relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…  (press / )"
                  className="rounded-2xl border-white/60 bg-white/90 pl-9"
                  data-testid="portal-search-input"
                />
              </div>
            </div>

            {/* Bucket filter chips */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {FILTER_CHIPS.map((c) => {
                const active = filter === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setFilter(c.id)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-indigo-300 bg-indigo-100 text-indigo-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                    ].join(" ")}
                    data-testid={`portal-filter-${c.id}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* Clinic + test filter chips */}
            {(clinicOptions.length > 1 || testOptions.length > 1) && (
              <div className="mb-3 space-y-1.5">
                {clinicOptions.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5" data-testid="portal-clinic-filter">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Clinic</span>
                    <button
                      type="button"
                      onClick={() => setClinicFilter(null)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                        clinicFilter === null
                          ? "border-blue-300 bg-blue-100 text-blue-700"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      All
                    </button>
                    {clinicOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setClinicFilter(c === clinicFilter ? null : c)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                          clinicFilter === c
                            ? "border-blue-300 bg-blue-100 text-blue-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                        data-testid={`portal-clinic-chip-${c.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {testOptions.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5" data-testid="portal-test-filter">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Test</span>
                    <button
                      type="button"
                      onClick={() => setTestFilter(null)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                        testFilter === null
                          ? "border-violet-300 bg-violet-100 text-violet-700"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      All
                    </button>
                    {testOptions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTestFilter(t === testFilter ? null : t)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                          testFilter === t
                            ? "border-violet-300 bg-violet-100 text-violet-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                        data-testid={`portal-test-chip-${t.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {sortedCallList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
                {search.trim() ? "No patients match this search." : "No patients in this view."}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 space-y-2">
                {sortedCallList.map(({ item, latest, bucket }) => {
                  const isSelected = selectedId === item.patientId;
                  const tlOpen = expandedTimeline.has(item.patientId);
                  const calls = callsByPatient[item.patientId] ?? [];
                  const attemptCount = latest?.attemptNumber ?? calls.length;
                  return (
                    <div
                      key={item.id}
                      className={[
                        "rounded-2xl border p-3 transition",
                        isSelected
                          ? "border-indigo-300 bg-indigo-50/40 shadow-[0_4px_22px_rgba(79,70,229,0.16)]"
                          : "border-slate-200/80 bg-white hover:border-indigo-200 hover:bg-indigo-50/20",
                      ].join(" ")}
                      data-testid={`portal-call-row-${item.patientId}`}
                    >
                      <div className="flex w-full items-start gap-3 text-left">
                        <BucketIndicator bucket={bucket} />
                        <button
                          type="button"
                          onClick={() => selectPatient(item.patientId)}
                          className="flex-1 min-w-0 text-left"
                          data-testid={`portal-row-select-${item.patientId}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <SchedulerIcon patientScreeningId={item.patientId} patientName={item.patientName} size="xs" />
                            <span className="text-sm font-semibold text-slate-900 truncate">{item.patientName}</span>
                            <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(item.appointmentStatus)}`}>
                              {statusLabel(item.appointmentStatus)}
                            </Badge>
                            {latest && (
                              <Badge
                                className={`rounded-full border text-[10px] ${statusBadgeClass(latest.outcome)}`}
                                data-testid={`portal-row-last-outcome-${item.patientId}`}
                              >
                                Last: {latest.outcome.replace(/_/g, " ")}
                              </Badge>
                            )}
                            {attemptCount > 0 && (
                              <Badge
                                className="rounded-full border border-slate-200 bg-slate-50 text-slate-600 text-[10px]"
                                data-testid={`portal-row-attempts-${item.patientId}`}
                              >
                                Attempt #{attemptCount}
                              </Badge>
                            )}
                            {bucket === "callback_due" && latest?.callbackAt && (
                              <Badge className="rounded-full border bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                                Due {formatRelative(latest.callbackAt as unknown as string)}
                              </Badge>
                            )}
                            {(() => {
                              const a = assignmentByPatient.get(item.patientId);
                              if (!a || a.source !== "reassigned" || !a.originalSchedulerId) return null;
                              const fromName = schedulerNameById.get(a.originalSchedulerId) ?? `#${a.originalSchedulerId}`;
                              return (
                                <Badge
                                  className="rounded-full border bg-violet-50 text-violet-700 border-violet-200 text-[10px]"
                                  title={a.reason ?? "Reassigned"}
                                  data-testid={`portal-row-reassigned-${item.patientId}`}
                                >
                                  ↩ from {fromName}
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{item.facility}</span>
                            <span>·</span>
                            <a
                              href={`tel:${digitsOnly(item.phoneNumber)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                              data-testid={`portal-tel-${item.patientId}`}
                            >
                              <Phone className="h-3 w-3" />{item.phoneNumber}
                            </a>
                            {item.insurance && (
                              <>
                                <span>·</span>
                                <span
                                  className="inline-flex items-center gap-0.5 text-slate-500"
                                  data-testid={`portal-row-insurance-${item.patientId}`}
                                >
                                  <ShieldCheck className="h-3 w-3" />{item.insurance}
                                </span>
                              </>
                            )}
                            {calls.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-0.5">
                                  <HistoryIcon className="h-3 w-3" />{calls.length} call{calls.length !== 1 ? "s" : ""}
                                </span>
                              </>
                            )}
                          </div>
                          {item.qualifyingTests.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {item.qualifyingTests.slice(0, 4).map((t) => (
                                <Badge key={`${item.id}-${t}`} className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50 text-[10px]">{t}</Badge>
                              ))}
                              {item.qualifyingTests.length > 4 && (
                                <span className="text-[10px] text-slate-400">+{item.qualifyingTests.length - 4} more</span>
                              )}
                            </div>
                          )}
                        </button>

                        {/* Per-row Add to Schedule — opens the prefilled booking dialog
                            so the operator never leaves the call list. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPatient(item.patientId);
                            setCallListBookPatient(item);
                          }}
                          title="Add to schedule"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-600 transition hover:border-violet-300 hover:bg-violet-50"
                          data-testid={`portal-row-add-to-schedule-${item.patientId}`}
                        >
                          <CalendarPlus className="h-4 w-4" />
                        </button>
                      </div>
                      {/* Timeline toggle */}
                      {calls.length > 0 && (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedTimeline((prev) => {
                                const n = new Set(prev);
                                n.has(item.patientId) ? n.delete(item.patientId) : n.add(item.patientId);
                                return n;
                              });
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
                            data-testid={`portal-timeline-toggle-${item.patientId}`}
                          >
                            <HistoryIcon className="h-3 w-3" />
                            {tlOpen ? "Hide timeline" : `Show timeline (${calls.length})`}
                            {tlOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          {tlOpen && (
                            <div className="mt-2 space-y-1.5" data-testid={`portal-timeline-${item.patientId}`}>
                              {calls.map((c) => (
                                <div key={c.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
                                  <div className="flex items-center gap-2">
                                    <Badge className={`rounded-full border text-[9px] ${statusBadgeClass(c.outcome)}`}>{c.outcome.replace("_", " ")}</Badge>
                                    <span className="text-slate-500">{formatRelative(c.startedAt as unknown as string)}</span>
                                    <span className="ml-auto text-slate-400">attempt #{c.attemptNumber}</span>
                                  </div>
                                  {c.notes && <p className="mt-1 text-slate-600">{c.notes}</p>}
                                  {c.callbackAt && (
                                    <p className="mt-0.5 text-amber-700">
                                      Callback: {new Date(c.callbackAt as unknown as string).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tasks section — Urgent items folded inline at top, then My open tasks */}
          <div className="px-5 py-4 shrink-0" data-testid="portal-tasks-tile">
            {urgentTasks.length > 0 && (
              <div className="mb-4" data-testid="portal-urgent-panel">
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Urgent requests</h2>
                  <Badge className="ml-auto rounded-full bg-orange-100 text-orange-700 text-[10px]">{urgentTasks.length}</Badge>
                </div>
                <div className="space-y-2">
                  {urgentTasks.map((task) => {
                    const userMap = new Map<string, UserEntry>(users.map((u) => [u.id, u]));
                    const requester = task.createdByUserId ? (userMap.get(task.createdByUserId)?.username ?? task.createdByUserId) : "Unknown";
                    const timeRemaining = calcTimeRemaining(task.urgency, task.createdAt);
                    const isOverdue = timeRemaining === "Overdue";
                    return (
                      <div key={task.id} className="rounded-2xl border border-orange-100 bg-orange-50/50 p-3" data-testid={`portal-urgent-item-${task.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className={`rounded-full border text-[10px] ${urgencyBadgeClass(task.urgency)}`}>
                                {urgencyShortLabel(task.urgency)}
                              </Badge>
                              <span className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-orange-700"}`}>
                                <Clock className="inline h-3 w-3 mr-0.5" />{timeRemaining}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{task.title}</p>
                            {task.patientName && <p className="text-xs text-slate-500">Patient: {task.patientName}</p>}
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                              <Users className="h-3 w-3" /><span>Requested by {requester}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 rounded-xl border-orange-200 bg-white text-orange-700 hover:bg-orange-50 text-xs h-7 px-3"
                            disabled={helpMutation.isPending}
                            onClick={() => helpMutation.mutate(task.id)}
                          >
                            Help
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-violet-600" />
              <h2 className="text-sm font-semibold text-slate-800">My open tasks</h2>
              {openTasks.length > 0 && (
                <Badge className="ml-auto rounded-full bg-violet-100 text-violet-700 text-[10px]">{openTasks.length}</Badge>
              )}
            </div>
            {openTasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-400">
                No open tasks
              </div>
            ) : (
              <div className="space-y-2">
                {openTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTaskDrawer(task)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-violet-200 hover:bg-violet-50/40"
                    data-testid={`portal-task-item-${task.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{task.title}</span>
                        {unreadTaskIds.has(task.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                      </div>
                      {task.patientName && <p className="mt-0.5 truncate text-xs text-slate-500">{task.patientName}</p>}
                    </div>
                    {task.urgency !== "none" && (
                      <Badge className={`rounded-full border text-[10px] ${urgencyBadgeClass(task.urgency)}`}>
                        {urgencyShortLabel(task.urgency)}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Disposition slide-over */}
      <DispositionSheet
        open={dispositionOpen}
        onOpenChange={setDispositionOpen}
        patientId={selectedItem?.patientId ?? null}
        patientName={selectedItem?.patientName ?? ""}
        schedulerUserId={currentUser?.id ?? null}
        priorAttempts={
          selectedItem ? (callsByPatient[selectedItem.patientId]?.length ?? 0) : 0
        }
      />

      {/* Shortcut help dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-indigo-600" /> Keyboard shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <ShortcutRow k="D" desc="Open disposition for selected patient" />
            <ShortcutRow k="N" desc="Move to next patient in queue" />
            <ShortcutRow k="S" desc="Open booking calendar for selected patient" />
            <ShortcutRow k="/" desc="Focus the search box" />
            <ShortcutRow k="?" desc="Show this help" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Slot-click booking dialog (existing flow preserved) */}
      <Dialog open={!!bookSlot} onOpenChange={(open) => { if (!open) { setBookSlot(null); setBookLinkedPatient(null); setBookPatientSearch(""); setBookName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Book appointment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              {bookSlot?.testType === "BrainWave" ? <Brain className="h-4 w-4 text-violet-600" /> : <Activity className="h-4 w-4 text-rose-700" />}
              <span className="font-medium">{bookSlot?.testType}</span>
              <span className="text-slate-400">·</span>
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>{bookSlot ? formatTime12(bookSlot.time) : ""}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <MapPin className="h-3.5 w-3.5" /><span>{facility}</span>
              <span className="text-slate-400">·</span>
              <Calendar className="h-3.5 w-3.5" />
              <span>{selectedDay ? new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700">Link patient from call list (optional)</Label>
              {bookLinkedPatient ? (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                  <span className="text-sm font-semibold text-violet-800">{bookLinkedPatient.patientName}</span>
                  <button type="button" onClick={() => { setBookLinkedPatient(null); setBookPatientSearch(""); }} className="text-violet-400 hover:text-violet-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input value={bookPatientSearch} onChange={(e) => setBookPatientSearch(e.target.value)} placeholder="Search call list…" className="pl-8 text-sm h-8 rounded-xl" />
                  </div>
                  {bookPatientResults.length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                      {bookPatientResults.map((p) => (
                        <button key={p.id} type="button" onClick={() => { setBookLinkedPatient(p); setBookName(""); setBookPatientSearch(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-violet-50 border-b border-slate-50 last:border-0">
                          <span className="font-medium text-slate-800">{p.patientName}</span>
                          <span className="text-slate-400">{p.facility}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {!bookLinkedPatient && (
              <div>
                <Label htmlFor="portal-book-name" className="text-xs font-medium text-slate-700">Or enter name manually</Label>
                <Input id="portal-book-name" value={bookName} onChange={(e) => setBookName(e.target.value)} placeholder="Patient name" className="mt-1 text-sm" />
              </div>
            )}
            {effectiveBookName.trim() && scheduledCallListNames.has(effectiveBookName.trim().toLowerCase()) && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span><span className="font-semibold">{effectiveBookName.trim()}</span> is already marked as scheduled.</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setBookSlot(null); setBookLinkedPatient(null); setBookPatientSearch(""); setBookName(""); }}>Cancel</Button>
            <Button
              size="sm"
              disabled={!effectiveBookName.trim() || bookMutation.isPending || scheduledCallListNames.has(effectiveBookName.trim().toLowerCase())}
              onClick={() => bookSlot && bookMutation.mutate({ patientName: effectiveBookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time, patientId: bookLinkedPatient?.patientId })}
            >
              {bookMutation.isPending ? "Booking…" : "Confirm booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Cancel appointment</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            Cancel <span className="font-semibold">{cancelTarget?.patientName}</span>'s {cancelTarget?.testType} at {cancelTarget ? formatTime12(cancelTarget.scheduledTime) : ""}?
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCancelTarget(null)}>Keep</Button>
            <Button size="sm" variant="destructive" disabled={cancelMutation.isPending} onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient quick-book dialog */}
      {callListBookPatient && (() => {
        const slots = callListBookTestType === "BrainWave" ? BW_SLOTS : VW_SLOTS;
        const bookedTimes = new Set(
          appointments
            .filter((a) => a.scheduledDate === selectedDateStr && a.status === "scheduled" && (callListBookTestType === "BrainWave" ? !isVitalWave(a.testType) : isVitalWave(a.testType)))
            .map((a) => a.scheduledTime),
        );
        return (
          <Dialog open onOpenChange={(open) => !open && setCallListBookPatient(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4 text-blue-600" />Book appointment
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div>
                  <Label className="text-xs font-medium text-slate-700">Patient</Label>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                    {callListBookPatient.patientName}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{selectedDay ? new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "Pick a date"}</span>
                  <span className="text-slate-300">·</span>
                  <MapPin className="h-3.5 w-3.5" /><span>{facility}</span>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-700">Test type</Label>
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" onClick={() => { setCallListBookTestType("BrainWave"); setCallListBookTime(""); }} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${callListBookTestType === "BrainWave" ? "border-violet-300 bg-violet-100 text-violet-700 ring-2 ring-violet-300 ring-offset-1" : "border-slate-200 bg-white text-slate-500 hover:bg-violet-50"}`}>
                      <Brain className="h-3.5 w-3.5" />BrainWave
                    </button>
                    <button type="button" onClick={() => { setCallListBookTestType("VitalWave"); setCallListBookTime(""); }} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${callListBookTestType === "VitalWave" ? "border-rose-400 bg-rose-100 text-rose-800 ring-2 ring-rose-400 ring-offset-1" : "border-slate-200 bg-white text-slate-500 hover:bg-rose-50"}`}>
                      <Activity className="h-3.5 w-3.5" />VitalWave
                    </button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-700">Time slot</Label>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {slots.map((slot) => {
                      const isBooked = bookedTimes.has(slot);
                      const isSelected = callListBookTime === slot;
                      return (
                        <button key={slot} type="button" disabled={isBooked} onClick={() => setCallListBookTime(slot)} className={`rounded-lg border py-1.5 text-xs font-medium transition ${isBooked ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300" : isSelected ? "border-blue-400 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50"}`}>
                          {formatTime12(slot)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setCallListBookPatient(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!callListBookTime || !selectedDay || bookMutation.isPending}
                  onClick={() => callListBookPatient && bookMutation.mutate({
                    patientName: callListBookPatient.patientName,
                    testType: callListBookTestType,
                    scheduledTime: callListBookTime,
                    patientId: callListBookPatient.patientId,
                  })}
                >
                  {bookMutation.isPending ? "Booking…" : "Book"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Task drawer */}
      {taskDrawerPatientId !== null && currentUser && (
        <TaskDrawer
          patientScreeningId={taskDrawerPatientId}
          patientName={taskDrawerPatientName}
          tasks={taskDrawerTasks}
          users={users}
          currentUser={currentUser}
          onClose={() => setTaskDrawerPatientId(null)}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function MetricTile({ icon, label, value, accent, badge }: { icon: React.ReactNode; label: string; value: number | string; accent: string; badge?: string }) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/85 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl" data-testid={`metric-tile-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${accent}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" data-testid="metric-tile-badge">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function BucketIndicator({ bucket }: { bucket: CallBucket }) {
  const map: Record<CallBucket, { color: string; label: string }> = {
    callback_due:  { color: "bg-amber-400",   label: "Callback due" },
    never_called:  { color: "bg-indigo-400",  label: "New" },
    no_answer:     { color: "bg-slate-400",   label: "No answer" },
    contacted:     { color: "bg-blue-400",    label: "Contacted" },
    scheduled:     { color: "bg-emerald-500", label: "Scheduled" },
    declined:      { color: "bg-rose-400",    label: "Declined" },
  };
  const cfg = map[bucket];
  return (
    <span className="mt-1.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full" title={cfg.label}>
      <span className={`h-full w-full rounded-full ${cfg.color}`} />
    </span>
  );
}

function ShortcutRow({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5">
      <span className="text-slate-700">{desc}</span>
      <kbd className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">{k}</kbd>
    </div>
  );
}

function CurrentCallCard({
  item,
  latestCall,
  schedulerName,
  facilityName,
  lineageFromName,
  lineageReason,
  scriptOpen,
  setScriptOpen,
  onDisposition,
  onBook,
  onSkip,
}: {
  item: OutreachCallItem | null;
  latestCall: OutreachCall | undefined;
  schedulerName: string;
  facilityName: string;
  lineageFromName: string | null;
  lineageReason: string | null;
  scriptOpen: boolean;
  setScriptOpen: (v: boolean) => void;
  onDisposition: () => void;
  onBook: () => void;
  onSkip: () => void;
}) {
  if (!item) {
    return (
      <div className="px-5 py-5 bg-gradient-to-br from-indigo-50/60 via-transparent to-blue-50/40">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
          <Megaphone className="h-3.5 w-3.5" />
          Current call
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Pick a patient from the call list to start working through the queue.
        </p>
      </div>
    );
  }

  const primaryTest = item.qualifyingTests[0];
  const script = primaryTest ? getScriptForTest(primaryTest) : null;
  return (
    <div className="px-5 py-5 bg-gradient-to-br from-indigo-50/60 via-transparent to-blue-50/40" data-testid="current-call-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
        <Megaphone className="h-3.5 w-3.5" />
        Current call
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-semibold text-slate-900">{item.patientName}</h2>
        <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(item.appointmentStatus)}`}>
          {statusLabel(item.appointmentStatus)}
        </Badge>
        {lineageFromName && (
          <Badge
            className="rounded-full border bg-violet-50 text-violet-700 border-violet-200 text-[10px]"
            data-testid="current-call-reassigned-from"
            title={lineageReason ?? "Reassigned"}
          >
            ↩ from {lineageFromName}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <a
          href={`tel:${digitsOnly(item.phoneNumber)}`}
          className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
          data-testid="current-call-tel"
        >
          <Phone className="h-3.5 w-3.5" />Call {item.phoneNumber}
        </a>
        <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{item.facility}</span>
        {item.dob && <span>DOB {item.dob}</span>}
        {item.age != null && <span>· {item.age} y/o</span>}
        {item.insurance && (
          <span className="inline-flex items-center gap-0.5"><ShieldCheck className="h-3 w-3" />{item.insurance}</span>
        )}
      </div>

      {/* AI reasoning summary — why this patient qualifies */}
      {item.reasoning?.length > 0 && (
        <div
          className="mt-3 rounded-xl border border-indigo-100 bg-white/80 p-3 text-[11px] text-slate-700"
          data-testid="current-call-reasoning"
        >
          <div className="flex items-center gap-1.5 text-indigo-600">
            <Sparkles className="h-3 w-3" />
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">Why this patient qualifies</span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {item.reasoning.slice(0, 3).map((r, i) => (
              <li key={`reason-${i}`}>
                <span className="font-semibold text-indigo-700">{r.testName}:</span>{" "}
                <span className="leading-relaxed line-clamp-3">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prior tests / cooldown reasoning summary */}
      {(item.previousTests || item.previousTestsDate) && (
        <div
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-900"
          data-testid="current-call-cooldown"
        >
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">Prior tests · cooldown</span>
          </div>
          <div className="mt-1 leading-relaxed">
            {item.previousTests && <span>{item.previousTests}</span>}
            {item.previousTestsDate && (
              <span className="ml-1 text-amber-700">(last {item.previousTestsDate})</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-white/70 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 inline-flex items-center gap-1">
          <Stethoscope className="h-3 w-3" />Provider · {item.providerName}
        </div>
        {item.qualifyingTests.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.qualifyingTests.map((t) => (
              <Badge key={`cur-${t}`} className="rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[11px]">{t}</Badge>
            ))}
          </div>
        )}
        {(item.diagnoses?.trim() || item.history?.trim()) && (
          <div className="mt-2 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
            {item.diagnoses?.trim() && (
              <div><span className="font-semibold text-slate-500">Dx:</span> <span className="line-clamp-2">{item.diagnoses}</span></div>
            )}
            {item.history?.trim() && (
              <div><span className="font-semibold text-slate-500">Hx:</span> <span className="line-clamp-2">{item.history}</span></div>
            )}
          </div>
        )}
      </div>

      {/* Scripts */}
      {script && primaryTest && (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-white/80 p-3" data-testid="current-call-script">
          <button
            type="button"
            onClick={() => setScriptOpen(!scriptOpen)}
            className="flex w-full items-center gap-2 text-left"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700">Script · {primaryTest}</span>
            <span className="ml-auto text-slate-400">{scriptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
          </button>
          {scriptOpen && (
            <div className="mt-2 space-y-2 text-xs text-slate-700">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Intro</p>
                <p className="mt-1 leading-relaxed">
                  {fillScript(script.intro, {
                    name: item.patientName.split(" ")[0],
                    scheduler: schedulerName,
                    clinic: facilityName,
                    provider: item.providerName,
                  })}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Why this matters</p>
                <p className="mt-1 leading-relaxed">{script.whyThisMatters}</p>
              </div>
              {script.objections.length > 0 && (
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">If they say…</p>
                  <ul className="mt-1 space-y-1">
                    {script.objections.map((o, i) => (
                      <li key={i} className="leading-relaxed">
                        <span className="font-semibold text-slate-600">"{o.objection}"</span> → <span>{o.response}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Last call summary */}
      {latestCall && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-2.5 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-500">Last attempt:</span>{" "}
          <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(latestCall.outcome)}`}>{latestCall.outcome.replace("_", " ")}</Badge>
          <span className="ml-1">· {formatRelative(latestCall.startedAt as unknown as string)}</span>
          {latestCall.notes && <p className="mt-1 italic text-slate-500">"{latestCall.notes}"</p>}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-indigo-100/60 pt-3">
        <Button
          onClick={onDisposition}
          className="rounded-full bg-indigo-600 px-4 text-white hover:bg-indigo-700"
          data-testid="current-call-disposition"
        >
          <FileText className="mr-1 h-4 w-4" /> Disposition <kbd className="ml-2 rounded bg-indigo-700 px-1.5 py-0.5 text-[10px]">D</kbd>
        </Button>
        <Button
          variant="outline"
          onClick={onBook}
          className="rounded-full border-blue-300 text-blue-700 hover:bg-blue-50"
          data-testid="current-call-book"
        >
          <CalendarPlus className="mr-1 h-4 w-4" /> Book slot <kbd className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">S</kbd>
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          className="ml-auto rounded-full text-slate-500"
          data-testid="current-call-next"
        >
          Next <ArrowRight className="ml-1 h-4 w-4" /> <kbd className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">N</kbd>
        </Button>
      </div>
    </div>
  );
}

// ─── Cockpit subcomponents ────────────────────────────────────────────────────

function FloatingMetricsTile({
  callsMade, reachedCount, scheduledFromCalls, conversionPct, callbacksDue,
}: {
  callsMade: number; reachedCount: number; scheduledFromCalls: number;
  conversionPct: number; callbacksDue: number;
}) {
  return (
    <div
      className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/95 px-4 py-2 shadow-[0_8px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl"
      data-testid="portal-floating-metrics"
    >
      <Stat icon={<Phone className="h-3.5 w-3.5 text-blue-600" />} label="Calls" value={callsMade} />
      <Stat icon={<PhoneCall className="h-3.5 w-3.5 text-violet-600" />} label="Reached" value={reachedCount} />
      <Stat icon={<CalendarCheck className="h-3.5 w-3.5 text-emerald-600" />} label="Booked" value={scheduledFromCalls} />
      <Stat icon={<TrendingUp className="h-3.5 w-3.5 text-amber-600" />} label="Conv" value={`${conversionPct}%`} />
      {callbacksDue > 0 && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          {callbacksDue} callback{callbacksDue !== 1 ? "s" : ""} due
        </span>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-1.5" data-testid={`metric-${label.toLowerCase()}`}>
      <span>{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function MissionControlBar({
  selectedItem, onDisposition, onBook, onSkip,
}: {
  selectedItem: OutreachCallItem | null;
  onDisposition: () => void;
  onBook: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="px-5 py-4"
      data-testid="mission-control-bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mission control</span>
        {selectedItem ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="mc-active-status">
            <Megaphone className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-semibold text-slate-800 truncate max-w-[160px]">{selectedItem.patientName}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-0.5"><Building2 className="h-3 w-3" />{selectedItem.facility}</span>
            {selectedItem.qualifyingTests[0] && (
              <Badge className="rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-100 text-[10px]">
                Next: {selectedItem.qualifyingTests[0]}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-xs italic text-slate-400" data-testid="mc-idle-status">Pick a patient to start</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!selectedItem} onClick={onSkip} data-testid="mc-skip">
            Skip
          </Button>
          <Button size="sm" variant="outline" disabled={!selectedItem} onClick={onBook} data-testid="mc-book">
            <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Book
          </Button>
          <Button size="sm" disabled={!selectedItem} onClick={onDisposition} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="mc-disposition">
            Disposition
          </Button>
        </div>
      </div>
    </div>
  );
}

type AiTurn = { role: "user" | "assistant"; content: string };

function AiBar({
  selectedItem,
  callListContext,
}: {
  selectedItem: OutreachCallItem | null;
  callListContext: { name: string; bucket: string; qualifyingTests: string[] }[];
}) {
  const [aiQuestion, setAiQuestion] = useState("");
  const [history, setHistory] = useState<AiTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [history, streaming]);

  const ask = async () => {
    const q = aiQuestion.trim();
    if (!q || streaming) return;
    setAiError(null);
    setAiQuestion("");
    const nextHistory: AiTurn[] = [...history, { role: "user", content: q }, { role: "assistant", content: "" }];
    setHistory(nextHistory);
    setStreaming(true);

    const ctx = selectedItem
      ? {
          name: selectedItem.patientName,
          age: selectedItem.age ?? null,
          insurance: selectedItem.insurance ?? null,
          diagnoses: selectedItem.diagnoses ?? null,
          history: selectedItem.history ?? null,
          qualifyingTests: selectedItem.qualifyingTests ?? [],
          previousTests: selectedItem.previousTests ?? null,
        }
      : null;

    try {
      const resp = await fetch("/api/scheduler-ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: q,
          patientContext: ctx,
          callListContext,
          history: history.slice(-10),
        }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.text().catch(() => "Request failed");
        throw new Error(err.slice(0, 200));
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              acc += parsed.delta;
              setHistory((h) => {
                const copy = h.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: acc };
                }
                return copy;
              });
            }
          } catch (e: any) {
            throw e;
          }
        }
      }
    } catch (e: any) {
      setAiError(e?.message || "Failed to get answer");
      setHistory((h) => h.slice(0, -2));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div
      className="px-5 py-4 bg-gradient-to-br from-indigo-50/40 via-transparent to-transparent"
      data-testid="ai-bar"
    >
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-indigo-500" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">AI co-pilot</span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => { setHistory([]); setAiError(null); }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            data-testid="ai-bar-clear"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div
          ref={transcriptRef}
          className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-indigo-100 bg-white/80 p-2 text-xs"
          data-testid="ai-bar-transcript"
        >
          {history.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "rounded-lg bg-indigo-50 px-2 py-1 text-indigo-900"
                  : "rounded-lg bg-slate-50 px-2 py-1 text-slate-700 whitespace-pre-wrap"
              }
              data-testid={`ai-bar-turn-${i}-${m.role}`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">{m.role}</span>
              <p className="mt-0.5 leading-relaxed">{m.content || (streaming && m.role === "assistant" ? "…" : "")}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-indigo-100 bg-white/80 px-3 py-2">
        <Input
          value={aiQuestion}
          onChange={(e) => setAiQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder={selectedItem ? `Ask about ${selectedItem.patientName}…` : "Ask the AI co-pilot…"}
          className="h-8 border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="ai-bar-input"
        />
        <Button
          size="sm"
          onClick={ask}
          disabled={streaming || !aiQuestion.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
          data-testid="ai-bar-send"
        >
          {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {aiError && (
        <p className="mt-2 text-xs text-rose-600" data-testid="ai-bar-error">{aiError}</p>
      )}
    </div>
  );
}

function ToolsPanel(props: {
  facility: string;
  todayAppointments: AncillaryAppointment[];
  onCancelAppointment: (a: AncillaryAppointment) => void;
  selectedItem: OutreachCallItem | null;
  bookingPanelOpen: boolean;
  setBookingPanelOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  calYear: number;
  calMonth: number;
  setCalMonth: (m: number | ((p: number) => number)) => void;
  setCalYear: (y: number | ((p: number) => number)) => void;
  selectedDay: number | null;
  setSelectedDay: (d: number | null) => void;
  bookedDates: Set<string>;
  appointments: AncillaryAppointment[];
  selectedDateStr: string | null;
  setBookSlot: (s: BookingSlot | null) => void;
  setBookName: (n: string) => void;
  setBookLinkedPatient: (p: OutreachCallItem | null) => void;
  setBookPatientSearch: (s: string) => void;
  setCancelTarget: (a: AncillaryAppointment | null) => void;
  scrollToSlot: { time: string; testType: string } | null;
  expandedSection?: "calendar" | "email" | "materials" | null;
  setExpandedSection?: (s: "calendar" | "email" | "materials" | null) => void;
}) {
  const {
    facility, todayAppointments, selectedItem, bookingPanelOpen, setBookingPanelOpen,
    calYear, calMonth, setCalMonth, setCalYear, selectedDay, setSelectedDay,
      appointments, setBookSlot, setBookName,
      setBookLinkedPatient, setBookPatientSearch,
      setExpandedSection,
    } = props;

    function handleConfirmSlot(slot: BookingSlot) {
      setBookSlot(slot);
      if (selectedItem) {
        setBookLinkedPatient(selectedItem);
        setBookName("");
        setBookPatientSearch("");
      }
    }

    return (
      <div data-testid="portal-tools-panel" className="contents">
        {/* Top half — Tri-Clinic monthly calendar */}
        <TriClinicCalendar
          facility={facility}
          appointments={appointments}
          selectedItem={selectedItem}
          calYear={calYear}
          calMonth={calMonth}
          setCalMonth={setCalMonth}
          setCalYear={setCalYear}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          onConfirmSlot={handleConfirmSlot}
          onExpand={setExpandedSection ? () => setExpandedSection("calendar") : undefined}
        />

        {/* Bottom half — Communication hub */}
        <CommunicationHub
          selectedItem={selectedItem}
          facility={facility}
          onExpandEmail={setExpandedSection ? () => setExpandedSection("email") : undefined}
          onExpandMaterials={setExpandedSection ? () => setExpandedSection("materials") : undefined}
        />
      </div>
    );
  }

  // ─── Tri-Clinic Calendar ───────────────────────────────────────────────────
  const CLINIC_PALETTE = [
    { dot: "bg-blue-500",   ring: "ring-blue-400",   text: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-300" },
    { dot: "bg-violet-500", ring: "ring-violet-400", text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-300" },
    { dot: "bg-amber-500",  ring: "ring-amber-400",  text: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-300" },
  ];

  type ClinicGroup = { key: string; label: string; color: typeof CLINIC_PALETTE[number] };

  function deriveClinicGroups(appointments: AncillaryAppointment[]): ClinicGroup[] {
    const facilities = new Set<string>();
    for (const a of appointments) if (a.facility) facilities.add(a.facility);
    if (facilities.size > 1) {
      return Array.from(facilities).slice(0, 3).map((f, i) => ({ key: f, label: f, color: CLINIC_PALETTE[i] }));
    }
    // Single facility — split by test type so the calendar still shows multi-color dots.
    const types = new Set<string>();
    for (const a of appointments) types.add(isBrainWave(a.testType) ? "BrainWave" : "VitalWave");
    const facLabel = Array.from(facilities)[0] ?? "";
    return Array.from(types).slice(0, 3).map((t, i) => ({
      key: `${facLabel}::${t}`,
      label: facLabel ? `${facLabel} · ${t}` : t,
      color: CLINIC_PALETTE[i],
    }));
  }

  function clinicKeyForAppt(a: AncillaryAppointment, multiFacility: boolean): string {
    if (multiFacility) return a.facility;
    return `${a.facility}::${isBrainWave(a.testType) ? "BrainWave" : "VitalWave"}`;
  }

  function clinicKeyForPatient(p: OutreachCallItem, groups: ClinicGroup[], multiFacility: boolean): string | null {
    if (multiFacility) return p.facility;
    for (const g of groups) {
      const isBw = g.label.includes("BrainWave");
      if (p.qualifyingTests.some((t) => (isBw ? isBrainWave(t) : isVitalWave(t)))) return g.key;
    }
    return groups[0]?.key ?? null;
  }

  function TriClinicCalendar({
    facility, appointments, selectedItem,
    calYear, calMonth, setCalMonth, setCalYear,
    selectedDay, setSelectedDay,
    onConfirmSlot, onExpand, fullWidth = false,
  }: {
    facility: string;
    appointments: AncillaryAppointment[];
    selectedItem: OutreachCallItem | null;
    calYear: number;
    calMonth: number;
    setCalMonth: (m: number | ((p: number) => number)) => void;
    setCalYear: (y: number | ((p: number) => number)) => void;
    selectedDay: number | null;
    setSelectedDay: (d: number | null) => void;
    onConfirmSlot: (slot: BookingSlot) => void;
    onExpand?: () => void;
    fullWidth?: boolean;
  }) {
    const facilitiesInData = useMemo(() => {
      const s = new Set<string>();
      for (const a of appointments) if (a.facility) s.add(a.facility);
      return s;
    }, [appointments]);
    const multiFacility = facilitiesInData.size > 1;
    const groups = useMemo(() => deriveClinicGroups(appointments), [appointments]);
    const groupColorByKey = useMemo(() => {
      const m = new Map<string, ClinicGroup>();
      for (const g of groups) m.set(g.key, g);
      return m;
    }, [groups]);

    const dateGroupCounts = useMemo(() => {
      const m = new Map<string, Map<string, number>>();
      for (const a of appointments) {
        if (a.status !== "scheduled") continue;
        const key = clinicKeyForAppt(a, multiFacility);
        if (!groupColorByKey.has(key)) continue;
        let inner = m.get(a.scheduledDate);
        if (!inner) { inner = new Map(); m.set(a.scheduledDate, inner); }
        inner.set(key, (inner.get(key) ?? 0) + 1);
      }
      return m;
    }, [appointments, multiFacility, groupColorByKey]);

    const selectedPatientGroupKey = selectedItem ? clinicKeyForPatient(selectedItem, groups, multiFacility) : null;
    const selectedGroupColor = selectedPatientGroupKey ? groupColorByKey.get(selectedPatientGroupKey)?.color : undefined;

    const firstDay = new Date(calYear, calMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === calYear && today.getMonth() === calMonth;
    const monthLabel = firstDay.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const [popupDay, setPopupDay] = useState<number | null>(null);

    const cells: Array<{ day: number | null }> = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
    while (cells.length % 7 !== 0) cells.push({ day: null });

    function prevMonth() { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }
    function nextMonth() { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }

    const cellSize = fullWidth ? "h-16" : "h-10";
    const gapClass = fullWidth ? "gap-1.5" : "gap-1";

    return (
      <div className={fullWidth ? "p-6" : "px-5 pt-5 pb-4"} data-testid="tri-clinic-calendar">
        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Booking calendar</h2>
          <Badge variant="outline" className="ml-2 rounded-full text-[10px] text-slate-500">{facility}</Badge>
          {onExpand && !fullWidth && (
            <button
              type="button"
              onClick={onExpand}
              title="Expand calendar"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50"
              data-testid="tools-expand-calendar"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <button type="button" onClick={prevMonth} className="rounded-full border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50" data-testid="cal-prev-month">
            <ChevronUp className="h-3.5 w-3.5 -rotate-90" />
          </button>
          <span className="text-sm font-semibold text-slate-800" data-testid="cal-month-label">{monthLabel}</span>
          <button type="button" onClick={nextMonth} className="rounded-full border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50" data-testid="cal-next-month">
            <ChevronUp className="h-3.5 w-3.5 rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()); setSelectedDay(today.getDate()); }}
            className="ml-auto rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50"
            data-testid="cal-today"
          >
            Today
          </button>
        </div>

        {groups.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
            {groups.map((g) => (
              <span key={g.key} className="inline-flex items-center gap-1" data-testid={`cal-legend-${g.key}`}>
                <span className={`h-2 w-2 rounded-full ${g.color.dot}`} />
                <span className="truncate max-w-[120px]">{g.label}</span>
              </span>
            ))}
          </div>
        )}

        <div className={`grid grid-cols-7 ${gapClass} text-center text-[10px] uppercase tracking-wide text-slate-400 mb-1`}>
          {["S","M","T","W","T","F","S"].map((d, i) => <div key={i}>{d}</div>)}
        </div>

        <div className={`grid grid-cols-7 ${gapClass}`}>
          {cells.map((c, i) => {
            if (c.day == null) return <div key={i} className={cellSize} />;
            const dateKey = toDateKey(calYear, calMonth, c.day);
            const dayCounts = dateGroupCounts.get(dateKey);
            const isToday = isCurrentMonth && c.day === today.getDate();
            const isSelected = selectedDay === c.day;
            const highlightForSelected = selectedGroupColor && dayCounts?.has(selectedPatientGroupKey!);
            return (
              <Popover key={i} open={popupDay === c.day} onOpenChange={(o) => { if (!o) setPopupDay(null); }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { setSelectedDay(c.day); setPopupDay(c.day); }}
                    className={[
                      cellSize,
                      "relative rounded-lg border text-xs font-medium transition flex flex-col items-center justify-start pt-1",
                      isSelected
                        ? "border-blue-400 bg-blue-50 text-blue-700"
                        : isToday
                        ? "border-emerald-300 bg-emerald-50/40 text-emerald-700"
                        : "border-slate-100 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50",
                      highlightForSelected ? `ring-2 ring-offset-1 ${selectedGroupColor!.ring}` : "",
                    ].join(" ")}
                    data-testid={`cal-day-${dateKey}`}
                  >
                    <span>{c.day}</span>
                    {dayCounts && dayCounts.size > 0 && (
                      <div className="mt-0.5 flex gap-0.5">
                        {Array.from(dayCounts.entries()).slice(0, 3).map(([gk, cnt]) => {
                          const color = groupColorByKey.get(gk)?.color;
                          if (!color) return null;
                          return (
                            <span key={gk} className={`h-1.5 w-1.5 rounded-full ${color.dot}`} title={`${groupColorByKey.get(gk)?.label}: ${cnt}`} />
                          );
                        })}
                      </div>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="center" sideOffset={4}>
                  <DayBookPopup
                    dateLabel={new Date(calYear, calMonth, c.day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    selectedItem={selectedItem}
                    appointments={appointments}
                    selectedDateKey={dateKey}
                    onConfirm={(slot) => { onConfirmSlot(slot); setPopupDay(null); }}
                    onCancel={() => setPopupDay(null)}
                  />
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </div>
    );
  }

  function DayBookPopup({
    dateLabel, selectedItem, appointments, selectedDateKey, onConfirm, onCancel,
  }: {
    dateLabel: string;
    selectedItem: OutreachCallItem | null;
    appointments: AncillaryAppointment[];
    selectedDateKey: string;
    onConfirm: (slot: BookingSlot) => void;
    onCancel: () => void;
  }) {
    const defaultType: "BrainWave" | "VitalWave" = selectedItem?.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave";
    const [testType, setTestType] = useState<"BrainWave" | "VitalWave">(defaultType);
    const [time, setTime] = useState<string>("");
    const slots = testType === "BrainWave" ? BW_SLOTS : VW_SLOTS;
    const bookedTimes = new Set(
      appointments
        .filter((a) => a.scheduledDate === selectedDateKey && a.status === "scheduled" && (testType === "BrainWave" ? !isVitalWave(a.testType) : isVitalWave(a.testType)))
        .map((a) => a.scheduledTime),
    );

    return (
      <div className="space-y-3" data-testid="day-book-popup">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Book on</p>
          <p className="text-sm font-semibold text-slate-800">{dateLabel}</p>
        </div>
        {selectedItem ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-2.5 py-1.5">
            <p className="text-[10px] text-violet-500 uppercase tracking-wide">Patient</p>
            <p className="text-sm font-semibold text-violet-800 truncate">{selectedItem.patientName}</p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] italic text-slate-400">
            No patient selected — pick one from the call list to pre-fill.
          </p>
        )}
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Ancillary test</Label>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              onClick={() => { setTestType("BrainWave"); setTime(""); }}
              className={`flex-1 inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs ${testType === "BrainWave" ? "border-violet-300 bg-violet-100 text-violet-700" : "border-slate-200 bg-white text-slate-500"}`}
              data-testid="popup-type-brainwave"
            >
              <Brain className="h-3 w-3" /> BrainWave
            </button>
            <button
              type="button"
              onClick={() => { setTestType("VitalWave"); setTime(""); }}
              className={`flex-1 inline-flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs ${testType === "VitalWave" ? "border-rose-300 bg-rose-100 text-rose-700" : "border-slate-200 bg-white text-slate-500"}`}
              data-testid="popup-type-vitalwave"
            >
              <Activity className="h-3 w-3" /> VitalWave
            </button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Time slot</Label>
          <div className="mt-1 grid grid-cols-4 gap-1 max-h-40 overflow-y-auto pr-1">
            {slots.map((s) => {
              const isBooked = bookedTimes.has(s);
              const isSelected = time === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={isBooked}
                  onClick={() => setTime(s)}
                  className={`rounded-md border py-1 text-[11px] transition ${
                    isBooked ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                    : isSelected ? "border-blue-400 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                  data-testid={`popup-time-${s}`}
                >
                  {formatTime12(s)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel} data-testid="popup-cancel">Cancel</Button>
          <Button
            size="sm"
            disabled={!time}
            onClick={() => onConfirm({ time, testType })}
            data-testid="popup-confirm"
          >
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  // ─── Communication Hub ────────────────────────────────────────────────────
  function CommunicationHub({
    selectedItem, facility, onExpandEmail, onExpandMaterials,
  }: {
    selectedItem: OutreachCallItem | null;
    facility: string;
    onExpandEmail?: () => void;
    onExpandMaterials?: () => void;
  }) {
    return (
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Mail className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold text-slate-800">Communication hub</h2>
        </div>
        <Tabs defaultValue="email" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="email" className="text-xs" data-testid="hub-tab-email">
              <Mail className="h-3 w-3 mr-1" /> Email
            </TabsTrigger>
            <TabsTrigger value="materials" className="text-xs" data-testid="hub-tab-materials">
              <Megaphone className="h-3 w-3 mr-1" /> Materials
            </TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="mt-3">
            <EmailComposer selectedItem={selectedItem} facility={facility} onExpand={onExpandEmail} />
          </TabsContent>
          <TabsContent value="materials" className="mt-3">
            <MaterialsPanel selectedItem={selectedItem} onExpand={onExpandMaterials} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  function defaultEmailFor(p: OutreachCallItem | null, facility: string): { to: string; subject: string; body: string } {
    if (!p) return { to: "", subject: "", body: "" };
    const subject = `Scheduling your visit at ${p.facility || facility}`;
    const body = `Hi ${p.patientName.split(" ")[0] || ""},\n\nThis is your scheduler from ${p.facility || facility}. We'd like to book your upcoming ${p.qualifyingTests.join(" / ") || "screening"} visit. Please reply with a time that works best for you, or call us at the number on file.\n\nThank you,\nScheduling Team`;
    return { to: p.phoneNumber || "", subject, body };
  }

  function EmailComposer({
    selectedItem, facility, onExpand, fullWidth = false,
  }: {
    selectedItem: OutreachCallItem | null;
    facility: string;
    onExpand?: () => void;
    fullWidth?: boolean;
  }) {
    const { toast } = useToast();
    const initial = useMemo(() => defaultEmailFor(selectedItem, facility), [selectedItem, facility]);
    const [to, setTo] = useState(initial.to);
    const [subject, setSubject] = useState(initial.subject);
    const [body, setBody] = useState(initial.body);

    useEffect(() => {
      setTo(initial.to);
      setSubject(initial.subject);
      setBody(initial.body);
    }, [initial]);

    function handleSend() {
      if (!selectedItem) {
        toast({ title: "No patient selected", description: "Pick a patient from the call list first.", variant: "destructive" });
        return;
      }
      toast({ title: "Email sent", description: `Sent to ${selectedItem.patientName}.` });
    }

    return (
      <div className="space-y-2" data-testid="email-composer">
        {!fullWidth && onExpand && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onExpand}
              title="Expand email"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:bg-emerald-50"
              data-testid="hub-expand-email"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        )}
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">To</Label>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="patient@example.com" className="mt-1 h-8 text-sm rounded-xl" data-testid="email-to" />
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 h-8 text-sm rounded-xl" data-testid="email-subject" />
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Body</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={fullWidth ? 14 : 5}
            className="mt-1 text-sm rounded-xl"
            data-testid="email-body"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 truncate">
            {selectedItem ? `Pre-filled for ${selectedItem.patientName}` : "Pick a patient to pre-fill"}
          </span>
          <Button size="sm" onClick={handleSend} className="h-8 rounded-full" data-testid="email-send">
            <Send className="h-3.5 w-3.5 mr-1" /> Send
          </Button>
        </div>
      </div>
    );
  }

  const MARKETING_MATERIALS = [
    { id: "brainwave-brochure", title: "BrainWave Brochure", desc: "Patient-facing overview of the BrainWave screening.", icon: Brain },
    { id: "vitalwave-info",     title: "VitalWave Info Sheet", desc: "1-page summary of the VitalWave cardiac screening.", icon: Activity },
    { id: "screening-faq",      title: "General Screening FAQ", desc: "Answers to the most common patient questions.", icon: FileText },
    { id: "insurance-coverage", title: "Insurance Coverage Note", desc: "Standard coverage note — Medicare + most PPOs.", icon: ShieldCheck },
    { id: "appointment-prep",   title: "Visit Prep Checklist", desc: "What to bring, fasting, ID, insurance card.", icon: ListTodo },
    { id: "post-visit-care",    title: "Post-Visit Care Guide", desc: "Post-test care + follow-up scheduling guidance.", icon: Sparkles },
  ];

  function MaterialsPanel({
    selectedItem, onExpand, fullWidth = false,
  }: {
    selectedItem: OutreachCallItem | null;
    onExpand?: () => void;
    fullWidth?: boolean;
  }) {
    const { toast } = useToast();

    function handleSend(title: string) {
      if (!selectedItem) {
        toast({ title: "No patient selected", description: "Pick a patient from the call list first.", variant: "destructive" });
        return;
      }
      toast({ title: "Material sent", description: `${title} sent to ${selectedItem.patientName}.` });
    }

    const cols = fullWidth ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1";
    const items = fullWidth ? MARKETING_MATERIALS : MARKETING_MATERIALS.slice(0, 3);

    return (
      <div className="space-y-2" data-testid="materials-panel">
        {!fullWidth && onExpand && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onExpand}
              title="Expand materials"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50"
              data-testid="hub-expand-materials"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className={`grid gap-2 ${cols}`}>
          {items.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className="rounded-xl border border-slate-200 bg-white p-2.5 hover:border-amber-300 hover:bg-amber-50/40 transition"
                data-testid={`material-card-${m.id}`}
              >
                <div className="flex items-start gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 shrink-0">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{m.title}</p>
                    <p className="text-[10px] text-slate-500 line-clamp-2">{m.desc}</p>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSend(m.title)}
                    className="h-7 rounded-full text-[11px]"
                    data-testid={`material-send-${m.id}`}
                  >
                    <Send className="h-3 w-3 mr-1" /> Send to patient
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {!fullWidth && onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="w-full text-center text-[11px] text-slate-500 hover:text-slate-700 underline"
            data-testid="hub-materials-see-all"
          >
            See all {MARKETING_MATERIALS.length} materials
          </button>
        )}
      </div>
    );
  }

  // ─── Expanded ("playing field") view rendered in the center column ──────
  function ExpandedSectionView(props: {
    section: "calendar" | "email" | "materials";
    onClose: () => void;
    facility: string;
    appointments: AncillaryAppointment[];
    selectedItem: OutreachCallItem | null;
    calYear: number;
    calMonth: number;
    setCalMonth: (m: number | ((p: number) => number)) => void;
    setCalYear: (y: number | ((p: number) => number)) => void;
    selectedDay: number | null;
    setSelectedDay: (d: number | null) => void;
    onConfirmSlot: (slot: BookingSlot) => void;
  }) {
    const { section, onClose } = props;
    const titleMap = { calendar: "Booking calendar", email: "Email composer", materials: "Marketing materials" };
    return (
      <div
        className="rounded-3xl border border-white/60 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl overflow-hidden"
        data-testid={`expanded-${section}`}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          {section === "calendar" && <Calendar className="h-4 w-4 text-blue-600" />}
          {section === "email" && <Mail className="h-4 w-4 text-emerald-600" />}
          {section === "materials" && <Megaphone className="h-4 w-4 text-amber-600" />}
          <h2 className="text-base font-semibold text-slate-800">{titleMap[section]}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            data-testid="expanded-close"
          >
            <Minimize2 className="h-3.5 w-3.5" /> Collapse
          </button>
        </div>
        {section === "calendar" && (
          <TriClinicCalendar
            fullWidth
            facility={props.facility}
            appointments={props.appointments}
            selectedItem={props.selectedItem}
            calYear={props.calYear}
            calMonth={props.calMonth}
            setCalMonth={props.setCalMonth}
            setCalYear={props.setCalYear}
            selectedDay={props.selectedDay}
            setSelectedDay={props.setSelectedDay}
            onConfirmSlot={props.onConfirmSlot}
          />
        )}
        {section === "email" && (
          <div className="p-6">
            <EmailComposer fullWidth selectedItem={props.selectedItem} facility={props.facility} />
          </div>
        )}
        {section === "materials" && (
          <div className="p-6">
            <MaterialsPanel fullWidth selectedItem={props.selectedItem} />
          </div>
        )}
      </div>
    );
  }
  
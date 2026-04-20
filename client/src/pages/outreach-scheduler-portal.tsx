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
} from "lucide-react";
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
import { CalendarPageHeader, HeaderPill, HeaderStatusPill } from "@/components/CalendarPageHeader";
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
  const [urgentPanelOpen, setUrgentPanelOpen] = useState(true);

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

  // Search + clinic + test + bucket filter + priority sort.
  const sortedCallList = useMemo(() => {
    const list = card?.callList ?? [];
    const q = search.trim().toLowerCase();
    const filtered = list
      .filter((item) => {
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
  }, [card, search, filter, clinicFilter, testFilter, latestCallByPatient]);

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
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">

        <CalendarPageHeader
          eyebrow={`SCHEDULER · ${card.facility.toUpperCase()}`}
          title={card.name}
          actions={
            <>
              <HeaderStatusPill />
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] text-white/85 hover:bg-white/20"
                data-testid="portal-shortcuts-btn"
              >
                <Keyboard className="h-3.5 w-3.5" /> Shortcuts
              </button>
              <Link href="/outreach">
                <HeaderPill icon={<ArrowLeft className="w-3.5 h-3.5" />}>Back to Outreach</HeaderPill>
              </Link>
            </>
          }
        >
          <p className="mt-2 text-sm text-slate-300/85">
            {card.totalPatients} patient{card.totalPatients !== 1 ? "s" : ""} on the call list today
          </p>
        </CalendarPageHeader>

        {/* ── Header metrics strip ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="portal-metrics-strip">
          <MetricTile icon={<Phone className="h-4 w-4" />} label="Calls made today" value={callsMade} accent="bg-blue-50 text-blue-700" />
          <MetricTile icon={<PhoneCall className="h-4 w-4" />} label="Contacts reached" value={reachedCount} accent="bg-violet-50 text-violet-700" />
          <MetricTile icon={<CalendarCheck className="h-4 w-4" />} label="Scheduled" value={scheduledFromCalls} accent="bg-emerald-50 text-emerald-700" />
          <MetricTile icon={<TrendingUp className="h-4 w-4" />} label="Conversion" value={`${conversionPct}%`} accent="bg-amber-50 text-amber-700" badge={callbacksDue > 0 ? `${callbacksDue} callback${callbacksDue !== 1 ? "s" : ""} due` : undefined} />
        </div>

        {/* ── Main two-pane layout ─────────────────────────────────────── */}
        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">

          {/* ─── LEFT: Current Call + Today's Schedule + Booking ────── */}
          <div className="flex flex-col gap-4">
            {/* Current Call card */}
            <CurrentCallCard
              item={selectedItem}
              latestCall={selectedItem ? latestCallByPatient.get(selectedItem.patientId) : undefined}
              schedulerName={card.name}
              facilityName={card.facility}
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

            {/* Today's Schedule */}
            <Card className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-semibold text-slate-800">Today's Schedule</h2>
                <Badge variant="outline" className="ml-auto rounded-full text-[10px] text-slate-500">
                  {todayAppointments.length} booked
                </Badge>
              </div>
              {todayAppointments.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-6 text-center text-xs italic text-slate-400">
                  No appointments booked for today yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {todayAppointments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs"
                      data-testid={`today-appt-${a.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isBrainWave(a.testType) ? <Brain className="h-3.5 w-3.5 text-violet-600 shrink-0" /> : <Activity className="h-3.5 w-3.5 text-rose-700 shrink-0" />}
                        <span className="font-semibold text-slate-700 shrink-0">{formatTime12(a.scheduledTime)}</span>
                        <span className="truncate text-slate-600">{a.patientName}</span>
                      </div>
                      <Badge className={`shrink-0 text-[9px] ${isBrainWave(a.testType) ? "bg-violet-100 text-violet-700" : "bg-rose-100 text-rose-800"}`}>
                        {isBrainWave(a.testType) ? "BW" : "VW"}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(a)}
                        title="Cancel appointment (then re-book from the call list)"
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                        data-testid={`today-appt-cancel-${a.id}`}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Booking calendar — collapsible */}
            <Card className="rounded-3xl border border-white/60 bg-white/85 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <button
                type="button"
                onClick={() => setBookingPanelOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-5 py-4 text-left"
                data-testid="portal-booking-panel-toggle"
              >
                <CalendarPlus className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-800">Booking calendar</span>
                <Badge variant="outline" className="ml-auto rounded-full text-[10px] text-slate-500">
                  {card.facility}
                </Badge>
                {bookingPanelOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {bookingPanelOpen && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4">
                  <MiniCalendar
                    year={calYear}
                    month={calMonth}
                    onPrev={() => { if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); } else setCalMonth((m) => m - 1); }}
                    onNext={() => { if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); } else setCalMonth((m) => m + 1); }}
                    onSelectDay={setSelectedDay}
                    selectedDay={selectedDay}
                    bookedDates={bookedDates}
                    testIdPrefix="portal-cal"
                  />
                  {selectedDay && (
                    <>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-slate-800">
                          {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" })}
                        </h3>
                      </div>
                      <SlotGrid
                        appointments={appointments}
                        selectedDate={selectedDateStr!}
                        onBook={(slot) => { setBookSlot(slot); setBookName(""); setBookLinkedPatient(null); setBookPatientSearch(""); }}
                        onCancel={(appt) => setCancelTarget(appt)}
                        testIdPrefix="portal"
                        availableLabel="Open"
                        bwBadgeLabel="1 hr"
                        vwBadgeLabel="30 min"
                        truncateWidth="max-w-[80px]"
                        scrollToSlot={scrollToSlot}
                      />
                    </>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* ─── RIGHT: Call list ──────────────────────────────────── */}
          <Card className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
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
          </Card>
        </div>

        {/* ── Tasks tile + Urgent panel ───────────────────────────────── */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl" data-testid="portal-tasks-tile">
            <div className="mb-4 flex items-center gap-2">
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
          </Card>

          <Card className="rounded-3xl border border-white/60 bg-white/80 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl" data-testid="portal-urgent-panel">
            <button
              type="button"
              onClick={() => setUrgentPanelOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-5 py-4 text-left"
            >
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold text-slate-800">Urgent requests</span>
              {urgentTasks.length > 0 && (
                <Badge className="rounded-full bg-orange-100 text-orange-700 text-[10px]">{urgentTasks.length}</Badge>
              )}
              <span className="ml-auto text-slate-400">
                {urgentPanelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>
            {urgentPanelOpen && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-3">
                {urgentTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-400">
                    No urgent requests at this time
                  </div>
                ) : (
                  <div className="space-y-3">
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
                )}
              </div>
            )}
          </Card>
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
  scriptOpen: boolean;
  setScriptOpen: (v: boolean) => void;
  onDisposition: () => void;
  onBook: () => void;
  onSkip: () => void;
}) {
  if (!item) {
    return (
      <Card className="rounded-3xl border border-white/60 bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Megaphone className="h-4 w-4 text-indigo-600" />
          Current call
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Pick a patient from the call list to start working through the queue.
        </p>
      </Card>
    );
  }

  const primaryTest = item.qualifyingTests[0];
  const script = primaryTest ? getScriptForTest(primaryTest) : null;
  return (
    <Card className="rounded-3xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-5 shadow-[0_18px_60px_rgba(79,70,229,0.18)] backdrop-blur-xl" data-testid="current-call-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
        <Megaphone className="h-3.5 w-3.5" />
        Current call
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-semibold text-slate-900">{item.patientName}</h2>
        <Badge className={`rounded-full border text-[10px] ${statusBadgeClass(item.appointmentStatus)}`}>
          {statusLabel(item.appointmentStatus)}
        </Badge>
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
      <div className="mt-4 flex flex-wrap gap-2 border-t border-indigo-100 pt-3">
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
    </Card>
  );
}

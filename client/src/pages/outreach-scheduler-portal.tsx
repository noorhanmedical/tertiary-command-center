import { useState, useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Brain,
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  X,
  Phone,
  Clock3,
  Building2,
  Stethoscope,
  CheckCircle2,
  PhoneMissed,
  PhoneCall,
  CalendarCheck,
  XCircle,
  RotateCcw,
  MessageSquare,
  Save,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import type { AncillaryAppointment } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

const FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;
type Facility = (typeof FACILITIES)[number];

type BookingSlot = { time: string; testType: "BrainWave" | "VitalWave" };

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
};

type OutreachSchedulerCard = {
  id: string;
  name: string;
  facility: string;
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

// ─── Calendar helpers ──────────────────────────────────────────────────────────

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function generateBrainWaveSlots(): string[] {
  const s: string[] = [];
  for (let h = 8; h <= 16; h++) s.push(`${String(h).padStart(2, "0")}:00`);
  return s;
}

function generateVitalWaveSlots(): string[] {
  const s: string[] = [];
  for (let h = 8; h <= 16; h++) {
    s.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 16) s.push(`${String(h).padStart(2, "0")}:30`);
  }
  s.push("16:30");
  return s;
}

const BW_SLOTS = generateBrainWaveSlots();
const VW_SLOTS = generateVitalWaveSlots();

function isBrainWave(t: string) { return t.toLowerCase().includes("brain"); }
function isVitalWave(t: string) { return t.toLowerCase().includes("vital"); }

// ─── Outcome helpers ───────────────────────────────────────────────────────────

const CALL_OUTCOMES = [
  { value: "no_answer",  label: "No Answer", Icon: PhoneMissed,  color: "bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200" },
  { value: "callback",   label: "Callback",  Icon: PhoneCall,    color: "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200" },
  { value: "scheduled",  label: "Scheduled", Icon: CalendarCheck, color: "bg-green-50 text-green-700 hover:bg-green-100 border-green-200" },
  { value: "declined",   label: "Declined",  Icon: XCircle,      color: "bg-red-50 text-red-600 hover:bg-red-100 border-red-200" },
] as const;

function statusBadgeClass(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n.includes("scheduled") || n.includes("booked")) return "bg-green-100 text-green-700 border-green-200";
  if (n.includes("complete")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (n.includes("cancel") || n.includes("declined")) return "bg-red-100 text-red-700 border-red-200";
  if (n === "no_answer") return "bg-slate-100 text-slate-600 border-slate-200";
  if (n === "callback") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

function statusLabel(status?: string | null) {
  const n = String(status || "pending").toLowerCase();
  if (n === "no_answer") return "No Answer";
  if (n === "callback") return "Callback";
  return status || "Pending";
}

// ─── MiniCalendar ─────────────────────────────────────────────────────────────

function MiniCalendar({
  year, month, onPrev, onNext, onSelectDay, selectedDay, bookedDates,
}: {
  year: number; month: number;
  onPrev: () => void; onNext: () => void;
  onSelectDay: (d: number) => void;
  selectedDay: number | null;
  bookedDates: Set<string>;
}) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" onClick={onPrev} className="h-7 w-7 p-0" data-testid="portal-cal-prev">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-semibold text-slate-800">{MONTHS[month]} {year}</span>
        <Button variant="ghost" size="sm" onClick={onNext} className="h-7 w-7 p-0" data-testid="portal-cal-next">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = toDateKey(year, month, d);
          const isToday = key === todayKey;
          const isSelected = d === selectedDay;
          const hasBooking = bookedDates.has(key);
          return (
            <button
              key={i}
              onClick={() => onSelectDay(d)}
              data-testid={`portal-cal-day-${d}`}
              className={`relative flex flex-col items-center justify-center h-8 w-full rounded text-xs font-medium transition-colors
                ${isSelected ? "bg-primary text-white" : isToday ? "bg-primary/10 text-primary font-bold" : "hover:bg-slate-100 text-slate-700"}`}
            >
              {d}
              {hasBooking && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-primary"}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── SlotGrid ─────────────────────────────────────────────────────────────────

function SlotGrid({
  appointments, selectedDate,
  onBook, onCancel,
}: {
  appointments: AncillaryAppointment[];
  selectedDate: string;
  onBook: (slot: BookingSlot) => void;
  onCancel: (appt: AncillaryAppointment) => void;
}) {
  const bookedBW = new Map<string, AncillaryAppointment>();
  const bookedVW = new Map<string, AncillaryAppointment>();
  for (const a of appointments) {
    if (a.scheduledDate !== selectedDate || a.status !== "scheduled") continue;
    if (isVitalWave(a.testType)) bookedVW.set(a.scheduledTime, a);
    else bookedBW.set(a.scheduledTime, a);
  }

  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700">BrainWave</span>
          <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700">1 hr</Badge>
        </div>
        <div className="space-y-1">
          {BW_SLOTS.map((slot) => {
            const appt = bookedBW.get(slot);
            return (
              <div
                key={slot}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                  ${appt ? "bg-violet-50 border-violet-200" : "bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "BrainWave" })}
                data-testid={`portal-slot-bw-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-violet-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className="text-violet-800 font-semibold truncate max-w-[80px]">{appt.patientName}</span>
                    <button onClick={(e) => { e.stopPropagation(); onCancel(appt); }} className="text-red-400 hover:text-red-600" data-testid={`portal-cancel-bw-${appt.id}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">Open</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-red-500" />
          <span className="text-sm font-semibold text-red-600">VitalWave</span>
          <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-600">30 min</Badge>
        </div>
        <div className="space-y-1">
          {VW_SLOTS.map((slot) => {
            const appt = bookedVW.get(slot);
            return (
              <div
                key={slot}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                  ${appt ? "bg-red-50 border-red-200" : "bg-white border-slate-200 hover:border-red-300 hover:bg-red-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "VitalWave" })}
                data-testid={`portal-slot-vw-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-red-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className="text-red-800 font-semibold truncate max-w-[80px]">{appt.patientName}</span>
                    <button onClick={(e) => { e.stopPropagation(); onCancel(appt); }} className="text-red-400 hover:text-red-600" data-testid={`portal-cancel-vw-${appt.id}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">Open</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OutreachSchedulerPortalPage() {
  const params = useParams<{ id: string }>();
  const schedulerId = params.id ?? "";

  // Calendar state
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [bookSlot, setBookSlot] = useState<BookingSlot | null>(null);
  const [bookName, setBookName] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AncillaryAppointment | null>(null);

  // Call list state
  const [search, setSearch] = useState("");
  const [pendingPatientId, setPendingPatientId] = useState<number | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [noteDrafts, setNoteDrafts] = useState<Map<number, string>>(new Map());

  const { toast } = useToast();
  const queryClientLocal = useQueryClient();

  // Outreach dashboard (for call list)
  const { data: dashboard, isLoading } = useQuery<OutreachDashboard>({
    queryKey: ["/api/outreach/dashboard"],
    refetchInterval: 60_000,
  });

  const card = useMemo(
    () => dashboard?.schedulerCards.find((c) => c.id === schedulerId) ?? null,
    [dashboard, schedulerId],
  );

  const facility = card?.facility as Facility | undefined;

  // Appointments (for calendar)
  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility!)}`, { headers });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!facility,
    refetchInterval: 30_000,
  });

  // Book appointment
  const bookMutation = useMutation({
    mutationFn: async ({ patientName, testType, scheduledTime }: { patientName: string; testType: string; scheduledTime: string }) => {
      const scheduledDate = toDateKey(calYear, calMonth, selectedDay!);
      const res = await apiRequest("POST", "/api/appointments", { patientName, facility, scheduledDate, scheduledTime, testType });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to book"); }
      return res.json();
    },
    onSuccess: () => {
      queryClientLocal.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Appointment booked" });
      setBookSlot(null);
      setBookName("");
    },
    onError: (e: Error) => toast({ title: "Booking failed", description: e.message, variant: "destructive" }),
  });

  // Cancel appointment
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

  // Update call status
  const updateStatusMutation = useMutation({
    mutationFn: ({ patientId, appointmentStatus }: { patientId: number; appointmentStatus: string }) =>
      apiRequest("PATCH", `/api/patients/${patientId}`, { appointmentStatus }),
    onMutate: ({ patientId }) => setPendingPatientId(patientId),
    onError: () => toast({ title: "Update failed", description: "Could not save the call outcome.", variant: "destructive" }),
    onSettled: () => {
      setPendingPatientId(null);
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
    },
  });

  // Save note
  const saveNoteMutation = useMutation({
    mutationFn: ({ patientId, notes }: { patientId: number; notes: string }) =>
      apiRequest("PATCH", `/api/patients/${patientId}`, { notes }),
    onSuccess: (_data, { patientId }) => {
      toast({ title: "Note saved" });
      setExpandedNotes((prev) => { const n = new Set(prev); n.delete(patientId); return n; });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
    },
    onError: () => toast({ title: "Save failed", description: "Could not save the note.", variant: "destructive" }),
  });

  function toggleNotes(patientId: number, existingNote: string | null) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) {
        next.delete(patientId);
        setNoteDrafts((d) => { const nd = new Map(d); nd.delete(patientId); return nd; });
      } else {
        next.add(patientId);
        setNoteDrafts((d) => { const nd = new Map(d); nd.set(patientId, existingNote ?? ""); return nd; });
      }
      return next;
    });
  }

  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate),
  );

  const selectedDateStr = selectedDay ? toDateKey(calYear, calMonth, selectedDay) : null;
  const dayAppointments = selectedDateStr
    ? appointments.filter((a) => a.scheduledDate === selectedDateStr && a.status === "scheduled")
    : [];

  const filteredCallList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = card?.callList ?? [];
    if (!q) return list;
    return list.filter(
      (item) =>
        item.patientName.toLowerCase().includes(q) ||
        item.facility.toLowerCase().includes(q) ||
        item.providerName.toLowerCase().includes(q) ||
        item.qualifyingTests.join(" ").toLowerCase().includes(q),
    );
  }, [search, card]);

  // Loading / not found states
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

  return (
    <div className="min-h-full flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,1)_40%,_rgba(239,246,255,0.92)_100%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-6 py-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" className="rounded-2xl border-white/60 bg-white/80 backdrop-blur">
              <Link href="/outreach"><ArrowLeft className="mr-2 h-4 w-4" />Back to Outreach</Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <div className="rounded-2xl bg-violet-600/10 p-2 text-violet-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{card.name}</h1>
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                  {card.facility}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {card.totalPatients} patient{card.totalPatients !== 1 ? "s" : ""} today · {card.touchedCount} calls worked · {card.conversionRate}% conversion
              </p>
            </div>
          </div>
        </div>

        {/* Two-panel layout */}
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">

          {/* ── Left: Calendar panel ─────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Mini calendar */}
            <Card className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              <div className="mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-800">Schedule Appointment</h2>
                <Badge variant="outline" className="ml-auto rounded-full text-[10px] text-slate-500">
                  {card.facility}
                </Badge>
              </div>
              <MiniCalendar
                year={calYear}
                month={calMonth}
                onPrev={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
                  else setCalMonth((m) => m - 1);
                }}
                onNext={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
                  else setCalMonth((m) => m + 1);
                }}
                onSelectDay={setSelectedDay}
                selectedDay={selectedDay}
                bookedDates={bookedDates}
              />
              {selectedDateStr && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs text-slate-500">Appointments on selected day</p>
                  {dayAppointments.length === 0 ? (
                    <p className="text-xs italic text-slate-400">No appointments scheduled</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dayAppointments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                          <div>
                            <span className="font-semibold text-slate-700">{formatTime12(a.scheduledTime)}</span>
                            <span className="ml-1.5 text-slate-500">{a.patientName}</span>
                          </div>
                          <Badge variant="secondary" className={`text-[9px] ${isBrainWave(a.testType) ? "bg-violet-100 text-violet-700" : "bg-red-100 text-red-600"}`}>
                            {isBrainWave(a.testType) ? "BW" : "VW"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Slot grid */}
            <Card className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
              {!selectedDay ? (
                <div className="flex h-28 flex-col items-center justify-center gap-2 text-slate-400">
                  <Calendar className="h-7 w-7 opacity-40" />
                  <p className="text-sm">Select a day to view slots</p>
                </div>
              ) : (
                <>
                  <div className="mb-1 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-slate-800">
                      {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" })}
                    </h3>
                  </div>
                  <p className="mb-4 text-xs text-slate-500">Click a slot to book · <X className="inline h-3 w-3" /> to cancel</p>
                  <SlotGrid
                    appointments={appointments}
                    selectedDate={selectedDateStr!}
                    onBook={(slot) => { setBookSlot(slot); setBookName(""); }}
                    onCancel={(appt) => setCancelTarget(appt)}
                  />
                </>
              )}
            </Card>
          </div>

          {/* ── Right: Call list ─────────────────────────────────────── */}
          <Card className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Call List</h2>
                <p className="text-sm text-slate-500">Provider shown for ancillary order context.</p>
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search patient, clinic, test…"
                  className="rounded-2xl border-white/60 bg-white/90 pl-9"
                  data-testid="portal-search-input"
                />
              </div>
            </div>

            {filteredCallList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
                {search.trim()
                  ? "No patients match this search."
                  : `No patients scheduled for ${card.name} today.`}
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 260px)" }}>
                {filteredCallList.map((item) => {
                  const isBusy = pendingPatientId === item.patientId && updateStatusMutation.isPending;
                  const currentStatus = item.appointmentStatus.toLowerCase();
                  return (
                    <div
                      key={item.id}
                      className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md"
                      data-testid={`portal-call-item-${item.patientId}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-900">{item.patientName}</h3>
                            <Badge className={`rounded-full border text-xs ${statusBadgeClass(item.appointmentStatus)}`} data-testid={`portal-status-badge-${item.patientId}`}>
                              {statusLabel(item.appointmentStatus)}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.time}</span>
                            <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{item.facility}</span>
                            <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{item.phoneNumber}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                          <Stethoscope className="h-3.5 w-3.5" />Provider
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-800">{item.providerName}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-xs text-slate-600">{item.patientType}</Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-xs text-slate-600">{item.insurance}</Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-xs text-slate-600">Batch {item.batchId}</Badge>
                      </div>

                      {item.qualifyingTests.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.qualifyingTests.map((test) => (
                            <Badge key={`${item.id}-${test}`} className="rounded-full bg-blue-50 text-xs text-blue-700 hover:bg-blue-50">{test}</Badge>
                          ))}
                        </div>
                      )}

                      {/* Call outcome actions */}
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Outcome</span>
                        {CALL_OUTCOMES.map(({ value, label, Icon, color }) => {
                          const isActive = currentStatus === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateStatusMutation.mutate({ patientId: item.patientId, appointmentStatus: isActive ? "pending" : value })}
                              className={["inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition", color, isActive ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-80", isBusy ? "cursor-not-allowed opacity-50" : "cursor-pointer"].join(" ")}
                              data-testid={`portal-outcome-${value}-${item.patientId}`}
                            >
                              <Icon className="h-3.5 w-3.5" />{label}
                            </button>
                          );
                        })}
                        {currentStatus !== "pending" && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => updateStatusMutation.mutate({ patientId: item.patientId, appointmentStatus: "pending" })}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 opacity-70 transition hover:bg-slate-50 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                            data-testid={`portal-outcome-reset-${item.patientId}`}
                          >
                            <RotateCcw className="h-3 w-3" />Reset
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleNotes(item.patientId, item.notes)}
                          className={["ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition", expandedNotes.has(item.patientId) ? "border-blue-200 bg-blue-50 text-blue-700" : item.notes ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"].join(" ")}
                          data-testid={`portal-notes-toggle-${item.patientId}`}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {item.notes && !expandedNotes.has(item.patientId) ? "Note" : "Add note"}
                        </button>
                      </div>

                      {expandedNotes.has(item.patientId) && (
                        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Call Note</p>
                          <Textarea
                            value={noteDrafts.get(item.patientId) ?? item.notes ?? ""}
                            onChange={(e) => setNoteDrafts((prev) => { const next = new Map(prev); next.set(item.patientId, e.target.value); return next; })}
                            placeholder="e.g. Left voicemail, patient asked to call back Tuesday…"
                            rows={3}
                            className="resize-none rounded-xl border-blue-200 bg-white text-sm focus-visible:ring-blue-300"
                            data-testid={`portal-notes-textarea-${item.patientId}`}
                          />
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <button type="button" onClick={() => toggleNotes(item.patientId, item.notes)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50" data-testid={`portal-notes-cancel-${item.patientId}`}>Cancel</button>
                            <button
                              type="button"
                              disabled={saveNoteMutation.isPending}
                              onClick={() => saveNoteMutation.mutate({ patientId: item.patientId, notes: (noteDrafts.get(item.patientId) ?? "").trim() })}
                              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                              data-testid={`portal-notes-save-${item.patientId}`}
                            >
                              <Save className="h-3 w-3" />Save note
                            </button>
                          </div>
                        </div>
                      )}

                      {!expandedNotes.has(item.patientId) && item.notes && (
                        <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-xs text-violet-800" data-testid={`portal-notes-preview-${item.patientId}`}>
                          <span className="mr-1 font-medium text-violet-500">Note:</span>{item.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Book dialog */}
      <Dialog open={!!bookSlot} onOpenChange={(open) => !open && setBookSlot(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Book Appointment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              {bookSlot?.testType === "BrainWave" ? <Brain className="h-4 w-4 text-violet-600" /> : <Activity className="h-4 w-4 text-red-500" />}
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
              <Label htmlFor="portal-book-name" className="text-xs font-medium text-slate-700">Patient Name</Label>
              <Input
                id="portal-book-name"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                placeholder="Enter patient name"
                className="mt-1 text-sm"
                data-testid="portal-input-book-name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && bookName.trim() && bookSlot)
                    bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time });
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBookSlot(null)}>Cancel</Button>
            <Button size="sm" disabled={!bookName.trim() || bookMutation.isPending} onClick={() => bookSlot && bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time })} data-testid="portal-button-confirm-book">
              {bookMutation.isPending ? "Booking…" : "Confirm Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Cancel Appointment</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            Cancel <span className="font-semibold">{cancelTarget?.patientName}</span>'s {cancelTarget?.testType} at {cancelTarget ? formatTime12(cancelTarget.scheduledTime) : ""}?
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCancelTarget(null)}>Keep</Button>
            <Button size="sm" variant="destructive" disabled={cancelMutation.isPending} onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)} data-testid="portal-button-confirm-cancel">
              {cancelMutation.isPending ? "Cancelling…" : "Cancel Appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

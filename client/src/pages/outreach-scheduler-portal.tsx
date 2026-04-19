import { useState, useMemo } from "react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

const FACILITIES = VALID_FACILITIES;
type Facility = (typeof VALID_FACILITIES)[number];

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

function formatAppointmentBadge(scheduledDate: string, scheduledTime: string, testType: string): string {
  const [y, m, d] = scheduledDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = formatTime12(scheduledTime);
  const typeLabel = isBrainWave(testType) ? "BrainWave" : "VitalWave";
  return `${dateLabel} · ${timeLabel} · ${typeLabel}`;
}


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
  const [callListBookPatient, setCallListBookPatient] = useState<OutreachCallItem | null>(null);
  const [callListBookTestType, setCallListBookTestType] = useState<"BrainWave" | "VitalWave">("BrainWave");
  const [callListBookTime, setCallListBookTime] = useState<string>("");
  const [scrollToSlot, setScrollToSlot] = useState<{ time: string; testType: string } | null>(null);

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
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!facility,
    refetchInterval: 30_000,
  });

  // Book appointment
  const bookMutation = useMutation({
    mutationFn: async ({ patientName, testType, scheduledTime, patientId }: { patientName: string; testType: string; scheduledTime: string; patientId?: number }) => {
      const scheduledDate = toDateKey(calYear, calMonth, selectedDay!);
      const res = await apiRequest("POST", "/api/appointments", { patientName, facility, scheduledDate, scheduledTime, testType });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to book"); }
      const appt = await res.json();
      let statusUpdateFailed = false;
      if (patientId != null) {
        try {
          await apiRequest("PATCH", `/api/patients/${patientId}`, { appointmentStatus: "scheduled" });
        } catch {
          statusUpdateFailed = true;
        }
      }
      return { appt, statusUpdateFailed };
    },
    onSuccess: ({ statusUpdateFailed }) => {
      queryClientLocal.invalidateQueries({ queryKey: ["/api/appointments"] });
      globalQueryClient.invalidateQueries({ queryKey: ["/api/outreach/dashboard"] });
      if (statusUpdateFailed) {
        toast({ title: "Appointment booked", description: "Could not auto-update call-list status — please mark manually.", variant: "destructive" });
      } else {
        toast({ title: "Appointment booked" });
      }
      setBookSlot(null);
      setBookName("");
      setCallListBookPatient(null);
      setCallListBookTime("");
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

  const appointmentByPatientName = useMemo(() => {
    const map = new Map<string, AncillaryAppointment>();
    for (const a of appointments) {
      if (a.status !== "scheduled") continue;
      const key = a.patientName.trim().toLowerCase();
      if (!map.has(key)) map.set(key, a);
    }
    return map;
  }, [appointments]);

  const bookedCount = useMemo(
    () => filteredCallList.filter((item) => appointmentByPatientName.has(item.patientName.trim().toLowerCase())).length,
    [filteredCallList, appointmentByPatientName],
  );

  const scheduledCallListNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of card?.callList ?? []) {
      if (item.appointmentStatus?.toLowerCase() === "scheduled") {
        names.add(item.patientName.trim().toLowerCase());
      }
    }
    return names;
  }, [card?.callList]);

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
                testIdPrefix="portal-cal"
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
                    testIdPrefix="portal"
                    availableLabel="Open"
                    bwBadgeLabel="1 hr"
                    vwBadgeLabel="30 min"
                    truncateWidth="max-w-[80px]"
                    scrollToSlot={scrollToSlot}
                  />
                </>
              )}
            </Card>
          </div>

          {/* ── Right: Call list ─────────────────────────────────────── */}
          <Card className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">Call List</h2>
                  {bookedCount > 0 && (
                    <span
                      className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      data-testid="call-list-booked-count"
                    >
                      {bookedCount} booked
                    </span>
                  )}
                </div>
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
                  const bookedAppt = appointmentByPatientName.get(item.patientName.trim().toLowerCase()) ?? null;
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
                            {bookedAppt && (
                              <button
                                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                                data-testid={`portal-appt-badge-${item.patientId}`}
                                aria-label={`Jump to booked appointment: ${formatAppointmentBadge(bookedAppt.scheduledDate, bookedAppt.scheduledTime, bookedAppt.testType)}`}
                                onClick={() => {
                                  const [y, mo, d] = bookedAppt.scheduledDate.split("-").map(Number);
                                  setCalYear(y);
                                  setCalMonth(mo - 1);
                                  setSelectedDay(d);
                                  setScrollToSlot({ time: bookedAppt.scheduledTime, testType: bookedAppt.testType });
                                }}
                              >
                                <CalendarCheck className="h-3 w-3 shrink-0" />
                                Booked: {formatAppointmentBadge(bookedAppt.scheduledDate, bookedAppt.scheduledTime, bookedAppt.testType)}
                              </button>
                            )}
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
                        <div className="ml-auto flex items-center gap-2">
                          {currentStatus === "scheduled" ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 cursor-default"
                              title="Already scheduled"
                              data-testid={`portal-book-patient-${item.patientId}`}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />Already Scheduled
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!selectedDay}
                              title={selectedDay ? "Book this patient into a slot" : "Select a day on the calendar first"}
                              onClick={() => {
                                setCallListBookPatient(item);
                                setCallListBookTestType(
                                  item.qualifyingTests.some((t) => isBrainWave(t)) ? "BrainWave" : "VitalWave"
                                );
                                setCallListBookTime("");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
                              data-testid={`portal-book-patient-${item.patientId}`}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />Book
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleNotes(item.patientId, item.notes)}
                            className={["inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition", expandedNotes.has(item.patientId) ? "border-blue-200 bg-blue-50 text-blue-700" : item.notes ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"].join(" ")}
                            data-testid={`portal-notes-toggle-${item.patientId}`}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {item.notes && !expandedNotes.has(item.patientId) ? "Note" : "Add note"}
                          </button>
                        </div>
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
                  if (e.key === "Enter" && bookName.trim() && bookSlot && !scheduledCallListNames.has(bookName.trim().toLowerCase()))
                    bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time });
                }}
              />
            </div>
            {bookName.trim() && scheduledCallListNames.has(bookName.trim().toLowerCase()) && (
              <div
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
                data-testid="portal-book-already-scheduled-warning"
              >
                <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <span className="font-semibold">{bookName.trim()}</span> is already marked as scheduled on the call list. Double-booking is not allowed.
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBookSlot(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!bookName.trim() || bookMutation.isPending || scheduledCallListNames.has(bookName.trim().toLowerCase())}
              onClick={() => bookSlot && bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time })}
              data-testid="portal-button-confirm-book"
            >
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

      {/* Call-list quick-book dialog */}
      {callListBookPatient && (() => {
        const slots = callListBookTestType === "BrainWave" ? BW_SLOTS : VW_SLOTS;
        const bookedTimes = new Set(
          appointments
            .filter((a) => a.scheduledDate === selectedDateStr && a.status === "scheduled" && (callListBookTestType === "BrainWave" ? !isVitalWave(a.testType) : isVitalWave(a.testType)))
            .map((a) => a.scheduledTime)
        );
        return (
          <Dialog open onOpenChange={(open) => !open && setCallListBookPatient(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  <CalendarPlus className="h-4 w-4 text-blue-600" />
                  Book Appointment
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-1">
                {/* Patient name (pre-filled, read-only) */}
                <div>
                  <Label className="text-xs font-medium text-slate-700">Patient</Label>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800" data-testid="portal-callbook-patient-name">
                    {callListBookPatient.patientName}
                  </div>
                </div>

                {/* Date */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar className="h-3.5 w-3.5" />
                  <span data-testid="portal-callbook-date">
                    {selectedDay
                      ? new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                      : "No date selected"}
                  </span>
                  <span className="text-slate-300">·</span>
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{facility}</span>
                </div>

                {/* Test type toggle */}
                <div>
                  <Label className="text-xs font-medium text-slate-700">Test Type</Label>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setCallListBookTestType("BrainWave"); setCallListBookTime(""); }}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${callListBookTestType === "BrainWave" ? "border-violet-300 bg-violet-100 text-violet-700 ring-2 ring-violet-300 ring-offset-1" : "border-slate-200 bg-white text-slate-500 hover:bg-violet-50"}`}
                      data-testid="portal-callbook-type-brainwave"
                    >
                      <Brain className="h-3.5 w-3.5" />BrainWave
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCallListBookTestType("VitalWave"); setCallListBookTime(""); }}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${callListBookTestType === "VitalWave" ? "border-red-300 bg-red-100 text-red-600 ring-2 ring-red-300 ring-offset-1" : "border-slate-200 bg-white text-slate-500 hover:bg-red-50"}`}
                      data-testid="portal-callbook-type-vitalwave"
                    >
                      <Activity className="h-3.5 w-3.5" />VitalWave
                    </button>
                  </div>
                </div>

                {/* Time slot picker */}
                <div>
                  <Label className="text-xs font-medium text-slate-700">Time Slot</Label>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {slots.map((slot) => {
                      const isBooked = bookedTimes.has(slot);
                      const isSelected = callListBookTime === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          disabled={isBooked}
                          onClick={() => setCallListBookTime(slot)}
                          className={`rounded-lg border py-1.5 text-xs font-medium transition ${isBooked ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300" : isSelected ? "border-blue-400 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50"}`}
                          data-testid={`portal-callbook-slot-${slot}`}
                        >
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
                  onClick={() => bookMutation.mutate({
                    patientName: callListBookPatient.patientName,
                    testType: callListBookTestType,
                    scheduledTime: callListBookTime,
                    patientId: callListBookPatient.patientId,
                  })}
                  data-testid="portal-callbook-confirm"
                >
                  {bookMutation.isPending ? "Booking…" : "Confirm Booking"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

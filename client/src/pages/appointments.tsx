import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  MapPin,
  X,
  Brain,
  Activity,
  Plus,
} from "lucide-react";
import type { AncillaryAppointment } from "@shared/schema";
import { Link } from "wouter";

const FACILITIES = ["Taylor Family Practice", "NWPG - Spring", "NWPG - Veterans"] as const;
type Facility = typeof FACILITIES[number];

const ALL_TESTS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Stress Echocardiogram",
  "Lower Extremity Venous Duplex",
  "Upper Extremity Venous Duplex",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Upper Extremity Arterial Doppler",
  "Abdominal Aortic Aneurysm Duplex",
];

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function generateBrainWaveSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 16; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

function generateVitalWaveSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 16; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 16) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  slots.push("16:30");
  return slots;
}

const BRAINWAVE_SLOTS = generateBrainWaveSlots();
const VITALWAVE_SLOTS = generateVitalWaveSlots();

function getTestSlots(testType: string): string[] {
  if (testType === "VitalWave") return VITALWAVE_SLOTS;
  if (testType === "BrainWave") return BRAINWAVE_SLOTS;
  return BRAINWAVE_SLOTS;
}

function isBrainWave(t: string) { return t.toLowerCase().includes("brain"); }
function isVitalWave(t: string) { return t.toLowerCase().includes("vital"); }

type BookingSlot = { time: string; testType: "BrainWave" | "VitalWave" };

function MiniCalendar({
  year,
  month,
  onPrev,
  onNext,
  onSelectDay,
  selectedDay,
  bookedDates,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (d: number) => void;
  selectedDay: number | null;
  bookedDates: Set<string>;
}) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" onClick={onPrev} className="h-7 w-7 p-0" data-testid="cal-prev">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-semibold text-slate-800">{monthNames[month]} {year}</span>
        <Button variant="ghost" size="sm" onClick={onNext} className="h-7 w-7 p-0" data-testid="cal-next">
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
              data-testid={`cal-day-${d}`}
              className={`relative flex flex-col items-center justify-center h-8 w-full rounded text-xs font-medium transition-colors
                ${isSelected ? "bg-primary text-white" : isToday ? "bg-primary/10 text-primary font-bold" : "hover:bg-slate-100 text-slate-700"}
              `}
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

type SlotGridProps = {
  appointments: AncillaryAppointment[];
  selectedDate: string;
  facility: Facility;
  onBook: (slot: BookingSlot) => void;
  onCancel: (appt: AncillaryAppointment) => void;
};

function SlotGrid({ appointments, selectedDate, facility: _facility, onBook, onCancel }: SlotGridProps) {
  const bookedBW = new Map<string, AncillaryAppointment>();
  const bookedVW = new Map<string, AncillaryAppointment>();
  for (const a of appointments) {
    if (a.scheduledDate !== selectedDate) continue;
    if (a.status !== "scheduled") continue;
    if (isVitalWave(a.testType)) bookedVW.set(a.scheduledTime, a);
    else bookedBW.set(a.scheduledTime, a);
  }

  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700">BrainWave</span>
          <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700">1 hr slots</Badge>
        </div>
        <div className="space-y-1">
          {BRAINWAVE_SLOTS.map((slot) => {
            const appt = bookedBW.get(slot);
            return (
              <div key={slot} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                ${appt ? "bg-violet-50 border-violet-200" : "bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "BrainWave" })}
                data-testid={`slot-brainwave-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-violet-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className="text-violet-800 font-semibold truncate max-w-[100px]">{appt.patientName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancel(appt); }}
                      className="text-red-400 hover:text-red-600 ml-1"
                      data-testid={`cancel-appt-${appt.id}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">Available</span>
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
          <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-600">30 min slots</Badge>
        </div>
        <div className="space-y-1">
          {VITALWAVE_SLOTS.map((slot) => {
            const appt = bookedVW.get(slot);
            return (
              <div key={slot} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                ${appt ? "bg-red-50 border-red-200" : "bg-white border-slate-200 hover:border-red-300 hover:bg-red-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "VitalWave" })}
                data-testid={`slot-vitalwave-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-red-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className="text-red-800 font-semibold truncate max-w-[100px]">{appt.patientName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancel(appt); }}
                      className="text-red-400 hover:text-red-600 ml-1"
                      data-testid={`cancel-appt-${appt.id}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">Available</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ClinicTab({ facility }: { facility: Facility }) {
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [bookSlot, setBookSlot] = useState<BookingSlot | null>(null);
  const [bookName, setBookName] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AncillaryAppointment | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility)}`, { headers });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const bookMutation = useMutation({
    mutationFn: async ({ patientName, testType, scheduledTime }: { patientName: string; testType: string; scheduledTime: string }) => {
      const scheduledDate = toDateKey(calYear, calMonth, selectedDay!);
      const res = await apiRequest("POST", "/api/appointments", {
        patientName,
        facility,
        scheduledDate,
        scheduledTime,
        testType,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to book");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Appointment booked" });
      setBookSlot(null);
      setBookName("");
    },
    onError: (e: Error) => {
      toast({ title: "Booking failed", description: e.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}`, { status: "cancelled" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Appointment cancelled" });
      setCancelTarget(null);
    },
    onError: (e: Error) => {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    },
  });

  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate)
  );

  const selectedDateStr = selectedDay ? toDateKey(calYear, calMonth, selectedDay) : null;
  const dayAppointments = selectedDateStr
    ? appointments.filter((a) => a.scheduledDate === selectedDateStr && a.status === "scheduled")
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
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
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-2">Appointments on selected day</p>
            {dayAppointments.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No appointments scheduled</p>
            ) : (
              <div className="space-y-1.5">
                {dayAppointments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <div>
                      <span className="font-semibold text-slate-700">{formatTime12(a.scheduledTime)}</span>
                      <span className="text-slate-500 ml-1.5">{a.patientName}</span>
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
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        {!selectedDay ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <Calendar className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Select a day to view slots</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-slate-800">
                {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">Click an available slot to book. Click <X className="inline w-3 h-3" /> to cancel.</p>
            <SlotGrid
              appointments={appointments}
              selectedDate={selectedDateStr!}
              facility={facility}
              onBook={(slot) => { setBookSlot(slot); setBookName(""); }}
              onCancel={(appt) => setCancelTarget(appt)}
            />
          </>
        )}
      </div>

      <Dialog open={!!bookSlot} onOpenChange={(open) => !open && setBookSlot(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Book Appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              {bookSlot?.testType === "BrainWave" ? <Brain className="w-4 h-4 text-violet-600" /> : <Activity className="w-4 h-4 text-red-500" />}
              <span className="font-medium">{bookSlot?.testType}</span>
              <span className="text-slate-400">·</span>
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{bookSlot ? formatTime12(bookSlot.time) : ""}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <MapPin className="w-3.5 h-3.5" />
              <span>{facility}</span>
              <span className="text-slate-400">·</span>
              <Calendar className="w-3.5 h-3.5" />
              <span>{selectedDay ? new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
            </div>
            <div>
              <Label htmlFor="book-name" className="text-xs font-medium text-slate-700">Patient Name</Label>
              <Input
                id="book-name"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                placeholder="Enter patient name"
                className="mt-1 text-sm"
                data-testid="input-book-patient-name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && bookName.trim() && bookSlot) {
                    bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time });
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBookSlot(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!bookName.trim() || bookMutation.isPending}
              onClick={() => bookSlot && bookMutation.mutate({ patientName: bookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time })}
              data-testid="button-confirm-book"
            >
              {bookMutation.isPending ? "Booking…" : "Confirm Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Cancel Appointment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Cancel <span className="font-semibold">{cancelTarget?.patientName}</span>'s {cancelTarget?.testType} at {cancelTarget ? formatTime12(cancelTarget.scheduledTime) : ""}?
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCancelTarget(null)}>Keep</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={cancelMutation.isPending}
              onClick={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
              data-testid="button-confirm-cancel"
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel Appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AppointmentsPage() {
  const [activeTab, setActiveTab] = useState<Facility>("Taylor Family Practice");

  return (
    <div className="min-h-screen bg-[hsl(210,35%,96%)]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Ancillary Appointments</h1>
              <p className="text-xs text-slate-500">Schedule BrainWave and VitalWave appointments by clinic</p>
            </div>
          </div>
          <Link href="/" data-testid="link-back-home">
            <Button variant="ghost" size="sm" className="text-slate-600 gap-1.5">
              <ChevronLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>

        <div className="flex gap-1 mb-6 bg-white rounded-xl border border-slate-200 p-1 w-fit shadow-sm">
          {FACILITIES.map((f) => (
            <button
              key={f}
              onClick={() => setActiveTab(f)}
              data-testid={`tab-facility-${f.replace(/\s+/g, "-").toLowerCase()}`}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === f
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <ClinicTab key={activeTab} facility={activeTab} />
      </div>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { AncillaryAppointment, PatientScreening } from "@shared/schema";
import { ANCILLARY_TESTS } from "@shared/plexus";
import { getTestPalette } from "@/lib/testColors";

const ALL_AVAILABLE_TESTS: string[] = [...ANCILLARY_TESTS];

interface AppointmentModalProps {
  patient: PatientScreening;
  onClose: () => void;
  defaultDate?: string;
}

export function AppointmentModal({ patient, onClose, defaultDate }: AppointmentModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initFromDefault = (dateStr?: string) => {
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return { year: y, month: (m ?? 1) - 1, day: d ?? null };
    }
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth(), day: null };
  };

  const init = initFromDefault(defaultDate);
  const [calYear, setCalYear] = useState(init.year);
  const [calMonth, setCalMonth] = useState(init.month);
  const [selectedDay, setSelectedDay] = useState<number | null>(init.day);
  const [selectedTestType, setSelectedTestType] = useState<string>(() => {
    const qt = patient.qualifyingTests || [];
    if ((qt as string[]).includes("BrainWave")) return "BrainWave";
    if ((qt as string[]).includes("VitalWave")) return "VitalWave";
    return "BrainWave";
  });

  const facility = (patient.facility as string) || "Taylor Family Practice";

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/patient/${patient.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const bookMutation = useMutation({
    mutationFn: async ({ scheduledTime }: { scheduledTime: string }) => {
      const scheduledDate = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay!).padStart(2, "0")}`;
      const res = await apiRequest("POST", "/api/appointments", {
        patientScreeningId: patient.id,
        patientName: patient.name,
        facility,
        scheduledDate,
        scheduledTime,
        testType: selectedTestType,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to book");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/patient", patient.id] });
      toast({ title: "Appointment booked!", description: `${patient.name} scheduled for ${selectedTestType}` });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "Booking failed", description: e.message, variant: "destructive" });
    },
  });

  const isVW = selectedTestType === "VitalWave";
  const slots = isVW
    ? (() => { const s: string[] = []; for (let h = 8; h <= 16; h++) { s.push(`${String(h).padStart(2, "0")}:00`); if (h < 16) s.push(`${String(h).padStart(2, "0")}:30`); } s.push("16:30"); return s; })()
    : (() => { const s: string[] = []; for (let h = 8; h <= 16; h++) { s.push(`${String(h).padStart(2, "0")}:00`); } return s; })();

  const selectedDateStr = selectedDay
    ? `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;

  const bookedSlots = new Set(
    appointments
      .filter((a) => {
        if (a.scheduledDate !== selectedDateStr || a.status !== "scheduled") return false;
        const aIsVW = a.testType === "VitalWave";
        return aIsVW === isVW;
      })
      .map((a) => a.scheduledTime)
  );

  const bookedDates = new Set<string>(
    appointments.filter((a) => a.status === "scheduled").map((a) => a.scheduledDate)
  );

  function fmt12(time24: string) {
    const [h, m] = time24.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  }

  function fmtDate(dateStr: string) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const palette = getTestPalette(selectedTestType);

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
  const todayKey = new Date().toISOString().split("T")[0];
  type Cell = { day: number; outside: boolean };
  const cells: Cell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: prevMonthDays - i, outside: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, outside: false });
  let nextDay = 1;
  while (cells.length % 7 !== 0) cells.push({ day: nextDay++, outside: true });

  const scheduledForThisPatient = patientAppts.filter((a) => a.status === "scheduled");

  const availTests = patient.qualifyingTests && (patient.qualifyingTests as string[]).length > 0
    ? (patient.qualifyingTests as string[])
    : ALL_AVAILABLE_TESTS;

  const defaultDateKey = defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Schedule Appointment — {patient.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {defaultDateKey && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                Appointment date defaults to <strong>schedule date ({fmtDate(defaultDateKey)})</strong>. You may select a different date if needed.
              </p>
            </div>
          )}

          {scheduledForThisPatient.length > 0 && (
            <div className="bg-primary/5 rounded-lg px-3 py-2 border border-primary/20">
              <p className="text-xs font-semibold text-primary mb-1.5">Existing appointments</p>
              <div className="space-y-1">
                {scheduledForThisPatient.map((a) => (
                  <div key={a.id} className="text-xs text-slate-600 flex items-center gap-2">
                    <Badge variant="secondary" className="text-[9px]">{a.testType}</Badge>
                    <span>{new Date(a.scheduledDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span>{fmt12(a.scheduledTime)}</span>
                    <span className="text-slate-400">{a.facility}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Test Type</label>
              <Select value={selectedTestType} onValueChange={setSelectedTestType}>
                <SelectTrigger className="text-sm" data-testid="select-modal-test-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availTests.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Facility</label>
              <div className="text-sm text-slate-600 px-3 py-2 bg-slate-50 rounded-md border border-slate-200">{facility}</div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6">
            <div className="text-sm font-semibold text-slate-900 mb-4">Select Appointment Date</div>
            <div className="flex items-center justify-between mb-3">
              <Button variant="ghost" size="icon" onClick={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
                else setCalMonth((m) => m - 1);
              }} className="h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100" data-testid="modal-cal-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-base font-semibold text-slate-900 tracking-tight">{monthNames[calMonth]} {calYear}</span>
              <Button variant="ghost" size="icon" onClick={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
                else setCalMonth((m) => m + 1);
              }} className="h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100" data-testid="modal-cal-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {dayLabels.map((d) => (
                <div key={d} className="text-center text-[11px] font-medium uppercase tracking-wider text-slate-400 py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell, i) => {
                if (cell.outside) {
                  return (
                    <div key={i} className="h-11 flex items-center justify-center text-sm text-slate-300 select-none">
                      {cell.day}
                    </div>
                  );
                }
                const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
                const isToday = key === todayKey;
                const isScheduleDate = key === defaultDateKey;
                const isSel = cell.day === selectedDay;
                const hasBooking = bookedDates.has(key);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDay(cell.day)}
                    data-testid={`modal-cal-day-${cell.day}`}
                    className={[
                      "relative h-11 w-full rounded-2xl text-sm font-medium transition-colors flex items-center justify-center",
                      isSel
                        ? `${palette.selectedBg} ${palette.selectedText} shadow-sm`
                        : isScheduleDate
                          ? "bg-slate-100 text-slate-900 ring-1 ring-slate-300"
                          : isToday
                            ? "text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100"
                            : "text-slate-800 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {cell.day}
                    {hasBooking && (
                      <span className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSel ? "bg-white/90" : palette.dotBg}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {selectedDay ? (
              <div className="mt-6 pt-5 border-t border-slate-200">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">Available Time Slots</div>
                  <div className="text-xs text-slate-500">
                    {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {selectedTestType}
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {slots.map((slot) => {
                    const isBooked = bookedSlots.has(slot);
                    return (
                      <button
                        key={slot}
                        disabled={isBooked || bookMutation.isPending}
                        onClick={() => !isBooked && bookMutation.mutate({ scheduledTime: slot })}
                        data-testid={`modal-slot-${slot}`}
                        className={[
                          "h-12 px-3 rounded-xl border text-sm font-medium transition-colors",
                          isBooked
                            ? "bg-slate-50 border-slate-200 text-slate-400 line-through cursor-not-allowed"
                            : `bg-white border-slate-200 ${palette.hoverBorder} ${palette.hoverBg} text-slate-800 cursor-pointer`,
                        ].join(" ")}
                      >
                        {fmt12(slot)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-6 pt-5 border-t border-slate-200 flex flex-col items-center justify-center text-slate-400 text-sm py-6">
                <Calendar className="w-8 h-8 mb-2 opacity-30" />
                Pick a date to see available time slots
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

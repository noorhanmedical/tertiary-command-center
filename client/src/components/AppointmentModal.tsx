import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import type { AncillaryAppointment, PatientScreening } from "@shared/schema";
import { ANCILLARY_TESTS } from "@shared/plexus";

const ALL_AVAILABLE_TESTS: string[] = [...ANCILLARY_TESTS];

export function AppointmentModal({ patient, onClose }: { patient: PatientScreening; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedTestType, setSelectedTestType] = useState<string>(() => {
    const qt = patient.qualifyingTests || [];
    if (qt.includes("BrainWave")) return "BrainWave";
    if (qt.includes("VitalWave")) return "VitalWave";
    return "BrainWave";
  });

  const facility = (patient.facility as string) || "Taylor Family Practice";

  const { data: appointments = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments", facility],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments?facility=${encodeURIComponent(facility)}`, { headers });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: patientAppts = [] } = useQuery<AncillaryAppointment[]>({
    queryKey: ["/api/appointments/patient", patient.id],
    queryFn: async () => {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api/appointments/patient/${patient.id}`, { headers });
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

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const scheduledForThisPatient = patientAppts.filter((a) => a.status === "scheduled");

  const availTests = patient.qualifyingTests && (patient.qualifyingTests as string[]).length > 0
    ? (patient.qualifyingTests as string[])
    : ALL_AVAILABLE_TESTS;

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <Button variant="ghost" size="sm" onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
                  else setCalMonth((m) => m - 1);
                }} className="h-7 w-7 p-0" data-testid="modal-cal-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm font-semibold text-slate-800">{monthNames[calMonth]} {calYear}</span>
                <Button variant="ghost" size="sm" onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
                  else setCalMonth((m) => m + 1);
                }} className="h-7 w-7 p-0" data-testid="modal-cal-next">
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
                  const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  const isToday = key === todayKey;
                  const isSel = d === selectedDay;
                  const hasBooking = bookedDates.has(key);
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(d)}
                      data-testid={`modal-cal-day-${d}`}
                      className={`relative flex flex-col items-center justify-center h-8 w-full rounded text-xs font-medium transition-colors
                        ${isSel ? "bg-primary text-white" : isToday ? "bg-primary/10 text-primary font-bold" : "hover:bg-slate-100 text-slate-700"}`}
                    >
                      {d}
                      {hasBooking && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSel ? "bg-white" : "bg-primary"}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              {!selectedDay ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                  <Calendar className="w-8 h-8 mb-2 opacity-30" />
                  Select a day
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-2">
                    {new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — {selectedTestType} slots
                  </p>
                  <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                    {slots.map((slot) => {
                      const isBooked = bookedSlots.has(slot);
                      return (
                        <button
                          key={slot}
                          disabled={isBooked || bookMutation.isPending}
                          onClick={() => !isBooked && bookMutation.mutate({ scheduledTime: slot })}
                          data-testid={`modal-slot-${slot}`}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                            ${isBooked
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-white border-slate-200 hover:border-primary hover:bg-primary/5 cursor-pointer text-slate-700"}`}
                        >
                          <span className="font-medium">{fmt12(slot)}</span>
                          <span className={isBooked ? "text-slate-400" : "text-slate-400 text-[10px]"}>
                            {isBooked ? "Booked" : "Available"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import {
  Activity, Brain, Calendar, CalendarCheck, CalendarPlus, Clock, MapPin, Search, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AncillaryAppointment } from "@shared/schema";
import {
  formatTime12, isVitalWave,
  BRAINWAVE_SLOTS as BW_SLOTS, VITALWAVE_SLOTS as VW_SLOTS,
} from "@/components/clinic-calendar";
import type { BookingSlot } from "@/components/clinic-calendar";
import type { OutreachCallItem } from "./types";

type BookMutate = (args: { patientName: string; testType: "BrainWave" | "VitalWave"; scheduledTime: string; patientId?: number }) => void;

export function SlotBookingDialog({
  bookSlot, setBookSlot, bookLinkedPatient, setBookLinkedPatient,
  bookPatientSearch, setBookPatientSearch, bookPatientResults,
  bookName, setBookName, effectiveBookName, scheduledCallListNames,
  facility, calYear, calMonth, selectedDay, isPending, onConfirm,
}: {
  bookSlot: BookingSlot | null;
  setBookSlot: (s: BookingSlot | null) => void;
  bookLinkedPatient: OutreachCallItem | null;
  setBookLinkedPatient: (p: OutreachCallItem | null) => void;
  bookPatientSearch: string;
  setBookPatientSearch: (s: string) => void;
  bookPatientResults: OutreachCallItem[];
  bookName: string;
  setBookName: (n: string) => void;
  effectiveBookName: string;
  scheduledCallListNames: Set<string>;
  facility: string | undefined;
  calYear: number;
  calMonth: number;
  selectedDay: number | null;
  isPending: boolean;
  onConfirm: BookMutate;
}) {
  return (
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
            disabled={!effectiveBookName.trim() || isPending || scheduledCallListNames.has(effectiveBookName.trim().toLowerCase())}
            onClick={() => bookSlot && onConfirm({ patientName: effectiveBookName.trim(), testType: bookSlot.testType, scheduledTime: bookSlot.time, patientId: bookLinkedPatient?.patientId })}
          >
            {isPending ? "Booking…" : "Confirm booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelAppointmentDialog({
  cancelTarget, setCancelTarget, isPending, onConfirm,
}: {
  cancelTarget: AncillaryAppointment | null;
  setCancelTarget: (a: AncillaryAppointment | null) => void;
  isPending: boolean;
  onConfirm: (id: AncillaryAppointment["id"]) => void;
}) {
  return (
    <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Cancel appointment</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600 py-2">
          Cancel <span className="font-semibold">{cancelTarget?.patientName}</span>'s {cancelTarget?.testType} at {cancelTarget ? formatTime12(cancelTarget.scheduledTime) : ""}?
        </p>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setCancelTarget(null)}>Keep</Button>
          <Button size="sm" variant="destructive" disabled={isPending} onClick={() => cancelTarget && onConfirm(cancelTarget.id)}>
            {isPending ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PatientQuickBookDialog({
  callListBookPatient, setCallListBookPatient,
  callListBookTestType, setCallListBookTestType,
  callListBookTime, setCallListBookTime,
  appointments, selectedDateStr, facility,
  calYear, calMonth, selectedDay, isPending, onConfirm,
}: {
  callListBookPatient: OutreachCallItem | null;
  setCallListBookPatient: (p: OutreachCallItem | null) => void;
  callListBookTestType: "BrainWave" | "VitalWave";
  setCallListBookTestType: (t: "BrainWave" | "VitalWave") => void;
  callListBookTime: string;
  setCallListBookTime: (t: string) => void;
  appointments: AncillaryAppointment[];
  selectedDateStr: string | null;
  facility: string | undefined;
  calYear: number;
  calMonth: number;
  selectedDay: number | null;
  isPending: boolean;
  onConfirm: BookMutate;
}) {
  if (!callListBookPatient) return null;
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
            disabled={!callListBookTime || !selectedDay || isPending}
            onClick={() => onConfirm({
              patientName: callListBookPatient.patientName,
              testType: callListBookTestType,
              scheduledTime: callListBookTime,
              patientId: callListBookPatient.patientId,
            })}
          >
            {isPending ? "Booking…" : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

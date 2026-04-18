import { useEffect } from "react";
import { Brain, Activity, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AncillaryAppointment } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BookingSlot = { time: string; testType: "BrainWave" | "VitalWave" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function formatTime12(time24: string): string {
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

export const BRAINWAVE_SLOTS = generateBrainWaveSlots();
export const VITALWAVE_SLOTS = generateVitalWaveSlots();

export function getTestSlots(testType: string): string[] {
  if (testType === "VitalWave") return VITALWAVE_SLOTS;
  return BRAINWAVE_SLOTS;
}

export function isBrainWave(t: string) { return t.toLowerCase().includes("brain"); }
export function isVitalWave(t: string) { return t.toLowerCase().includes("vital"); }

// ─── MiniCalendar ─────────────────────────────────────────────────────────────

export function MiniCalendar({
  year,
  month,
  onPrev,
  onNext,
  onSelectDay,
  selectedDay,
  bookedDates,
  testIdPrefix = "cal",
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (d: number) => void;
  selectedDay: number | null;
  bookedDates: Set<string>;
  testIdPrefix?: string;
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
        <Button variant="ghost" size="sm" onClick={onPrev} className="h-7 w-7 p-0" data-testid={`${testIdPrefix}-prev`}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-semibold text-slate-800">{monthNames[month]} {year}</span>
        <Button variant="ghost" size="sm" onClick={onNext} className="h-7 w-7 p-0" data-testid={`${testIdPrefix}-next`}>
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
              data-testid={`${testIdPrefix}-day-${d}`}
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

// ─── SlotGrid ─────────────────────────────────────────────────────────────────

export type SlotGridProps = {
  appointments: AncillaryAppointment[];
  selectedDate: string;
  onBook: (slot: BookingSlot) => void;
  onCancel: (appt: AncillaryAppointment) => void;
  testIdPrefix?: string;
  availableLabel?: string;
  bwBadgeLabel?: string;
  vwBadgeLabel?: string;
  truncateWidth?: string;
  scrollToSlot?: { time: string; testType: string } | null;
};

export function SlotGrid({
  appointments,
  selectedDate,
  onBook,
  onCancel,
  testIdPrefix = "",
  availableLabel = "Available",
  bwBadgeLabel = "1 hr slots",
  vwBadgeLabel = "30 min slots",
  truncateWidth = "max-w-[100px]",
  scrollToSlot = null,
}: SlotGridProps) {
  useEffect(() => {
    if (!scrollToSlot) return;
    const prefix = testIdPrefix ? `${testIdPrefix}-` : "";
    const slotType = isBrainWave(scrollToSlot.testType) ? "brainwave" : "vitalwave";
    const testId = `${prefix}slot-${slotType}-${scrollToSlot.time}`;
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollToSlot, testIdPrefix]);
  const bookedBW = new Map<string, AncillaryAppointment>();
  const bookedVW = new Map<string, AncillaryAppointment>();
  for (const a of appointments) {
    if (a.scheduledDate !== selectedDate) continue;
    if (a.status !== "scheduled") continue;
    if (isVitalWave(a.testType)) bookedVW.set(a.scheduledTime, a);
    else bookedBW.set(a.scheduledTime, a);
  }

  const prefix = testIdPrefix ? `${testIdPrefix}-` : "";

  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-700">BrainWave</span>
          <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700">{bwBadgeLabel}</Badge>
        </div>
        <div className="space-y-1">
          {BRAINWAVE_SLOTS.map((slot) => {
            const appt = bookedBW.get(slot);
            return (
              <div key={slot} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                ${appt ? "bg-violet-50 border-violet-200" : "bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "BrainWave" })}
                data-testid={`${prefix}slot-brainwave-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-violet-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className={`text-violet-800 font-semibold truncate ${truncateWidth}`}>{appt.patientName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancel(appt); }}
                      className="text-red-400 hover:text-red-600 ml-1"
                      data-testid={`${prefix}cancel-appt-${appt.id}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">{availableLabel}</span>
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
          <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-600">{vwBadgeLabel}</Badge>
        </div>
        <div className="space-y-1">
          {VITALWAVE_SLOTS.map((slot) => {
            const appt = bookedVW.get(slot);
            return (
              <div key={slot} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors
                ${appt ? "bg-red-50 border-red-200" : "bg-white border-slate-200 hover:border-red-300 hover:bg-red-50/50 cursor-pointer"}`}
                onClick={() => !appt && onBook({ time: slot, testType: "VitalWave" })}
                data-testid={`${prefix}slot-vitalwave-${slot}`}
              >
                <span className={`font-medium ${appt ? "text-red-700" : "text-slate-600"}`}>{formatTime12(slot)}</span>
                {appt ? (
                  <div className="flex items-center gap-1">
                    <span className={`text-red-800 font-semibold truncate ${truncateWidth}`}>{appt.patientName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancel(appt); }}
                      className="text-red-400 hover:text-red-600 ml-1"
                      data-testid={`${prefix}cancel-appt-${appt.id}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[10px]">{availableLabel}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

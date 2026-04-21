import { useEffect } from "react";
import { Brain, Activity, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AncillaryAppointment } from "@shared/schema";
import { SchedulerIcon } from "@/components/plexus/SchedulerIcon";
import {
  BRAINWAVE_PALETTE,
  VITALWAVE_PALETTE,
  getTestPalette,
  type TestPalette,
} from "@/lib/testColors";

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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function MiniCalendar({
  year,
  month,
  onPrev,
  onNext,
  onSelectDay,
  selectedDay,
  bookedDates,
  testIdPrefix = "cal",
  palette,
  showOutsideDays = true,
}: {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (d: number) => void;
  selectedDay: number | null;
  bookedDates: Set<string>;
  testIdPrefix?: string;
  palette?: TestPalette;
  showOutsideDays?: boolean;
}) {
  const pal = palette ?? getTestPalette(null);
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  type Cell = { day: number; outside: boolean };
  const cells: Cell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ day: prevMonthDays - i, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, outside: false });
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: nextDay++, outside: true });
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrev}
          className="h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100"
          data-testid={`${testIdPrefix}-prev`}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-base font-semibold text-slate-900 tracking-tight">
          {MONTH_NAMES[month]} {year}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          className="h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100"
          data-testid={`${testIdPrefix}-next`}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-medium uppercase tracking-wider text-slate-400 py-2"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          const cellMonth = cell.outside
            ? cell.day > 20
              ? month - 1
              : month + 1
            : month;
          const cellYear =
            cellMonth < 0 ? year - 1 : cellMonth > 11 ? year + 1 : year;
          const normalizedMonth = (cellMonth + 12) % 12;
          const key = toDateKey(cellYear, normalizedMonth, cell.day);
          const isToday = key === todayKey;
          const isSelected = !cell.outside && cell.day === selectedDay;
          const hasBooking = bookedDates.has(key);

          if (cell.outside && !showOutsideDays) {
            return <div key={i} className="h-11" />;
          }

          return (
            <button
              key={i}
              onClick={() => !cell.outside && onSelectDay(cell.day)}
              data-testid={cell.outside ? undefined : `${testIdPrefix}-day-${cell.day}`}
              disabled={cell.outside}
              className={[
                "relative h-11 w-full rounded-2xl text-sm font-medium transition-colors flex items-center justify-center",
                cell.outside
                  ? "text-slate-300 cursor-default"
                  : isSelected
                    ? `${pal.selectedBg} ${pal.selectedText} shadow-sm`
                    : isToday
                      ? "text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100"
                      : "text-slate-800 hover:bg-slate-100",
              ].join(" ")}
            >
              {cell.day}
              {hasBooking && !cell.outside && (
                <span
                  className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                    isSelected ? "bg-white/90" : pal.dotBg
                  }`}
                />
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
  bwBadgeLabel = "1 hr",
  vwBadgeLabel = "30 min",
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
      <SlotColumn
        title="BrainWave"
        slots={BRAINWAVE_SLOTS}
        bookings={bookedBW}
        palette={BRAINWAVE_PALETTE}
        icon={<Brain className="w-4 h-4" />}
        badgeLabel={bwBadgeLabel}
        availableLabel={availableLabel}
        onBook={(time) => onBook({ time, testType: "BrainWave" })}
        onCancel={onCancel}
        prefix={prefix}
        slotType="brainwave"
        truncateWidth={truncateWidth}
      />
      <SlotColumn
        title="VitalWave"
        slots={VITALWAVE_SLOTS}
        bookings={bookedVW}
        palette={VITALWAVE_PALETTE}
        icon={<Activity className="w-4 h-4" />}
        badgeLabel={vwBadgeLabel}
        availableLabel={availableLabel}
        onBook={(time) => onBook({ time, testType: "VitalWave" })}
        onCancel={onCancel}
        prefix={prefix}
        slotType="vitalwave"
        truncateWidth={truncateWidth}
      />
    </div>
  );
}

function SlotColumn({
  title,
  slots,
  bookings,
  palette,
  icon,
  badgeLabel,
  availableLabel,
  onBook,
  onCancel,
  prefix,
  slotType,
  truncateWidth,
}: {
  title: string;
  slots: string[];
  bookings: Map<string, AncillaryAppointment>;
  palette: TestPalette;
  icon: React.ReactNode;
  badgeLabel: string;
  availableLabel: string;
  onBook: (time: string) => void;
  onCancel: (appt: AncillaryAppointment) => void;
  prefix: string;
  slotType: "brainwave" | "vitalwave";
  truncateWidth: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={palette.iconText}>{icon}</span>
        <span className={`text-sm font-semibold ${palette.accentText}`}>{title}</span>
        <Badge
          variant="secondary"
          className={`text-[10px] ${palette.badgeBg} ${palette.badgeText} border-0`}
        >
          {badgeLabel}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((slot) => {
          const appt = bookings.get(slot);
          const isBooked = !!appt;
          return (
            <div
              key={slot}
              onClick={() => !isBooked && onBook(slot)}
              data-testid={`${prefix}slot-${slotType}-${slot}`}
              className={[
                "group flex items-center justify-between px-3 h-11 rounded-xl border text-xs font-medium transition-colors",
                isBooked
                  ? `${palette.bookedBg} ${palette.bookedBorder}`
                  : `bg-white border-slate-200 ${palette.hoverBorder} ${palette.hoverBg} cursor-pointer`,
              ].join(" ")}
            >
              <span
                className={
                  isBooked ? palette.accentText : "text-slate-700"
                }
              >
                {formatTime12(slot)}
              </span>
              {appt ? (
                <div className="flex items-center gap-1 min-w-0">
                  {appt.patientScreeningId != null && (
                    <SchedulerIcon
                      patientScreeningId={appt.patientScreeningId}
                      patientName={appt.patientName}
                      size="xs"
                    />
                  )}
                  <span
                    className={`${palette.bookedText} font-semibold truncate ${truncateWidth}`}
                  >
                    {appt.patientName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancel(appt);
                    }}
                    className="text-slate-400 hover:text-rose-600 ml-1"
                    data-testid={`${prefix}cancel-appt-${appt.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span className="text-slate-400 text-[10px] uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                  {availableLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

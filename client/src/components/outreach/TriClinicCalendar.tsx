import { useMemo, useState } from "react";
import { Activity, Brain, Calendar, ChevronUp, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AncillaryAppointment } from "@shared/schema";
import {
  toDateKey,
  formatTime12,
  isBrainWave,
  isVitalWave,
  BRAINWAVE_SLOTS as BW_SLOTS,
  VITALWAVE_SLOTS as VW_SLOTS,
} from "@/components/clinic-calendar";
import type { BookingSlot } from "@/components/clinic-calendar";
import type { OutreachCallItem } from "./types";

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

export function TriClinicCalendar({
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

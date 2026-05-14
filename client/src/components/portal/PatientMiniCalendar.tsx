import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import type { SchedulePatientDialogPatient } from "@/components/portal/SchedulePatientDialog";

// Patient-specific mini calendar for the team portal right/left rail.
//
// Wraps the existing facility-month-count behaviour but adds:
//   - patient header (name, DOB, facility, qualified tests if known)
//   - a clearly patient-scoped Schedule CTA that bubbles up via
//     onSchedulePatient — the parent then opens the existing
//     SchedulePatientDialog with the patient + date prefilled.
//
// When no patient is selected for scheduling, the calendar still works
// as a facility month view (same data shape it used before) — the
// header just shows the facility context instead of a patient name.

const POLL_MS = 30_000;

export type PatientMiniCalendarProps = {
  patient: SchedulePatientDialogPatient | null;
  facility: string;
  selectedDate: string;
  qualifyingTests?: string[];
  mode: "clinicSchedule" | "ancillarySchedule" | "callList";
  onSelectDate: (date: string) => void;
  onSchedulePatient?: (payload: {
    patient: SchedulePatientDialogPatient;
    selectedDate: string;
  }) => void;
};

function modeLabel(m: PatientMiniCalendarProps["mode"]): string {
  if (m === "clinicSchedule") return "Clinic Schedule";
  if (m === "ancillarySchedule") return "Ancillary Schedule";
  return "Call List";
}

export function PatientMiniCalendar({
  patient,
  facility,
  selectedDate,
  qualifyingTests,
  mode,
  onSelectDate,
  onSchedulePatient,
}: PatientMiniCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selectedDate);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const monthIso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;

  const { data } = useQuery<{ days: { date: string; appointmentCount: number }[] }>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  const cells = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of data?.days ?? []) counts.set(d.date, d.appointmentCount);
    const first = new Date(cursor.y, cursor.m, 1);
    const startOffset = first.getDay();
    const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: Array<{ date: string | null; count: number }> = [];
    for (let i = 0; i < startOffset; i++) out.push({ date: null, count: 0 });
    for (let day = 1; day <= lastDate; day++) {
      const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      out.push({ date: ds, count: counts.get(ds) ?? 0 });
    }
    return out;
  }, [data, cursor]);

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const patientName = patient?.patientName ?? null;
  const patientDob = patient?.patientDob ?? null;
  const patientFacility = patient?.facilityId ?? facility ?? null;
  const ctaDisabled = !patient || !onSchedulePatient || !selectedDate;

  return (
    <Card className="p-3" data-testid="patient-mini-calendar">
      <div className="mb-2 flex items-center justify-between">
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"
            data-testid="patient-mini-calendar-mode"
          >
            {modeLabel(mode)}
          </div>
          <div
            className="text-sm font-semibold text-slate-900 truncate"
            data-testid="patient-mini-calendar-name"
          >
            {patientName ? `Scheduling: ${patientName}` : facility || "No facility selected"}
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            {patientDob ? `DOB ${patientDob}` : null}
            {patientFacility ? (patientDob ? ` · ${patientFacility}` : patientFacility) : null}
            {patient?.serviceType ? ` · ${patient.serviceType}` : null}
          </div>
          {qualifyingTests && qualifyingTests.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {qualifyingTests.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-700"
                >
                  {t}
                </span>
              ))}
              {qualifyingTests.length > 4 && (
                <span className="text-[9px] text-slate-500">
                  +{qualifyingTests.length - 4} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))
          }
          className="p-1 hover:bg-slate-100 rounded"
          data-testid="button-patient-mini-calendar-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span
          className="text-sm font-semibold"
          data-testid="patient-mini-calendar-month"
        >
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))
          }
          className="p-1 hover:bg-slate-100 rounded"
          data-testid="button-patient-mini-calendar-next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-slate-400 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => (
          <button
            key={i}
            type="button"
            disabled={!c.date}
            onClick={() => c.date && onSelectDate(c.date)}
            className={`aspect-square flex flex-col items-center justify-center rounded text-xs ${
              !c.date
                ? ""
                : c.date === selectedDate
                ? "bg-indigo-600 text-white"
                : c.count > 0
                ? "bg-indigo-50 text-indigo-900 hover:bg-indigo-100"
                : "hover:bg-slate-100"
            }`}
            data-testid={c.date ? `patient-mini-calendar-day-${c.date}` : undefined}
          >
            {c.date && <span>{parseInt(c.date.slice(-2), 10)}</span>}
            {c.date && c.count > 0 && (
              <span className="text-[8px] opacity-80">{c.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          disabled={ctaDisabled}
          onClick={() => {
            if (!patient || !onSchedulePatient || !selectedDate) return;
            onSchedulePatient({ patient, selectedDate });
          }}
          className="gap-1.5"
          data-testid="button-patient-mini-calendar-schedule"
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {patient
            ? `Schedule ${patient.patientName ?? "patient"}`
            : "Choose a patient"}
        </Button>
      </div>
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon } from "lucide-react";
import type { SchedulePatientDialogPatient } from "@/components/portal/SchedulePatientDialog";
import {
  CanonicalCommandCalendar,
  type CanonicalMonthCellSummary,
} from "@/components/calendar/CanonicalCommandCalendar";

// Patient-specific mini calendar for the team portal left rail.
//
// The grid itself is the canonical calendar shared by PCS, ACS,
// Plexus IQ, and Dashboard — rendered via CanonicalCommandCalendar
// (inline mode). This wrapper keeps the surrounding patient-scoped
// affordances: patient header (name, DOB, facility, qualifying tests),
// mode label, and the Schedule CTA that bubbles via onSchedulePatient.
//
// When no patient is selected the calendar still works as a facility
// month view (same data shape it used before); the header just shows
// the facility context instead of a patient name.

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
  // Profile-driven facility scope. When the selected facility isn't
  // in `assignedFacilityIds` and `viewAllFacilities` is false, the
  // calendar renders a soft access hint above the grid so the user
  // sees why counts may be empty. The calendar itself stays visible.
  assignedFacilityIds?: string[];
  viewAllFacilities?: boolean;
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
  assignedFacilityIds,
  viewAllFacilities,
}: PatientMiniCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selectedDate);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Sync the visible month to selectedDate when the parent updates it
  // (e.g. after scheduling, switching patients, or selecting a date
  // from the right-panel calendar). Without this the cursor stays on
  // the original month and the new selection is invisible.
  useEffect(() => {
    if (!selectedDate) return;
    const d = new Date(selectedDate);
    if (Number.isNaN(d.getTime())) return;
    setCursor((cur) => {
      if (cur.y === d.getFullYear() && cur.m === d.getMonth()) return cur;
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }, [selectedDate]);

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

  // Build the per-date cell map the CanonicalMonthCalendar consumes.
  // The facility month-summary endpoint returns one row per date with
  // an appointment count; we surface that as the canonical cell count
  // plus a single dot so the grid lights up where work exists.
  const canonicalCells = useMemo<Record<string, CanonicalMonthCellSummary>>(() => {
    const out: Record<string, CanonicalMonthCellSummary> = {};
    for (const d of data?.days ?? []) {
      const count = d.appointmentCount ?? 0;
      if (count <= 0) continue;
      out[d.date] = {
        count,
        dots: [
          {
            className: "bg-indigo-500",
            title: `${count} appointment${count === 1 ? "" : "s"}`,
          },
        ],
      };
    }
    return out;
  }, [data]);

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

      {/* Facility-access hint. The calendar stays visible, but when
          the selected facility is outside the user's assigned scope
          a soft note explains why counts may read zero. Falls back
          to silent when the profile permits all facilities or no
          assignment list was passed (e.g. legacy callers). */}
      {(() => {
        if (viewAllFacilities) return null;
        if (!assignedFacilityIds || assignedFacilityIds.length === 0) return null;
        if (!facility) return null;
        if (assignedFacilityIds.includes(facility)) return null;
        return (
          <div
            className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-900"
            data-testid="patient-mini-calendar-access-hint"
          >
            <span className="font-semibold uppercase tracking-wider">Heads up · </span>
            <span>
              "{facility}" is outside your assigned facilities — counts may
              read zero or omit rows you can't access.
            </span>
          </div>
        );
      })()}

      {/* Canonical calendar shared by PCS, ACS, Plexus IQ, and Dashboard.
          Re-key on month change so the uncontrolled cursor inside the
          view honours the parent's selectedDate when scheduling
          switches patients/months. */}
      <div data-testid="patient-mini-calendar-month-grid">
        <CanonicalCommandCalendar
          key={`${cursor.y}-${cursor.m}`}
          mode="inline"
          profileId={mode === "ancillarySchedule" ? "ancillaryCareSpecialist" : "patientCareSpecialist"}
          cells={canonicalCells}
          initialMonth={new Date(cursor.y, cursor.m, 1)}
          onSelectDate={(iso) => {
            const d = new Date(iso);
            if (!Number.isNaN(d.getTime())) {
              setCursor({ y: d.getFullYear(), m: d.getMonth() });
            }
            onSelectDate(iso);
          }}
        />
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

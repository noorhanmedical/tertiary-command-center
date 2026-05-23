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
import {
  buildCommandCalendarCells,
  defaultCommandCalendarEventWindow,
  ANCILLARY_DOT_CLASS,
  type CommandCalendarSummaryRow,
} from "@/lib/calendar/commandCalendarViewModel";
import type { GlobalScheduleEvent } from "@shared/schema";
import { PromoteToPlaygroundButton } from "@/components/playground/PromoteToPlaygroundButton";
import {
  buildCalendarDatePlaygroundContext,
  type PanelPlaygroundContext,
  type PanelPlaygroundSource,
} from "@/lib/playground/panelPlaygroundContext";

// Patient-specific mini calendar for the team portal left rail.
//
// The grid itself is the canonical calendar shared by PCS, ACS,
// Plexus IQ, and Dashboard — rendered via CanonicalCommandCalendar
// (inline mode) AND fed by the same `buildCommandCalendarCells`
// helper. So PCS/ACS no longer show a simplified count-only
// calendar — they show the same per-date ancillary-category dots
// and procedure-complete badge Plexus IQ shows, scoped to the
// current facility.

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
  // Source surface tag passed into the canonical
  // PanelPlaygroundContext when the user expands a date popup.
  // Defaults to "unknown" — callers in PCS / ACS pass "pcs" / "acs".
  panelSourceSurface?: PanelPlaygroundSource;
  // Optional promote handler. When present, the selected-date
  // popup shows the canonical promote-to-Playground button.
  onPromoteToPlayground?: (context: PanelPlaygroundContext) => void;
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
  panelSourceSurface = "unknown",
  onPromoteToPlayground,
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

  // Canonical calendar-summary feed (one row per screening_batch).
  // Same data Plexus IQ uses. We filter to the current facility on
  // the client via buildCommandCalendarCells so the left-rail
  // calendar shows the right slice of work.
  const { data: summary = [] } = useQuery<CommandCalendarSummaryRow[]>({
    queryKey: ["/api/screening-batches/calendar-summary"],
    queryFn: async () => {
      const res = await fetch("/api/screening-batches/calendar-summary", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Calendar summary fetch failed (${res.status})`);
      }
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: POLL_MS,
  });

  // Procedure-complete events drive the calendar's ✓ badge so a date
  // with a completed procedure is visually distinct, matching the
  // Plexus IQ surface.
  const completedEventRange = useMemo(
    () => defaultCommandCalendarEventWindow(),
    [],
  );
  const { data: completedEvents = [] } = useQuery<GlobalScheduleEvent[]>({
    queryKey: [
      "/api/global-schedule-events",
      {
        eventType: "procedure_complete",
        startDate: completedEventRange.start,
        endDate: completedEventRange.end,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("eventType", "procedure_complete");
      params.set("startDate", completedEventRange.start);
      params.set("endDate", completedEventRange.end);
      params.set("limit", "500");
      const res = await fetch(
        `/api/global-schedule-events?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(`Calendar events fetch failed (${res.status})`);
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  // Shared canonical builder — same call PCS, ACS, Plexus IQ, and
  // Dashboard use. `facility` scopes the rows so the left rail
  // shows the current clinic's per-date work. The legacy
  // count-only month-summary feed is no longer used here.
  const canonicalCells = useMemo<Record<string, CanonicalMonthCellSummary>>(
    () =>
      buildCommandCalendarCells({
        summary,
        facility: facility ?? null,
        completedEvents,
      }),
    [summary, facility, completedEvents],
  );

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

      {/* Selected-date popup. Compact inline summary of the cell the
          parent has flagged as `selectedDate`. Surfaces the same
          ancillary-category dots + total count + procedure-complete
          badge the grid shows, plus the canonical promote-to-Playground
          arrow when a handler is wired. */}
      {(() => {
        const cell = selectedDate ? canonicalCells[selectedDate] : undefined;
        if (!selectedDate) return null;
        const count = cell?.count ?? 0;
        const dots = cell?.dots ?? [];
        const procedureCompleted = !!cell?.badge;
        const categoryLabels = dots
          .map((d) => d.title)
          .filter((t): t is string => !!t);
        const categoryKeys = Object.keys(ANCILLARY_DOT_CLASS).filter((k) =>
          dots.some((d) => d.className === ANCILLARY_DOT_CLASS[k]?.className),
        );
        const promoteContext = onPromoteToPlayground
          ? buildCalendarDatePlaygroundContext({
              sourceSurface: panelSourceSurface,
              selectedDate,
              facilityId: facility || null,
              count,
              categories: categoryKeys,
              procedureCompleted,
            })
          : null;
        return (
          <div
            className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"
            data-testid="patient-mini-calendar-date-popup"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {selectedDate}
                  {facility ? ` · ${facility}` : ""}
                </div>
                <div className="text-slate-900 leading-tight">
                  {count > 0 ? (
                    <>
                      <span className="font-semibold tabular-nums">{count}</span>
                      <span className="ml-1 text-slate-600">
                        qualifying patient{count === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500 italic">No qualifying batches on this date.</span>
                  )}
                </div>
                {(categoryLabels.length > 0 || procedureCompleted) && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {dots.map((d, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium border border-slate-200 bg-white text-slate-700`}
                        title={d.title}
                        data-testid={`patient-mini-calendar-date-popup-dot-${i}`}
                      >
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${d.className}`} />
                        {d.title ?? ""}
                      </span>
                    ))}
                    {procedureCompleted && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-800"
                        data-testid="patient-mini-calendar-date-popup-procedure-complete"
                      >
                        ✓ Procedure complete
                      </span>
                    )}
                  </div>
                )}
              </div>
              {promoteContext && onPromoteToPlayground ? (
                <PromoteToPlaygroundButton
                  context={promoteContext}
                  onPromote={onPromoteToPlayground}
                  title={`Expand ${selectedDate} in Playground`}
                />
              ) : null}
            </div>
          </div>
        );
      })()}

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

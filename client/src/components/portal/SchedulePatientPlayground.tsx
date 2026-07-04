import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  X,
  CalendarPlus,
  Clock,
  Stethoscope,
  CheckCircle2,
  XCircle,
  Check,
  CalendarDays,
  User,
  Phone,
  Building2,
  ShieldCheck,
  Bell,
  MapPin,
  FileText,
} from "lucide-react";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import {
  type SchedulePatientDialogPatient,
  type BookingResult,
  SERVICE_OPTIONS,
  APPOINTMENT_TYPES,
  TIME_SLOTS,
  prettyTime,
  prettyDateLong,
  combineLocalDateAndTimeToIso,
  buildScheduleNote,
} from "@/components/portal/SchedulePatientDialog";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";
import { CanonicalMonthCalendar } from "@/calendar/views/CanonicalMonthCalendar";

// Mode 2 of the two scheduling experiences: the full, calendar-led
// scheduler that takes over the center Playground canvas. Same data/write
// contracts as SchedulePatientDialog — pulls per-day events from
// global_schedule_events and writes through
// POST /api/global-schedule-events/schedule-ancillary.

const ACCENT = "#4863A0";

export type SchedulePatientPlaygroundProps = {
  patient: SchedulePatientDialogPatient;
  selectedDate: string;
  onClose?: () => void;
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtNextAction(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function evtTitle(evt: unknown): { title: string; sub: string } {
  const e = evt as {
    patientName?: string | null;
    serviceType?: string | null;
    startsAt?: string | null;
    status?: string | null;
  };
  return {
    title: e.patientName ?? e.serviceType ?? "Event",
    sub: [fmtTime(e.startsAt ?? null), e.serviceType ?? "", e.status ?? ""]
      .filter(Boolean)
      .join(" · "),
  };
}

function SummaryRow({
  icon,
  label,
  value,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2.5" data-testid={testId}>
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </div>
        <div className="truncate text-sm font-medium text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function EventColumn({
  label,
  rows,
  emptyText,
  testId,
  accent,
}: {
  label: string;
  rows: unknown[];
  emptyText: string;
  testId: string;
  accent: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </div>
        {rows.length > 0 && (
          <span
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-center text-[11px] italic text-slate-400">
          {emptyText}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 12).map((evt, idx) => {
            const r = evtTitle(evt);
            return (
              <li
                key={idx}
                className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-700"
              >
                <div className="truncate font-medium text-slate-900">{r.title}</div>
                {r.sub && (
                  <div className="truncate text-[10px] text-slate-500">{r.sub}</div>
                )}
              </li>
            );
          })}
          {rows.length > 12 && (
            <li className="text-[10px] italic text-slate-400">
              and {rows.length - 12} more…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SchedulePatientPlayground({
  patient,
  selectedDate: initialDate,
  onClose,
}: SchedulePatientPlaygroundProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  // Multi-test selection — staff can book several ancillary tests in one
  // pass. Seeds from the incoming target service when present.
  const [selectedServices, setSelectedServices] = useState<string[]>(
    patient.serviceType ? [patient.serviceType] : [],
  );
  // Optional per-test date/time overrides. A test with no entry uses the
  // shared selectedDate + time; an entry (even partial) diverges.
  const [serviceOverrides, setServiceOverrides] = useState<
    Record<string, { date?: string; time?: string }>
  >({});
  const [appointmentType, setAppointmentType] = useState<string>(
    APPOINTMENT_TYPES[0],
  );
  const [location, setLocation] = useState<string>(patient.facilityId ?? "");
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState<string>("");
  // Per-test results from the last confirm; drives the partial-failure panel.
  const [bookingResults, setBookingResults] = useState<BookingResult[] | null>(
    null,
  );

  const initialMonth = useMemo(() => {
    const d = new Date(`${initialDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [initialDate]);

  const { data: dayContext, isLoading: contextLoading } =
    useQuery<PatientScheduleDayContext>({
      queryKey: [
        "schedule-patient-playground-context",
        patient.facilityId ?? null,
        patient.patientScreeningId ?? null,
        patient.executionCaseId ?? null,
        selectedDate,
      ],
      queryFn: () =>
        fetchPatientScheduleDayContext({
          facilityId: patient.facilityId ?? null,
          patientScreeningId: patient.patientScreeningId ?? null,
          executionCaseId: patient.executionCaseId ?? null,
          selectedDate,
        }),
    });

  // Effective date/time for a single test: its override wins, else shared.
  const effectiveFor = (svc: string): { date: string; time: string } => {
    const ov = serviceOverrides[svc] ?? {};
    return { date: ov.date || selectedDate, time: ov.time || time };
  };

  // Test selection helpers.
  const toggleService = (svc: string) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc],
    );
    // Drop any override when a test is deselected so it can't leak back.
    setServiceOverrides((prev) => {
      if (!prev[svc]) return prev;
      const next = { ...prev };
      delete next[svc];
      return next;
    });
  };
  const enableOverride = (svc: string) =>
    setServiceOverrides((prev) => ({
      ...prev,
      [svc]: { date: selectedDate, time },
    }));
  const resetOverride = (svc: string) =>
    setServiceOverrides((prev) => {
      const next = { ...prev };
      delete next[svc];
      return next;
    });
  const patchOverride = (
    svc: string,
    patch: { date?: string; time?: string },
  ) =>
    setServiceOverrides((prev) => ({
      ...prev,
      [svc]: { ...(prev[svc] ?? {}), ...patch },
    }));

  // Name-only patients (walk-ins / not yet screened) are schedulable:
  // the server creates a minimal execution case stub from patientName
  // when neither id resolves. Either an id OR a non-empty name is enough.
  const canSubmit = useMemo(() => {
    const hasIdentity =
      patient.patientScreeningId != null ||
      patient.executionCaseId != null ||
      !!patient.patientName?.trim();
    if (!hasIdentity) return false;
    if (selectedServices.length === 0) return false;
    // Every selected test must resolve to a valid effective date + time.
    return selectedServices.every((svc) => {
      const ov = serviceOverrides[svc] ?? {};
      return !!combineLocalDateAndTimeToIso(
        ov.date || selectedDate,
        ov.time || time,
      );
    });
  }, [patient, selectedServices, serviceOverrides, selectedDate, time]);

  const scheduleMutation = useMutation({
    // Fan out one existing single-test write per selected test. Runs
    // sequentially so a brand-new (name-only) patient's first booking
    // creates the stub case and later bookings attach to that same case
    // (carried forward via the response) instead of duplicating it.
    mutationFn: async (): Promise<BookingResult[]> => {
      if (selectedServices.length === 0)
        throw new Error("Select at least one test");
      const results: BookingResult[] = [];
      let resolvedCaseId: number | null = patient.executionCaseId ?? null;
      let resolvedScreeningId: number | null =
        patient.patientScreeningId ?? null;
      for (const svc of selectedServices) {
        const eff = effectiveFor(svc);
        const startsAt = combineLocalDateAndTimeToIso(eff.date, eff.time);
        if (!startsAt) {
          results.push({
            service: svc,
            ok: false,
            error: "Invalid date or time",
          });
          continue;
        }
        try {
          const resp = (await schedulePatientAncillary({
            executionCaseId: resolvedCaseId,
            patientScreeningId: resolvedScreeningId,
            patientName: patient.patientName ?? null,
            patientDob: patient.patientDob ?? null,
            serviceType: svc,
            startsAt,
            facilityId: patient.facilityId ?? null,
            note: buildScheduleNote(note, appointmentType, location),
            metadata: {
              source: "schedule_patient_playground",
              appointmentType: appointmentType.trim() || null,
              location: location.trim() || null,
            },
          })) as {
            executionCase?: {
              id?: number;
              patientScreeningId?: number | null;
            };
          };
          if (resp?.executionCase?.id != null) {
            resolvedCaseId = resp.executionCase.id;
            if (resp.executionCase.patientScreeningId != null)
              resolvedScreeningId = resp.executionCase.patientScreeningId;
          }
          results.push({ service: svc, ok: true });
        } catch (err) {
          results.push({
            service: svc,
            ok: false,
            error: err instanceof Error ? err.message : "Schedule write failed",
          });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      setBookingResults(results);
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: patient.facilityId ?? null,
        selectedDate,
        patientScreeningId: patient.patientScreeningId ?? null,
      });
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({
          title: okCount === 1 ? "Scheduled" : `${okCount} tests scheduled`,
          description: `for ${patient.patientName ?? "patient"}.`,
        });
        // Full success: clear the transient inputs so the surface is ready
        // for the next booking without re-opening.
        setSelectedServices([]);
        setServiceOverrides({});
        setTime("");
        setNote("");
      } else {
        toast({
          title:
            okCount > 0
              ? `${okCount} scheduled · ${failed.length} failed`
              : "Could not schedule",
          description: failed
            .map((f) => `${f.service}: ${f.error ?? "failed"}`)
            .join(" · "),
          variant: "destructive",
        });
      }
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not schedule",
        description: err instanceof Error ? err.message : "Schedule write failed.",
        variant: "destructive",
      });
    },
  });

  const initials = (patient.patientName ?? "P")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  const nextAction = fmtNextAction(patient.nextActionAt);
  const pdfDisabledReason =
    "Open the patient chart to generate clinical PDFs — clinical data isn't loaded in the scheduler.";

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_20px_70px_rgba(15,23,42,0.10)]"
      data-testid="schedule-patient-playground"
    >
      {/* Premium gradient header */}
      <div
        className="relative shrink-0 px-7 py-5 text-white"
        style={{ backgroundImage: `linear-gradient(135deg, ${ACCENT}, #2f4673)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold backdrop-blur">
              {initials || <User className="h-6 w-6" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                <CalendarPlus className="h-3.5 w-3.5" />
                Schedule Ancillary
              </div>
              <div className="truncate text-2xl font-bold leading-tight">
                {patient.patientName ?? "Patient"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/80">
                {patient.patientDob && <span>DOB {patient.patientDob}</span>}
                {patient.serviceType && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 font-medium">
                    <Stethoscope className="h-3 w-3" />
                    {patient.serviceType}
                  </span>
                )}
              </div>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close scheduling view"
              title="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              data-testid="button-schedule-patient-playground-close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Two panes: prominent calendar (left) + booking summary (right).
          Each pane scrolls internally so there is no full-page scroll. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1.55fr_1fr]">
        {/* LEFT — prominent calendar + slots + day glance */}
        <div className="min-h-0 overflow-auto border-slate-200 p-6 lg:border-r">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <CanonicalMonthCalendar
              initialMonth={initialMonth}
              onSelectDate={(iso) => {
                setSelectedDate(iso);
                setTime("");
              }}
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Available slots · {prettyDateLong(selectedDate)}
            </div>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {TIME_SLOTS.map((slot) => {
                const active = slot === time;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setTime(slot)}
                    className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-transparent text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    style={active ? { backgroundColor: ACCENT } : undefined}
                    data-testid={`sp-pg-slot-${slot}`}
                  >
                    {prettyTime(slot)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Day at a glance
            </div>
            {contextLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-xs italic text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading day context…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <EventColumn
                  label="Clinic Schedule"
                  rows={dayContext?.clinicEvents ?? []}
                  emptyText="No clinic visits."
                  testId="sp-pg-clinic-events"
                  accent={ACCENT}
                />
                <EventColumn
                  label="Ancillary Schedule"
                  rows={dayContext?.ancillaryEvents ?? []}
                  emptyText="No ancillary appointments."
                  testId="sp-pg-ancillary-events"
                  accent={ACCENT}
                />
                <EventColumn
                  label="This patient"
                  rows={dayContext?.patientEvents ?? []}
                  emptyText="No events for this patient on this day."
                  testId="sp-pg-patient-events"
                  accent={ACCENT}
                />
                <EventColumn
                  label="Availability / Blocks"
                  rows={dayContext?.availabilityBlocks ?? []}
                  emptyText="No availability blocks."
                  testId="sp-pg-availability-blocks"
                  accent={ACCENT}
                />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — patient summary + booking form + sticky confirm */}
        <div className="flex min-h-0 flex-col bg-white">
          <div className="min-h-0 flex-1 space-y-5 overflow-auto p-6">
            {/* Patient summary */}
            <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Patient summary
              </div>
              <div className="space-y-2.5">
                {patient.callReason && (
                  <SummaryRow
                    icon={<Bell className="h-3.5 w-3.5" />}
                    label="Call reason"
                    value={patient.callReason}
                    testId="sp-pg-summary-reason"
                  />
                )}
                {patient.serviceType && (
                  <SummaryRow
                    icon={<Stethoscope className="h-3.5 w-3.5" />}
                    label="Target test"
                    value={patient.serviceType}
                    testId="sp-pg-summary-service"
                  />
                )}
                {patient.patientPhone && (
                  <SummaryRow
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label="Phone"
                    value={patient.patientPhone}
                    testId="sp-pg-summary-phone"
                  />
                )}
                {patient.facilityId && (
                  <SummaryRow
                    icon={<Building2 className="h-3.5 w-3.5" />}
                    label="Clinic"
                    value={patient.facilityId}
                    testId="sp-pg-summary-clinic"
                  />
                )}
                {patient.insurance && (
                  <SummaryRow
                    icon={<ShieldCheck className="h-3.5 w-3.5" />}
                    label="Insurance"
                    value={patient.insurance}
                    testId="sp-pg-summary-insurance"
                  />
                )}
                {nextAction && (
                  <SummaryRow
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Next action"
                    value={nextAction}
                    testId="sp-pg-summary-next-action"
                  />
                )}
                {!patient.callReason &&
                  !patient.serviceType &&
                  !patient.patientPhone &&
                  !patient.facilityId &&
                  !patient.insurance &&
                  !nextAction && (
                    <div className="text-[11px] italic text-slate-400">
                      No additional context available for this patient.
                    </div>
                  )}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  title={pdfDisabledReason}
                  className="gap-1.5"
                  data-testid="button-sp-pg-clinician-pdf"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Clinician PDF
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  title={pdfDisabledReason}
                  className="gap-1.5"
                  data-testid="button-sp-pg-plexus-pdf"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Plexus PDF
                </Button>
              </div>
            </div>

            {/* Booking form */}
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Tests <span className="text-red-500">*</span>
                  </Label>
                  {selectedServices.length > 0 && (
                    <span
                      className="text-[11px] font-medium text-slate-400"
                      data-testid="text-sp-pg-selected-count"
                    >
                      {selectedServices.length} selected
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    Array.from(
                      new Set([
                        ...selectedServices.filter(
                          (s) => !SERVICE_OPTIONS.includes(s),
                        ),
                        ...SERVICE_OPTIONS,
                      ]),
                    )
                  ).map((svc) => {
                    const active = selectedServices.includes(svc);
                    return (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => toggleService(svc)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          active
                            ? "border-transparent text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        style={active ? { backgroundColor: ACCENT } : undefined}
                        data-testid={`chip-sp-pg-service-${svc}`}
                      >
                        {active && <Check className="h-3 w-3" />}
                        {svc}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedServices.length > 0 && (
                <div
                  className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-2.5"
                  data-testid="section-sp-pg-per-test"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <CalendarDays className="h-3 w-3" />
                    Per-test schedule
                  </div>
                  <p className="text-[11px] text-slate-400">
                    All tests use the shared date &amp; time from the calendar —
                    override any test individually.
                  </p>
                  {selectedServices.map((svc) => {
                    const ov = serviceOverrides[svc] ?? {};
                    const hasOverride = !!(ov.date || ov.time);
                    const eff = effectiveFor(svc);
                    return (
                      <div
                        key={svc}
                        className="rounded-xl border border-slate-200 bg-white p-2"
                        data-testid={`sp-pg-override-row-${svc}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-slate-800">
                              {svc}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {prettyDateLong(eff.date)}
                              {eff.time ? ` · ${prettyTime(eff.time)}` : ""}
                              {" · "}
                              {hasOverride ? "custom" : "shared"}
                            </div>
                          </div>
                          {hasOverride ? (
                            <button
                              type="button"
                              onClick={() => resetOverride(svc)}
                              className="shrink-0 text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline"
                              data-testid={`button-sp-pg-override-reset-${svc}`}
                            >
                              Use shared
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => enableOverride(svc)}
                              className="shrink-0 text-[11px] font-semibold underline-offset-2 hover:underline"
                              style={{ color: ACCENT }}
                              data-testid={`button-sp-pg-override-enable-${svc}`}
                            >
                              Override
                            </button>
                          )}
                        </div>
                        {hasOverride && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Input
                              type="date"
                              value={ov.date || selectedDate}
                              onChange={(e) =>
                                patchOverride(svc, { date: e.target.value })
                              }
                              className="rounded-xl"
                              data-testid={`input-sp-pg-override-date-${svc}`}
                            />
                            <Input
                              type="time"
                              value={ov.time || time}
                              onChange={(e) =>
                                patchOverride(svc, { time: e.target.value })
                              }
                              className="rounded-xl"
                              data-testid={`input-sp-pg-override-time-${svc}`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {bookingResults && bookingResults.some((r) => !r.ok) && (
                <div
                  className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/70 p-2.5"
                  data-testid="panel-sp-pg-results"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Booking results
                  </div>
                  <ul className="space-y-1">
                    {bookingResults.map((r) => (
                      <li
                        key={r.service}
                        className="flex items-start gap-1.5 text-[11px]"
                        data-testid={`sp-pg-result-row-${r.service}`}
                      >
                        {r.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                        )}
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">
                            {r.service}
                          </span>
                          {r.ok ? (
                            <span className="text-slate-500"> — scheduled</span>
                          ) : (
                            <span className="text-red-600">
                              {" "}
                              — {r.error ?? "failed"}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <Label
                  htmlFor="sp-pg-appt-type"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Appointment type
                </Label>
                <select
                  id="sp-pg-appt-type"
                  value={appointmentType}
                  onChange={(e) => setAppointmentType(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: ACCENT }}
                  data-testid="select-sp-pg-appt-type"
                >
                  {APPOINTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label
                  htmlFor="sp-pg-location"
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  <MapPin className="h-3 w-3" />
                  Location
                </Label>
                <Input
                  id="sp-pg-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Room / site / mobile unit"
                  className="mt-1.5 rounded-xl"
                  data-testid="input-sp-pg-location"
                />
              </div>

              <div>
                <Label
                  htmlFor="sp-pg-note"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Note (optional)
                </Label>
                <Textarea
                  id="sp-pg-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1.5 min-h-[80px] rounded-xl"
                  placeholder="Context for the technician/scheduler"
                  data-testid="textarea-sp-pg-note"
                />
              </div>
            </div>
          </div>

          {/* Sticky confirm */}
          <div className="shrink-0 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-slate-500">Selected</span>
              <span className="font-semibold text-slate-800" data-testid="text-sp-pg-selection">
                {prettyDateLong(selectedDate)}
                {time ? ` · ${prettyTime(time)}` : ""}
                {selectedServices.length > 0
                  ? ` · ${selectedServices.length} test${selectedServices.length > 1 ? "s" : ""}`
                  : ""}
              </span>
            </div>
            <Button
              type="button"
              disabled={!canSubmit || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
              className="w-full gap-1.5 rounded-xl py-5 text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: ACCENT }}
              data-testid="button-sp-pg-submit"
            >
              {scheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {selectedServices.length > 1
                ? `Schedule ${selectedServices.length} tests`
                : "Confirm schedule"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

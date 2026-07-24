import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CanonicalMonthCalendar } from "@/calendar";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  CalendarPlus,
  Clock,
  CheckCircle2,
  Check,
  X,
  XCircle,
  CalendarDays,
} from "lucide-react";
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

// Patient-specific scheduling popup opened from right-panel work-queue
// rows. Separate from Plexus IQ calendar — this surface only writes to
// global_schedule_events through the canonical
// /api/global-schedule-events/schedule-ancillary route.
//
// Mode 1 of the two scheduling experiences: a fast, premium popup that
// keeps the current Playground content intact behind it.

const ACCENT = "#4863A0";

export const SERVICE_OPTIONS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
];

export const APPOINTMENT_TYPES = ["In-clinic", "Mobile unit", "Telehealth"];

// 8:00 AM – 4:30 PM in 30-minute steps.
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

export type SchedulePatientDialogPatient = {
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  serviceType?: string | null;
  // Enriched read-only context (shown when available; the call list does
  // not carry phone/insurance, so those stay null from that entry point).
  patientPhone?: string | null;
  insurance?: string | null;
  callReason?: string | null;
  nextActionAt?: string | null;
};

export type SchedulePatientDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: SchedulePatientDialogPatient | null;
  defaultDate?: string | null;
  defaultTime?: string | null;
  // Clinic choices for the editable Facility select shown in new-patient
  // (no-id) mode. When empty/omitted the facility falls back to a free-text
  // input.
  facilityOptions?: string[];
  onOpenInPlayground?: (payload: {
    patient: SchedulePatientDialogPatient;
    selectedDate: string;
  }) => void;
};

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function prettyTime(time: string): string {
  if (!/^(\d{1,2}):(\d{2})$/.test(time)) return time;
  const d = new Date(`2000-01-01T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(d.getTime())) return time;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function prettyDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function combineLocalDateAndTimeToIso(
  date: string,
  time: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

// Build the canonical note + metadata for a scheduling write so the
// appointment type and location persist (the schedule-ancillary route
// stores note + metadata alongside the event).
export function buildScheduleNote(
  note: string,
  appointmentType: string,
  location: string,
): string | null {
  const parts: string[] = [];
  if (appointmentType.trim()) parts.push(`Type: ${appointmentType.trim()}`);
  if (location.trim()) parts.push(`Location: ${location.trim()}`);
  if (note.trim()) parts.push(note.trim());
  return parts.length ? parts.join(" · ") : null;
}

// Per-test booking outcome surfaced after a fan-out confirm so partial
// failures are never silent.
export type BookingResult = { service: string; ok: boolean; error?: string };

// Clean, Apple-calendar-style date picker: a trigger button that opens a
// popover hosting the canonical month grid. Rendered above the z-[80]
// team-portal overlay (PopoverContent z-[95]). Selecting a day fires
// onChange and closes the popover.
function MonthCalendarPopover({
  value,
  onChange,
  testId,
  ariaLabel,
}: {
  value: string;
  onChange: (isoDate: string) => void;
  testId: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedCell = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? {
        [value]: {
          badge: {
            icon: <Check className="h-2.5 w-2.5" />,
            className: "bg-plexus-navy-800 text-white",
            title: "Selected date",
          },
        },
      }
    : {};
  const initialMonth = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? "Pick a date"}
          className="mt-1 flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 focus:outline-none focus:ring-2"
          style={{ ["--tw-ring-color" as string]: ACCENT }}
          data-testid={testId}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">
            {value ? prettyDateLong(value) : "Select a date"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[95] w-[340px] p-3 bg-white/20 backdrop-blur-2xl border-white/40 shadow-2xl rounded-2xl"
        data-testid={`${testId}-popover`}
      >
        <CanonicalMonthCalendar
          cells={selectedCell}
          initialMonth={initialMonth}
          onSelectDate={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SchedulePatientDialog({
  open,
  onOpenChange,
  patient,
  defaultDate,
  defaultTime,
  facilityOptions,
  onOpenInPlayground,
}: SchedulePatientDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const initialDate =
    defaultDate && /^\d{4}-\d{2}-\d{2}/.test(defaultDate)
      ? defaultDate.slice(0, 10)
      : todayIso();
  const initialTime =
    defaultTime && /^\d{1,2}:\d{2}$/.test(defaultTime) ? defaultTime : "";
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  // Multi-test selection — staff can book several ancillary tests in one
  // pass. Seeds from the incoming target service when present.
  const [selectedServices, setSelectedServices] = useState<string[]>(
    patient?.serviceType ? [patient.serviceType] : [],
  );
  const [time, setTime] = useState<string>(initialTime);
  // Per-test results from the last confirm; drives the partial-failure panel.
  const [bookingResults, setBookingResults] = useState<BookingResult[] | null>(
    null,
  );

  // New-patient (walk-in) mode: no screening/case id means the identity is
  // whatever the staff member types here — only the name is a hard
  // submission requirement, and the write goes through the existing
  // name-only server path (execution-case stub from patientName).
  const isNewPatientEntry =
    !!patient &&
    patient.patientScreeningId == null &&
    patient.executionCaseId == null;
  const [nameInput, setNameInput] = useState<string>("");

  // Composite patient identity. Screening/case ids alone are not enough:
  // quick-schedule name-only patients carry no ids, so switching between
  // two of them would otherwise skip the reset and reuse the previous
  // patient's date/time/service. Name, DOB, and target service are
  // folded in so every real patient change reseeds the form.
  const patientKey = [
    patient?.patientScreeningId ?? "",
    patient?.executionCaseId ?? "",
    patient?.patientName ?? "",
    patient?.patientDob ?? "",
    patient?.serviceType ?? "",
    patient?.facilityId ?? "",
  ].join("|");

  // Reset form when a new patient is opened OR the pre-fill date/time
  // changes (e.g. a hand-off from the quick-schedule pop-up).
  useEffect(() => {
    if (open) {
      setSelectedDate(initialDate);
      setSelectedServices(patient?.serviceType ? [patient.serviceType] : []);
      setBookingResults(null);
      setTime(initialTime);
      setNameInput(patient?.patientName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientKey, initialDate, initialTime]);

  // Effective identity: the editable name wins in new-patient mode;
  // otherwise the incoming patient record is authoritative. DOB and
  // facility ride along from the incoming record only.
  const effectiveName = isNewPatientEntry
    ? nameInput.trim() || null
    : (patient?.patientName ?? null);
  const effectiveDob = patient?.patientDob ?? null;
  const effectiveFacility = patient?.facilityId ?? null;

  // Test selection helper.
  const toggleService = (svc: string) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc],
    );
  };

  const canSubmit = useMemo(() => {
    if (!patient) return false;
    const hasIdentity =
      patient.patientScreeningId != null ||
      patient.executionCaseId != null ||
      !!effectiveName;
    if (!hasIdentity) return false;
    if (selectedServices.length === 0) return false;
    // Every selected test uses the shared date + time.
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [patient, effectiveName, selectedServices, selectedDate, time]);

  const scheduleMutation = useMutation({
    // Fan out one existing single-test write per selected test. Runs
    // sequentially so a brand-new (name-only) patient's first booking
    // creates the stub case and later bookings attach to that same case
    // (carried forward via the response) instead of duplicating it.
    mutationFn: async (): Promise<BookingResult[]> => {
      if (!patient) throw new Error("No patient selected");
      if (selectedServices.length === 0)
        throw new Error("Select at least one test");
      const results: BookingResult[] = [];
      let resolvedCaseId: number | null = patient.executionCaseId ?? null;
      let resolvedScreeningId: number | null =
        patient.patientScreeningId ?? null;
      const startsAtShared = combineLocalDateAndTimeToIso(selectedDate, time);
      for (const svc of selectedServices) {
        const startsAt = startsAtShared;
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
            // Carry the resolved case forward so a name-only walk-in's
            // first booking creates the stub and later tests attach to it.
            executionCaseId: resolvedCaseId,
            patientScreeningId: resolvedScreeningId,
            patientName: effectiveName,
            patientDob: effectiveDob,
            serviceType: svc,
            startsAt,
            facilityId: effectiveFacility,
            metadata: {
              source: "schedule_patient_dialog",
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
        facility: effectiveFacility,
        selectedDate,
        patientScreeningId: patient?.patientScreeningId ?? null,
      });
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({
          title:
            okCount === 1
              ? "Scheduled"
              : `${okCount} tests scheduled`,
          description: `for ${effectiveName ?? "patient"}.`,
        });
        onOpenChange(false);
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
        description:
          err instanceof Error ? err.message : "Schedule write failed.",
        variant: "destructive",
      });
    },
  });

  const initials = (effectiveName ?? "P")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent
        className="z-[95] max-w-3xl gap-0 overflow-hidden p-0"
        data-testid="dialog-schedule-patient"
      >
        <DialogTitle className="sr-only">
          Schedule {effectiveName ?? "patient"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Quick-schedule an ancillary appointment for this patient.
        </DialogDescription>
        {/* Compact header — patient name only */}
        <div
          className="relative px-6 py-5 text-white"
          style={{ backgroundImage: `linear-gradient(135deg, ${ACCENT}, #2f4673)` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-base font-bold backdrop-blur">
                {initials || <CalendarPlus className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                  <CalendarPlus className="h-3 w-3" />
                  Quick Schedule
                </div>
                <div
                  className="truncate text-xl font-bold leading-tight"
                  data-testid="text-schedule-patient-header-name"
                >
                  {effectiveName ??
                    (isNewPatientEntry ? "New patient" : "Patient")}
                </div>
                <div className="mt-0.5 text-xs text-white/75">
                  {effectiveDob ? `DOB ${effectiveDob}` : ""}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              data-testid="button-schedule-patient-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto p-6">
          {isNewPatientEntry && (
            <div>
              <Label
                htmlFor="schedule-patient-name"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Patient name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="schedule-patient-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="First and last name"
                className="mt-1 rounded-xl bg-white"
                autoComplete="off"
                data-testid="input-schedule-patient-name"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Date
              </Label>
              <MonthCalendarPopover
                value={selectedDate}
                onChange={setSelectedDate}
                testId="button-schedule-patient-date"
                ariaLabel="Pick appointment date"
              />
            </div>
            <div>
              <Label
                htmlFor="schedule-patient-time"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Time
              </Label>
              <Input
                id="schedule-patient-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 rounded-xl"
                data-testid="input-schedule-patient-time"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3 w-3" />
              Available slots
            </div>
            <div className="grid max-h-28 grid-cols-4 gap-1.5 overflow-auto pr-0.5">
              {TIME_SLOTS.map((slot) => {
                const active = slot === time;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setTime(slot)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-transparent text-white shadow-sm"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                    style={active ? { backgroundColor: ACCENT } : undefined}
                    data-testid={`schedule-patient-slot-${slot}`}
                  >
                    {prettyTime(slot)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Tests <span className="text-red-500">*</span>
              </Label>
              {selectedServices.length > 0 && (
                <span
                  className="text-[11px] font-medium text-slate-400"
                  data-testid="text-schedule-patient-selected-count"
                >
                  {selectedServices.length} selected
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_OPTIONS.map((svc) => {
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
                    data-testid={`chip-schedule-patient-service-${svc}`}
                  >
                    {active && <Check className="h-3 w-3" />}
                    {svc}
                  </button>
                );
              })}
            </div>
          </div>

          {bookingResults && bookingResults.some((r) => !r.ok) && (
            <div
              className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50/70 p-2.5"
              data-testid="panel-schedule-patient-results"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Booking results
              </div>
              <ul className="space-y-1">
                {bookingResults.map((r) => (
                  <li
                    key={r.service}
                    className="flex items-start gap-1.5 text-[11px]"
                    data-testid={`result-row-${r.service}`}
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
        </div>

        <DialogFooter className="gap-2 border-t border-slate-100 bg-slate-50/40 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-schedule-patient-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || scheduleMutation.isPending}
            onClick={() => scheduleMutation.mutate()}
            className="gap-1.5 text-white"
            style={{ backgroundColor: ACCENT }}
            data-testid="button-schedule-patient-submit"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

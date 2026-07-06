import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  Check,
  Loader2,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SERVICE_OPTIONS,
  TIME_SLOTS,
  prettyTime,
  combineLocalDateAndTimeToIso,
} from "@/components/portal/SchedulePatientDialog";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";
import { useToast } from "@/hooks/use-toast";

// Patient typeahead hit resolved against GET /api/plexus/patients/search —
// the always-registered patient-lookup endpoint (patient_screenings by
// name). `patientScreeningId` is the real screening id required by the
// schedule-ancillary write.
export type QuickSchedulePatientHit = {
  patientScreeningId: number;
  name: string;
  dob: string | null;
  insurance: string | null;
};

async function searchPatientsByName(
  query: string,
): Promise<QuickSchedulePatientHit[]> {
  const qs = new URLSearchParams({ q: query });
  const res = await fetch(`/api/plexus/patients/search?${qs}`, {
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string })?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(
      `Patient search failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const rows = (await res.json()) as Array<{
    id: number;
    name: string;
    dob: string | null;
    insurance: string | null;
  }>;
  return rows.map((r) => ({
    patientScreeningId: r.id,
    name: r.name,
    dob: r.dob ?? null,
    insurance: r.insurance ?? null,
  }));
}

// Minimal shape of a global-schedule event needed to summarize a patient's
// existing bookings for the chosen day.
type QuickScheduleDayEvent = {
  id?: number | string;
  eventType?: string | null;
  serviceType?: string | null;
  startsAt?: string | null;
  status?: string | null;
  facilityId?: string | null;
};

function fmtEventTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export type CalendarQuickSchedulePayload = {
  date: string;
  time: string;
  service: string;
  patientName: string;
  // Present when the typeahead resolved the name to a real patient record.
  resolvedPatient: QuickSchedulePatientHit | null;
};

export type CalendarQuickScheduleDialogProps = {
  open: boolean;
  date: string | null;
  facility?: string | null;
  onOpenChange: (open: boolean) => void;
  onSchedule: (payload: CalendarQuickSchedulePayload) => void;
  onOpenInPlayground: (payload: CalendarQuickSchedulePayload) => void;
};

/**
 * Lightweight scheduling pop-up launched from the left-rail Calendar tool and
 * from clicking a date in the compact mini-calendar (task #635). Collects a
 * date, time, service, and an optional patient. The patient field is a
 * typeahead against real patient records (task #636): when a patient is
 * resolved and date + time + service are all set, "Schedule" books the
 * appointment directly through the canonical schedulePatientAncillary write.
 * Free-text-only entries (or incomplete selections) still gracefully fall
 * back to the pre-fill handoff into the full SchedulePatientDialog.
 */
export function CalendarQuickScheduleDialog({
  open,
  date,
  facility,
  onOpenChange,
  onSchedule,
  onOpenInPlayground,
}: CalendarQuickScheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [service, setService] = useState<string>("");
  const [patientName, setPatientName] = useState<string>("");
  const [resolvedPatient, setResolvedPatient] = useState<QuickSchedulePatientHit | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setSelectedDate(date ?? "");
      setTime("");
      setService("");
      setPatientName("");
      setResolvedPatient(null);
      setSearchOpen(false);
    }
  }, [open, date]);

  const searchTerm = patientName.trim();
  const { data: matches = [], isFetching: searching } = useQuery<QuickSchedulePatientHit[]>({
    queryKey: ["calendar-quick-schedule-patient-search", searchTerm],
    queryFn: () => searchPatientsByName(searchTerm),
    enabled: open && !resolvedPatient && searchOpen && searchTerm.length >= 2,
  });

  // Existing appointments for the resolved patient on the chosen day —
  // same day-context read the full SchedulePatientDialog uses, so the
  // operator sees potential double-bookings before confirming.
  const { data: dayContext, isFetching: dayContextLoading } =
    useQuery<PatientScheduleDayContext>({
      queryKey: [
        "calendar-quick-schedule-day-context",
        facility ?? null,
        resolvedPatient?.patientScreeningId ?? null,
        selectedDate,
      ],
      queryFn: () =>
        fetchPatientScheduleDayContext({
          facilityId: facility ?? null,
          patientScreeningId: resolvedPatient?.patientScreeningId ?? null,
          selectedDate,
        }),
      enabled: open && !!resolvedPatient && !!selectedDate,
    });

  const patientDayEvents = useMemo(
    () => (dayContext?.patientEvents ?? []) as QuickScheduleDayEvent[],
    [dayContext],
  );

  // Same-service duplicate on the same day → visible warning (not a block).
  const duplicateServiceEvent = useMemo(() => {
    const svc = service.trim().toLowerCase();
    if (!svc) return null;
    return (
      patientDayEvents.find(
        (e) => (e.serviceType ?? "").trim().toLowerCase() === svc,
      ) ?? null
    );
  }, [patientDayEvents, service]);

  const payload: CalendarQuickSchedulePayload = {
    date: selectedDate,
    time,
    service,
    patientName: searchTerm,
    resolvedPatient,
  };

  const canProceed = !!selectedDate;
  const startsAtIso = combineLocalDateAndTimeToIso(selectedDate, time);
  // Direct booking is possible only with a resolved real patient plus a
  // complete date + time + service selection.
  const canBookDirectly = useMemo(
    () => !!resolvedPatient && !!service.trim() && !!startsAtIso,
    [resolvedPatient, service, startsAtIso],
  );

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedPatient) throw new Error("No patient selected");
      if (!startsAtIso) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: null,
        patientScreeningId: resolvedPatient.patientScreeningId,
        serviceType: service.trim(),
        startsAt: startsAtIso,
        facilityId: facility ?? null,
        note: null,
        metadata: { source: "calendar_quick_schedule" },
      });
    },
    onSuccess: () => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: facility ?? null,
        selectedDate,
        patientScreeningId: resolvedPatient?.patientScreeningId ?? null,
      });
      toast({
        title: "Scheduled",
        description: `${service.trim()} for ${resolvedPatient?.name ?? "patient"} on ${selectedDate} at ${prettyTime(time)}.`,
      });
      onOpenChange(false);
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

  function pickPatient(row: QuickSchedulePatientHit) {
    setResolvedPatient(row);
    setPatientName(row.name);
    setSearchOpen(false);
  }

  function clearResolvedPatient() {
    setResolvedPatient(null);
    setPatientName("");
    setSearchOpen(false);
  }

  function handleSchedule() {
    if (canBookDirectly) {
      bookMutation.mutate();
    } else {
      onSchedule(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[90] max-w-md" data-testid="dialog-calendar-quick-schedule">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#4863A0]">
            <CalendarDays className="h-4 w-4" />
            Quick Schedule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-date">Date</Label>
            <Input
              id="quick-schedule-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              data-testid="input-quick-schedule-date"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-time">Time</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="quick-schedule-time" data-testid="select-quick-schedule-time">
                <SelectValue placeholder="Select a time" />
              </SelectTrigger>
              <SelectContent className="z-[95]">
                {TIME_SLOTS.map((slot) => (
                  <SelectItem key={slot} value={slot}>
                    {prettyTime(slot)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-service">Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger id="quick-schedule-service" data-testid="select-quick-schedule-service">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent className="z-[95]">
                {SERVICE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quick-schedule-patient">Patient (optional)</Label>
            {resolvedPatient ? (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2"
                data-testid="chip-quick-schedule-resolved-patient"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {resolvedPatient.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {[
                        resolvedPatient.dob ? `DOB ${resolvedPatient.dob}` : null,
                        resolvedPatient.insurance,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Patient record linked"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearResolvedPatient}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                  aria-label="Clear selected patient"
                  data-testid="button-quick-schedule-clear-patient"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="quick-schedule-patient"
                    value={patientName}
                    onChange={(e) => {
                      setPatientName(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="Search patients or type a name…"
                    className="pl-8"
                    autoComplete="off"
                    data-testid="input-quick-schedule-patient"
                  />
                  {searching && (
                    <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                  )}
                </div>
                {searchOpen && searchTerm.length >= 2 && (
                  <div
                    className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
                    data-testid="list-quick-schedule-patient-matches"
                  >
                    {matches.length === 0 && !searching ? (
                      <div className="px-3 py-2 text-xs italic text-slate-500">
                        No matching patients — use "New patient" below to enter
                        their details.
                      </div>
                    ) : (
                      <ul className="max-h-52 overflow-y-auto py-1">
                        {matches.map((p) => (
                          <li key={p.patientScreeningId}>
                            <button
                              type="button"
                              onClick={() => pickPatient(p)}
                              className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-50"
                              data-testid={`option-quick-schedule-patient-${p.patientScreeningId}`}
                            >
                              <span className="text-sm font-medium text-slate-900">
                                {p.name}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {[
                                  p.dob ? `DOB ${p.dob}` : null,
                                  p.insurance,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            {resolvedPatient && selectedDate && (
              <div
                className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2"
                data-testid="section-quick-schedule-day-context"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <CalendarClock className="h-3 w-3" />
                  Existing appointments · {selectedDate}
                </div>
                {dayContextLoading ? (
                  <div className="flex items-center gap-1.5 text-[11px] italic text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking this patient's day…
                  </div>
                ) : patientDayEvents.length === 0 ? (
                  <div
                    className="text-[11px] text-slate-500"
                    data-testid="text-quick-schedule-no-existing"
                  >
                    No existing appointments for {resolvedPatient.name} on this
                    day.
                  </div>
                ) : (
                  <ul
                    className="space-y-1"
                    data-testid="list-quick-schedule-existing-appointments"
                  >
                    {patientDayEvents.map((evt, i) => (
                      <li
                        key={evt.id ?? i}
                        className="flex items-center gap-2 text-[11px] text-slate-700"
                        data-testid={`row-quick-schedule-existing-${evt.id ?? i}`}
                      >
                        <span className="font-medium">
                          {fmtEventTime(evt.startsAt) || "Time TBD"}
                        </span>
                        <span className="truncate">
                          {evt.serviceType || evt.eventType || "Appointment"}
                        </span>
                        {evt.status ? (
                          <span className="text-slate-400">· {evt.status}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {duplicateServiceEvent && (
                  <div
                    className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800"
                    data-testid="warning-quick-schedule-duplicate-service"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>
                      {resolvedPatient.name} already has{" "}
                      <span className="font-semibold">{service.trim()}</span>{" "}
                      scheduled on this day
                      {fmtEventTime(duplicateServiceEvent.startsAt)
                        ? ` at ${fmtEventTime(duplicateServiceEvent.startsAt)}`
                        : ""}
                      . Booking again will create a duplicate.
                    </span>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-500" data-testid="text-quick-schedule-hint">
              {canBookDirectly
                ? "Ready to book — Schedule will create this appointment."
                : resolvedPatient
                  ? "Pick a time and service to book directly, or Schedule to continue in the full dialog."
                  : "Select a patient from the list to book directly; free text opens the full dialog pre-filled."}
            </p>
            {!resolvedPatient && (
              <button
                type="button"
                disabled={!canProceed || bookMutation.isPending}
                onClick={() => onSchedule(payload)}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                title="Enter a new patient's name, DOB, and facility in the full dialog"
                data-testid="button-quick-schedule-new-patient"
              >
                <UserPlus className="h-3.5 w-3.5" />
                New patient — enter name &amp; DOB
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canProceed || bookMutation.isPending}
            onClick={() => onOpenInPlayground(payload)}
            data-testid="button-quick-schedule-playground"
          >
            Open in Playground
          </Button>
          <Button
            type="button"
            disabled={!canProceed || bookMutation.isPending}
            onClick={handleSchedule}
            data-testid="button-quick-schedule-submit"
          >
            {bookMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Scheduling…
              </>
            ) : canBookDirectly ? (
              "Book appointment"
            ) : (
              "Schedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

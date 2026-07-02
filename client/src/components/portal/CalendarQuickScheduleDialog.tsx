import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Loader2, Search, X } from "lucide-react";
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
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
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
      <DialogContent className="max-w-md" data-testid="dialog-calendar-quick-schedule">
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
              <SelectContent>
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
              <SelectContent>
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
                        No matching patients — free text will pre-fill the full
                        dialog instead.
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
            <p className="text-[11px] text-slate-500" data-testid="text-quick-schedule-hint">
              {canBookDirectly
                ? "Ready to book — Schedule will create this appointment."
                : resolvedPatient
                  ? "Pick a time and service to book directly, or Schedule to continue in the full dialog."
                  : "Select a patient from the list to book directly; free text opens the full dialog pre-filled."}
            </p>
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

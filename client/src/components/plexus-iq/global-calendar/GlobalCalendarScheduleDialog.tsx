// Admin-only scheduling popup for the Plexus IQ global calendar.
//
// This popup is a thin, refined UI layer over the app's canonical scheduling
// primitives — it does NOT introduce a parallel scheduling path:
//   - Patient search: cross-facility by name (/api/plexus/patients/search) OR
//     facility-then-patient (/api/portal/patient-search?facility=).
//   - Ancillary choice: a DROPDOWN sourced from the Ancillary Service Registry
//     (fetchActiveServicesForFacility) so it always reflects wherever
//     ancillaries are added/enabled — never a hardcoded list. Ultrasound
//     subtypes are chosen from the same registry dropdown.
//   - Time slots: the real capacity-aware availability engine
//     (POST /api/scheduling/availability via fetchAvailability). Slots render
//     as classy UNFILLED circular time chips. Admin may double/triple-book via
//     the server-enforced authorized override (metadata.override).
//   - Write: schedulePatientAncillary → POST
//     /api/global-schedule-events/schedule-ancillary, the single canonical
//     writer, so the booking wires into the clinic's calendar + patient
//     journey automatically.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, UserRound, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useFacilities } from "@/hooks/api/organization";
import { usePatientSearch } from "@/features/plexus-tasks/hooks";
import { searchPatients, type PatientSearchRow } from "@/lib/portal/commandCenterApi";
import {
  fetchActiveServicesForFacility,
  bucketServices,
  schedulerCategoryOf,
  type RegistryService,
  type SchedulerCategory,
} from "@/lib/scheduling/serviceRegistry";
import {
  fetchAvailability,
  prettyMinutes,
  type ResourceType,
  type SlotAvailability,
} from "@/lib/scheduling/availabilityApi";
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { combineLocalDateAndTimeToIso, prettyDate } from "@/components/portal/caseWorkspace";

type SelectedPatient = {
  patientScreeningId: number;
  name: string;
  facility: string | null;
};

export function GlobalCalendarScheduleDialog({
  open,
  onOpenChange,
  isoDate,
  defaultFacility,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The day clicked on the calendar (YYYY-MM-DD). Falls back to today. */
  isoDate: string | null;
  /** Facility currently scoped in the calendar's gear filter, if any. */
  defaultFacility?: string | null;
  /** Fires after a successful booking so the calendar can refresh. */
  onScheduled?: () => void;
}) {
  const { toast } = useToast();
  const { data: facilities = [] } = useFacilities();

  // ── Facility + patient selection ────────────────────────────────────────
  const [facility, setFacility] = useState<string>("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patient, setPatient] = useState<SelectedPatient | null>(null);

  // ── Ancillary selection (registry-sourced) ──────────────────────────────
  const [serviceCode, setServiceCode] = useState<string>("");

  // ── Slot selection ──────────────────────────────────────────────────────
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const targetDate = useMemo(
    () => (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : todayIso()),
    [isoDate],
  );

  // Reset transient state whenever the dialog opens for a (possibly new) day.
  useEffect(() => {
    if (open) {
      setFacility(defaultFacility?.trim() ? defaultFacility.trim() : "");
      setPatientQuery("");
      setPatient(null);
      setServiceCode("");
      setSelectedTime(null);
    }
  }, [open, defaultFacility]);

  // Cross-facility name search (mode A). Facility-scoped search (mode B) runs
  // when a facility is selected. Both feed the same result list.
  const nameSearch = usePatientSearch(facility ? "" : patientQuery);
  const facilitySearch = useQuery<PatientSearchRow[]>({
    queryKey: ["global-cal-facility-patient-search", facility, patientQuery],
    enabled: open && !!facility && patientQuery.trim().length >= 2,
    staleTime: 30_000,
    queryFn: () => searchPatients({ query: patientQuery.trim(), facility, limit: 25 }),
  });

  const patientResults: SelectedPatient[] = useMemo(() => {
    if (facility) {
      return (facilitySearch.data ?? []).map((r) => ({
        patientScreeningId: r.patientScreeningId,
        name: r.name,
        facility: r.facility ?? facility,
      }));
    }
    return (nameSearch.data ?? []).map((r) => ({
      patientScreeningId: r.id,
      name: r.name,
      facility: null,
    }));
  }, [facility, facilitySearch.data, nameSearch.data]);

  const searching = facility ? facilitySearch.isFetching : nameSearch.isFetching;

  // Effective facility for availability + registry lookups: the patient's own
  // facility (when known) wins, otherwise the explicitly-selected facility.
  const effectiveFacility = patient?.facility ?? (facility || null);

  // ── Ancillary service registry (facility-scoped) ────────────────────────
  const { data: services = [] } = useQuery<RegistryService[]>({
    queryKey: ["global-cal-services", effectiveFacility],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => fetchActiveServicesForFacility(effectiveFacility),
  });

  const serviceGroups = useMemo(() => bucketServices(services), [services]);
  const selectedService = useMemo(
    () => services.find((s) => s.internalCode === serviceCode) ?? null,
    [services, serviceCode],
  );

  const resourceType: ResourceType | null = useMemo(() => {
    if (!selectedService) return null;
    const cat: SchedulerCategory | null = schedulerCategoryOf(selectedService);
    return cat;
  }, [selectedService]);

  // ── Availability (real capacity-aware engine) ───────────────────────────
  const availability = useQuery({
    queryKey: [
      "global-cal-availability",
      effectiveFacility,
      targetDate,
      resourceType,
    ],
    enabled: open && !!resourceType,
    staleTime: 15_000,
    queryFn: () =>
      fetchAvailability({
        facility: effectiveFacility,
        date: targetDate,
        services: [{ resourceType: resourceType as ResourceType }],
        patientKey: patient ? String(patient.patientScreeningId) : null,
      }),
  });

  const slots: SlotAvailability[] = availability.data?.slots ?? [];

  const canBook = !!patient && !!selectedService && !!selectedTime && !booking;

  async function handleBook() {
    if (!patient || !selectedService || !selectedTime) return;
    const startsAt = combineLocalDateAndTimeToIso(targetDate, selectedTime);
    if (!startsAt) {
      toast({ title: "Invalid time", variant: "destructive" });
      return;
    }
    // If the chosen slot is not a recommended fit (e.g. FULL), an admin can
    // still book via the server-enforced authorized override.
    const slot = slots.find((s) => s.time === selectedTime);
    const needsOverride = slot ? !slot.fits : false;

    setBooking(true);
    try {
      await schedulePatientAncillary({
        patientScreeningId: patient.patientScreeningId,
        patientName: patient.name,
        serviceType: selectedService.internalCode,
        startsAt,
        facilityId: effectiveFacility,
        metadata: {
          source: "plexus_iq_global_calendar",
          ...(needsOverride
            ? {
                override: {
                  constraint: slot?.constraint ?? "full",
                  reason: "Admin override from global calendar (double/triple-book)",
                },
              }
            : {}),
        },
      });
      toast({
        title: "Scheduled",
        description: `${selectedService.displayName} for ${patient.name} on ${prettyDate(targetDate)}.`,
      });
      onScheduled?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not schedule",
        description: err instanceof Error ? err.message : "Schedule write failed.",
        variant: "destructive",
      });
    } finally {
      setBooking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="global-cal-schedule-dialog">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-slate-900">
            Schedule · {prettyDate(targetDate)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* FACILITY (optional — enables facility-then-patient mode) */}
          <Field label="Facility (optional)">
            <Select
              value={facility || "__any__"}
              onValueChange={(v) => {
                setFacility(v === "__any__" ? "" : v);
                setPatient(null);
              }}
            >
              <SelectTrigger className="h-9" data-testid="global-cal-facility-select">
                <SelectValue placeholder="Any facility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any facility (search all)</SelectItem>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* PATIENT search */}
          <Field label="Patient">
            {patient ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{patient.name}</div>
                    {patient.facility && (
                      <div className="truncate text-[11px] text-slate-500">{patient.facility}</div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPatient(null)}
                  className="rounded p-1 text-slate-400 hover:text-slate-700"
                  data-testid="global-cal-clear-patient"
                  aria-label="Clear patient"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder={facility ? `Search patients in ${facility}` : "Search patients across all facilities"}
                    className="h-9 pl-9"
                    data-testid="global-cal-patient-search"
                  />
                </div>
                {patientQuery.trim().length >= 2 && (
                  <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200">
                    {searching ? (
                      <div className="flex items-center justify-center py-4 text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : patientResults.length === 0 ? (
                      <div className="py-4 text-center text-[12px] text-slate-400">No patients found</div>
                    ) : (
                      patientResults.map((p) => (
                        <button
                          key={p.patientScreeningId}
                          type="button"
                          onClick={() => {
                            setPatient(p);
                            setServiceCode("");
                            setSelectedTime(null);
                          }}
                          className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                          data-testid={`global-cal-patient-result-${p.patientScreeningId}`}
                        >
                          <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="flex-1 truncate text-sm text-slate-800">{p.name}</span>
                          {p.facility && (
                            <span className="shrink-0 text-[11px] text-slate-400">{p.facility}</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </Field>

          {/* ANCILLARY dropdown (registry-sourced, grouped) */}
          <Field label="Ancillary">
            <Select
              value={serviceCode}
              onValueChange={(v) => {
                setServiceCode(v);
                setSelectedTime(null);
              }}
              disabled={!patient || services.length === 0}
            >
              <SelectTrigger className="h-9" data-testid="global-cal-ancillary-select">
                <SelectValue placeholder={services.length === 0 ? "No active services" : "Choose an ancillary"} />
              </SelectTrigger>
              <SelectContent>
                {serviceGroups.brainwave && (
                  <SelectItem value={serviceGroups.brainwave.internalCode}>
                    {serviceGroups.brainwave.displayName}
                  </SelectItem>
                )}
                {serviceGroups.vitalwave && (
                  <SelectItem value={serviceGroups.vitalwave.internalCode}>
                    {serviceGroups.vitalwave.displayName}
                  </SelectItem>
                )}
                {serviceGroups.ultrasound.map((u) => (
                  <SelectItem key={u.internalCode} value={u.internalCode}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* TIME SLOTS — classy unfilled circular chips */}
          {selectedService && (
            <Field label="Available times">
              {availability.isFetching ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : slots.length === 0 ? (
                <div className="py-3 text-center text-[12px] text-slate-400">
                  No time slots for this day
                </div>
              ) : (
                <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto py-1">
                  {slots.map((slot) => {
                    const active = selectedTime === slot.time;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setSelectedTime(slot.time)}
                        title={slot.fits ? `${slot.available} of ${slot.total} free` : slot.reason}
                        className={[
                          "flex h-9 items-center justify-center rounded-full border text-[12px] font-medium transition",
                          active
                            ? "border-plexus-navy-800 bg-plexus-navy-800 text-white"
                            : slot.fits
                              ? "border-slate-300 bg-transparent text-slate-700 hover:border-plexus-navy-800 hover:text-plexus-navy-800"
                              : "border-dashed border-amber-300 bg-transparent text-amber-600 hover:border-amber-500",
                        ].join(" ")}
                        data-testid={`global-cal-slot-${slot.time}`}
                      >
                        {prettyMinutes(slot.startMinutes)}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedTime && slots.find((s) => s.time === selectedTime && !s.fits) && (
                <p className="mt-1 text-[11px] text-amber-600">
                  This slot is not normally available — booking will apply an admin override.
                </p>
              )}
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-800"
              data-testid="global-cal-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canBook}
              onClick={handleBook}
              className="inline-flex items-center gap-2 rounded-lg bg-plexus-navy-800 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="global-cal-book"
            >
              {booking && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

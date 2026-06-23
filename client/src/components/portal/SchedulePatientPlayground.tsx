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
  CalendarDays,
  Stethoscope,
  CheckCircle2,
  User,
} from "lucide-react";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import type { SchedulePatientDialogPatient } from "@/components/portal/SchedulePatientDialog";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

// Expanded center-Playground scheduling view. Same data/write contracts as
// SchedulePatientDialog — pulls per-day events from global_schedule_events
// and writes through POST /api/global-schedule-events/schedule-ancillary.

const ACCENT = "#4863A0";

const SERVICE_OPTIONS = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE (93306)",
  "Renal Artery Doppler (93975)",
  "Lower Extremity Arterial Doppler (93925)",
  "Abdominal Aortic Aneurysm Duplex (93978)",
  "Lower Extremity Venous Duplex (93971)",
];

// 8:00 AM – 4:30 PM in 30-minute steps.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 16; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

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

function prettyTime(time: string): string {
  if (!/^(\d{1,2}):(\d{2})$/.test(time)) return time;
  const d = new Date(`2000-01-01T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(d.getTime())) return time;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function prettyDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function combineLocalDateAndTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) return null;
  const local = new Date(`${date}T${time.padStart(5, "0")}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
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
      className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-[11px] italic text-slate-400">
          {emptyText}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 16).map((evt, idx) => {
            const r = evtTitle(evt);
            return (
              <li
                key={idx}
                className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-700 transition-colors hover:bg-slate-100/70"
              >
                <div className="truncate font-medium text-slate-900">{r.title}</div>
                {r.sub && (
                  <div className="truncate text-[10px] text-slate-500">{r.sub}</div>
                )}
              </li>
            );
          })}
          {rows.length > 16 && (
            <li className="text-[10px] italic text-slate-400">
              and {rows.length - 16} more…
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
  const [serviceType, setServiceType] = useState<string>(patient.serviceType ?? "");
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState<string>("");

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

  const canSubmit = useMemo(() => {
    if (!(patient.patientScreeningId ?? patient.executionCaseId)) return false;
    if (!serviceType.trim()) return false;
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [patient, serviceType, selectedDate, time]);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const startsAt = combineLocalDateAndTimeToIso(selectedDate, time);
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: patient.executionCaseId ?? null,
        patientScreeningId: patient.patientScreeningId ?? null,
        serviceType: serviceType.trim(),
        startsAt,
        facilityId: patient.facilityId ?? null,
        note: note.trim() || null,
        metadata: { source: "schedule_patient_playground" },
      });
    },
    onSuccess: () => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: patient.facilityId ?? null,
        selectedDate,
        patientScreeningId: patient.patientScreeningId ?? null,
      });
      toast({
        title: "Scheduled",
        description: `${serviceType.trim()} for ${patient.patientName ?? "patient"}.`,
      });
      setTime("");
      setNote("");
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

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_20px_70px_rgba(15,23,42,0.10)]"
      data-testid="schedule-patient-playground"
    >
      {/* Premium gradient header */}
      <div
        className="relative px-7 py-6 text-white"
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
                {patient.facilityId && (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1 w-1 rounded-full bg-white/50" />
                    {patient.facilityId}
                  </span>
                )}
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

      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          {/* Booking panel */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CalendarDays className="h-4 w-4" style={{ color: ACCENT }} />
              New appointment
            </div>

            <div>
              <Label
                htmlFor="sp-pg-date"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Date
              </Label>
              <Input
                id="sp-pg-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1.5 rounded-xl"
                data-testid="input-sp-pg-date"
              />
              <div className="mt-1 text-[11px] text-slate-400">
                {prettyDateLong(selectedDate)}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Time
              </div>
              <div className="grid max-h-40 grid-cols-3 gap-1.5 overflow-auto pr-0.5">
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
                      data-testid={`sp-pg-slot-${slot}`}
                    >
                      {prettyTime(slot)}
                    </button>
                  );
                })}
              </div>
              <Input
                id="sp-pg-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-2 rounded-xl"
                data-testid="input-sp-pg-time"
              />
            </div>

            <div>
              <Label
                htmlFor="sp-pg-service"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Service type
              </Label>
              <select
                id="sp-pg-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: ACCENT }}
                data-testid="select-sp-pg-service-type"
              >
                <option value="">— Select service —</option>
                {(serviceType && !SERVICE_OPTIONS.includes(serviceType)
                  ? [serviceType, ...SERVICE_OPTIONS]
                  : SERVICE_OPTIONS
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
                className="mt-1.5 min-h-[88px] rounded-xl"
                placeholder="Context for the technician/scheduler"
                data-testid="textarea-sp-pg-note"
              />
            </div>

            <Button
              type="button"
              disabled={!canSubmit || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
              className="w-full gap-1.5 rounded-xl py-5 text-sm font-semibold shadow-sm"
              style={{ backgroundColor: ACCENT }}
              data-testid="button-sp-pg-submit"
            >
              {scheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {time ? `Schedule at ${prettyTime(time)}` : "Schedule"}
            </Button>
          </div>

          {/* Day at a glance */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" />
              Day at a glance · {prettyDateLong(selectedDate)}
            </div>
            {contextLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-xs italic text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading day context…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                  emptyText="No existing events for this patient on this day."
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
      </div>
    </div>
  );
}

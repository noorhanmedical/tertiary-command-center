import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Maximize2,
  CalendarPlus,
  Clock,
  Stethoscope,
  Phone,
  Building2,
  ShieldCheck,
  Bell,
  CheckCircle2,
  MapPin,
  UserPlus,
  X,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import {
  fetchPatientScheduleDayContext,
  schedulePatientAncillary,
  type PatientScheduleDayContext,
} from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

// Patient-specific scheduling popup opened from right-panel work-queue
// rows. Separate from Plexus IQ calendar — this surface only writes to
// global_schedule_events through the canonical
// /api/global-schedule-events/schedule-ancillary route.
//
// Mode 1 of the two scheduling experiences: a fast, premium popup that
// keeps the current Playground content intact behind it.

const ACCENT = "#4863A0";

// Shape returned by GET /api/execution-cases/similar — the duplicate-
// prevention lookup that powers the "did you mean this existing patient?"
// panel for name-only (walk-in) patients.
export type SimilarPatientMatch = {
  id: number;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  patientScreeningId: number | null;
  source: string;
  qualificationStatus: string;
  engagementStatus: string;
  createdAt: string | null;
  matchReason: "exact_name" | "similar_name" | "same_dob_similar_name";
};

const MATCH_REASON_LABEL: Record<SimilarPatientMatch["matchReason"], string> = {
  exact_name: "Same name",
  similar_name: "Similar name",
  same_dob_similar_name: "Similar name · same DOB",
};

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

function evtRowLabel(evt: unknown): { title: string; sub: string } {
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

function ContextChip({
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
    <div
      className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white"
      title={`${label}: ${value}`}
      data-testid={testId}
    >
      <span className="text-white/70">{icon}</span>
      <span className="truncate max-w-[180px]">{value}</span>
    </div>
  );
}

function EventList({
  label,
  rows,
  emptyText,
  testId,
}: {
  label: string;
  rows: unknown[];
  emptyText: string;
  testId: string;
}) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}{" "}
        {rows.length > 0 && (
          <span className="ml-1 text-slate-400">{rows.length}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">{emptyText}</div>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 6).map((evt, idx) => {
            const r = evtRowLabel(evt);
            return (
              <li
                key={idx}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
              >
                <div className="font-medium text-slate-900 truncate">
                  {r.title}
                </div>
                {r.sub && (
                  <div className="text-[10px] text-slate-500 truncate">
                    {r.sub}
                  </div>
                )}
              </li>
            );
          })}
          {rows.length > 6 && (
            <li className="text-[10px] text-slate-400 italic">
              and {rows.length - 6} more…
            </li>
          )}
        </ul>
      )}
    </div>
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
  const [serviceType, setServiceType] = useState<string>(
    patient?.serviceType ?? "",
  );
  const [appointmentType, setAppointmentType] = useState<string>(
    APPOINTMENT_TYPES[0],
  );
  const [location, setLocation] = useState<string>("");
  const [time, setTime] = useState<string>(initialTime);
  const [note, setNote] = useState<string>("");

  // New-patient (walk-in) mode: no screening/case id means the identity is
  // whatever the staff member types here — Name / DOB / Facility become
  // editable inputs and the write goes through the existing name-only
  // server path (execution-case stub from patientName).
  const isNewPatientEntry =
    !!patient &&
    patient.patientScreeningId == null &&
    patient.executionCaseId == null;
  const [nameInput, setNameInput] = useState<string>("");
  const [dobInput, setDobInput] = useState<string>("");
  const [facilityInput, setFacilityInput] = useState<string>("");

  // Composite patient identity. Screening/case ids alone are not enough:
  // quick-schedule name-only patients carry no ids, so switching between
  // two of them would otherwise skip the reset and reuse the previous
  // patient's date/time/service/note. Name, DOB, and target service are
  // folded in so every real patient change reseeds the form.
  const patientKey = [
    patient?.patientScreeningId ?? "",
    patient?.executionCaseId ?? "",
    patient?.patientName ?? "",
    patient?.patientDob ?? "",
    patient?.serviceType ?? "",
    patient?.facilityId ?? "",
  ].join("|");

  // Duplicate prevention: when the patient carries no ids (name-only
  // walk-in), staff can link this appointment to a likely existing case
  // instead of letting the server create a duplicate stub.
  const [selectedMatch, setSelectedMatch] = useState<SimilarPatientMatch | null>(null);
  const [matchesDismissed, setMatchesDismissed] = useState(false);

  // Reset form when a new patient is opened OR the pre-fill date/time
  // changes (e.g. a hand-off from the quick-schedule pop-up).
  useEffect(() => {
    if (open) {
      setSelectedDate(initialDate);
      setServiceType(patient?.serviceType ?? "");
      setAppointmentType(APPOINTMENT_TYPES[0]);
      setLocation(patient?.facilityId ?? "");
      setTime(initialTime);
      setNote("");
      setSelectedMatch(null);
      setMatchesDismissed(false);
      setNameInput(patient?.patientName ?? "");
      setDobInput(patient?.patientDob ?? "");
      setFacilityInput(patient?.facilityId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientKey, initialDate, initialTime]);

  // Effective identity: editable inputs win in new-patient mode; otherwise
  // the incoming patient record is authoritative.
  const effectiveName = isNewPatientEntry
    ? nameInput.trim() || null
    : (patient?.patientName ?? null);
  const effectiveDob = isNewPatientEntry
    ? dobInput.trim() || null
    : (patient?.patientDob ?? null);
  const effectiveFacility = isNewPatientEntry
    ? facilityInput.trim() || null
    : (patient?.facilityId ?? null);

  // Name-only patient = quick-schedule fallback / walk-in territory. Only
  // then do we look up similar existing patients (identified patients
  // already resolve to their own case server-side). Uses the effective
  // identity so names typed in new-patient mode drive the lookup too.
  const isNameOnlyPatient =
    !!patient &&
    patient.patientScreeningId == null &&
    patient.executionCaseId == null &&
    !!effectiveName;

  const { data: similarData } = useQuery<{ matches: SimilarPatientMatch[] }>({
    queryKey: [
      "/api/execution-cases/similar",
      effectiveName ?? "",
      effectiveDob ?? "",
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ name: effectiveName ?? "" });
      if (effectiveDob) params.set("dob", effectiveDob);
      const res = await fetch(`/api/execution-cases/similar?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Similar-patient lookup failed");
      return res.json();
    },
    enabled: open && isNameOnlyPatient,
    staleTime: 30_000,
  });

  const similarMatches = isNameOnlyPatient ? (similarData?.matches ?? []) : [];

  const { data: dayContext, isLoading: contextLoading } =
    useQuery<PatientScheduleDayContext>({
      queryKey: [
        "schedule-patient-day-context",
        effectiveFacility,
        patient?.patientScreeningId ?? null,
        patient?.executionCaseId ?? null,
        selectedDate,
      ],
      queryFn: () =>
        fetchPatientScheduleDayContext({
          facilityId: effectiveFacility,
          patientScreeningId: patient?.patientScreeningId ?? null,
          executionCaseId: patient?.executionCaseId ?? null,
          selectedDate,
        }),
      enabled: open && !!patient,
    });

  // Name-only patients (walk-ins / not yet screened) are schedulable:
  // the server creates a minimal execution case stub from patientName
  // when neither id resolves. Either an id OR a non-empty name is enough.
  const canSubmit = useMemo(() => {
    if (!patient) return false;
    const hasIdentity =
      patient.patientScreeningId != null ||
      patient.executionCaseId != null ||
      !!effectiveName;
    if (!hasIdentity) return false;
    if (!serviceType.trim()) return false;
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [patient, effectiveName, serviceType, selectedDate, time]);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!patient) throw new Error("No patient selected");
      const startsAt = combineLocalDateAndTimeToIso(selectedDate, time);
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        // When staff picked a likely existing patient, link to that case
        // instead of letting the server create a duplicate stub.
        executionCaseId:
          patient.executionCaseId ?? selectedMatch?.id ?? null,
        patientScreeningId:
          patient.patientScreeningId ?? selectedMatch?.patientScreeningId ?? null,
        patientName: effectiveName,
        patientDob: effectiveDob,
        serviceType: serviceType.trim(),
        startsAt,
        facilityId: effectiveFacility,
        note: buildScheduleNote(note, appointmentType, location),
        metadata: {
          source: "schedule_patient_dialog",
          appointmentType: appointmentType.trim() || null,
          location: location.trim() || null,
        },
      });
    },
    onSuccess: () => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: effectiveFacility,
        selectedDate,
        patientScreeningId: patient?.patientScreeningId ?? null,
      });
      toast({
        title: "Scheduled",
        description: `${serviceType.trim()} for ${effectiveName ?? "patient"}.`,
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

  const initials = (effectiveName ?? "P")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  const nextAction = fmtNextAction(patient?.nextActionAt);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <DialogContent
        className="max-w-3xl gap-0 overflow-hidden p-0"
        data-testid="dialog-schedule-patient"
      >
        <DialogTitle className="sr-only">
          Schedule {effectiveName ?? "patient"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Quick-schedule an ancillary appointment for this patient.
        </DialogDescription>
        {/* Premium gradient header with patient + context chips */}
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
            <div className="flex items-center gap-1.5">
              {patient && onOpenInPlayground && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInPlayground({
                      patient: {
                        ...patient,
                        patientName: effectiveName,
                        patientDob: effectiveDob,
                        facilityId: effectiveFacility,
                      },
                      selectedDate,
                    });
                    onOpenChange(false);
                  }}
                  aria-label="Open full scheduler"
                  title="Open full scheduler in Playground"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
                  data-testid="button-schedule-patient-open-in-playground"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Full scheduler
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                data-testid="button-schedule-patient-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {(patient?.callReason ||
            patient?.serviceType ||
            patient?.patientPhone ||
            effectiveFacility ||
            patient?.insurance ||
            nextAction) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {patient?.callReason && (
                <ContextChip
                  icon={<Bell className="h-3 w-3" />}
                  label="Call reason"
                  value={patient.callReason}
                  testId="schedule-patient-chip-reason"
                />
              )}
              {patient?.serviceType && (
                <ContextChip
                  icon={<Stethoscope className="h-3 w-3" />}
                  label="Target test"
                  value={patient.serviceType}
                  testId="schedule-patient-chip-service"
                />
              )}
              {patient?.patientPhone && (
                <ContextChip
                  icon={<Phone className="h-3 w-3" />}
                  label="Phone"
                  value={patient.patientPhone}
                  testId="schedule-patient-chip-phone"
                />
              )}
              {effectiveFacility && (
                <ContextChip
                  icon={<Building2 className="h-3 w-3" />}
                  label="Clinic"
                  value={effectiveFacility}
                  testId="schedule-patient-chip-clinic"
                />
              )}
              {patient?.insurance && (
                <ContextChip
                  icon={<ShieldCheck className="h-3 w-3" />}
                  label="Insurance"
                  value={patient.insurance}
                  testId="schedule-patient-chip-insurance"
                />
              )}
              {nextAction && (
                <ContextChip
                  icon={<Clock className="h-3 w-3" />}
                  label="Next action"
                  value={nextAction}
                  testId="schedule-patient-chip-next-action"
                />
              )}
            </div>
          )}
        </div>

        {/* Duplicate prevention — likely existing patients for name-only
            walk-ins. Picking one links the appointment to the existing
            case instead of creating a duplicate record. */}
        {isNameOnlyPatient && similarMatches.length > 0 && !matchesDismissed && (
          <div
            className="border-b border-amber-200 bg-amber-50/70 px-6 py-3"
            data-testid="panel-similar-patients"
          >
            {selectedMatch ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm text-emerald-800">
                  <UserCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    Linking to existing patient{" "}
                    <span className="font-semibold">{selectedMatch.patientName}</span>
                    {selectedMatch.patientDob ? ` (DOB ${selectedMatch.patientDob})` : ""}
                    {" — no duplicate record will be created."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMatch(null)}
                  className="shrink-0 text-xs font-semibold text-slate-600 underline-offset-2 hover:underline"
                  data-testid="button-similar-patient-unlink"
                >
                  Undo
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    Possible existing patient — is this the same person?
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatchesDismissed(true)}
                    className="shrink-0 text-xs font-medium text-amber-700 underline-offset-2 hover:underline"
                    data-testid="button-similar-patients-dismiss"
                  >
                    No, this is a new patient
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {similarMatches.slice(0, 4).map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-white px-3 py-1.5"
                      data-testid={`row-similar-patient-${m.id}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {m.patientName}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {[
                            m.patientDob ? `DOB ${m.patientDob}` : null,
                            m.facilityId,
                            MATCH_REASON_LABEL[m.matchReason],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
                        onClick={() => setSelectedMatch(m)}
                        data-testid={`button-similar-patient-use-${m.id}`}
                      >
                        Use this patient
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
          <div className="space-y-3">
            {isNewPatientEntry && (
              <div
                className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-3"
                data-testid="section-schedule-patient-details"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <UserPlus className="h-3 w-3" />
                  Patient details
                </div>
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label
                      htmlFor="schedule-patient-dob"
                      className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                    >
                      Date of birth
                    </Label>
                    <Input
                      id="schedule-patient-dob"
                      type="date"
                      value={dobInput}
                      onChange={(e) => setDobInput(e.target.value)}
                      className="mt-1 rounded-xl bg-white"
                      data-testid="input-schedule-patient-dob"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="schedule-patient-facility"
                      className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                    >
                      Facility
                    </Label>
                    {facilityOptions && facilityOptions.length > 0 ? (
                      <select
                        id="schedule-patient-facility"
                        value={facilityInput}
                        onChange={(e) => setFacilityInput(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                        style={{ ["--tw-ring-color" as string]: ACCENT }}
                        data-testid="select-schedule-patient-facility"
                      >
                        <option value="">— No clinic —</option>
                        {(facilityInput &&
                        !facilityOptions.includes(facilityInput)
                          ? [facilityInput, ...facilityOptions]
                          : facilityOptions
                        ).map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id="schedule-patient-facility"
                        value={facilityInput}
                        onChange={(e) => setFacilityInput(e.target.value)}
                        placeholder="Clinic name"
                        className="mt-1 rounded-xl bg-white"
                        data-testid="input-schedule-patient-facility"
                      />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  No patient record linked — this appointment will be saved
                  under the name you enter here.
                </p>
              </div>
            )}
            <div>
              <Label
                htmlFor="schedule-patient-date"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Date
              </Label>
              <Input
                id="schedule-patient-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="mt-1 rounded-xl"
                data-testid="input-schedule-patient-date"
              />
              <div className="mt-1 text-[11px] text-slate-400">
                {prettyDateLong(selectedDate)}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Clock className="h-3 w-3" />
                Available slots
              </div>
              <div className="grid max-h-32 grid-cols-3 gap-1.5 overflow-auto pr-0.5">
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
              <Input
                id="schedule-patient-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-2 rounded-xl"
                data-testid="input-schedule-patient-time"
              />
            </div>

            <div>
              <Label
                htmlFor="schedule-patient-service"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Service type
              </Label>
              <select
                id="schedule-patient-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: ACCENT }}
                data-testid="select-schedule-patient-service-type"
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label
                  htmlFor="schedule-patient-appt-type"
                  className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Appointment type
                </Label>
                <select
                  id="schedule-patient-appt-type"
                  value={appointmentType}
                  onChange={(e) => setAppointmentType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                  style={{ ["--tw-ring-color" as string]: ACCENT }}
                  data-testid="select-schedule-patient-appt-type"
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
                  htmlFor="schedule-patient-location"
                  className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Location
                </Label>
                <Input
                  id="schedule-patient-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Room / site"
                  className="mt-1 rounded-xl"
                  data-testid="input-schedule-patient-location"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="schedule-patient-note"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Note (optional)
              </Label>
              <Textarea
                id="schedule-patient-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 min-h-[72px] rounded-xl"
                placeholder="Anything the technician/scheduler should know"
                data-testid="textarea-schedule-patient-note"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Day at a glance · {prettyDateLong(selectedDate)}
            </div>
            {contextLoading ? (
              <div className="text-xs text-slate-500 italic py-2">
                Loading day context…
              </div>
            ) : (
              <div className="space-y-3">
                <EventList
                  label="Clinic Schedule"
                  rows={dayContext?.clinicEvents ?? []}
                  emptyText="No clinic visits."
                  testId="schedule-patient-clinic-events"
                />
                <EventList
                  label="Ancillary Schedule"
                  rows={dayContext?.ancillaryEvents ?? []}
                  emptyText="No ancillary appointments."
                  testId="schedule-patient-ancillary-events"
                />
                <EventList
                  label="This patient"
                  rows={dayContext?.patientEvents ?? []}
                  emptyText="No existing events for this patient on this day."
                  testId="schedule-patient-patient-events"
                />
                <EventList
                  label="Availability / Blocks"
                  rows={dayContext?.availabilityBlocks ?? []}
                  emptyText="No availability blocks."
                  testId="schedule-patient-availability-blocks"
                />
              </div>
            )}
          </div>
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
            {time ? `Confirm ${prettyTime(time)}` : "Confirm schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

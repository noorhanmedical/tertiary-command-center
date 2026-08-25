import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Stethoscope,
  User,
  X,
} from "lucide-react";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";
import {
  ANCILLARY_SERVICE_OPTIONS,
  APPOINTMENT_TYPES,
  TIME_SLOTS,
  combineLocalDateAndTimeToIso,
  prettyDate,
  prettyTime,
  todayIso,
  useCaseProofDocs,
} from "@/components/portal/caseWorkspace";
import { fetchPatientCommandCenter, type CommandCenterResponse } from "@/lib/portal/commandCenterApi";
import { schedulePatientAncillary } from "@/lib/workflow/teamMemberWorkspaceApi";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";

const ACCENT = "#4863A0";
const POLL_MS = 30_000;

export type SchedulingWorkspaceProps = {
  ctx: CallCaseContext;
  facility: string;
  selectedDate: string;
  onClose: () => void;
};

type MonthSummary = { days: { date: string; appointmentCount: number }[] };

function prettyDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Big Zocdoc-style month calendar. Reads /api/portal/month-summary for
// per-day appointment counts and emits the ISO date on selection.
function BigMonthCalendar({
  facility,
  selectedDate,
  onSelect,
}: {
  facility: string;
  selectedDate: string;
  onSelect: (d: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const monthIso = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const { data, isLoading } = useQuery<MonthSummary>({
    queryKey: ["/api/portal/month-summary", facility, monthIso],
    queryFn: async () => {
      const u = new URL("/api/portal/month-summary", window.location.origin);
      u.searchParams.set("facility", facility);
      u.searchParams.set("month", monthIso);
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) return { days: [] };
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!facility,
  });

  const counts = new Map<string, number>();
  for (const d of data?.days ?? []) counts.set(d.date, d.appointmentCount);
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = first.getDay();
  const lastDate = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: Array<{ date: string | null; count: number }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, count: 0 });
  for (let day = 1; day <= lastDate; day++) {
    const ds = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date: ds, count: counts.get(ds) ?? 0 });
  }
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  const today = todayIso();

  return (
    <div
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="scheduling-workspace-calendar"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CalendarDays className="h-4 w-4" style={{ color: ACCENT }} />
          {monthLabel}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            data-testid="button-sw-cal-prev"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            data-testid="button-sw-cal-next"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[11px] font-semibold text-slate-400">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-7 gap-1">
        {isLoading && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-xl bg-white/60">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        )}
        {cells.map((c, i) => {
          if (!c.date) return <div key={`pad-${i}`} className="aspect-square" />;
          const isSelected = c.date === selectedDate;
          const isToday = c.date === today;
          return (
            <button
              key={c.date}
              type="button"
              onClick={() => onSelect(c.date!)}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors ${
                isSelected
                  ? "border-transparent text-white shadow-sm"
                  : c.count > 0
                    ? "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                    : "border-slate-100 text-slate-600 hover:bg-slate-50"
              }`}
              style={isSelected ? { backgroundColor: ACCENT } : undefined}
              data-testid={`sw-cal-day-${c.date}`}
            >
              <span className={`font-semibold ${isToday && !isSelected ? "text-indigo-600" : ""}`}>
                {parseInt(c.date.slice(-2), 10)}
              </span>
              {c.count > 0 && (
                <span className={`mt-0.5 text-[9px] ${isSelected ? "text-white/80" : "text-slate-400"}`}>
                  {c.count} appt{c.count === 1 ? "" : "s"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  testId,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="min-w-0 text-right text-[12px] font-medium text-slate-900" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function ProofLink({
  label,
  doc,
  testId,
}: {
  label: string;
  doc: { id: number; downloadUrl: string | null } | null;
  testId: string;
}) {
  if (!doc) {
    return (
      <div
        className="flex items-center justify-between rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] italic text-slate-400"
        data-testid={`${testId}-empty`}
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </span>
        <span>Not generated</span>
      </div>
    );
  }
  const href = doc.downloadUrl ?? `/api/documents-library/${doc.id}/file`;
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]">
      <span className="flex items-center gap-1.5 font-medium text-slate-700">
        <FileText className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        {label}
      </span>
      <span className="flex items-center gap-2">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-indigo-600 hover:underline"
          data-testid={`${testId}-open`}
        >
          Open
        </a>
        <a
          href={href}
          download
          className="font-semibold text-slate-500 hover:underline"
          data-testid={`${testId}-download`}
        >
          Download
        </a>
      </span>
    </div>
  );
}

export function SchedulingWorkspace({ ctx, facility, selectedDate: initialDate, onClose }: SchedulingWorkspaceProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const facilityId = ctx.facilityId ?? facility ?? "";
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayIso());
  const [time, setTime] = useState<string>("");
  const [appointmentType, setAppointmentType] = useState<string>(ctx.targetServices[0] ?? "");
  const [location, setLocation] = useState<string>(facilityId);
  const [note, setNote] = useState<string>("");

  const proof = useCaseProofDocs(ctx.patientScreeningId);

  const hasPatientRecord =
    typeof ctx.patientScreeningId === "number" && ctx.patientScreeningId > 0;
  const { data: commandCenter } = useQuery<CommandCenterResponse>({
    queryKey: ["portal-command-center", ctx.patientScreeningId],
    queryFn: () => fetchPatientCommandCenter(ctx.patientScreeningId as number),
    enabled: hasPatientRecord,
  });

  const phone = commandCenter?.patient.phone ?? null;
  const insurance = commandCenter?.patient.insurance ?? null;

  const appointmentOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of [...ctx.targetServices, ...APPOINTMENT_TYPES, ...ANCILLARY_SERVICE_OPTIONS]) {
      const v = (s ?? "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }, [ctx.targetServices]);

  const canSubmit = useMemo(() => {
    if (!hasPatientRecord && ctx.executionCaseId == null) return false;
    if (!appointmentType.trim()) return false;
    return !!combineLocalDateAndTimeToIso(selectedDate, time);
  }, [hasPatientRecord, ctx.executionCaseId, appointmentType, selectedDate, time]);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const startsAt = combineLocalDateAndTimeToIso(selectedDate, time);
      if (!startsAt) throw new Error("Pick a valid date and time");
      return schedulePatientAncillary({
        executionCaseId: ctx.executionCaseId ?? null,
        patientScreeningId: ctx.patientScreeningId ?? null,
        serviceType: appointmentType.trim(),
        startsAt,
        facilityId: facilityId || null,
        note: note.trim() || null,
        metadata: {
          source: "team_portal_scheduling_workspace",
          callReason: ctx.callReason,
          targetServices: ctx.targetServices,
          location: location.trim() || null,
        },
      });
    },
    onSuccess: () => {
      invalidateTeamPortalScheduleQueries(queryClient, {
        facility: facilityId || null,
        selectedDate,
        patientScreeningId: ctx.patientScreeningId ?? null,
      });
      toast({
        title: "Scheduled",
        description: `${appointmentType.trim()} for ${ctx.patientName} on ${prettyDate(selectedDate)}${
          time ? ` at ${prettyTime(time)}` : ""
        }.`,
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

  const initials = ctx.patientName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_20px_70px_rgba(15,23,42,0.10)]"
      data-testid="scheduling-workspace"
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
                Schedule Appointment
              </div>
              <div className="truncate text-2xl font-bold leading-tight" data-testid="scheduling-workspace-name">
                {ctx.patientName}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/80">
                {ctx.patientDob && <span>DOB {ctx.patientDob}</span>}
                {facilityId && (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1 w-1 rounded-full bg-white/50" />
                    {facilityId}
                  </span>
                )}
                {ctx.callReason && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 font-medium">
                    <Stethoscope className="h-3 w-3" />
                    {ctx.callReason}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scheduling view"
            title="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            data-testid="button-scheduling-workspace-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
          {/* LEFT — calendar + time slots */}
          <div className="space-y-4">
            <BigMonthCalendar
              facility={facilityId}
              selectedDate={selectedDate}
              onSelect={(d) => {
                setSelectedDate(d);
                setTime("");
              }}
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Clock className="h-4 w-4" style={{ color: ACCENT }} />
                Available times
              </div>
              <div className="mb-3 text-[11px] text-slate-400">{prettyDateLong(selectedDate)}</div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
                {TIME_SLOTS.map((slot) => {
                  const active = slot === time;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setTime(slot)}
                      className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors ${
                        active
                          ? "border-transparent text-white shadow-sm"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                      style={active ? { backgroundColor: ACCENT } : undefined}
                      data-testid={`sw-slot-${slot}`}
                    >
                      {prettyTime(slot)}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Label
                  htmlFor="sw-custom-time"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Custom time
                </Label>
                <Input
                  id="sw-custom-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1.5 rounded-xl"
                  data-testid="input-sw-custom-time"
                />
              </div>
            </div>
          </div>

          {/* RIGHT — booking form */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Appointment details</div>

            <div className="space-y-1.5">
              <InfoRow
                icon={<User className="h-3.5 w-3.5" />}
                label="Patient"
                value={ctx.patientName}
                testId="sw-info-patient"
              />
              <InfoRow
                icon={<Phone className="h-3.5 w-3.5" />}
                label="Phone"
                value={phone ?? <span className="italic text-slate-400">Not on file</span>}
                testId="sw-info-phone"
              />
              <InfoRow
                icon={<Stethoscope className="h-3.5 w-3.5" />}
                label="Call reason"
                value={ctx.callReason || <span className="italic text-slate-400">—</span>}
                testId="sw-info-call-reason"
              />
              <InfoRow
                label="Target ancillary"
                value={
                  ctx.targetServices.length > 0 ? (
                    ctx.targetServices.join(", ")
                  ) : (
                    <span className="italic text-slate-400">None specified</span>
                  )
                }
                testId="sw-info-target"
              />
              <InfoRow
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="Clinic / facility"
                value={facilityId || <span className="italic text-slate-400">—</span>}
                testId="sw-info-facility"
              />
              <InfoRow
                label="Insurance"
                value={insurance ?? <span className="italic text-slate-400">Not on file</span>}
                testId="sw-info-insurance"
              />
            </div>

            {/* Proof / PDF links */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Supporting documents
              </div>
              {proof.isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] italic text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading documents…
                </div>
              ) : (
                <>
                  <ProofLink label="Clinician Atlas" doc={proof.clinicianPdf} testId="sw-proof-clinician" />
                  <ProofLink label="Plexus Atlas" doc={proof.plexusPdf} testId="sw-proof-plexus" />
                </>
              )}
            </div>

            <div>
              <Label
                htmlFor="sw-appointment-type"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Appointment type
              </Label>
              <select
                id="sw-appointment-type"
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: ACCENT }}
                data-testid="select-sw-appointment-type"
              >
                <option value="">— Select appointment type —</option>
                {appointmentOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label
                  htmlFor="sw-date"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Date
                </Label>
                <Input
                  id="sw-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setTime("");
                  }}
                  className="mt-1.5 rounded-xl"
                  data-testid="input-sw-date"
                />
              </div>
              <div>
                <Label
                  htmlFor="sw-time"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Time
                </Label>
                <Input
                  id="sw-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1.5 rounded-xl"
                  data-testid="input-sw-time"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="sw-location"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Location
              </Label>
              <Input
                id="sw-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Clinic / room / address"
                className="mt-1.5 rounded-xl"
                data-testid="input-sw-location"
              />
            </div>

            <div>
              <Label
                htmlFor="sw-note"
                className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                Notes (optional)
              </Label>
              <Textarea
                id="sw-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1.5 min-h-[80px] rounded-xl"
                placeholder="Context for the technician/scheduler"
                data-testid="textarea-sw-note"
              />
            </div>

            <Button
              type="button"
              disabled={!canSubmit || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
              className="w-full gap-1.5 rounded-xl py-5 text-sm font-semibold shadow-sm"
              style={{ backgroundColor: ACCENT }}
              data-testid="button-sw-confirm"
            >
              {scheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {time ? `Confirm ${prettyDate(selectedDate)} · ${prettyTime(time)}` : "Confirm appointment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

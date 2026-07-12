import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  MapPin,
  FileSignature,
  ClipboardList,
  FileUp,
  FolderOpen,
} from "lucide-react";
import {
  fetchWorkspaceAncillarySchedule,
  schedulePatientAncillary,
  type TeamWorkspaceAncillaryAppointment,
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
} from "@/components/portal/SchedulePatientDialogV2";
import { invalidateTeamPortalScheduleQueries } from "@/lib/portal/scheduleInvalidations";
import { CanonicalMonthCalendar } from "@/calendar/views/CanonicalMonthCalendar";
import {
  AncillaryDocInline,
  type AncillaryDocMode,
  type AncillaryServiceContext,
} from "@/components/portal/AncillaryDocModals";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import { useLocation } from "wouter";

// The patient scheduling workspace. It leads with the per-ancillary document
// workflows (Consent · Screening · Report) that staff open this view for, each
// expanding its form inline underneath the button. Booking a new appointment
// lives behind a "Schedule appointment" button that opens the calendar in a
// dialog — the calendar no longer dominates the surface.

const ACCENT = "#4863A0";

export type SchedulePatientPlaygroundProps = {
  patient: SchedulePatientDialogPatient;
  selectedDate: string;
  // The patient's active ancillaries, passed from the ancillary schedule so
  // the workspace can render the per-ancillary document sections.
  ancillaries?: AncillaryServiceContext[];
  onClose?: () => void;
};

type DocKind = Exclude<AncillaryDocMode, null>;

// Soft category tint for the per-ancillary accent icon.
function categoryTint(serviceType: string): { bg: string; fg: string } {
  switch (getAncillaryCategory(serviceType)) {
    case "brainwave":
      return { bg: "bg-violet-100", fg: "text-violet-600" };
    case "vitalwave":
      return { bg: "bg-rose-100", fg: "text-rose-600" };
    case "ultrasound":
      return { bg: "bg-emerald-100", fg: "text-emerald-600" };
    default:
      return { bg: "bg-slate-100", fg: "text-slate-500" };
  }
}

// Premium, border-less document action. Icon sits in a soft rounded chip with
// the label beneath. Fills solid when open, tints green when complete.
function DocButton({
  label,
  icon,
  complete,
  active,
  onClick,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  complete: boolean;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`group flex flex-col items-center gap-2 rounded-2xl px-3 py-3.5 text-xs font-semibold transition-all ${
        active
          ? "bg-[#4863A0] text-white shadow-[0_8px_20px_rgba(72,99,160,0.30)]"
          : complete
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-slate-50 text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
          active
            ? "bg-white/20 text-white"
            : complete
              ? "bg-emerald-100 text-emerald-600"
              : "bg-white text-slate-500 group-hover:text-[#4863A0]"
        }`}
      >
        {complete ? <Check className="h-4 w-4" /> : icon}
      </span>
      {label}
    </button>
  );
}

export function SchedulePatientPlayground({
  patient,
  selectedDate: initialDate,
  ancillaries,
  onClose,
}: SchedulePatientPlaygroundProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  // Which document workflow (if any) is expanded inline, keyed by ancillary
  // instance + kind so it loads directly under the button that opened it.
  const [expandedDoc, setExpandedDoc] = useState<{
    instanceId: string;
    kind: DocKind;
  } | null>(null);
  // The booking calendar/form lives in a dialog behind a button.
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Multi-test selection — staff can book several ancillary tests in one pass.
  const [selectedServices, setSelectedServices] = useState<string[]>(
    patient.serviceType ? [patient.serviceType] : [],
  );
  const [serviceOverrides, setServiceOverrides] = useState<
    Record<string, { date?: string; time?: string }>
  >({});
  const [appointmentType, setAppointmentType] = useState<string>(
    APPOINTMENT_TYPES[0],
  );
  const [location, setLocation] = useState<string>(patient.facilityId ?? "");
  const [time, setTime] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [bookingResults, setBookingResults] = useState<BookingResult[] | null>(
    null,
  );

  const initialMonth = useMemo(() => {
    const d = new Date(`${initialDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [initialDate]);

  // Self-fetch fallback: several entry points open the Playground without
  // passing the patient's ancillaries. So the document sections always render,
  // we fetch the facility's ancillary schedule for the day and filter to this
  // patient. The caller-supplied `ancillaries` prop wins when present.
  const patientMatchKey = useMemo(() => {
    if (patient.patientScreeningId != null) return `p:${patient.patientScreeningId}`;
    return `n:${(patient.patientName ?? "").toLowerCase().trim()}|${patient.facilityId ?? ""}`;
  }, [patient.patientScreeningId, patient.patientName, patient.facilityId]);

  const { data: fetchedAncillaryRows = [] } = useQuery<
    TeamWorkspaceAncillaryAppointment[]
  >({
    queryKey: [
      "schedule-patient-playground-ancillaries",
      patient.facilityId ?? null,
      selectedDate,
    ],
    queryFn: () =>
      fetchWorkspaceAncillarySchedule({
        facilityId: patient.facilityId ?? null,
        startDate: `${selectedDate}T00:00:00.000Z`,
        endDate: `${selectedDate}T23:59:59.999Z`,
        limit: 100,
      }),
    enabled: !(ancillaries && ancillaries.length > 0) && !!patient.facilityId,
  });

  const resolvedAncillaries = useMemo<AncillaryServiceContext[]>(() => {
    if (ancillaries && ancillaries.length > 0) return ancillaries;
    const seen = new Set<string>();
    const out: AncillaryServiceContext[] = [];
    for (const row of fetchedAncillaryRows) {
      const rowKey =
        row.patientScreeningId != null
          ? `p:${row.patientScreeningId}`
          : `n:${(row.patientName ?? "").toLowerCase().trim()}|${row.facilityId ?? ""}`;
      if (rowKey !== patientMatchKey) continue;
      const instanceId = String(row.id);
      if (seen.has(instanceId)) continue;
      seen.add(instanceId);
      out.push({
        instanceId,
        serviceType: row.serviceType ?? "Ancillary",
        executionCaseId: row.executionCaseId ?? null,
        patientScreeningId: row.patientScreeningId ?? null,
        readiness: row.readiness ?? null,
        startsAt: row.startsAt ?? null,
        status: row.status ?? null,
      });
    }
    return out;
  }, [ancillaries, fetchedAncillaryRows, patientMatchKey]);

  const effectiveFor = (svc: string): { date: string; time: string } => {
    const ov = serviceOverrides[svc] ?? {};
    return { date: ov.date || selectedDate, time: ov.time || time };
  };

  const toggleService = (svc: string) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc],
    );
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

  // Toggle an inline document workflow open/closed for one ancillary.
  const toggleDoc = (instanceId: string, kind: DocKind) =>
    setExpandedDoc((prev) =>
      prev && prev.instanceId === instanceId && prev.kind === kind
        ? null
        : { instanceId, kind },
    );

  // Seed a test and open the scheduling dialog.
  const handleScheduleNext = (serviceType: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceType) ? prev : [...prev, serviceType],
    );
    setScheduleOpen(true);
  };

  const handleOpenEhr = (patientScreeningId: number | null) => {
    if (patientScreeningId == null) return;
    navigate(`/patient-directory?patientId=${patientScreeningId}`);
  };

  const onDocChanged = () => {
    queryClient.invalidateQueries({
      queryKey: ["team-workspace-ancillary-schedule"],
    });
    queryClient.invalidateQueries({
      queryKey: ["schedule-patient-playground-ancillaries"],
    });
    invalidateTeamPortalScheduleQueries(queryClient, {
      facility: patient.facilityId ?? undefined,
      selectedDate,
      patientScreeningId: patient.patientScreeningId ?? undefined,
    });
  };

  const canSubmit = useMemo(() => {
    const hasIdentity =
      patient.patientScreeningId != null ||
      patient.executionCaseId != null ||
      !!patient.patientName?.trim();
    if (!hasIdentity) return false;
    if (selectedServices.length === 0) return false;
    return selectedServices.every((svc) => {
      const ov = serviceOverrides[svc] ?? {};
      return !!combineLocalDateAndTimeToIso(
        ov.date || selectedDate,
        ov.time || time,
      );
    });
  }, [patient, selectedServices, serviceOverrides, selectedDate, time]);

  const scheduleMutation = useMutation({
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
        setSelectedServices([]);
        setServiceOverrides({});
        setTime("");
        setNote("");
        setBookingResults(null);
        setScheduleOpen(false);
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

  const headerMeta = [
    patient.patientDob ? `DOB ${patient.patientDob}` : "",
    patient.patientPhone ?? "",
    patient.facilityId ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_16px_50px_rgba(15,23,42,0.10)]"
      data-testid="schedule-patient-playground"
    >
      {/* Compact header — no divider line, spacing does the separating */}
      <div className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-2">
        <span
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-[0_6px_16px_rgba(72,99,160,0.35)]"
          style={{ backgroundColor: ACCENT }}
        >
          {initials || <User className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-slate-900">
            {patient.patientName ?? "Patient"}
          </div>
          {headerMeta && (
            <div className="truncate text-xs text-slate-500">{headerMeta}</div>
          )}
        </div>
        <Button
          type="button"
          onClick={() => setScheduleOpen(true)}
          className="gap-1.5 text-white"
          style={{ backgroundColor: ACCENT }}
          data-testid="button-sp-pg-open-schedule"
        >
          <CalendarPlus className="h-4 w-4" />
          Schedule appointment
        </Button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scheduling view"
            title="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            data-testid="button-schedule-patient-playground-close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* One natural scroll region for the whole workspace */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        data-testid="sp-pg-scroll"
      >
        {resolvedAncillaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
            <Stethoscope className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <div className="text-sm font-medium text-slate-600">
              No ancillary tests scheduled for this patient yet.
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Use “Schedule appointment” above to book one.
            </div>
          </div>
        ) : (
          <div className="space-y-8" data-testid="sp-pg-ancillary-sections">
            {resolvedAncillaries.map((svc) => {
              const r = svc.readiness;
              const items: {
                kind: DocKind;
                label: string;
                icon: React.ReactNode;
                complete: boolean;
              }[] = [
                {
                  kind: "consent",
                  label: "Consent",
                  icon: <FileSignature className="h-4 w-4" />,
                  complete: r?.informedConsent === "complete",
                },
                {
                  kind: "screening",
                  label: "Screening",
                  icon: <ClipboardList className="h-4 w-4" />,
                  complete: r?.screeningForm === "complete",
                },
                {
                  kind: "report",
                  label: "Report",
                  icon: <FileUp className="h-4 w-4" />,
                  complete: r?.report === "complete",
                },
              ];
              const done = items.filter((i) => i.complete).length;
              const allDone = done === items.length;
              const tint = categoryTint(svc.serviceType);
              const open =
                expandedDoc && expandedDoc.instanceId === svc.instanceId
                  ? expandedDoc.kind
                  : null;
              return (
                <section
                  key={svc.instanceId}
                  data-testid={`sp-pg-ancillary-section-${svc.instanceId}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint.bg} ${tint.fg}`}
                    >
                      <Stethoscope className="h-4 w-4" />
                    </span>
                    <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
                      {svc.serviceType}
                    </h3>
                    {allDone ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"
                        data-testid={`sp-pg-progress-${svc.instanceId}`}
                      >
                        <Check className="h-4 w-4" /> Ready
                      </span>
                    ) : (
                      <span
                        className="text-xs font-medium text-slate-400"
                        data-testid={`sp-pg-progress-${svc.instanceId}`}
                      >
                        {done}/{items.length} done
                      </span>
                    )}
                    {svc.patientScreeningId != null && (
                      <button
                        type="button"
                        onClick={() => handleOpenEhr(svc.patientScreeningId)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#4863A0]"
                        title="Open patient chart"
                        data-testid={`sp-pg-open-ehr-${svc.instanceId}`}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {items.map((it) => (
                      <DocButton
                        key={it.kind}
                        label={it.label}
                        icon={it.icon}
                        complete={it.complete}
                        active={open === it.kind}
                        onClick={() => toggleDoc(svc.instanceId, it.kind)}
                        testId={`sp-pg-doc-${it.kind}-${svc.instanceId}`}
                      />
                    ))}
                  </div>

                  {open && (
                    <div
                      className="mt-3 rounded-2xl bg-slate-50 p-4"
                      data-testid={`sp-pg-doc-panel-${svc.instanceId}`}
                    >
                      <AncillaryDocInline
                        key={`${svc.instanceId}-${open}`}
                        mode={open}
                        active={svc}
                        patientName={patient.patientName ?? null}
                        onChanged={onDocChanged}
                        onClose={() => setExpandedDoc(null)}
                      />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Scheduling dialog — the calendar lives here, behind the button */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent
          className="z-[95] max-h-[90vh] max-w-2xl overflow-y-auto"
          data-testid="dialog-sp-pg-schedule"
        >
          <DialogHeader>
            <DialogTitle>
              Schedule appointment
              {patient.patientName ? ` — ${patient.patientName}` : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <CanonicalMonthCalendar
                initialMonth={initialMonth}
                onSelectDate={(iso) => {
                  setSelectedDate(iso);
                  setTime("");
                }}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Time · {prettyDateLong(selectedDate)}
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {TIME_SLOTS.map((slot) => {
                  const activeSlot = slot === time;
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setTime(slot)}
                      className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors ${
                        activeSlot
                          ? "border-transparent text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      style={activeSlot ? { backgroundColor: ACCENT } : undefined}
                      data-testid={`sp-pg-slot-${slot}`}
                    >
                      {prettyTime(slot)}
                    </button>
                  );
                })}
              </div>
            </div>

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
                {Array.from(
                  new Set([
                    ...selectedServices.filter(
                      (s) => !SERVICE_OPTIONS.includes(s),
                    ),
                    ...SERVICE_OPTIONS,
                  ]),
                ).map((svc) => {
                  const activeChip = selectedServices.includes(svc);
                  return (
                    <button
                      key={svc}
                      type="button"
                      onClick={() => toggleService(svc)}
                      aria-pressed={activeChip}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        activeChip
                          ? "border-transparent text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      style={activeChip ? { backgroundColor: ACCENT } : undefined}
                      data-testid={`chip-sp-pg-service-${svc}`}
                    >
                      {activeChip && <Check className="h-3 w-3" />}
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
                  All tests use the shared date &amp; time — override any test
                  individually.
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

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span
                className="text-xs text-slate-500"
                data-testid="text-sp-pg-selection"
              >
                {prettyDateLong(selectedDate)}
                {time ? ` · ${prettyTime(time)}` : ""}
                {selectedServices.length > 0
                  ? ` · ${selectedServices.length} test${selectedServices.length > 1 ? "s" : ""}`
                  : ""}
              </span>
              <Button
                type="button"
                disabled={!canSubmit || scheduleMutation.isPending}
                onClick={() => scheduleMutation.mutate()}
                className="gap-1.5 rounded-xl text-sm font-semibold text-white shadow-sm"
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

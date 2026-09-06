// AncillaryWorkflowWorkspace — the ACS/PCS clinic-day workflow surface that
// opens in the Playground when a team member clicks an ancillary schedule row.
//
// Design language (matches the Plexus IQ "Team Access" login): navy typography
// and controls on the winter background, frosted-glass tiles that FLOAT on the
// page — no wrapper container tiles. The single service in view sets a subtle
// accent HINT (purple = BrainWave, red = VitalWave, green = Ultrasound); navy
// stays the base everywhere else.
//
// It composes existing canonical pieces — it does NOT introduce new writers or
// duplicate qualification/document logic. Status is read from the canonical
// readiness resolver via GET /api/portal/case-readiness/:executionCaseId.
//
// Patient command header actions are limited to what this workspace actually
// receives (patient/case/service/facility). Open Plexus EHR + Atlas/Documents
// are wired; schedule actions (reschedule/no-show/cancel/call) require the
// schedule event id / phone, which live in the Team Portal shell and are NOT
// threaded here — so they are intentionally NOT rendered (no dead buttons).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  ClipboardList,
  FileUp,
  Stethoscope,
  Activity,
  ExternalLink,
  Sparkles,
  ChevronDown,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { QualifyingEvidence } from "@/components/patient-directory/PatientChartSections";
import { PatientPdfActions } from "@/components/qualification/PatientPdfActions";
import {
  AncillaryDocInline,
  type AncillaryServiceContext,
  type AncillaryDocMode,
} from "@/components/portal/AncillaryDocModals";
import { ReportUploadPanel } from "@/components/portal/ReportUploadPanel";
import { ProcedureComponentPanel } from "@/components/portal/ProcedureComponentPanel";
import { listProcedureEventsApi, type ProcedureEventDto } from "@/lib/workflow/procedureEventsApi";
import { dispatchOpenWorkspace } from "@/components/playground/playgroundEvents";
import { getInitials } from "@/lib/format";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import type { EmrQualifyingTest } from "@/types/emr";
import type {
  AncillaryReadinessSummary,
  AncillaryReadinessItemState,
} from "@/lib/workflow/teamMemberWorkspaceApi";

type Props = {
  patientScreeningId: number | null;
  executionCaseId: number | null;
  serviceKey: string | null;
  facilityId: string | number | null;
  patientName: string | null;
};

// One screening row (subset) carrying the canonical qualification evidence.
type ScreeningEvidence = {
  id: number;
  name: string;
  dob: string | null;
  gender: string | null;
  age: number | null;
  insurance: string | null;
  diagnoses: string | null;
  medications: string | null;
  qualifyingTests: string[] | null;
  reasoning: Record<string, unknown> | null;
};

// ── Service accent (HINT only — navy is the base everywhere else) ────────────
type Accent = "purple" | "red" | "green";

function accentForService(service: string): Accent {
  const c = getAncillaryCategory(service);
  if (c === "brainwave") return "purple";
  if (c === "vitalwave") return "red";
  return "green"; // ultrasound + vascular / cardiac studies
}

// Static Tailwind class strings per accent (kept static so the JIT sees them).
const ACCENT_CLASS: Record<
  Accent,
  { icon: string; chip: string; ring: string; label: string; statusChip: string }
> = {
  purple: {
    icon: "text-violet-700",
    chip: "bg-violet-500/15",
    ring: "ring-violet-300",
    label: "text-violet-800",
    statusChip: "bg-violet-500/15 text-violet-800 ring-1 ring-violet-300",
  },
  red: {
    icon: "text-rose-700",
    chip: "bg-rose-500/15",
    ring: "ring-rose-300",
    label: "text-rose-800",
    statusChip: "bg-rose-500/15 text-rose-800 ring-1 ring-rose-300",
  },
  green: {
    icon: "text-emerald-700",
    chip: "bg-emerald-500/15",
    ring: "ring-emerald-300",
    label: "text-emerald-800",
    statusChip: "bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-300",
  },
};

// Map the stored reasoning entry for ONE service into the EmrQualifyingTest
// shape QualifyingEvidence consumes. Mirrors emrModel.ts (no recompute).
function toQualifyingTest(serviceName: string, reasoning: Record<string, unknown> | null): EmrQualifyingTest {
  const r = (reasoning?.[serviceName] ?? null) as Record<string, unknown> | null;
  const cat = getAncillaryCategory(serviceName);
  const bucket: EmrQualifyingTest["bucket"] =
    cat === "brainwave" || cat === "vitalwave" || cat === "ultrasound" ? cat : "ultrasound";
  const arr = (v: unknown): string[] | null => (Array.isArray(v) ? (v as string[]) : null);
  return {
    testName: serviceName,
    bucket,
    clinicianUnderstanding: (r?.clinician_understanding as string) ?? null,
    patientTalkingPoints: (r?.patient_talking_points as string) ?? null,
    confidence: (r?.confidence as string) ?? null,
    qualifyingFactors: arr(r?.qualifying_factors),
    icd10Codes: arr(r?.icd10_codes),
    pearls: arr(r?.pearls),
    approvalRequired: typeof r?.approvalRequired === "boolean" ? (r.approvalRequired as boolean) : null,
  };
}

function splitList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

// ── Workflow tiles ───────────────────────────────────────────────────────────
// Three square tiles, each backed by a canonical readiness item. Status is
// derived ONLY from the readiness summary (never invented).
type DocStepMode = Exclude<AncillaryDocMode, null>;

type StepDef = {
  mode: DocStepMode;
  step: number;
  title: string;
  Icon: typeof FileSignature;
  itemOf: (r: AncillaryReadinessSummary) => AncillaryReadinessItemState;
};

const STEP_DEFS: StepDef[] = [
  { mode: "consent", step: 1, title: "Informed Consent", Icon: FileSignature, itemOf: (r) => r.informedConsent },
  { mode: "screening", step: 2, title: "Screening Form", Icon: ClipboardList, itemOf: (r) => r.screeningForm },
  { mode: "report", step: 3, title: "Report Upload", Icon: FileUp, itemOf: (r) => r.report },
];

type StatusKind = "complete" | "not_started" | "action" | "not_required" | "unknown";

type StatusMeta = { kind: StatusKind; label: string; cta: string };

function statusMetaFor(
  itemState: AncillaryReadinessItemState | null,
  isNext: boolean,
  mode: DocStepMode,
): StatusMeta {
  const cta = mode === "report" ? "Upload Report" : mode === "consent" ? "Open Consent" : "Open Screening";
  if (itemState == null) {
    return { kind: "unknown", label: "Status unavailable", cta };
  }
  if (itemState === "complete") {
    return { kind: "complete", label: "Complete", cta: "Review" };
  }
  if (itemState === "not_required") {
    return { kind: "not_required", label: "Not required", cta: "Open" };
  }
  if (mode === "report") {
    return { kind: isNext ? "action" : "not_started", label: "Waiting for report", cta };
  }
  return { kind: isNext ? "action" : "not_started", label: isNext ? "Action needed" : "Not started", cta };
}

// Non-accent status chips are calm/navy. The "action" (next tile) chip uses the
// service accent — resolved per render below.
const NEUTRAL_STATUS_CHIP: Record<Exclude<StatusKind, "action">, string> = {
  complete: "bg-slate-100 text-[#243B64] ring-1 ring-slate-200",
  not_started: "bg-slate-100 text-[#52647F] ring-1 ring-slate-200",
  not_required: "bg-slate-100 text-[#71819A] ring-1 ring-slate-200",
  unknown: "bg-slate-100 text-[#71819A] ring-1 ring-slate-200",
};

// In-progress procedure statuses (anything other than not_started / complete).
const PROC_STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  paused: "Paused",
  cancelled: "Cancelled",
  no_show: "No-show",
  unable_to_complete: "Unable to complete",
};

export function AncillaryWorkflowWorkspace({
  patientScreeningId,
  executionCaseId,
  serviceKey,
  facilityId,
  patientName,
}: Props) {
  const [docMode, setDocMode] = useState<AncillaryDocMode>(null);
  const [procedureOpen, setProcedureOpen] = useState(false);
  const [qualOpen, setQualOpen] = useState(true);
  const queryClient = useQueryClient();

  // Fetch the single screening row for identity + qualification evidence.
  // Reuses the canonical /api/patients/:id read; no new endpoint.
  const { data: screening } = useQuery<ScreeningEvidence | null>({
    queryKey: ["/api/patients", patientScreeningId, "ancillary-workflow-evidence"],
    queryFn: async () => {
      if (patientScreeningId == null) return null;
      const res = await fetch(`/api/patients/${patientScreeningId}`, { credentials: "include" });
      if (!res.ok) return null;
      return (await res.json()) as ScreeningEvidence;
    },
    enabled: patientScreeningId != null,
    staleTime: 30_000,
  });

  const displayName = screening?.name ?? patientName ?? "Patient";
  const service = serviceKey ?? "";
  const accent = accentForService(service);
  const ac = ACCENT_CLASS[accent];

  // Canonical per-case readiness (single source of truth: the same resolver the
  // ancillary schedule uses). Drives the tile statuses + screening preview.
  const readinessQueryKey = ["/api/portal/case-readiness", executionCaseId, service] as const;
  const { data: readiness } = useQuery<AncillaryReadinessSummary | null>({
    queryKey: readinessQueryKey,
    queryFn: async () => {
      if (executionCaseId == null) return null;
      const params = new URLSearchParams();
      if (service) params.set("serviceType", service);
      const res = await fetch(
        `/api/portal/case-readiness/${executionCaseId}?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { readiness: AncillaryReadinessSummary | null };
      return body.readiness ?? null;
    },
    enabled: executionCaseId != null,
    staleTime: 15_000,
  });

  // Canonical procedure event for THIS service — drives the Procedure tile
  // status (never invented; read straight from procedure_events). No parallel
  // frontend procedure state machine — the canonical row is the source.
  const procedureEventsKey = ["/api/procedure-events", executionCaseId, service] as const;
  const { data: procedureEvents } = useQuery<ProcedureEventDto[]>({
    queryKey: procedureEventsKey,
    queryFn: () =>
      listProcedureEventsApi({
        executionCaseId,
        patientScreeningId,
        serviceType: service || null,
      }),
    enabled: executionCaseId != null || patientScreeningId != null,
    staleTime: 10_000,
  });
  const procedureStatus = useMemo<string | null>(() => {
    const rows = procedureEvents ?? [];
    const exact = rows.find(
      (r) => (r.serviceType ?? "").toLowerCase() === service.toLowerCase(),
    );
    return (exact ?? rows[0] ?? null)?.procedureStatus ?? null;
  }, [procedureEvents, service]);

  const qualifyingTest = useMemo(
    () => (service ? toQualifyingTest(service, screening?.reasoning ?? null) : null),
    [service, screening?.reasoning],
  );
  const diagnoses = useMemo(() => splitList(screening?.diagnoses), [screening?.diagnoses]);
  const medications = useMemo(() => splitList(screening?.medications), [screening?.medications]);
  const hasEvidence =
    !!qualifyingTest &&
    !!(
      qualifyingTest.qualifyingFactors?.length ||
      qualifyingTest.clinicianUnderstanding ||
      diagnoses.length ||
      medications.length
    );

  // The single-service context the doc workflow modules operate on. Readiness
  // is threaded in so the screening-form preview + completion states are live.
  const docService: AncillaryServiceContext | null = useMemo(() => {
    if (!service) return null;
    return {
      instanceId: `${executionCaseId ?? "nocase"}:${service}`,
      serviceType: service,
      executionCaseId: executionCaseId ?? null,
      ancillaryCaseId: null,
      patientScreeningId: patientScreeningId ?? null,
      readiness: readiness ?? null,
    };
  }, [service, executionCaseId, patientScreeningId, readiness]);

  // The patient shape PatientPdfActions expects (canonical Atlas generator input).
  const pdfPatient = useMemo(
    () =>
      screening
        ? {
            id: screening.id,
            name: screening.name,
            dob: screening.dob,
            age: screening.age,
            gender: screening.gender,
            insurance: screening.insurance,
            diagnoses: screening.diagnoses,
            medications: screening.medications,
            qualifyingTests: screening.qualifyingTests ?? [],
            reasoning: screening.reasoning ?? {},
          }
        : null,
    [screening],
  );

  // The first still-incomplete REQUIRED tile — gets the "next up" emphasis.
  const nextMode: DocStepMode | null = useMemo(() => {
    if (!readiness) return null;
    for (const def of STEP_DEFS) {
      if (def.itemOf(readiness) === "missing") return def.mode;
    }
    return null;
  }, [readiness]);

  function openEhr() {
    if (patientScreeningId == null) return;
    dispatchOpenWorkspace({
      type: "patient_ehr",
      title: displayName,
      patientScreeningId,
      executionCaseId: executionCaseId ?? null,
      serviceKey: service || null,
      facilityId: facilityId ?? null,
      focusSection: "ancillary-journey",
    });
  }

  function handleDocChanged() {
    queryClient.invalidateQueries({ queryKey: readinessQueryKey });
    setDocMode(null);
  }

  // Opening one active surface closes the other (they share the body region).
  function openStep(mode: DocStepMode) {
    setProcedureOpen(false);
    setDocMode(mode);
  }
  function openProcedure() {
    setDocMode(null);
    setProcedureOpen(true);
  }
  // Procedure completion / component capture changes downstream readiness
  // (billing) and the procedure status chip — refresh both.
  function handleProcedureChanged() {
    queryClient.invalidateQueries({ queryKey: readinessQueryKey });
    queryClient.invalidateQueries({ queryKey: procedureEventsKey });
  }

  const facilityLabel = facilityId != null ? String(facilityId) : null;
  // Dense demographics line (real fields only; nothing invented).
  const demoLine = [
    screening?.dob ? `DOB ${screening.dob}` : null,
    screening?.age != null ? `${screening.age}` : null,
    screening?.gender ?? null,
    service || null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const activeStep = docMode ? STEP_DEFS.find((d) => d.mode === docMode) ?? null : null;

  // Procedure tile status — derived ONLY from the canonical procedure event.
  const procedureComplete = procedureStatus === "complete";
  const procMeta: StatusMeta = procedureComplete
    ? { kind: "complete", label: "Complete", cta: "Review Components" }
    : procedureStatus == null || procedureStatus === "not_started"
      ? { kind: "not_started", label: "Not started", cta: "Open Procedure" }
      : {
          kind: "action",
          label: PROC_STATUS_LABEL[procedureStatus] ?? procedureStatus,
          cta: "Continue Procedure",
        };
  // Emphasise the Procedure tile once screening is done and it isn't complete.
  const procedureEmphasised =
    procedureOpen || (!procedureComplete && readiness?.screeningForm === "complete");

  return (
    <div
      className="relative h-full overflow-y-auto bg-transparent px-8 py-6"
      data-testid="ancillary-workflow-workspace"
    >
      {/* Edge-less atmospheric contrast wash — softens the snow behind the
          upper content for readability. NOT a panel: no border, no edges. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(115%_90%_at_50%_0%,rgba(255,255,255,0.60),rgba(233,240,250,0.30)_42%,rgba(255,255,255,0)_78%)]"
        aria-hidden="true"
      />
      <div className="relative z-10 mx-auto w-full max-w-[1040px]">
        {/* ── Patient command header — dense, floats bare on the background ── */}
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => setQualOpen((v) => !v)}
            className="group flex min-w-0 items-center gap-3.5 text-left"
            aria-expanded={qualOpen}
            data-testid="ancillary-workflow-patient-toggle"
          >
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#243b64] text-base font-semibold text-white shadow-sm"
              aria-hidden="true"
            >
              {getInitials(displayName)}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className="truncate text-2xl font-bold tracking-tight text-[#1F3557] [text-shadow:0_1px_2px_rgba(255,255,255,0.55)]"
                  data-testid="ancillary-workflow-patient"
                >
                  {displayName}
                </span>
                {hasEvidence && (
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-[#243b64] ${
                      qualOpen ? "rotate-180" : ""
                    }`}
                  />
                )}
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-medium text-[#52647F] [text-shadow:0_1px_2px_rgba(255,255,255,0.5)]">
                {demoLine}
              </span>
              {facilityLabel && (
                <span className="mt-0.5 block truncate text-[12px] font-medium text-[#71819A]">
                  {facilityLabel}
                </span>
              )}
            </span>
          </button>

          {/* Quick actions — only the ones actually wired from this workspace.
              Compact frost buttons, navy icons/text. */}
          <div className="flex shrink-0 items-center gap-1.5">
            {pdfPatient && (
              <PatientPdfActions
                patient={pdfPatient as never}
                facility={facilityLabel}
                scheduleDate={null}
                iconOnly
              />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 rounded-xl !border-[#243b64]/25 bg-white/70 px-3 text-xs !text-[#243b64] backdrop-blur hover:!bg-[#243b64]/5"
              onClick={openEhr}
              disabled={patientScreeningId == null}
              data-testid="button-ancillary-open-ehr"
            >
              <Stethoscope className="h-4 w-4" /> Open Plexus EHR
            </Button>
          </div>
        </div>

        {/* ── Why Qualified — free-floating text under demographics (no box) ── */}
        {qualifyingTest && qualOpen && (
          <div className="ml-[62px] mt-3" data-testid="ancillary-workflow-why-qualified">
            <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${ac.label} [text-shadow:0_1px_2px_rgba(255,255,255,0.5)]`}>
              <Sparkles className="h-3.5 w-3.5" /> Why Qualified — {service}
            </div>
            {hasEvidence ? (
              <div className="text-[#5A6A80] [&_*]:!text-[#5A6A80] [&_a]:!text-[#2459E0] [&_button]:!text-[#2459E0]">
                <QualifyingEvidence test={qualifyingTest} diagnoses={diagnoses} medications={medications} />
              </div>
            ) : (
              <div className="text-[11px] text-[#5A6A80]" data-testid="ancillary-workflow-why-qualified-empty">
                No stored qualification evidence for this service. This may be a
                legacy or manually-added test — open the EHR for full context.
              </div>
            )}
          </div>
        )}

        {/* ── Three square workflow tiles — the only surfaces; float on page ── */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { kind: "doc", def: STEP_DEFS[0] }, // Informed Consent
              { kind: "doc", def: STEP_DEFS[1] }, // Screening Form
              { kind: "procedure" }, //              Procedure (canonical event)
              { kind: "doc", def: STEP_DEFS[2] }, // Report Upload
            ] as const
          ).map((tile) => {
            let mode: string;
            let title: string;
            let Icon: typeof FileSignature;
            let meta: StatusMeta;
            let isActive: boolean;
            let emphasised: boolean;
            let onOpen: () => void;
            let onClose: () => void;

            if (tile.kind === "doc") {
              const def = tile.def;
              mode = def.mode;
              title = def.title;
              Icon = def.Icon;
              const itemState = readiness ? def.itemOf(readiness) : null;
              const isNext = nextMode === def.mode;
              meta = statusMetaFor(itemState, isNext, def.mode);
              isActive = docMode === def.mode;
              emphasised = isNext || isActive;
              onOpen = () => openStep(def.mode);
              onClose = () => setDocMode(null);
            } else {
              mode = "procedure";
              title = "Procedure";
              Icon = Activity;
              meta = procMeta;
              isActive = procedureOpen;
              emphasised = procedureEmphasised;
              onOpen = openProcedure;
              onClose = () => setProcedureOpen(false);
            }
            const isComplete = meta.kind === "complete";

            return (
              <div
                key={mode}
                className={`group relative flex aspect-square flex-col rounded-[26px] border border-white/70 p-5 backdrop-blur-xl transition-all ${
                  isComplete ? "bg-white/80" : "bg-white/[0.88]"
                } ${
                  isActive
                    ? `shadow-[0_18px_48px_rgba(31,53,87,0.16)] ring-2 ${ac.ring}`
                    : emphasised
                      ? `shadow-[0_16px_44px_rgba(31,53,87,0.14)] ring-1 ${ac.ring} hover:-translate-y-0.5`
                      : "shadow-[0_14px_40px_rgba(31,53,87,0.10)] hover:-translate-y-0.5 hover:shadow-[0_16px_44px_rgba(31,53,87,0.14)]"
                }`}
                data-testid={`ancillary-workflow-module-${mode}`}
              >
                {/* Completion check — top-right, no step label */}
                {isComplete && (
                  <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#243b64]/10">
                    <Check className="h-3.5 w-3.5 text-[#243b64]" aria-label="Complete" />
                  </span>
                )}

                {/* Centered group: icon + title + status */}
                <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
                  <span
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                      isComplete ? "bg-slate-500/10" : ac.chip
                    }`}
                  >
                    <Icon className={`h-7 w-7 ${isComplete ? "text-slate-500" : ac.icon}`} />
                  </span>
                  <h3 className="text-[17px] font-bold leading-tight tracking-tight text-[#1F3557]">
                    {title}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      meta.kind === "action" ? ac.statusChip : NEUTRAL_STATUS_CHIP[meta.kind]
                    }`}
                    data-testid={`ancillary-workflow-status-${mode}`}
                  >
                    {meta.label}
                  </span>
                </div>

                {/* Action button */}
                <div className="pt-1">
                  {isActive ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 w-full rounded-xl text-xs !border-[#243b64]/25 !text-[#243b64] hover:!bg-[#243b64]/5"
                      onClick={onClose}
                      data-testid={`ancillary-workflow-open-${mode}`}
                    >
                      Close
                    </Button>
                  ) : emphasised ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 w-full rounded-xl text-xs !bg-[#243b64] !text-white hover:!bg-[#1d3054]"
                      onClick={onOpen}
                      data-testid={`ancillary-workflow-open-${mode}`}
                    >
                      {meta.cta}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 w-full rounded-xl text-xs !border-[#243b64]/25 !text-[#243b64] hover:!bg-[#243b64]/5"
                      onClick={onOpen}
                      data-testid={`ancillary-workflow-open-${mode}`}
                    >
                      {meta.cta}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Active tile workflow body — floats on the page when open ── */}
        {docMode && docService && (
          <div
            className="mt-6 rounded-3xl border border-white/70 bg-white/[0.92] p-6 shadow-[0_16px_44px_rgba(31,53,87,0.14)] backdrop-blur-xl"
            data-testid={`ancillary-workflow-body-${docMode}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {activeStep && (
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${ac.chip}`}>
                    <activeStep.Icon className={`h-4 w-4 ${ac.icon}`} />
                  </span>
                )}
                <h3 className="text-sm font-bold text-[#1F3557]">
                  {activeStep?.title ?? "Workflow"}
                </h3>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-slate-500"
                onClick={() => setDocMode(null)}
                aria-label="Close workflow"
                data-testid="ancillary-workflow-body-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {docMode === "report" && executionCaseId != null && patientScreeningId != null ? (
              <ReportUploadPanel
                executionCaseId={executionCaseId}
                patientScreeningId={patientScreeningId}
                serviceType={service || null}
              />
            ) : docMode === "report" && (executionCaseId == null || patientScreeningId == null) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                This appointment isn't fully linked to a patient/case yet, so a
                report can't be attached to the correct episode. Open the EHR to
                resolve the linkage first.
              </div>
            ) : (
              <AncillaryDocInline
                mode={docMode}
                active={docService}
                patientName={displayName}
                onChanged={handleDocChanged}
                onClose={() => setDocMode(null)}
              />
            )}
          </div>
        )}

        {/* ── Procedure execution + component capture — canonical event ── */}
        {procedureOpen && (
          <div
            className="mt-6 rounded-3xl border border-white/70 bg-white/[0.92] p-6 shadow-[0_16px_44px_rgba(31,53,87,0.14)] backdrop-blur-xl"
            data-testid="ancillary-workflow-body-procedure"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${ac.chip}`}>
                  <Activity className={`h-4 w-4 ${ac.icon}`} />
                </span>
                <h3 className="text-sm font-bold text-[#1F3557]">Procedure</h3>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-slate-500"
                onClick={() => setProcedureOpen(false)}
                aria-label="Close procedure"
                data-testid="ancillary-workflow-body-procedure-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ProcedureComponentPanel
              executionCaseId={executionCaseId}
              patientScreeningId={patientScreeningId}
              serviceKey={service || null}
              facilityId={facilityId ?? null}
              patientName={displayName}
              onChanged={handleProcedureChanged}
            />
          </div>
        )}

        {!service && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
            <ExternalLink className="h-3.5 w-3.5" /> No service context on this row.
          </div>
        )}
      </div>
    </div>
  );
}

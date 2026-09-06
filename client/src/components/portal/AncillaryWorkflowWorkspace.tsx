// AncillaryWorkflowWorkspace — the ACS/PCS clinic-day workflow surface that
// opens in the Playground when a team member clicks an ancillary schedule row.
//
// Design language (matches the Plexus IQ "Team Access" login): navy typography
// and controls on the winter background, frosted-glass tiles that FLOAT on the
// page — no wrapper container tiles. Service identity is expressed ONLY through
// a slow "smoke" hover atmosphere (purple = BrainWave, burgundy = VitalWave,
// emerald = Ultrasound); the icon, title, status, and buttons stay navy.
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

import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
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

// ── Service identity ─────────────────────────────────────────────────────────
type Accent = "purple" | "red" | "green";

function accentForService(service: string): Accent {
  const c = getAncillaryCategory(service);
  if (c === "brainwave") return "purple";
  if (c === "vitalwave") return "red";
  return "green"; // ultrasound + vascular / cardiac studies
}

// Space-separated RGB triplets fed to the smoke layers via the --smoke prop.
// Refined / muted (no neon): plum violet, wine burgundy, forest emerald.
const SMOKE_RGB: Record<Accent, string> = {
  purple: "129 74 158",
  red: "150 45 60",
  green: "38 112 84",
};

// Why-Qualified label keeps a small service-accent tint (dark/saturated).
const ACCENT_LABEL: Record<Accent, string> = {
  purple: "text-violet-800",
  red: "text-rose-800",
  green: "text-emerald-800",
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
// derived ONLY from the readiness summary (never invented). Left-to-right order
// communicates sequence (no step labels).
type DocStepMode = Exclude<AncillaryDocMode, null>;

type StepDef = {
  mode: DocStepMode;
  title: string;
  Icon: typeof FileSignature;
  itemOf: (r: AncillaryReadinessSummary) => AncillaryReadinessItemState;
};

const STEP_DEFS: StepDef[] = [
  { mode: "consent", title: "Informed Consent", Icon: FileSignature, itemOf: (r) => r.informedConsent },
  { mode: "screening", title: "Screening Form", Icon: ClipboardList, itemOf: (r) => r.screeningForm },
  { mode: "report", title: "Report Upload", Icon: FileUp, itemOf: (r) => r.report },
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

// All status chips are navy/neutral — service color lives only in the smoke.
const STATUS_CHIP: Record<StatusKind, string> = {
  complete: "bg-slate-100 text-[#243B64] ring-1 ring-slate-200",
  action: "bg-[#243b64]/10 text-[#243B64] ring-1 ring-[#243b64]/20",
  not_started: "bg-slate-100 text-[#52647F] ring-1 ring-slate-200",
  not_required: "bg-slate-100 text-[#71819A] ring-1 ring-slate-200",
  unknown: "bg-slate-100 text-[#71819A] ring-1 ring-slate-200",
};

// In-progress canonical procedure statuses (other than not_started / complete).
const PROC_STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  paused: "Paused",
  cancelled: "Cancelled",
  no_show: "No-show",
  unable_to_complete: "Unable to complete",
};

// One square workflow tile with the service "smoke" hover atmosphere. Tracks
// the cursor and writes --mx/--my onto the node (no re-render per move).
function WorkflowTile({
  Icon,
  title,
  meta,
  isActive,
  isComplete,
  emphasised,
  smokeRgb,
  onOpen,
  onClose,
  testId,
}: {
  Icon: typeof FileSignature;
  title: string;
  meta: StatusMeta;
  isActive: boolean;
  isComplete: boolean;
  emphasised: boolean;
  smokeRgb: string;
  onOpen: () => void;
  onClose: () => void;
  testId: string;
}) {
  function handleMove(e: MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  return (
    <div
      className={`smoke-tile group flex aspect-square flex-col rounded-2xl border border-white/65 bg-white/[0.82] p-5 shadow-[0_12px_34px_rgba(31,53,87,0.10)] backdrop-blur-xl transition-transform ${
        isActive
          ? "ring-2 ring-[#243b64]/30"
          : emphasised
            ? "ring-1 ring-[#243b64]/20 hover:-translate-y-0.5"
            : "hover:-translate-y-0.5"
      } ${isComplete ? "opacity-95" : ""}`}
      style={{ "--smoke": smokeRgb } as CSSProperties}
      onMouseMove={handleMove}
      data-testid={testId}
    >
      {/* Smoke layers — above the frosted base, below the content. */}
      <span className="smoke smoke-1" aria-hidden="true" />
      <span className="smoke smoke-2" aria-hidden="true" />
      <span className="smoke smoke-3" aria-hidden="true" />

      {/* Completion check — top-right, navy (never green). */}
      {isComplete && (
        <span className="absolute right-3.5 top-3.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#243b64]/10">
          <Check className="h-3.5 w-3.5 text-[#243b64]" aria-label="Complete" />
        </span>
      )}

      {/* Centered group: bare navy icon + title + status */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Icon className="h-10 w-10 text-[#243B64]" strokeWidth={1.6} />
        <h3 className="text-[17px] font-bold leading-tight tracking-tight text-[#1F3557]">{title}</h3>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_CHIP[meta.kind]}`}>
          {meta.label}
        </span>
      </div>

      {/* Action button */}
      <div className="relative z-10 pt-1">
        {isActive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 w-full rounded-xl text-xs !border-[#243b64]/25 bg-white/60 !text-[#243b64] hover:!bg-[#243b64]/5"
            onClick={onClose}
            data-testid={`${testId}-action`}
          >
            Close
          </Button>
        ) : emphasised ? (
          <Button
            type="button"
            size="sm"
            className="h-9 w-full rounded-xl text-xs !bg-[#243b64] !text-white hover:!bg-[#1d3054]"
            onClick={onOpen}
            data-testid={`${testId}-action`}
          >
            {meta.cta}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 w-full rounded-xl text-xs !border-[#243b64]/25 bg-white/60 !text-[#243b64] hover:!bg-[#243b64]/5"
            onClick={onOpen}
            data-testid={`${testId}-action`}
          >
            {meta.cta}
          </Button>
        )}
      </div>
    </div>
  );
}

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
  const smokeRgb = SMOKE_RGB[accent];

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
      listProcedureEventsApi({ executionCaseId, patientScreeningId, serviceType: service || null }),
    enabled: executionCaseId != null || patientScreeningId != null,
    staleTime: 10_000,
  });
  const procedureStatus = useMemo<string | null>(() => {
    const rows = procedureEvents ?? [];
    const exact = rows.find((r) => (r.serviceType ?? "").toLowerCase() === service.toLowerCase());
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
      : { kind: "action", label: PROC_STATUS_LABEL[procedureStatus] ?? procedureStatus, cta: "Continue Procedure" };
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

          {/* Quick actions — only the ones actually wired from this workspace. */}
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
            <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${ACCENT_LABEL[accent]} [text-shadow:0_1px_2px_rgba(255,255,255,0.5)]`}>
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

        {/* ── Four square workflow tiles — float directly over the winter bg.
            Consent → Screening → Procedure → Report (left-to-right sequence). ── */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {/* Consent + Screening (docs) */}
          {STEP_DEFS.slice(0, 2).map((def) => {
            const { mode, title, Icon } = def;
            const itemState = readiness ? def.itemOf(readiness) : null;
            const isNext = nextMode === mode;
            const meta = statusMetaFor(itemState, isNext, mode);
            const isActive = docMode === mode;
            return (
              <WorkflowTile
                key={mode}
                Icon={Icon}
                title={title}
                meta={meta}
                isActive={isActive}
                isComplete={meta.kind === "complete"}
                emphasised={isNext || isActive}
                smokeRgb={smokeRgb}
                onOpen={() => openStep(mode)}
                onClose={() => setDocMode(null)}
                testId={`ancillary-workflow-module-${mode}`}
              />
            );
          })}

          {/* Procedure — canonical procedure_events (3rd in sequence) */}
          <WorkflowTile
            Icon={Activity}
            title="Procedure"
            meta={procMeta}
            isActive={procedureOpen}
            isComplete={procedureComplete}
            emphasised={procedureEmphasised}
            smokeRgb={smokeRgb}
            onOpen={openProcedure}
            onClose={() => setProcedureOpen(false)}
            testId="ancillary-workflow-module-procedure"
          />

          {/* Report Upload (doc) */}
          {STEP_DEFS.slice(2).map((def) => {
            const { mode, title, Icon } = def;
            const itemState = readiness ? def.itemOf(readiness) : null;
            const isNext = nextMode === mode;
            const meta = statusMetaFor(itemState, isNext, mode);
            const isActive = docMode === mode;
            return (
              <WorkflowTile
                key={mode}
                Icon={Icon}
                title={title}
                meta={meta}
                isActive={isActive}
                isComplete={meta.kind === "complete"}
                emphasised={isNext || isActive}
                smokeRgb={smokeRgb}
                onOpen={() => openStep(mode)}
                onClose={() => setDocMode(null)}
                testId={`ancillary-workflow-module-${mode}`}
              />
            );
          })}
        </div>

        {/* ── Active tile workflow body — floats on the page when open ── */}
        {docMode && docService && (
          <div
            className="mt-6 rounded-2xl border border-white/70 bg-white/[0.92] p-6 shadow-[0_16px_44px_rgba(31,53,87,0.14)] backdrop-blur-xl"
            data-testid={`ancillary-workflow-body-${docMode}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {activeStep && (
                  <activeStep.Icon className="h-5 w-5 text-[#243B64]" strokeWidth={1.6} />
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
            className="mt-6 rounded-2xl border border-white/70 bg-white/[0.92] p-6 shadow-[0_16px_44px_rgba(31,53,87,0.14)] backdrop-blur-xl"
            data-testid="ancillary-workflow-body-procedure"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Activity className="h-5 w-5 text-[#243B64]" strokeWidth={1.6} />
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

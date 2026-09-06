// AncillaryWorkflowWorkspace — the ACS/PCS clinic-day workflow surface that
// opens in the Playground when a team member clicks an ancillary schedule row.
//
// It is centered on the scheduled ancillary workflow (NOT a generic EHR dump):
//   • patient identity header — the patient name is the context control that
//     expands/collapses the "Why Qualified" evidence directly beneath it
//   • quick Atlas access (Clinician + Plexus) + "Open Plexus EHR"
//   • three sequenced primary workflow cards: Informed Consent → Screening
//     Form → Report Upload, each showing REAL readiness status
//   • the selected step's workflow body (canonical AncillaryDocInline +
//     ReportUploadPanel)
//
// It composes existing canonical pieces — it does NOT introduce new writers or
// duplicate qualification/document logic. Status is read from the canonical
// readiness resolver via GET /api/portal/case-readiness/:executionCaseId.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  ClipboardList,
  FileUp,
  Stethoscope,
  ExternalLink,
  Sparkles,
  ChevronDown,
  CheckCircle2,
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

// ── Workflow step model ─────────────────────────────────────────────────────
// Each of the three cards maps to a canonical readiness item. Status is derived
// ONLY from the readiness summary (never invented). The "next" required, still
// incomplete step is emphasised so the specialist knows where to go next.
type DocStepMode = Exclude<AncillaryDocMode, null>;

type StepDef = {
  mode: DocStepMode;
  step: number;
  title: string;
  description: string;
  Icon: typeof FileSignature;
  // Which readiness item backs this step's status.
  itemOf: (r: AncillaryReadinessSummary) => AncillaryReadinessItemState;
};

const STEP_DEFS: StepDef[] = [
  {
    mode: "consent",
    step: 1,
    title: "Informed Consent",
    description: "Review and complete the patient's service consent before testing begins.",
    Icon: FileSignature,
    itemOf: (r) => r.informedConsent,
  },
  {
    mode: "screening",
    step: 2,
    title: "Screening Form",
    description: "Complete the qualification and symptom screening used for documentation.",
    Icon: ClipboardList,
    itemOf: (r) => r.screeningForm,
  },
  {
    mode: "report",
    step: 3,
    title: "Report Upload",
    description: "Upload the completed service report and associate it with this encounter.",
    Icon: FileUp,
    itemOf: (r) => r.report,
  },
];

type StatusKind = "complete" | "not_started" | "action" | "not_required" | "unknown";

type StatusMeta = { kind: StatusKind; label: string; cta: string };

function statusMetaFor(
  itemState: AncillaryReadinessItemState | null,
  isNext: boolean,
  mode: DocStepMode,
): StatusMeta {
  if (itemState == null) {
    return {
      kind: "unknown",
      label: "Status unavailable",
      cta: mode === "report" ? "Upload Report" : mode === "consent" ? "Open Consent" : "Open Screening",
    };
  }
  if (itemState === "complete") {
    return { kind: "complete", label: "Complete", cta: "Review" };
  }
  if (itemState === "not_required") {
    return { kind: "not_required", label: "Not required for this service", cta: "Open anyway" };
  }
  // missing
  const cta = mode === "report" ? "Upload Report" : mode === "consent" ? "Open Consent" : "Continue Screening";
  if (mode === "report") {
    return { kind: isNext ? "action" : "not_started", label: "Waiting for report", cta };
  }
  return { kind: isNext ? "action" : "not_started", label: isNext ? "Action needed" : "Not started", cta };
}

const STATUS_CHIP: Record<StatusKind, string> = {
  complete: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  action: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
  not_started: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  not_required: "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
  unknown: "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
};

export function AncillaryWorkflowWorkspace({
  patientScreeningId,
  executionCaseId,
  serviceKey,
  facilityId,
  patientName,
}: Props) {
  const [docMode, setDocMode] = useState<AncillaryDocMode>(null);
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

  // Canonical per-case readiness (single source of truth: the same resolver the
  // ancillary schedule uses). Drives the three card statuses + screening preview.
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

  // The first still-incomplete REQUIRED step — gets the "next up" emphasis.
  const nextMode: DocStepMode | null = useMemo(() => {
    if (!readiness) return null;
    for (const def of STEP_DEFS) {
      const s = def.itemOf(readiness);
      if (s === "missing") return def.mode;
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

  // Refresh readiness after a document workflow reports a change.
  function handleDocChanged() {
    queryClient.invalidateQueries({ queryKey: readinessQueryKey });
    setDocMode(null);
  }

  const facilityLabel = facilityId != null ? String(facilityId) : null;
  const metaLine = [
    screening?.dob ? `DOB ${screening.dob}` : null,
    screening?.age != null ? `${screening.age}yo` : null,
    screening?.gender ?? null,
    service || null,
    facilityLabel,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const activeStep = docMode ? STEP_DEFS.find((d) => d.mode === docMode) ?? null : null;

  return (
    <div
      className="h-full overflow-y-auto bg-gradient-to-b from-white/40 to-white/10 px-6 py-6"
      data-testid="ancillary-workflow-workspace"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        {/* ── Patient header (identity + context control) ── */}
        <div className="plexus-glass-75 rounded-3xl p-5">
          <div className="flex items-start justify-between gap-4">
            <button
              type="button"
              onClick={() => setQualOpen((v) => !v)}
              className="group flex min-w-0 items-center gap-3.5 rounded-2xl text-left transition-colors"
              aria-expanded={qualOpen}
              data-testid="ancillary-workflow-patient-toggle"
            >
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-lg font-semibold text-white shadow-sm"
                aria-hidden="true"
              >
                {getInitials(displayName)}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span
                    className="truncate text-xl font-semibold text-slate-900 group-hover:text-violet-800"
                    data-testid="ancillary-workflow-patient"
                  >
                    {displayName}
                  </span>
                  {hasEvidence && (
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:text-violet-600 ${
                        qualOpen ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{metaLine}</span>
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-2">
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
                className="h-9 gap-1.5 px-3 text-xs"
                onClick={openEhr}
                disabled={patientScreeningId == null}
                data-testid="button-ancillary-open-ehr"
              >
                <Stethoscope className="h-4 w-4" /> Open Plexus EHR
              </Button>
            </div>
          </div>

          {/* ── Why Qualified — expands directly under the patient identity,
              connected to the header (not a floating banner). ── */}
          {qualifyingTest && qualOpen && (
            <div
              className="mt-4 rounded-2xl border border-violet-100 bg-white/70 p-4"
              data-testid="ancillary-workflow-why-qualified"
            >
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
                <Sparkles className="h-3.5 w-3.5" /> Why Qualified — {service}
              </div>
              {hasEvidence ? (
                <QualifyingEvidence test={qualifyingTest} diagnoses={diagnoses} medications={medications} />
              ) : (
                <div
                  className="text-[11px] text-slate-500"
                  data-testid="ancillary-workflow-why-qualified-empty"
                >
                  No stored qualification evidence for this service. This may be a
                  legacy or manually-added test — open the EHR for full context.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Primary workflow ── */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Service Workflow
            </h2>
            <span className="text-xs text-slate-400">Informed Consent → Screening → Report</span>
          </div>

          <div className="relative">
            {/* Sequence connector (desktop) — sits behind the cards. */}
            <div
              className="pointer-events-none absolute left-[16%] right-[16%] top-[46px] hidden h-0.5 bg-gradient-to-r from-violet-200 via-violet-200 to-violet-200 md:block"
              aria-hidden="true"
            />
            <div className="relative grid gap-5 md:grid-cols-3">
              {STEP_DEFS.map((def) => {
                const { mode, step, title, description, Icon } = def;
                const itemState = readiness ? def.itemOf(readiness) : null;
                const isNext = nextMode === mode;
                const meta = statusMetaFor(itemState, isNext, mode);
                const isActive = docMode === mode;
                const isComplete = meta.kind === "complete";
                const emphasised = isNext || isActive;

                return (
                  <div
                    key={mode}
                    className={`group relative flex min-h-[248px] flex-col rounded-3xl border p-5 transition-all ${
                      isActive
                        ? "border-violet-300 bg-white shadow-md ring-2 ring-violet-200"
                        : emphasised
                          ? "border-violet-200 bg-white/90 shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                          : "plexus-glass-75 border-white/60 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                    }`}
                    data-testid={`ancillary-workflow-module-${mode}`}
                  >
                    {/* Top row: step badge + completion check */}
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Step {step}
                      </span>
                      {isComplete && (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Complete" />
                      )}
                    </div>

                    {/* Icon */}
                    <span
                      className={`mt-3 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
                        isComplete
                          ? "bg-emerald-100 text-emerald-600"
                          : emphasised
                            ? "bg-violet-600 text-white shadow-sm"
                            : "bg-violet-100 text-violet-700 group-hover:bg-violet-200"
                      }`}
                    >
                      <Icon className="h-7 w-7" />
                    </span>

                    {/* Title + description */}
                    <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>

                    {/* Status + action pinned to the bottom */}
                    <div className="mt-auto pt-4">
                      <div className="mb-2.5 flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                          Status
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[meta.kind]}`}
                          data-testid={`ancillary-workflow-status-${mode}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={isActive ? "secondary" : emphasised ? "default" : "outline"}
                        className="h-9 w-full text-xs"
                        onClick={() => setDocMode((m) => (m === mode ? null : mode))}
                        data-testid={`ancillary-workflow-open-${mode}`}
                      >
                        {isActive ? "Close" : meta.cta}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Active step workflow body (canonical components) ── */}
        {docMode && docService && (
          <div
            className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            data-testid={`ancillary-workflow-body-${docMode}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {activeStep && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                    <activeStep.Icon className="h-4 w-4" />
                  </span>
                )}
                <h3 className="text-sm font-semibold text-slate-900">
                  {activeStep?.title ?? "Workflow"}
                </h3>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
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

        {!service && (
          <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
            <ExternalLink className="h-3.5 w-3.5" /> No service context on this row.
          </div>
        )}
      </div>
    </div>
  );
}

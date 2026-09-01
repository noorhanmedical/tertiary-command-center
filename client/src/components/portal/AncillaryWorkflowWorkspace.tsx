// AncillaryWorkflowWorkspace — the ACS clinic-day workflow surface that opens
// in the Playground when an ACS clicks an ancillary schedule row.
//
// It is centered on the scheduled ancillary workflow (NOT a generic EHR dump):
//   • concise patient header (identity + scheduled service/time)
//   • quick Atlas access (Clinician + Plexus) via the canonical generators
//   • "Open Plexus EHR" action (dispatches the canonical patient_ehr workspace)
//   • "Why Qualified" for THIS service, from stored Plexus IQ evidence
//   • the three primary workflow modules: Informed Consent, Screening Form,
//     Report Upload (reusing the canonical AncillaryDocInline + ReportUploadPanel)
//
// It composes existing canonical pieces — it does NOT introduce new writers or
// duplicate qualification/document logic.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, ClipboardList, FileUp, Stethoscope, ExternalLink, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
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
import type { AncillaryReadinessSummary } from "@/lib/workflow/teamMemberWorkspaceApi";

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

export function AncillaryWorkflowWorkspace({
  patientScreeningId,
  executionCaseId,
  serviceKey,
  facilityId,
  patientName,
}: Props) {
  const [docMode, setDocMode] = useState<AncillaryDocMode>(null);

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

  const qualifyingTest = useMemo(
    () => (service ? toQualifyingTest(service, screening?.reasoning ?? null) : null),
    [service, screening?.reasoning],
  );
  const diagnoses = useMemo(() => splitList(screening?.diagnoses), [screening?.diagnoses]);
  const medications = useMemo(() => splitList(screening?.medications), [screening?.medications]);

  // The single-service context the doc workflow modules operate on.
  const docService: AncillaryServiceContext | null = useMemo(() => {
    if (!service) return null;
    return {
      instanceId: `${executionCaseId ?? "nocase"}:${service}`,
      serviceType: service,
      executionCaseId: executionCaseId ?? null,
      patientScreeningId: patientScreeningId ?? null,
      readiness: null as AncillaryReadinessSummary | null,
    };
  }, [service, executionCaseId, patientScreeningId]);

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

  const facilityLabel = facilityId != null ? String(facilityId) : null;

  return (
    <div className="h-full overflow-y-auto bg-transparent p-4" data-testid="ancillary-workflow-workspace">
      {/* ── Patient header ── */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700"
            aria-hidden="true"
          >
            {getInitials(displayName)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900" data-testid="ancillary-workflow-patient">
              {displayName}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {[
                screening?.dob ? `DOB ${screening.dob}` : null,
                screening?.age != null ? `${screening.age}yo` : null,
                screening?.gender ?? null,
                service || null,
                facilityLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
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
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={openEhr}
            disabled={patientScreeningId == null}
            data-testid="button-ancillary-open-ehr"
          >
            <Stethoscope className="h-3 w-3" /> Open Plexus EHR
          </Button>
        </div>
      </div>

      {/* ── Why Qualified (stored Plexus IQ evidence for THIS service) ── */}
      {qualifyingTest && (
        <Card className="mb-3 border-violet-200/70 bg-violet-50/30 p-3" data-testid="ancillary-workflow-why-qualified">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
            <Sparkles className="h-3.5 w-3.5" /> Why Qualified — {service}
          </div>
          {qualifyingTest.qualifyingFactors?.length ||
          qualifyingTest.clinicianUnderstanding ||
          diagnoses.length ||
          medications.length ? (
            <QualifyingEvidence test={qualifyingTest} diagnoses={diagnoses} medications={medications} />
          ) : (
            <div className="text-[11px] text-slate-500" data-testid="ancillary-workflow-why-qualified-empty">
              No stored qualification evidence for this service. This may be a
              legacy or manually-added test — open the EHR for full context.
            </div>
          )}
        </Card>
      )}

      {/* ── Three primary workflow modules ── */}
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {(
          [
            { mode: "consent" as const, label: "Consent", Icon: FileSignature },
            { mode: "screening" as const, label: "Screening", Icon: ClipboardList },
            { mode: "report" as const, label: "Report", Icon: FileUp },
          ]
        ).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => setDocMode((m) => (m === mode ? null : mode))}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors ${
              docMode === mode
                ? "border-violet-300 bg-violet-100 text-violet-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            data-testid={`ancillary-workflow-module-${mode}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Active module body (canonical components) ── */}
      {docMode && docService && (
        <Card className="p-3" data-testid={`ancillary-workflow-body-${docMode}`}>
          {docMode === "report" && executionCaseId != null && patientScreeningId != null ? (
            <ReportUploadPanel
              executionCaseId={executionCaseId}
              patientScreeningId={patientScreeningId}
              serviceType={service || null}
            />
          ) : (
            <AncillaryDocInline
              mode={docMode}
              active={docService}
              patientName={displayName}
              onChanged={() => setDocMode(null)}
              onClose={() => setDocMode(null)}
            />
          )}
        </Card>
      )}

      {docMode === "report" && (executionCaseId == null || patientScreeningId == null) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          This appointment isn't fully linked to a patient/case yet, so a report
          can't be attached to the correct episode. Open the EHR to resolve the
          linkage first.
        </div>
      )}

      {!service && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
          <ExternalLink className="h-3.5 w-3.5" /> No service context on this row.
        </div>
      )}
    </div>
  );
}

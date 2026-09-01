// A0-UI — ACS/PCS ancillary-case screening page.
//
// Resolves the real screening context (readiness row + ids + questionnaire)
// for a canonical ancillary case, shows completion status, and hosts the
// structured BrainWave/VitalWave questionnaire. Submitting flows through the
// real A0 backend, which triggers A1 (Order Note refresh) server-side.

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { ScreeningQuestionnaire, type ScreeningContextResolved } from "@/features/screening/ScreeningQuestionnaire";
import type { Questionnaire } from "@shared/schema/screeningEvidence";

type ContextResponse = {
  clinicId: number;
  ancillaryCaseId: number;
  serviceType: string;
  questionnaire: Questionnaire | null;
  questionnaireVersion: string | null;
  screeningReadinessId: number;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  current: { version: string; completedAt: string | null; completedByRole: string | null } | null;
};

export default function AncillaryScreeningPage() {
  const params = useParams<{ ancillaryCaseId: string }>();
  const ancillaryCaseId = Number(params.ancillaryCaseId);

  const { data, isLoading, error, refetch, isFetching } = useQuery<ContextResponse>({
    queryKey: ["screening-context", ancillaryCaseId],
    enabled: Number.isFinite(ancillaryCaseId),
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/screening-evidence/context", { ancillaryCaseId });
      return res.json();
    },
  });

  if (!Number.isFinite(ancillaryCaseId)) {
    return <div className="p-6 text-sm text-destructive">Invalid ancillary case id.</div>;
  }
  if (isLoading) {
    return <div className="p-6 flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading screening…</div>;
  }
  if (error) {
    const msg = error instanceof ApiError ? `${error.status}: ${error.body}` : (error as Error).message;
    return <div className="p-6 text-sm text-destructive">Could not load screening context — {msg}</div>;
  }
  if (!data) return null;

  if (!data.questionnaire || !data.questionnaireVersion) {
    return (
      <div className="p-6 text-sm">
        Structured screening is not defined for service <b>{data.serviceType}</b>. Only BrainWave and VitalWave have structured questionnaires.
      </div>
    );
  }

  const resolved: ScreeningContextResolved = {
    clinicId: data.clinicId,
    ancillaryCaseId: data.ancillaryCaseId,
    serviceType: data.serviceType,
    questionnaire: data.questionnaire,
    questionnaireVersion: data.questionnaireVersion,
    screeningReadinessId: data.screeningReadinessId,
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ancillary Screening — {data.serviceType}</h1>
        <div className="text-xs text-muted-foreground">Case #{data.ancillaryCaseId}</div>
      </div>

      <div className="rounded-lg border p-4 text-sm">
        <div className="font-medium mb-1">Screening</div>
        {data.current ? (
          <div className="space-y-1">
            <div>Status: <span className="font-medium text-emerald-700">Complete</span></div>
            <div className="text-muted-foreground">
              Completed by role: {data.current.completedByRole ?? "—"} · Completed at: {data.current.completedAt ?? "—"} · Version: {data.current.version.slice(0, 12)}…
            </div>
            <div className="text-xs text-muted-foreground">Re-submitting will update the structured evidence and refresh the unsigned Order Note.</div>
          </div>
        ) : (
          <div>Status: <span className="font-medium text-amber-700">Incomplete</span> — complete the questionnaire below.</div>
        )}
      </div>

      <ScreeningQuestionnaire
        context={resolved}
        onSubmitted={() => refetch()}
      />
      {isFetching ? <div className="text-xs text-muted-foreground">Refreshing status…</div> : null}
    </div>
  );
}

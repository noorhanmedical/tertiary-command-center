// aiRecommendationsApi — Phase 3 PR 3.4 client.

export type RecommendationStatus = "proposed" | "accepted" | "rejected" | "superseded";
export type ModelProvider = "rules_engine" | "openai" | "other" | "not_configured";
export type ConfidenceLabel = "not_applicable" | "low" | "medium" | "high";

export type AiRecommendation = {
  id: number;
  recommendationKey: string;
  exceptionSnapshotId: number | null;
  recommendationType: string;
  recommendedAction: string;
  title: string;
  body: string;
  modelProvider: ModelProvider;
  modelName: string | null;
  confidenceLabel: ConfidenceLabel;
  ruleIds: string[];
  rationale: string;
  inputs: Record<string, unknown>;
  status: RecommendationStatus;
  requiresHumanReview: number;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
  policySnapshot: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  detectorVersion: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AiSafetyPolicy = {
  allowedModelProviders: ModelProvider[];
  effectiveModelProvider: ModelProvider;
  confidenceReportingMode: "rules_only" | "model_label" | "explicit_label";
  humanReviewRequired: true;
  autoActionsEnabled: false;
  sources: Record<string, string>;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchAiSafetyPolicy(): Promise<AiSafetyPolicy> {
  const res = await fetch(`/api/ai-recommendations/safety-policy`, { credentials: "include" });
  return jsonOrThrow(res);
}

export async function fetchAiRecommendations(filters: {
  status?: string; exceptionSnapshotId?: number; modelProvider?: string; recommendedAction?: string;
} = {}): Promise<AiRecommendation[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.exceptionSnapshotId != null) qs.set("exceptionSnapshotId", String(filters.exceptionSnapshotId));
  if (filters.modelProvider) qs.set("modelProvider", filters.modelProvider);
  if (filters.recommendedAction) qs.set("recommendedAction", filters.recommendedAction);
  const res = await fetch(`/api/ai-recommendations${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow(res);
}

export async function acceptAiRecommendation(id: number) {
  const res = await fetch(`/api/ai-recommendations/${id}/accept`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}

export async function rejectAiRecommendation(id: number, reason: string) {
  const res = await fetch(`/api/ai-recommendations/${id}/reject`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
  });
  return jsonOrThrow(res);
}

export const PROVIDER_TONE: Record<ModelProvider, string> = {
  rules_engine: "bg-emerald-50 text-emerald-800",
  openai: "bg-violet-50 text-violet-800",
  other: "bg-amber-50 text-amber-800",
  not_configured: "bg-slate-50 text-slate-700",
};

export const CONFIDENCE_TONE: Record<ConfidenceLabel, string> = {
  not_applicable: "bg-slate-50 text-slate-700",
  low: "bg-blue-50 text-blue-800",
  medium: "bg-amber-50 text-amber-900",
  high: "bg-rose-50 text-rose-900",
};

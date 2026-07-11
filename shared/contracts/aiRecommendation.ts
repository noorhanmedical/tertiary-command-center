// Phase 3 PR 3.4 — shared AI recommendation contract.
//
// This module defines the *vocabulary* the recommendation log uses and the
// explainability surface. It does not execute anything. PR 3.5 will
// generate recommendations against this contract.

export const MODEL_PROVIDERS = [
  "rules_engine",
  "openai",
  "other",
  "not_configured",
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const CONFIDENCE_LABELS = [
  "not_applicable",
  "low",
  "medium",
  "high",
] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export const RECOMMENDATION_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "superseded",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

// Action vocabulary — what the recommendation is *proposing*. None of these
// strings authorise execution; they are labels for human review.
export const RECOMMENDATION_ACTIONS = [
  "schedule_callback",
  "request_signature",
  "send_invoice",
  "resend_invoice",
  "follow_up_denial",
  "reassign_owner",
  "escalate_to_admin",
  "request_more_info",
  "dismiss_exception",
  "other",
] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

/** Effective AI safety policy returned by the safety service. */
export type AiSafetyPolicy = {
  /** Which providers an installation has authorised. */
  allowedModelProviders: ModelProvider[];
  /** Which provider the recommendation engine should use right now. */
  effectiveModelProvider: ModelProvider;
  /** "rules_only" → confidence is always not_applicable;
   *  "model_label" → use the provider-reported label;
   *  "explicit_label" → recommendation engine assigns the label.
   */
  confidenceReportingMode: "rules_only" | "model_label" | "explicit_label";
  /** Hard-forced true. Human must review every recommendation. */
  humanReviewRequired: true;
  /** Hard-forced false. No automatic execution. */
  autoActionsEnabled: false;
  /** Source breakdown for the UI ("admin_settings" / "default" / "env"). */
  sources: Record<string, "admin_settings" | "default" | "env">;
};

/** Explainability payload attached to every recommendation log entry. */
export type RecommendationExplanation = {
  modelProvider: ModelProvider;
  modelName: string | null;
  confidenceLabel: ConfidenceLabel;
  ruleIds: string[];
  inputs: Record<string, unknown>;
  rationale: string;
};

export const AI_SAFETY_DOMAIN = "ai_safety";

export const AI_SAFETY_KEYS = {
  allowedModelProviders: "allowed_model_providers",
  defaultModelProvider: "default_model_provider",
  confidenceReportingMode: "confidence_reporting_mode",
} as const;

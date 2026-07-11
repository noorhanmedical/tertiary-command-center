// Phase 3 PR 3.1 — shared exception-intelligence types.

export type ExceptionSeverity = "info" | "low" | "medium" | "high" | "critical";

export type ExceptionOwnerRole = "pcs" | "acs" | "biller" | "admin" | "manager_review";

export type DetectorCategory = "engagement" | "document" | "scheduling" | "billing" | "operations";

export type ExceptionType =
  // engagement / call
  | "callback_overdue"
  | "lvm_followup_overdue"
  | "no_answer_followup_overdue"
  | "unable_to_reach_threshold_met"
  | "ready_to_schedule_stale"
  | "stale_queue_item"
  // document / ACS
  | "report_missing"
  | "order_note_missing"
  | "procedure_note_missing"
  | "physician_signature_pending"
  | "billing_readiness_blocked"
  | "insurance_verification_pending"
  | "duplicate_patient_risk"
  | "missing_patient_contact"
  // scheduling
  | "scheduling_delay"
  | "no_show_followup_due"
  // billing
  | "invoice_readiness_blocked"
  | "invoice_batch_stale"
  | "invoice_draft_stale"
  | "invoice_approval_stale"
  | "invoice_delivery_failed"
  | "missing_invoice_recipient"
  | "payment_overdue"
  | "denial_followup_due"
  | "disputed_invoice"
  | "remittance_missing"
  | "high_balance_aging";

/** Detector registry entry — pure declarative metadata. */
export type DetectorDefinition = {
  exceptionType: ExceptionType;
  category: DetectorCategory;
  defaultSeverity: ExceptionSeverity;
  defaultOwnerRole: ExceptionOwnerRole;
  /** Setting key that overrides the threshold for this detector. */
  thresholdSettingKey: string;
  /** Default threshold in hours (or days when explicitly `_days`). */
  defaultThresholdValue: number;
  thresholdUnit: "hours" | "days" | "attempts" | "count";
  /** Friendly title for UI surfaces. */
  title: string;
  /** Short explanation template; engine substitutes facts. */
  explanationTemplate: string;
};

export type EffectiveDetectorPolicy = {
  exceptionType: ExceptionType;
  severity: ExceptionSeverity;
  ownerRole: ExceptionOwnerRole;
  thresholdValue: number;
  thresholdUnit: "hours" | "days" | "attempts" | "count";
  source: "test_type" | "facility" | "user" | "global" | "default";
};

export type EffectiveExceptionPolicy = {
  scope: { facilityId: string | null; testType: string | null };
  detectors: Record<ExceptionType, EffectiveDetectorPolicy>;
  humanReviewRequired: boolean;
  autoActionsEnabled: boolean;
  sources: Record<string, "test_type" | "facility" | "user" | "global" | "default">;
};

export const EXCEPTION_INTELLIGENCE_DOMAIN = "exception_intelligence";

export const EXCEPTION_GLOBAL_KEYS = {
  humanReviewRequired: "human_review_required",
  autoActionsEnabled: "auto_actions_enabled",
} as const;

// Shared billing-policy types — Phase 4 PR 4.1.
//
// These types describe the effective policy bundle returned by
// /api/billing-policy/effective. The server resolves them from
// admin_settings via the (facility, user, testType, global) scope
// precedence Phase 2 hardening item 5 added.

export type InvoiceFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom_days_of_month"
  | "custom_weekdays";

export type InvoiceCutoffWindow =
  | "through_yesterday"
  | "through_period_end"
  | "through_end_of_week"
  | "through_today";

export type InvoiceDeliveryMethod =
  | "download_only"
  | "email"
  | "portal_pending"
  | "integration_pending";

export type ApprovalRequirement =
  | "none"
  | "admin"
  | "billing_auditor"
  | "admin_or_auditor";

export type PaymentTerm = "due_on_receipt" | "net_7" | "net_15" | "net_30" | "custom";

export type RevenueSplitRule = {
  /** Plexus share as a percentage (0-100). null when not configured. */
  plexusSharePercent: number | null;
  /** Clinic share as a percentage (0-100). */
  clinicSharePercent: number | null;
  /** Fixed Plexus fee per line item in dollars. */
  plexusFixedFee: number | null;
};

export type EffectiveBillingPolicy = {
  scope: { facilityId: string | null; testType: string | null };
  schedule: {
    frequency: InvoiceFrequency;
    daysOfMonth: number[];      // for custom_days_of_month
    weekdays: number[];         // 0=Sun..6=Sat for custom_weekdays
    timezone: string;
    cutoffWindow: InvoiceCutoffWindow;
    cutoffHourLocal: number;     // 0..23
  };
  recipients: {
    primaryEmail: string | null;
    ccEmails: string[];
    bccEmails: string[];
    billingContactName: string | null;
    fallbackToFacilityContact: boolean;
    escalationContactName: string | null;
    deliveryMethod: InvoiceDeliveryMethod;
  };
  pricing: {
    perTestPrice: number | null;        // unit price for the testType in scope
    bundledPrice: number | null;
    minimumMonthlyFee: number | null;
    allowManualAdjustment: boolean;
    revenueSplit: RevenueSplitRule;
  };
  readiness: {
    holdMissingReport: boolean;
    holdMissingConsent: boolean;
    holdMissingScreening: boolean;
    holdMissingOrderNote: boolean;
    holdMissingProcedureNote: boolean;
    holdPendingPhysicianSignature: boolean;
    holdPendingBillingReadiness: boolean;
    holdPendingInsuranceVerification: boolean;
    excludeNoShows: boolean;
    excludeCancelled: boolean;
    billableNoShow: boolean;
  };
  approval: {
    requirement: ApprovalRequirement;
    autoDraftOnly: boolean;
  };
  paymentTerms: {
    term: PaymentTerm;
    customDays: number | null;
    reminderIntervalDays: number;
  };
  numbering: {
    facilityPrefix: string | null;
    includePeriodCode: boolean;
  };
  /** Per-key source ledger (test_type | facility | user | global | default). */
  sources: Record<string, "test_type" | "facility" | "user" | "global" | "default">;
};

export const BILLING_POLICY_KEYS = {
  // schedule
  scheduleFrequency: "schedule_frequency",
  scheduleDaysOfMonth: "schedule_days_of_month",
  scheduleWeekdays: "schedule_weekdays",
  scheduleTimezone: "schedule_timezone",
  scheduleCutoffWindow: "schedule_cutoff_window",
  scheduleCutoffHourLocal: "schedule_cutoff_hour_local",
  // recipients
  primaryEmail: "primary_email",
  ccEmails: "cc_emails",
  bccEmails: "bcc_emails",
  billingContactName: "billing_contact_name",
  fallbackToFacilityContact: "fallback_to_facility_contact",
  escalationContactName: "escalation_contact_name",
  deliveryMethod: "delivery_method",
  // pricing
  perTestPrice: "per_test_price",
  bundledPrice: "bundled_price",
  minimumMonthlyFee: "minimum_monthly_fee",
  allowManualAdjustment: "allow_manual_adjustment",
  revenueSplit: "revenue_split",
  // readiness
  holdMissingReport: "hold_missing_report",
  holdMissingConsent: "hold_missing_consent",
  holdMissingScreening: "hold_missing_screening",
  holdMissingOrderNote: "hold_missing_order_note",
  holdMissingProcedureNote: "hold_missing_procedure_note",
  holdPendingPhysicianSignature: "hold_pending_physician_signature",
  holdPendingBillingReadiness: "hold_pending_billing_readiness",
  holdPendingInsuranceVerification: "hold_pending_insurance_verification",
  excludeNoShows: "exclude_no_shows",
  excludeCancelled: "exclude_cancelled",
  billableNoShow: "billable_no_show",
  // approval
  approvalRequirement: "approval_requirement",
  autoDraftOnly: "auto_draft_only",
  // payment
  paymentTerm: "payment_term",
  paymentTermCustomDays: "payment_term_custom_days",
  reminderIntervalDays: "reminder_interval_days",
  // numbering
  facilityPrefix: "facility_prefix",
  includePeriodCode: "include_period_code",
} as const;

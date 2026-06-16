// Phase 3 PR 3.5 — recommendation rule registry.
//
// Each rule converts a detected exception into a *proposed* next-best
// action. Rules are pure: they read the exception row + safety policy
// and return a recommendation proposal (or null if the engine should
// stay silent). The engine never executes the proposal — humans accept
// or reject from /admin/ai-recommendations.

import type { ExceptionSnapshot } from "@shared/schema/exceptionSnapshots";
import type {
  AiSafetyPolicy,
  RecommendationAction,
} from "@shared/contracts/aiRecommendation";

export const RECOMMENDATION_VERSION = "3.6.0";

export type RecommendationProposal = {
  recommendationType: string;
  recommendedAction: RecommendationAction;
  title: string;
  body: string;
  ruleIds: string[];
  rationale: string;
  inputs: Record<string, unknown>;
};

export type RuleContext = {
  exception: ExceptionSnapshot;
  safety: AiSafetyPolicy;
  policySnapshot: Record<string, unknown>;
};

export type RuleFn = (ctx: RuleContext) => RecommendationProposal | null;

function fact(snapshot: Record<string, unknown>, key: string, fallback = "—"): string {
  const v = snapshot[key];
  return v == null ? fallback : String(v);
}

const callbackOverdueRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  const overdueBy = fact(snap, "overdueHours");
  return {
    recommendationType: "callback_followup",
    recommendedAction: "schedule_callback",
    title: "Schedule callback follow-up",
    body: `Callback is overdue by ${overdueBy}h. Reach out via the next allowed channel before escalating.`,
    ruleIds: ["callback_overdue::schedule_followup"],
    rationale:
      "Detected callback_overdue. Rule proposes scheduling the next attempt rather than auto-dialing. Human must confirm.",
    inputs: {
      overdueHours: snap.overdueHours ?? null,
      lastAttemptAt: snap.lastAttemptAt ?? null,
      attemptCount: snap.attemptCount ?? null,
    },
  };
};

const paymentOverdueRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  const balance = fact(snap, "outstandingBalance");
  return {
    recommendationType: "payment_outreach",
    recommendedAction: "resend_invoice",
    title: "Resend invoice to patient",
    body: `Outstanding balance ${balance}. Propose to resend the most recent invoice and flag for billing follow-up.`,
    ruleIds: ["payment_overdue::resend_invoice"],
    rationale:
      "Detected payment_overdue. Rule proposes a resend (human-approved); does not initiate any charge.",
    inputs: {
      invoiceId: exception.invoiceId,
      outstandingBalance: snap.outstandingBalance ?? null,
      lastDeliveryAt: snap.lastDeliveryAt ?? null,
    },
  };
};

const invoiceDeliveryFailedRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "invoice_redelivery",
    recommendedAction: "resend_invoice",
    title: "Re-deliver invoice via fallback channel",
    body: `Invoice ${exception.invoiceId ?? "—"} delivery failed (${fact(snap, "lastError")}). Propose using the configured fallback channel.`,
    ruleIds: ["invoice_delivery_failed::resend_via_fallback"],
    rationale:
      "Detected invoice_delivery_failed. Rule proposes re-delivery; no auto-resend is performed.",
    inputs: {
      invoiceId: exception.invoiceId,
      lastChannel: snap.lastChannel ?? null,
      lastError: snap.lastError ?? null,
    },
  };
};

const invoiceReadinessBlockedRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "invoice_readiness_unblock",
    recommendedAction: "request_more_info",
    title: "Request missing readiness checks",
    body: `Invoice readiness is blocked on: ${fact(snap, "blockedReasons")}. Propose to request the missing items from the responsible team.`,
    ruleIds: ["invoice_readiness_blocked::request_more_info"],
    rationale:
      "Detected invoice_readiness_blocked. Rule proposes information request; readiness is not marked complete automatically.",
    inputs: {
      invoiceId: exception.invoiceId,
      blockedReasons: snap.blockedReasons ?? null,
    },
  };
};

const physicianSignaturePendingRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "signature_request",
    recommendedAction: "request_signature",
    title: "Request physician signature",
    body: `Documentation pending physician signature for ${fact(snap, "patientLabel")}. Propose to send a signature request.`,
    ruleIds: ["physician_signature_pending::request_signature"],
    rationale:
      "Detected physician_signature_pending. Rule proposes the request; nothing is signed automatically.",
    inputs: {
      executionCaseId: exception.executionCaseId,
      pendingDocumentIds: snap.pendingDocumentIds ?? null,
    },
  };
};

const denialFollowupDueRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "denial_followup",
    recommendedAction: "follow_up_denial",
    title: "Follow up on payer denial",
    body: `Denial follow-up due (reason: ${fact(snap, "denialReason")}). Propose to assign a biller to work the denial.`,
    ruleIds: ["denial_followup_due::assign_biller"],
    rationale:
      "Detected denial_followup_due. Rule proposes assignment; biller still owns the work.",
    inputs: {
      invoiceId: exception.invoiceId,
      denialReason: snap.denialReason ?? null,
      payer: snap.payer ?? null,
    },
  };
};

// ── PR 3.6 — document + billing rules ──────────────────────────────

const missingDocumentRule = (label: string): RuleFn => ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: `${label}_request`,
    recommendedAction: "request_more_info",
    title: `Request missing ${label}`,
    body: `${label} missing for ${fact(snap, "patientLabel")} (${fact(snap, "hoursMissing")}h). Propose to request the document from the responsible team.`,
    ruleIds: [`${label}_missing::request_more_info`],
    rationale: `Detected ${label}_missing. Rule proposes an information request; no document is fabricated or auto-uploaded.`,
    inputs: { documentType: snap.documentType, hoursMissing: snap.hoursMissing },
  };
};

const billingReadinessBlockedRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "billing_readiness_unblock",
    recommendedAction: "request_more_info",
    title: "Collect missing billing requirements",
    body: `Billing readiness blocked on: ${fact(snap, "missingRequirements")}. Propose to request the missing items.`,
    ruleIds: ["billing_readiness_blocked::request_more_info"],
    rationale:
      "Detected billing_readiness_blocked. Rule proposes information collection; billing is not marked ready automatically.",
    inputs: {
      executionCaseId: exception.executionCaseId,
      missingRequirements: snap.missingRequirements ?? null,
    },
  };
};

const invoiceBatchStaleRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "invoice_batch_review",
    recommendedAction: "escalate_to_admin",
    title: "Escalate stale invoice batch",
    body: `Invoice batch #${exception.entityId ?? "—"} has been in ${fact(snap, "batchStatus")} for ${fact(snap, "hoursStale")}h. Propose to escalate for review.`,
    ruleIds: ["invoice_batch_stale::escalate"],
    rationale:
      "Detected invoice_batch_stale. Rule proposes escalation; the batch is not auto-closed or auto-approved.",
    inputs: { batchId: exception.entityId, batchStatus: snap.batchStatus },
  };
};

const invoiceDraftStaleRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "invoice_draft_review",
    recommendedAction: "reassign_owner",
    title: "Reassign stale draft invoice",
    body: `Invoice #${exception.invoiceId ?? "—"} has been in Draft for ${fact(snap, "hoursStale")}h. Propose to reassign owner for review.`,
    ruleIds: ["invoice_draft_stale::reassign_owner"],
    rationale:
      "Detected invoice_draft_stale. Rule proposes ownership reassignment only; no status changes happen automatically.",
    inputs: { invoiceId: exception.invoiceId, hoursStale: snap.hoursStale },
  };
};

const missingInvoiceRecipientRule: RuleFn = ({ exception }) => {
  return {
    recommendationType: "invoice_recipient_collection",
    recommendedAction: "request_more_info",
    title: "Collect invoice recipient",
    body: `Invoice #${exception.invoiceId ?? "—"} cannot deliver — recipient missing. Propose to request recipient details from the patient or facility.`,
    ruleIds: ["missing_invoice_recipient::request_more_info"],
    rationale:
      "Detected missing_invoice_recipient. Rule proposes request; recipient is never auto-populated from external sources.",
    inputs: { invoiceId: exception.invoiceId },
  };
};

const highBalanceAgingRule: RuleFn = ({ exception }) => {
  const snap = (exception.sourceSnapshot ?? {}) as Record<string, unknown>;
  return {
    recommendationType: "high_balance_review",
    recommendedAction: "escalate_to_admin",
    title: "Escalate aging high-balance invoice",
    body: `Invoice #${exception.invoiceId ?? "—"} balance ${fact(snap, "totalBalance")} has aged ${fact(snap, "daysAging")}d. Propose escalation to admin/biller.`,
    ruleIds: ["high_balance_aging::escalate"],
    rationale:
      "Detected high_balance_aging. Rule proposes escalation; no write-off, no auto-collection.",
    inputs: { invoiceId: exception.invoiceId, totalBalance: snap.totalBalance, daysAging: snap.daysAging },
  };
};

export const RECOMMENDATION_RULES: Partial<Record<string, RuleFn>> = {
  callback_overdue: callbackOverdueRule,
  payment_overdue: paymentOverdueRule,
  invoice_delivery_failed: invoiceDeliveryFailedRule,
  invoice_readiness_blocked: invoiceReadinessBlockedRule,
  physician_signature_pending: physicianSignaturePendingRule,
  denial_followup_due: denialFollowupDueRule,
  report_missing: missingDocumentRule("report"),
  order_note_missing: missingDocumentRule("order_note"),
  procedure_note_missing: missingDocumentRule("procedure_note"),
  billing_readiness_blocked: billingReadinessBlockedRule,
  invoice_batch_stale: invoiceBatchStaleRule,
  invoice_draft_stale: invoiceDraftStaleRule,
  missing_invoice_recipient: missingInvoiceRecipientRule,
  high_balance_aging: highBalanceAgingRule,
};

/** Return the rule for an exception type, or null if no rule is registered. */
export function getRuleForExceptionType(exceptionType: string): RuleFn | null {
  return RECOMMENDATION_RULES[exceptionType] ?? null;
}

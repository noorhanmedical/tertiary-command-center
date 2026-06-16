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

export const RECOMMENDATION_VERSION = "3.5.0";

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

export const RECOMMENDATION_RULES: Partial<Record<string, RuleFn>> = {
  callback_overdue: callbackOverdueRule,
  payment_overdue: paymentOverdueRule,
  invoice_delivery_failed: invoiceDeliveryFailedRule,
  invoice_readiness_blocked: invoiceReadinessBlockedRule,
  physician_signature_pending: physicianSignaturePendingRule,
  denial_followup_due: denialFollowupDueRule,
};

/** Return the rule for an exception type, or null if no rule is registered. */
export function getRuleForExceptionType(exceptionType: string): RuleFn | null {
  return RECOMMENDATION_RULES[exceptionType] ?? null;
}

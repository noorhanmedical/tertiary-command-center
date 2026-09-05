// Phase P2 — pure operational presentation logic for the canonical ACS/PCS
// stage vector.
//
// ZERO React, zero I/O. Everything here is a pure function over the SERVER-
// computed `CaseStageVector` (currentStage / currentStageIntegrity / per-stage
// StageStatus / billingReadiness blockers). It NEVER recomputes which stage a
// case is in and NEVER runs a frontend lifecycle state machine — it only maps
// the server's already-decided next stage + blockers to an operational label,
// tone, "next action", and worklist bucket. Service classification uses the
// canonical alias-resolved identity (shared/canonicalService), never a service-
// name regex or a scattered hardcoded BW/VW check.

import {
  CANONICAL_STAGE_ORDER,
  type CaseStageVector,
  type CanonicalStageKey,
  type StageStatus,
  type CodeCount,
} from "@shared/canonicalStageVector";
import { serviceRequiresStructuredScreening } from "@shared/canonicalService";

export type OperationalTone = "green" | "amber" | "blue" | "red" | "gray";

export const STAGE_LABELS: Record<CanonicalStageKey, string> = {
  adminReview: "Admin Review",
  engagement: "Engagement",
  appointment: "Appointment",
  orderNote: "Order Note",
  procedure: "Procedure",
  report: "Report",
  procedureNote: "Procedure Note",
  signature: "Signature",
  billingReadiness: "Billing Readiness",
  billingDocument: "Billing Document",
  claim: "Claim",
  invoice: "Invoice",
  payment: "Payment",
};

// Human "next action" phrasing for each canonical stage. This is DISPLAY text
// for the server-decided `currentStage`; it does not decide the stage.
const NEXT_ACTION_LABELS: Record<CanonicalStageKey, string> = {
  adminReview: "Awaiting admin review",
  engagement: "Add to engagement outreach",
  appointment: "Schedule appointment",
  orderNote: "Order Note needs signature",
  procedure: "Ready for procedure",
  report: "Awaiting diagnostic report",
  procedureNote: "Procedure Note pending",
  signature: "Procedure Note needs signature",
  billingReadiness: "Prepare billing",
  billingDocument: "Generate billing document",
  claim: "Submit claim",
  invoice: "Issue invoice",
  payment: "Collect payment",
};

const STAGE_TONE: Record<CanonicalStageKey, OperationalTone> = {
  adminReview: "amber",
  engagement: "amber",
  appointment: "blue",
  orderNote: "amber",
  procedure: "blue",
  report: "amber",
  procedureNote: "amber",
  signature: "amber",
  billingReadiness: "blue",
  billingDocument: "blue",
  claim: "blue",
  invoice: "blue",
  payment: "blue",
};

export type NextAction = {
  /** The server-decided current stage (null when complete or unresolvable). */
  stageKey: CanonicalStageKey | null;
  label: string;
  tone: OperationalTone;
  /** True when this represents an outstanding action (i.e. not "complete"). */
  actionable: boolean;
  /** True when the case cannot progress until a data-integrity issue is fixed. */
  integrityIssue: boolean;
};

/** Derive the explicit "next action" for a case, PURELY from the server's
 *  currentStage + currentStageIntegrity. No stage is recomputed. */
export function nextActionForCase(v: CaseStageVector): NextAction {
  if (v.currentStageIntegrity === "conflicting") {
    return {
      stageKey: v.currentStage,
      label: v.currentStage
        ? `Resolve data integrity issue — ${STAGE_LABELS[v.currentStage]}`
        : "Resolve data integrity issue",
      tone: "red",
      actionable: true,
      integrityIssue: true,
    };
  }
  if (v.currentStage == null) {
    // Resolved + no current stage → the whole (enabled) lifecycle is complete.
    return { stageKey: null, label: "Complete — no action required", tone: "green", actionable: false, integrityIssue: false };
  }
  return {
    stageKey: v.currentStage,
    label: NEXT_ACTION_LABELS[v.currentStage],
    tone: STAGE_TONE[v.currentStage],
    actionable: true,
    integrityIssue: false,
  };
}

export type CaseBlocker = {
  code: string;
  count: number;
  /** Where the blocker was surfaced. */
  source: "billing" | "claim" | CanonicalStageKey;
};

/** Aggregate the canonical, PHI-free blockers for a case: the persisted billing
 *  + claim blocker code counts from the billing-readiness stage, plus the
 *  warning codes of any stage the server flagged as `conflicting`. Pure. */
export function caseBlockers(v: CaseStageVector): CaseBlocker[] {
  const out: CaseBlocker[] = [];
  for (const b of v.billingReadiness.billingBlockers ?? []) out.push({ code: b.code, count: b.count, source: "billing" });
  for (const b of v.billingReadiness.claimBlockers ?? []) out.push({ code: b.code, count: b.count, source: "claim" });
  for (const key of CANONICAL_STAGE_ORDER) {
    const s = v[key] as StageStatus | undefined;
    if (s && s.integrity === "conflicting") {
      for (const w of s.warnings ?? []) out.push({ code: w, count: 1, source: key });
    }
  }
  return out;
}

/** Convenience: does the case have any outstanding blocker signal. */
export function hasBlockers(v: CaseStageVector): boolean {
  return caseBlockers(v).length > 0;
}

// ─── Operational worklist buckets (client-side over fetched canonical rows) ───
// Each bucket is a pure predicate over the SERVER-decided currentStage /
// integrity (and, for the screening lens only, the canonical alias-resolved
// screening requirement). Buckets are FILTER LENSES, not a partition — they may
// overlap (e.g. a screening-required Order Note case matches both "Needs
// screening" and "Needs signature"). No lifecycle is recomputed.

export type OperationalFilterId =
  | "all"
  | "needs_admin_review"
  | "needs_engagement"
  | "needs_scheduling"
  | "needs_screening"
  | "needs_signature"
  | "ready_for_procedure"
  | "report_pending"
  | "procedure_note_pending"
  | "billing"
  | "needs_review"
  | "complete";

export type OperationalFilter = {
  id: OperationalFilterId;
  label: string;
  match: (v: CaseStageVector) => boolean;
};

const isComplete = (v: CaseStageVector) => v.currentStage == null && v.currentStageIntegrity !== "conflicting";

export const OPERATIONAL_FILTERS: OperationalFilter[] = [
  { id: "all", label: "All cases", match: () => true },
  { id: "needs_admin_review", label: "Needs admin review", match: (v) => v.currentStage === "adminReview" && v.currentStageIntegrity !== "conflicting" },
  { id: "needs_engagement", label: "Needs engagement", match: (v) => v.currentStage === "engagement" && v.currentStageIntegrity !== "conflicting" },
  { id: "needs_scheduling", label: "Needs scheduling", match: (v) => v.currentStage === "appointment" && v.currentStageIntegrity !== "conflicting" },
  {
    id: "needs_screening",
    // Order-Note-stage cases whose canonical service requires structured
    // screening (BW/VW). The ACS canonical DTO models screening as a
    // prerequisite of the Order Note stage (no separate stage), so this is the
    // screening lens over the Order Note stage — resolved via the canonical
    // alias table, never a service-name regex.
    label: "Screening (Order Note · screening-required)",
    match: (v) => v.currentStage === "orderNote" && v.currentStageIntegrity !== "conflicting" && serviceRequiresStructuredScreening(v.serviceType),
  },
  { id: "needs_signature", label: "Needs signature", match: (v) => (v.currentStage === "orderNote" || v.currentStage === "signature") && v.currentStageIntegrity !== "conflicting" },
  { id: "ready_for_procedure", label: "Ready for procedure", match: (v) => v.currentStage === "procedure" && v.currentStageIntegrity !== "conflicting" },
  { id: "report_pending", label: "Report pending", match: (v) => v.currentStage === "report" && v.currentStageIntegrity !== "conflicting" },
  { id: "procedure_note_pending", label: "Procedure Note pending", match: (v) => v.currentStage === "procedureNote" && v.currentStageIntegrity !== "conflicting" },
  { id: "billing", label: "Billing", match: (v) => (v.currentStage === "billingReadiness" || v.currentStage === "billingDocument") && v.currentStageIntegrity !== "conflicting" },
  { id: "needs_review", label: "Needs review (data integrity)", match: (v) => v.currentStageIntegrity === "conflicting" },
  { id: "complete", label: "Complete", match: isComplete },
];

export function operationalFilterById(id: string): OperationalFilter {
  return OPERATIONAL_FILTERS.find((f) => f.id === id) ?? OPERATIONAL_FILTERS[0];
}

export function filterCases<T extends CaseStageVector>(rows: T[], id: string): T[] {
  const f = operationalFilterById(id);
  return rows.filter((v) => f.match(v));
}

/** Count how many of `rows` fall into each bucket (for filter-bar badges). */
export function bucketCounts(rows: CaseStageVector[]): Record<OperationalFilterId, number> {
  const counts = {} as Record<OperationalFilterId, number>;
  for (const f of OPERATIONAL_FILTERS) counts[f.id] = 0;
  for (const v of rows) {
    for (const f of OPERATIONAL_FILTERS) {
      if (f.match(v)) counts[f.id] += 1;
    }
  }
  return counts;
}

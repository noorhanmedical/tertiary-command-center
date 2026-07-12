// Role gating for Clinical Intelligence governance actions.
//
// The app's RBAC roles are admin / clinician / scheduler / biller.
// Physician review steps are actionable only by clinician-role users
// (physicians). Compliance review steps are actionable only by admins,
// who act as the compliance authority. Schedulers and billers see all
// governance surfaces read-only.

import type { AuthUser } from "@/App";
import type { CiRuleStatus } from "./types";

/** Display name recorded in audit/version history for the acting user. */
export function ciActorName(user: AuthUser): string {
  return user?.username ?? "Unknown user";
}

/** Can this user manage governance artifacts (create/edit rules, review learning items)? */
export function canManageGovernance(user: AuthUser): boolean {
  return user?.role === "admin" || user?.role === "clinician";
}

/**
 * Can this user approve/return a rule currently in the given review status?
 * - pending_physician_review → clinician (physician) only
 * - pending_compliance_review → admin (compliance) only
 */
export function canReviewRuleStatus(user: AuthUser, status: CiRuleStatus): boolean {
  if (!user) return false;
  if (status === "pending_physician_review") return user.role === "clinician";
  if (status === "pending_compliance_review") return user.role === "admin";
  return false;
}

/**
 * Can this user perform a specific rule status transition?
 * Activation out of a review state requires the matching reviewer role;
 * all other transitions require governance-manager rights.
 */
export function canTransitionRule(
  user: AuthUser,
  from: CiRuleStatus,
  to: CiRuleStatus,
): boolean {
  if (!user) return false;
  if (to === "active" && (from === "pending_physician_review" || from === "pending_compliance_review")) {
    return canReviewRuleStatus(user, from);
  }
  return canManageGovernance(user);
}

/** Human label for who is allowed to act on a rule in the given review status. */
export function requiredReviewerLabel(status: CiRuleStatus): string {
  if (status === "pending_physician_review") return "physician (clinician role)";
  if (status === "pending_compliance_review") return "compliance (admin role)";
  return "authorized reviewer";
}

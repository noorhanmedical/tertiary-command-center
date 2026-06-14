// callResultAuditIdentity — Phase 2 PR 2.2.
//
// When an admin uses view-as (viewing PCS or ACS as a specific team
// member), the call-result must still be audited with the REAL
// admin identity, not the impersonated user. This service centralizes
// that contract so route handlers can't accidentally swap them.
//
// Contract:
//   - actorUserId (the row's actor_user_id in journey events) = the
//     REAL session user. For admin view-as, this is the admin's id.
//   - viewAsTeamMemberId (the row's metadata.view_as_user_id) = the
//     impersonated user's id, OR null when no view-as is active.
//
// The combination guarantees every write is traceable to (a) the
// human who pressed the button, and (b) which team member's
// perspective they were operating from. Audit queries can filter
// either dimension.

import type { Request } from "express";

export type CallResultAuditIdentity = {
  /** Always the real session user. Never overridden by view-as. */
  actorUserId: string | null;
  /** The impersonated team member when admin view-as is active. */
  viewAsTeamMemberId: string | null;
  /** Whether the actor is admin (cached so the route doesn't re-check). */
  actorIsAdmin: boolean;
};

export function resolveCallResultAuditIdentity(
  req: Request,
  rawViewAsTeamMemberId?: string | null,
): CallResultAuditIdentity {
  const actorUserId = req.session?.userId ?? null;
  const actorIsAdmin = (req.session?.role ?? "") === "admin";
  // Non-admin callers cannot use view-as — silently drop the value.
  const viewAsTeamMemberId = actorIsAdmin
    ? (rawViewAsTeamMemberId ?? null) || null
    : null;
  return { actorUserId, viewAsTeamMemberId, actorIsAdmin };
}

export function callResultAuditMetadata(
  identity: CallResultAuditIdentity,
): Record<string, unknown> {
  return {
    actor_user_id: identity.actorUserId,
    actor_is_admin: identity.actorIsAdmin,
    view_as_user_id: identity.viewAsTeamMemberId,
  };
}

// Canonical translation layer: access-control default-workspace identifier
// → actual application route.
//
// WHY THIS EXISTS (Reconciliation Phase 2.5)
// The backend AccessContextService resolves a `defaultWorkspace` — a stable,
// CONTROLLED identifier describing a user's intended landing EXPERIENCE
// (e.g. "clinical", "pcs", "finance"). That identifier namespace is
// deliberately SEPARATE from the client workspace registry
// (workspaceRegistry.ts), which describes actual navigation workspaces.
//
// This module is the ONE place that translates the former into a concrete
// route. Nothing else should map default-workspace identifiers to URLs.
//
// SECURITY: a raw database string must NEVER become an arbitrary navigation
// URL. We only ever return a route from the controlled table below; any
// unknown / null / stale identifier falls back to a safe internal default.

/** Safe fallback landing for ordinary authenticated internal roles. */
export const DEFAULT_FALLBACK_ROUTE = "/home";

/**
 * Minimal safe landing for authenticated users whose intended workspace has
 * no supported UI yet (currently: Investor). This is a NEUTRAL surface that
 * exposes no operational/PHI data. It is TEMPORARY / UNSUPPORTED — it is not
 * an Investor Portal and must not be treated as one.
 */
export const ACCESS_PENDING_ROUTE = "/access-pending";

/**
 * Controlled map of every access-control WORKSPACE_IDENTIFIER
 * (shared/schema/access.ts) to a concrete route.
 *
 * Notes:
 *  - platform_admin lands on the Plexus OS homepage (NOT Settings) by product
 *    decision.
 *  - technician → the ACS/ancillary portal is TEMPORARY: it is the current
 *    ancillary operating environment. It does NOT imply technician === ACS;
 *    the authorization roles remain distinct. Revisit when a dedicated
 *    technician surface ships.
 *  - pcs / acs land DIRECTLY in their full-screen Team Portals (the persistent
 *    Admin shell intentionally disappears there).
 *  - investor is intentionally routed to the neutral ACCESS_PENDING surface —
 *    NOT /home — because /home exposes operational/patient information an
 *    investor must not see. Investor never gains access merely because its
 *    dedicated UI does not exist yet.
 */
export const WORKSPACE_IDENTIFIER_ROUTES: Record<string, string> = {
  plexus_home: "/home",
  platform_admin: "/home", // homepage, not Settings (product decision)
  organization_admin: "/admin/settings",
  clinic_admin: "/admin/settings",
  clinical: "/clinician-portal",
  acs: "/ancillary-care-specialist-portal",
  pcs: "/patient-care-specialist-portal",
  technician: "/ancillary-care-specialist-portal", // TEMPORARY (see note)
  operations: "/mission-control",
  finance: "/plexus-bank",
  billing: "/billing",
  executive: "/home",
  investor: ACCESS_PENDING_ROUTE, // TEMPORARY / UNSUPPORTED neutral surface
  technical: "/home",
  compliance: "/admin/settings?tab=logs",
  patient_support: "/home",
  implementation: "/clinic-onboarding",
};

/**
 * Resolve a backend-provided default-workspace identifier to a safe route.
 *
 * Returns the mapped route for a known identifier, or DEFAULT_FALLBACK_ROUTE
 * when the identifier is null/undefined/unknown. The output is ALWAYS one of
 * the controlled routes above or the fallback — a raw DB string can never
 * become the navigation target.
 */
export function resolveDefaultWorkspaceRoute(
  defaultWorkspace: string | null | undefined,
): string {
  if (!defaultWorkspace) return DEFAULT_FALLBACK_ROUTE;
  const route = WORKSPACE_IDENTIFIER_ROUTES[defaultWorkspace];
  return route ?? DEFAULT_FALLBACK_ROUTE;
}

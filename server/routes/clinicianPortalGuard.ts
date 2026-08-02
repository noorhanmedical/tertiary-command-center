// Shared Clinician Portal authorization boundary.
//
// The SINGLE guard used by every Clinician Portal surface (the existing
// physician portal signature/reports routes AND the Phase 2H canonical
// overview). Fails CLOSED:
//
//   • unauthenticated (no session user)        → 401
//   • authenticated but role is missing/unknown → 403 (NO "clinician" default)
//   • authenticated but role is not exactly
//     clinician|admin (scheduler/biller/tech…) → 403
//
// The actor role comes ONLY from the server session — never from the query
// string or request body. Clinic scope is derived ONLY from req.clinicId
// (populated by the clinicContext middleware from the session), never from a
// client-supplied value, and a missing scope fails closed with 403.

import type { Request, Response, NextFunction } from "express";

/** Exactly the two roles allowed into any Clinician Portal surface. */
const CLINICIAN_PORTAL_ROLES = new Set(["clinician", "admin"]);

/**
 * Role gate for every Clinician Portal route. A missing session user is 401; a
 * missing OR unknown role is 403 (there is deliberately NO `?? "clinician"`
 * fallback — an unrecognized/absent role must never be silently promoted to
 * clinician access).
 */
export function requireClinicianOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const role = req.session.role;
  if (typeof role !== "string" || !CLINICIAN_PORTAL_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden — clinician role required" });
    return;
  }
  next();
}

/**
 * Derive the authenticated clinic scope from server request context (populated
 * by the clinicContext middleware from the session — never from body, params,
 * or query). Fails closed with 403 when absent so no clinic-scoped read can run
 * unscoped. Returns the numeric clinicId on success, or null after having
 * already sent the 403 response.
 *
 * NOTE (intentional): the clinicContext middleware sets req.clinicId = null for
 * the `admin` role (admins are all-clinics elsewhere). Because the Clinician
 * Portal is strictly per-clinic, an admin WITHOUT an assigned session clinic is
 * deliberately 403 here — clinic scope is mandatory and never inferred. An admin
 * who does carry a session clinic scope is allowed. Broadening this to an
 * all-clinics portal read is explicitly out of scope (see the Phase 2K backlog).
 */
export function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) {
    res.status(403).json({ error: "Clinic scope required" });
    return null;
  }
  return clinicId;
}

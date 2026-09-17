// ADR-002 Stage B — resource-loading tenant guards.
//
// Thin helpers that load a resource, resolve its owning clinic, and enforce the
// caller's TenantContext BEFORE any PHI is returned. Kept separate from the pure
// server/lib/tenantContext.ts (which must not depend on storage) for clean
// layering. Built entirely on the proven `enforceTenantResource` helper — no new
// policy is introduced here.
//
// Usage (screening-keyed PHI sub-resources, e.g. clinical-data/encounters/...):
//   const screening = await enforceScreeningTenant(req, res, screeningId);
//   if (!screening) return; // guard already wrote the 403/404 (PHI-free)
//   ... proceed to return/mutate PHI for this screening ...

import type { Request, Response } from "express";
import { storage } from "../storage";
import { enforceTenantResource } from "../lib/tenantContext";

/**
 * Resolve a patient screening and enforce tenant ownership.
 * Returns the screening when access is allowed; otherwise writes the correct
 * PHI-free response (404 not-found / 404 cross-clinic / 403 denied) and returns
 * null. Cross-clinic returns 404 (no existence disclosure).
 */
export async function enforceScreeningTenant(
  req: Request,
  res: Response,
  screeningId: number,
): Promise<Awaited<ReturnType<typeof storage.getPatientScreening>> | null> {
  const screening = await storage.getPatientScreening(screeningId);
  if (!screening) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const clinicId = (screening as { clinicId?: number | null }).clinicId;
  if (!enforceTenantResource(req, res, clinicId)) return null;
  return screening;
}

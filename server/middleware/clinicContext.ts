/**
 * clinicContext middleware
 *
 * Reads `req.session.clinicId` (set at login) and attaches it to `req` as
 * `req.clinicId` for easy consumption by repositories.
 *
 * Rules:
 *  - `admin` role → `req.clinicId = null`  (sees all data, no filter)
 *  - all other roles → `req.clinicId = req.session.clinicId ?? null`
 *
 * Repositories check: if clinicId is null AND role is admin → skip filter.
 * If clinicId is null AND role is NOT admin → the user has no clinic assigned
 * yet (pre-backfill); they see no tenant-scoped data until backfilled.
 *
 * This middleware must be registered AFTER the session middleware.
 */

import type { Request, Response, NextFunction } from "express";

// Extend the Express Request type so `req.clinicId` is globally typed.
declare global {
  namespace Express {
    interface Request {
      /** null = admin (bypasses filter) or not yet assigned. */
      clinicId: number | null;
    }
  }
}

export function clinicContext(req: Request, _res: Response, next: NextFunction): void {
  if (req.session?.role === "admin") {
    // Admin sees everything — no clinic isolation.
    req.clinicId = null;
  } else {
    req.clinicId = req.session?.clinicId ?? null;
  }
  next();
}

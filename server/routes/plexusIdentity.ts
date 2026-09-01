/**
 * Plexus-internal identity endpoints.
 *
 * ─── NOT REGISTERED (Phase 2A) ────────────────────────────────────
 *
 * This file is intentionally NOT imported by server/routes.ts. Every
 * route it exports is gated by `requirePlexusIdentityAccess`, which
 * currently always denies (see server/services/plexusIdentity/authorization.ts
 * for the unresolved USER_ROLES blocker).
 *
 * When the Plexus-internal role lands:
 *   1. Update `authorization.ts` to permit that role.
 *   2. Set FEATURE_PLEXUS_IDENTITY_REVIEW=true.
 *   3. Import `registerPlexusIdentityRoutes` from server/routes.ts.
 *   4. Add tests that a clinic admin (`role === "admin"`) still gets 403.
 *
 * NO clinic-facing route may live in this file.
 */

import type { Express, Request, Response } from "express";
import {
  requirePlexusIdentityAccess,
  PLEXUS_INTERNAL_ROLE_BLOCKER,
} from "../services/plexusIdentity/authorization";
import { featureFlags } from "../lib/featureFlags";

export function registerPlexusIdentityRoutes(app: Express): void {
  // Deliberate fail-safe. If someone wires this up before the role
  // exists, every endpoint returns 403 with a machine-readable code.
  app.get(
    "/api/plexus/identity/health",
    requirePlexusIdentityAccess,
    (_req: Request, res: Response) => {
      res.json({
        ok: true,
        writesEnabled: featureFlags.plexusIdentityWrite,
        reviewEnabled: featureFlags.plexusIdentityReview,
      });
    },
  );

  app.get(
    "/api/plexus/identity/blocker",
    requirePlexusIdentityAccess,
    (_req: Request, res: Response) => {
      res.json(PLEXUS_INTERNAL_ROLE_BLOCKER);
    },
  );

  // Placeholder listing endpoint for the review queue. Real logic
  // lands with FEATURE_PLEXUS_IDENTITY_REVIEW=true.
  app.get(
    "/api/plexus/identity/match-candidates",
    requirePlexusIdentityAccess,
    (_req: Request, res: Response) => {
      res.status(501).json({
        error: "not_implemented_pending_plexus_internal_role",
        code: PLEXUS_INTERNAL_ROLE_BLOCKER.reason,
      });
    },
  );
}

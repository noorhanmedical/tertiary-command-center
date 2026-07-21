/**
 * Phase 2C — Service-specific Admin Review route.
 *
 * Registered UNCONDITIONALLY but every handler:
 *   • 404 when FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is OFF (avoids
 *     leaking existence).
 *   • Runs requireAdminReviewAccess (currently always denies pending
 *     the Plexus-internal clinical reviewer role — see
 *     server/services/adminReview/authorization.ts).
 *
 * Server-derived fields (NEVER accepted from client input):
 *   • reviewer_user_id — from session
 *   • reviewer_role — from session
 *   • actual_reviewed_at — server CURRENT_TIMESTAMP
 *   • evidence_snapshot — from the ancillary case's current state
 *   • previous_status — from the ancillary case
 *   • service_type — from the ancillary case
 *   • clinic scope — from req.clinicId
 *
 * Client-supplied fields:
 *   • newStatus (required; normalized via normalizeReviewStatus)
 *   • effectiveClinicalDate (optional)
 *   • rationale (optional)
 *   • source (optional; server may reject non-allowed values)
 */

import type { Express, Request, Response } from "express";
import { featureFlags } from "../lib/featureFlags";
import { requireAdminReviewAccess } from "../services/adminReview/authorization";
import { recordAncillaryCaseAdminReview } from "../services/adminReview/recordAdminReview";
import type { AncillaryReviewSource } from "@shared/schema/adminReviewEvents";

const ALLOWED_SOURCES: readonly AncillaryReviewSource[] = [
  "manual",
  "bulk",
  "same_day_retroactive",
];

export function registerAdminReviewEventsRoutes(app: Express): void {
  app.post(
    "/api/ancillary-cases/:id/admin-review",
    // Feature-flag gate FIRST so we return 404 (not 403) when the
    // feature is off — hides route existence.
    (req: Request, res: Response, next) => {
      if (!featureFlags.serviceSpecificAdminReview) {
        return res.status(404).json({ error: "Not Found" });
      }
      return requireAdminReviewAccess(req, res, next);
    },
    async (req: Request, res: Response) => {
      try {
        const acId = Number.parseInt(String(req.params.id), 10);
        if (!Number.isFinite(acId) || acId <= 0) {
          return res.status(400).json({ error: "invalid ancillary case id" });
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const newStatusRaw = typeof body.newStatus === "string" ? body.newStatus : "";
        if (!newStatusRaw) return res.status(400).json({ error: "newStatus required" });

        // Client is NOT permitted to set actualReviewedAt or
        // evidenceSnapshot. Reject if present (defensive — the
        // service also ignores them).
        if ("actualReviewedAt" in body || "evidenceSnapshot" in body) {
          return res.status(400).json({
            error: "actualReviewedAt and evidenceSnapshot are server-owned",
            code: "SERVER_OWNED_FIELDS_REJECTED",
          });
        }

        const source: AncillaryReviewSource =
          typeof body.source === "string" &&
          (ALLOWED_SOURCES as readonly string[]).includes(body.source)
            ? (body.source as AncillaryReviewSource)
            : "manual";

        const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        if (!clinicId) return res.status(403).json({ error: "Clinic scope required" });

        const session = (req as { session?: { userId?: string; role?: string } }).session ?? {};
        const outcome = await recordAncillaryCaseAdminReview({
          ancillaryCaseId: acId,
          clinicId,
          newStatus: newStatusRaw,
          effectiveClinicalDate:
            typeof body.effectiveClinicalDate === "string" ? body.effectiveClinicalDate : null,
          rationale: typeof body.rationale === "string" ? body.rationale : null,
          actor: { userId: session.userId ?? null, role: session.role ?? null },
          source,
        });

        if (outcome.status === "case_not_found") {
          return res.status(404).json({ error: "ancillary case not found" });
        }
        if (outcome.status === "cross_clinic_denied") {
          return res.status(403).json({ error: "cross-clinic write refused" });
        }
        if (outcome.status === "skipped_flag_off") {
          // Should be unreachable because the route already gated on
          // the flag — belt and braces.
          return res.status(404).json({ error: "Not Found" });
        }
        return res.json(outcome);
      } catch (e: unknown) {
        const err = e as { status?: number; code?: string; message?: string };
        const status = err.status ?? 500;
        res.status(status).json({ error: err.message ?? "review failed", code: err.code });
      }
    },
  );
}

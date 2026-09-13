// Engagement Call List Distribution & Secure Share Packages — HTTP routes.
//
// Feature-flagged behind FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES. When OFF every
// route responds with a uniform 404 so the surface is invisible (no behavior
// change on existing deployments).
//
// Task 1 delivers the canonical COHORT PREVIEW endpoint. Later tasks add
// distribution preview, idempotent confirm, package retrieval, and the secure
// public share endpoint. All admin-authoring routes are gated by
// requireRole("admin"); the public share endpoint (Task 8) is intentionally
// token-authenticated and mounted separately.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { featureFlags } from "../lib/featureFlags";
import {
  CALL_LIST_COHORT_KEYS,
  isCallListCohortKey,
} from "@shared/engagement/callListCohorts";
import { previewCohort } from "../services/engagement/callListCohortService";
import { previewCallListDistribution } from "../services/engagement/callListDistributionPreview";
import { confirmCallListDistribution } from "../services/engagement/callListConfirm";
import {
  getPackageById,
  getPackageWithMembers,
  setGenerationStatus,
  listRecentPackages,
  revokePackageShare,
  extendPackageShare,
  regeneratePackageShareToken,
  setPackagePin,
  clearPackagePin,
  callListPackagesTableExists,
} from "../repositories/callListPackages.repo";
import { getPackageByTokenHash } from "../repositories/callListPackages.repo";
import { saveBlob, readBlob } from "../services/blobStore";
import {
  hashShareToken,
  resolveShareAccess,
  requiresPin,
  extractHeaderPin,
  buildShareAccessAudit,
  type ShareAccessState,
} from "../services/engagement/callListShareToken";
import {
  requireManagerOrAdmin,
  schedulerIdsInScope,
  clinicIdsInScope,
  type ManagerScope,
} from "../services/teams/managerScope";
import {
  facilityInScope,
  packageInScope,
  allMembersInScope,
  resolveListFacilityScope,
} from "../services/engagement/callListAuthz";
import { logAudit } from "../services/auditService";
import bcrypt from "bcryptjs";
import {
  consumeShareRateLimit,
  SHARE_ACCESS_MAX,
  SHARE_ACCESS_WINDOW_MS,
  SHARE_PIN_MAX,
  SHARE_PIN_WINDOW_MS,
} from "../services/engagement/callListShareRateLimit";

type RequireRole = (
  ...roles: string[]
) => (req: Request, res: Response, next: () => void) => void;

/** Uniform "feature disabled" guard — 404 so the surface is invisible. */
function ensureEnabled(res: Response): boolean {
  if (!featureFlags.callListPackages) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

/** Deploy-blocker fail-safe: when the feature flag is ON but migration 0088 is
 *  NOT applied, refuse loudly with 503 rather than silently succeeding or
 *  performing a partial write. Call BEFORE any package write (esp. confirm,
 *  which commits assignments) so we never assign-without-packaging under a
 *  misconfigured deploy. Reads independently fail-safe via repo safeRead. */
async function ensureSchemaReady(res: Response): Promise<boolean> {
  if (await callListPackagesTableExists()) return true;
  res.status(503).json({
    error:
      "Call List Packages schema not ready — apply migration 0088 before enabling FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES",
    code: "CALL_LIST_PACKAGES_MIGRATION_MISSING",
  });
  return false;
}

/** The resolved manager scope attached by requireManagerOrAdmin. */
function scopeOf(req: Request): ManagerScope {
  return (req as { managerScope?: ManagerScope }).managerScope as ManagerScope;
}

/** 403 (not 404) when a facility is outside the caller's scope. Server is
 *  authoritative — the client-supplied facility is never trusted. */
function denyFacility(res: Response, scope: ManagerScope, facility: string): boolean {
  if (!facilityInScope(scope, facility)) {
    res.status(403).json({ error: "Facility not in your scope" });
    return true;
  }
  return false;
}

/** Load a package and enforce facility scope. Returns the package, or null
 *  after having sent the appropriate 404/403 response. */
async function loadPackageInScope(req: Request, res: Response, id: number) {
  const pkg = await getPackageById(id);
  if (!pkg) {
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  const scope = scopeOf(req);
  // Defense-in-depth: enforce BOTH facility AND clinic scope (fail-closed) so
  // authorization never relies on facility strings being globally unique.
  const allowedClinicIds = await clinicIdsInScope(scope);
  if (!packageInScope(scope, allowedClinicIds, pkg)) {
    // Do not reveal cross-scope existence — uniform 404.
    res.status(404).json({ error: "Package not found" });
    return null;
  }
  return pkg;
}

const SERVICE_CATEGORY_ENUM = ["brainwave", "vitalwave", "ultrasound"] as const;

const distributionPreviewBodySchema = z.object({
  cohort: z.enum(CALL_LIST_COHORT_KEYS),
  facility: z.string().trim().min(1, "facility is required"),
  services: z.array(z.string().trim().min(1)).optional(),
  serviceCategories: z.array(z.enum(SERVICE_CATEGORY_ENUM)).optional(),
  notContactedDays: z.number().int().optional(),
  serviceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "serviceDate must be YYYY-MM-DD")
    .optional(),
});

const pdfUploadBodySchema = z.object({
  pdfBase64: z.string().min(1, "pdfBase64 is required"),
  filename: z.string().trim().min(1).max(200).optional(),
});

const pdfFailedBodySchema = z.object({
  errorCode: z.string().trim().max(120).optional(),
});

const extendBodySchema = z.object({
  hours: z.number().int().positive().max(24 * 30),
});

// Optional share PIN: 4–12 chars (digits or letters). Hashed with bcrypt;
// plaintext never persisted or logged.
const pinBodySchema = z.object({
  pin: z
    .string()
    .trim()
    .min(4, "PIN must be at least 4 characters")
    .max(12, "PIN must be at most 12 characters"),
});

const confirmBodySchema = z.object({
  distributionOperationId: z.string().trim().min(8, "distributionOperationId is required"),
  cohort: z.enum(CALL_LIST_COHORT_KEYS),
  facility: z.string().trim().min(1, "facility is required"),
  serviceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "serviceDate must be YYYY-MM-DD")
    .optional(),
  services: z.array(z.string().trim().min(1)).optional(),
  mapping: z
    .array(
      z.object({
        executionCaseId: z.number().int().positive(),
        teamMemberId: z.number().int().positive(),
      }),
    )
    .min(1, "mapping must contain at least one assignment"),
});

const cohortPreviewQuerySchema = z.object({
  cohort: z.enum(CALL_LIST_COHORT_KEYS),
  facility: z.string().trim().min(1, "facility is required"),
  services: z.string().trim().optional(),
  serviceCategories: z.string().trim().optional(),
  notContactedDays: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/** Parse + validate a CSV of service-category tokens. */
function parseServiceCategories(csv: string | undefined): ("brainwave" | "vitalwave" | "ultrasound")[] {
  if (!csv) return [];
  const valid = new Set(SERVICE_CATEGORY_ENUM);
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is "brainwave" | "vitalwave" | "ultrasound" => valid.has(s as never));
}

export function registerEngagementCallListPackageRoutes(
  app: Express,
  _requireRole: RequireRole,
) {
  // Authority = admin (org-wide) OR an active team manager scoped to their
  // facilities + roster (requireManagerOrAdmin attaches req.managerScope). The
  // server independently enforces facility + team-member scope on every route;
  // the client-supplied facility id is never trusted. Ordinary staff (PCS/ACS
  // with no management authority) get 403.
  // GET /api/engagement/call-lists/cohort-preview
  //   ?cohort=never_called&facility=Taylor%20Family%20Practice
  //   &services=BrainWave,VitalWave&notContactedDays=7&limit=50
  //
  // Returns the CURRENT canonical membership count + the first N members for
  // the selected facility/cohort/service filter. Read-only, no side effects.
  app.get(
    "/api/engagement/call-lists/cohort-preview",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const parsed = cohortPreviewQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { cohort, facility, services, serviceCategories, notContactedDays, limit } = parsed.data;
      if (!isCallListCohortKey(cohort)) {
        return res.status(400).json({ error: "Unknown cohort" });
      }
      if (denyFacility(res, scopeOf(req), facility)) return;
      const serviceList =
        services && services.length > 0
          ? services.split(",").map((s) => s.trim()).filter(Boolean)
          : null;
      const categoryList = parseServiceCategories(serviceCategories);
      try {
        const result = await previewCohort(
          {
            cohort,
            facility,
            services: serviceList,
            serviceCategories: categoryList.length ? categoryList : null,
            notContactedDays: notContactedDays ?? null,
          },
          limit ?? 50,
        );
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:cohort-preview] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to build cohort preview",
        });
      }
    },
  );

  // POST /api/engagement/call-lists/distribution-preview
  // Body: { cohort, facility, services?: string[], notContactedDays?, serviceDate? }
  //
  // Read-only: computes the current cohort membership, runs the PURE allocator
  // over EXACTLY those cases, and returns per-member capacity + ancillary/status
  // mix + the exact proposed patient membership, plus a previewOperationId and
  // the exact executionCaseId→teamMemberId mapping for a later idempotent
  // Confirm. Performs NO writes / NO assignment events.
  app.post(
    "/api/engagement/call-lists/distribution-preview",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const parsed = distributionPreviewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { cohort, facility, services, serviceCategories, notContactedDays, serviceDate } = parsed.data;
      if (!isCallListCohortKey(cohort)) {
        return res.status(400).json({ error: "Unknown cohort" });
      }
      if (denyFacility(res, scopeOf(req), facility)) return;
      try {
        const result = await previewCallListDistribution({
          cohort,
          facility,
          services: services && services.length > 0 ? services : null,
          serviceCategories: serviceCategories && serviceCategories.length > 0 ? serviceCategories : null,
          notContactedDays: notContactedDays ?? null,
          serviceDate: serviceDate ?? null,
        });
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:distribution-preview] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to build distribution preview",
        });
      }
    },
  );

  // POST /api/engagement/call-lists/distribution-confirm
  // Body: { distributionOperationId, cohort, facility, serviceDate?, services?,
  //         mapping: [{ executionCaseId, teamMemberId }] }
  //
  // Idempotent (keyed by distributionOperationId): commits canonical
  // assignments for EXACTLY the reviewed mapping (revalidated at commit,
  // conflicts excluded not replaced), then creates one frozen package + share
  // token per member. A PDF/package failure never rolls back the assignment.
  app.post(
    "/api/engagement/call-lists/distribution-confirm",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const parsed = confirmBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { distributionOperationId, cohort, facility, serviceDate, services, mapping } =
        parsed.data;
      if (!isCallListCohortKey(cohort)) {
        return res.status(400).json({ error: "Unknown cohort" });
      }
      // Deploy-blocker: refuse (503) if the flag is on but the schema is absent
      // — never commit assignments we cannot package under a misconfig.
      if (!(await ensureSchemaReady(res))) return;
      const scope = scopeOf(req);
      if (denyFacility(res, scope, facility)) return;
      // Team-member scope: a manager may only assign to roster members within
      // their scope. Server-authoritative — never trust the client mapping.
      const allowedSchedulers = await schedulerIdsInScope(scope);
      const memberIds = mapping.map((m) => m.teamMemberId);
      if (!allMembersInScope(scope, memberIds, allowedSchedulers)) {
        return res.status(403).json({ error: "One or more team members are outside your scope" });
      }
      // Defense-in-depth clinic tenant gate. Admin → null (no narrowing). A
      // manager may only confirm cases in an authorized clinic; the service
      // excludes out-of-clinic cases as conflicts (never assigns them).
      const allowedClinicIds = await clinicIdsInScope(scope);
      const actorUserId = (req.session as { userId?: string })?.userId ?? null;
      try {
        const result = await confirmCallListDistribution({
          distributionOperationId,
          cohort,
          facility,
          serviceDate: serviceDate ?? null,
          services: services && services.length > 0 ? services : null,
          mapping,
          actorUserId,
          allowedClinicIds: allowedClinicIds === null ? null : [...allowedClinicIds],
        });
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:distribution-confirm] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to confirm distribution",
        });
      }
    },
  );

  // GET /api/engagement/call-lists/packages?facility=&limit=
  // Recent Generated Lists (Engagement-internal). Header rows only (no member
  // PHI) for the management list.
  app.get(
    "/api/engagement/call-lists/packages",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const scope = scopeOf(req);
      const facility =
        typeof req.query.facility === "string" && req.query.facility.trim()
          ? req.query.facility.trim()
          : null;
      // A specific requested facility must be in scope; otherwise the list is
      // restricted to the caller's authorized facility set (admin → all).
      if (facility && denyFacility(res, scope, facility)) return;
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      try {
        const { facilityIds } = resolveListFacilityScope(scope, facility);
        // Defense-in-depth clinic tenant filter. Admin → null (all clinics).
        // Manager → their in-scope clinic id set (empty = fail-closed to none).
        const allowedClinicIds = await clinicIdsInScope(scope);
        const clinicIds = allowedClinicIds === null ? null : [...allowedClinicIds];
        const rows = await listRecentPackages({
          facilityIds,
          clinicIds,
          limit: Number.isFinite(limit) ? limit : 25,
        });
        // Do not leak token hashes to the client list.
        return res.json(
          rows.map((p) => ({
            id: p.id,
            facility: p.facilityId,
            teamMemberId: p.teamMemberId,
            teamMemberName: p.teamMemberNameSnapshot,
            serviceDate: p.serviceDate,
            cohortLabel: p.cohortLabelSnapshot,
            patientCount: p.patientCount,
            generationStatus: p.generationStatus,
            status: p.status,
            shareExpiresAt: p.shareExpiresAt,
            shareRevokedAt: p.shareRevokedAt,
            pdfAvailable: p.pdfBlobId != null,
            pinProtected: p.sharePinHash != null,
            createdAt: p.createdAt,
          })),
        );
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:list] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to list packages" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/revoke — immediate revocation.
  app.post(
    "/api/engagement/call-lists/packages/:id/revoke",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const updated = await revokePackageShare(id);
        if (!updated) return res.status(404).json({ error: "Package not found" });
        return res.json({ ok: true, shareRevokedAt: updated.shareRevokedAt });
      } catch (error: unknown) {
        console.error("[engagement/call-lists:revoke] error:", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to revoke share link" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/extend { hours }
  app.post(
    "/api/engagement/call-lists/packages/:id/extend",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      const parsed = extendBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const updated = await extendPackageShare(id, parsed.data.hours);
        if (!updated) return res.status(404).json({ error: "Package not found" });
        return res.json({ ok: true, shareExpiresAt: updated.shareExpiresAt });
      } catch (error: unknown) {
        console.error("[engagement/call-lists:extend] error:", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to extend share link" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/regenerate — new token (once).
  app.post(
    "/api/engagement/call-lists/packages/:id/regenerate",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const result = await regeneratePackageShareToken(id);
        if (!result) return res.status(404).json({ error: "Package not found" });
        return res.json({
          ok: true,
          shareToken: result.token,
          shareExpiresAt: result.pkg.shareExpiresAt,
        });
      } catch (error: unknown) {
        console.error("[engagement/call-lists:regenerate] error:", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to regenerate share link" });
      }
    },
  );

  // GET /api/engagement/call-lists/packages/:id
  // Returns the frozen package header + members (incl. atlasPayloadSnapshot) so
  // the client can render the combined PDF from the immutable snapshot.
  app.get(
    "/api/engagement/call-lists/packages/:id",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const result = await getPackageWithMembers(id);
        if (!result) return res.status(404).json({ error: "Package not found" });
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:get-package] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to load package" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/pdf
  // Body: { pdfBase64, filename? } — stores the browser-generated combined PDF
  // as a durable blob (Option A) and marks the package generation READY. This
  // is idempotent-friendly: re-uploading simply stores a new blob + points the
  // package at it. A failure here never affects the committed assignments.
  app.post(
    "/api/engagement/call-lists/packages/:id/pdf",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      const parsed = pdfUploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const pkg = await loadPackageInScope(req, res, id);
        if (!pkg) return;
        const buffer = Buffer.from(parsed.data.pdfBase64, "base64");
        if (buffer.length === 0) {
          return res.status(400).json({ error: "Decoded PDF is empty" });
        }
        const blob = await saveBlob({
          ownerType: "call_list_package",
          ownerId: id,
          filename:
            parsed.data.filename ?? `call-list-${id}-${pkg.serviceDate ?? "list"}.pdf`,
          contentType: "application/pdf",
          buffer,
        });
        const updated = await setGenerationStatus(id, "ready", {
          pdfBlobId: blob.id,
          errorCode: null,
        });
        return res.json({
          ok: true,
          generationStatus: updated?.generationStatus ?? "ready",
          pdfBlobId: blob.id,
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:upload-pdf] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to store package PDF" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/pdf-failed
  // Marks generation FAILED (retryable) when the browser could not render/upload
  // the PDF. Assignments remain committed and visible in the Team Portal.
  app.post(
    "/api/engagement/call-lists/packages/:id/pdf-failed",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      const parsed = pdfFailedBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        await setGenerationStatus(id, "failed", {
          errorCode: parsed.data.errorCode ?? "client_render_failed",
        });
        return res.json({ ok: true, generationStatus: "failed" });
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:pdf-failed] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to update package status" });
      }
    },
  );

  // GET /api/engagement/call-lists/packages/:id/pdf
  // Streams the stored durable PDF (admin/manager download from Engagement /
  // Recent Lists). The public token-scoped download lives on the share route.
  app.get(
    "/api/engagement/call-lists/packages/:id/pdf",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      try {
        const pkg = await loadPackageInScope(req, res, id);
        if (!pkg) return;
        if (pkg.pdfBlobId == null) {
          return res.status(404).json({ error: "PDF not generated yet" });
        }
        const blob = await readBlob(pkg.pdfBlobId);
        if (!blob) return res.status(404).json({ error: "PDF blob missing" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${blob.blob.filename.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
        );
        return res.send(blob.buffer);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-lists:download-pdf] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to download package PDF" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/set-pin { pin }
  // Set/replace the OPTIONAL share PIN (second factor). Only a bcrypt hash is
  // stored; plaintext is never persisted. Manager-scoped.
  app.post(
    "/api/engagement/call-lists/packages/:id/set-pin",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      const parsed = pinBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const pinHash = await bcrypt.hash(parsed.data.pin, 12);
        const updated = await setPackagePin(id, pinHash);
        if (!updated) return res.status(404).json({ error: "Package not found" });
        await logAudit(req, "share_pin_set", "call_list_package", id, null);
        return res.json({ ok: true, pinProtected: true });
      } catch (error: unknown) {
        console.error("[engagement/call-lists:set-pin] error:", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to set share PIN" });
      }
    },
  );

  // POST /api/engagement/call-lists/packages/:id/clear-pin — revert to token-only.
  app.post(
    "/api/engagement/call-lists/packages/:id/clear-pin",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      if (!ensureEnabled(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid package id" });
      }
      try {
        if (!(await loadPackageInScope(req, res, id))) return;
        const updated = await clearPackagePin(id);
        if (!updated) return res.status(404).json({ error: "Package not found" });
        await logAudit(req, "share_pin_cleared", "call_list_package", id, null);
        return res.json({ ok: true, pinProtected: false });
      } catch (error: unknown) {
        console.error("[engagement/call-lists:clear-pin] error:", error instanceof Error ? error.message : error);
        return res.status(500).json({ error: "Failed to clear share PIN" });
      }
    },
  );

  // ─── PUBLIC secure share endpoints (Task 8 + hardening) ────────────────────
  // Token-authenticated (NO session). The share URL itself is the credential.
  // The token resolves EXACTLY ONE package; no traversal into other patients,
  // members, facilities, packages, EHR, or the Patient Directory. Invalid,
  // expired, and revoked tokens return the SAME uniform 404 so a caller cannot
  // tell whether another package exists. Feature-off also returns the uniform
  // 404 (indistinguishable). No PHI in the URL.
  //
  // HARDENING: every public request is rate-limited by client IP BEFORE the
  // token is resolved (so valid/invalid tokens throttle identically — no
  // validity leak via 429). Access is audited (package id + coarse result +
  // safe request metadata only — never the token, never PHI). An OPTIONAL
  // per-package PIN gates the PHI snapshot + PDF behind a bcrypt-verified,
  // rate-limited second factor.

  /** Uniform "not found" — used for invalid/expired/revoked/off, never leaking
   *  which. */
  function shareNotFound(res: Response) {
    return res.status(404).json({ error: "Not found" });
  }
  /** Uniform 429 — identical regardless of token validity. */
  function shareRateLimited(res: Response) {
    return res.status(429).json({ error: "Too many requests" });
  }
  /** Real client IP (ALB first hop trusted via app.set("trust proxy", 1)). */
  function clientIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || "unknown";
  }
  /** Audit a PUBLIC access event. NEVER logs the token or any PHI — only the
   *  internal package id, a coarse result, and safe request metadata. */
  async function auditShareAccess(
    req: Request,
    packageId: number,
    result: string,
  ): Promise<void> {
    // buildShareAccessAudit guarantees the payload carries ONLY safe metadata —
    // never the token, never the PIN, never PHI.
    await logAudit(
      req,
      "share_access",
      "call_list_package",
      packageId,
      buildShareAccessAudit(
        result,
        clientIp(req),
        (req.headers["user-agent"] as string | undefined) ?? null,
      ),
    );
  }

  type ResolvedShare = {
    pkg: Awaited<ReturnType<typeof getPackageById>>;
    state: ShareAccessState;
  };

  /** Resolve a presented token → { pkg, precise access state }. A null pkg
   *  means the token hash matched nothing (unknown token — not audited, to
   *  avoid unbounded writes; rate-limiting bounds unknown-token spam). */
  async function resolveShareState(tokenParam: string | string[] | undefined): Promise<ResolvedShare> {
    if (!featureFlags.callListPackages) return { pkg: null, state: "invalid" };
    const token = typeof tokenParam === "string" ? tokenParam : undefined;
    if (!token) return { pkg: null, state: "invalid" };
    const pkg = await getPackageByTokenHash(hashShareToken(token));
    if (!pkg) return { pkg: null, state: "invalid" };
    const state = resolveShareAccess(token, {
      storedHash: pkg.shareTokenHash,
      expiresAt: pkg.shareExpiresAt,
      revokedAt: pkg.shareRevokedAt,
      status: pkg.status,
    });
    return { pkg, state };
  }

  /** The FROZEN public snapshot payload. Strips internal ids (executionCaseId /
   *  patientScreeningId / clinicId / blob / token hash) so the token can never
   *  pivot into live systems. */
  function publicSnapshot(
    pkg: NonNullable<Awaited<ReturnType<typeof getPackageById>>>,
    withMembers: NonNullable<Awaited<ReturnType<typeof getPackageWithMembers>>>,
  ) {
    return {
      teamMemberName: pkg.teamMemberNameSnapshot,
      facility: pkg.facilityId,
      serviceDate: pkg.serviceDate,
      cohortLabel: pkg.cohortLabelSnapshot,
      patientCount: pkg.patientCount,
      summaryMetrics: pkg.summaryMetrics,
      generationStatus: pkg.generationStatus,
      pdfAvailable: pkg.pdfBlobId != null,
      pinProtected: pkg.sharePinHash != null,
      members: withMembers.members.map((m) => ({
        patientName: m.patientNameSnapshot,
        dob: m.patientDobSnapshot,
        phone: m.patientPhoneSnapshot,
        demographics: m.demographicsSnapshot,
        services: m.servicesSnapshot,
        reasonForCall: m.reasonForCallSnapshot,
        cohortClassification: m.cohortClassificationSnapshot,
        qualificationSummary: m.qualificationSummarySnapshot,
        atlas: m.atlasPayloadSnapshot,
      })),
    };
  }

  /** PIN-gated metadata-only payload — NO members, NO PHI beyond the coarse
   *  header the recipient needs to recognize their own list before entering a
   *  PIN. */
  function publicMetaOnly(pkg: NonNullable<Awaited<ReturnType<typeof getPackageById>>>) {
    return {
      pinRequired: true,
      teamMemberName: pkg.teamMemberNameSnapshot,
      facility: pkg.facilityId,
      serviceDate: pkg.serviceDate,
      cohortLabel: pkg.cohortLabelSnapshot,
      patientCount: pkg.patientCount,
      pdfAvailable: pkg.pdfBlobId != null,
    };
  }

  // GET /api/shared-call-list/:token — frozen snapshot, OR pin-required stub.
  app.get("/api/shared-call-list/:token", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!consumeShareRateLimit(`share:${ip}`, SHARE_ACCESS_MAX, SHARE_ACCESS_WINDOW_MS)) {
      return shareRateLimited(res);
    }
    try {
      const { pkg, state } = await resolveShareState(req.params.token);
      if (!pkg || state !== "ok") {
        if (pkg) await auditShareAccess(req, pkg.id, `denied_${state}`);
        return shareNotFound(res);
      }
      // PIN gate: token alone reveals only non-PHI metadata.
      if (requiresPin(pkg)) {
        await auditShareAccess(req, pkg.id, "pin_required");
        return res.json(publicMetaOnly(pkg));
      }
      const withMembers = await getPackageWithMembers(pkg.id);
      if (!withMembers) return shareNotFound(res);
      await auditShareAccess(req, pkg.id, "granted");
      return res.json(publicSnapshot(pkg, withMembers));
    } catch (error: unknown) {
      console.error("[shared-call-list:get] error:", error instanceof Error ? error.message : error);
      // Even on internal error, do not reveal existence — uniform 404.
      return shareNotFound(res);
    }
  });

  // POST /api/shared-call-list/:token/verify-pin { pin } — unlock a PIN-gated
  // package. Rate-limited per token+IP (anti-brute-force). Returns the frozen
  // snapshot on success; a package with no PIN returns it directly.
  app.post("/api/shared-call-list/:token/verify-pin", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!consumeShareRateLimit(`share:${ip}`, SHARE_ACCESS_MAX, SHARE_ACCESS_WINDOW_MS)) {
      return shareRateLimited(res);
    }
    const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
    try {
      const { pkg, state } = await resolveShareState(req.params.token);
      if (!pkg || state !== "ok") {
        if (pkg) await auditShareAccess(req, pkg.id, `denied_${state}`);
        return shareNotFound(res);
      }
      // No PIN configured → token-only; return the snapshot.
      if (!requiresPin(pkg)) {
        const withMembers = await getPackageWithMembers(pkg.id);
        if (!withMembers) return shareNotFound(res);
        await auditShareAccess(req, pkg.id, "granted");
        return res.json(publicSnapshot(pkg, withMembers));
      }
      // PIN-attempt rate limit keyed by package + IP.
      if (!consumeShareRateLimit(`pin:${pkg.id}:${ip}`, SHARE_PIN_MAX, SHARE_PIN_WINDOW_MS)) {
        await auditShareAccess(req, pkg.id, "pin_rate_limited");
        return shareRateLimited(res);
      }
      const ok = pin.length > 0 && (await bcrypt.compare(pin, pkg.sharePinHash!));
      if (!ok) {
        await auditShareAccess(req, pkg.id, "pin_failed");
        return res.status(401).json({ error: "Invalid PIN" });
      }
      const withMembers = await getPackageWithMembers(pkg.id);
      if (!withMembers) return shareNotFound(res);
      await auditShareAccess(req, pkg.id, "granted");
      return res.json(publicSnapshot(pkg, withMembers));
    } catch (error: unknown) {
      console.error("[shared-call-list:verify-pin] error:", error instanceof Error ? error.message : error);
      return shareNotFound(res);
    }
  });

  // GET /api/shared-call-list/:token/pdf — the durable stored combined PDF.
  // PIN-gated packages require the PIN via the x-share-pin HEADER only (never a
  // query string). The public page fetches this with the header and triggers a
  // local blob download — the browser never navigates to a PIN-bearing URL.
  app.get("/api/shared-call-list/:token/pdf", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!consumeShareRateLimit(`share:${ip}`, SHARE_ACCESS_MAX, SHARE_ACCESS_WINDOW_MS)) {
      return shareRateLimited(res);
    }
    try {
      const { pkg, state } = await resolveShareState(req.params.token);
      if (!pkg || state !== "ok") {
        if (pkg) await auditShareAccess(req, pkg.id, `denied_${state}`);
        return shareNotFound(res);
      }
      if (pkg.pdfBlobId == null) return shareNotFound(res);
      if (requiresPin(pkg)) {
        // PIN accepted ONLY via the x-share-pin header — NEVER a query string
        // or path (that would leak the PIN into URLs, browser history,
        // referrers, redirects, analytics, and server access logs).
        const pin = extractHeaderPin(req.headers as Record<string, unknown>);
        if (!consumeShareRateLimit(`pin:${pkg.id}:${ip}`, SHARE_PIN_MAX, SHARE_PIN_WINDOW_MS)) {
          await auditShareAccess(req, pkg.id, "pin_rate_limited");
          return shareRateLimited(res);
        }
        const ok = pin.length > 0 && (await bcrypt.compare(pin, pkg.sharePinHash!));
        if (!ok) {
          await auditShareAccess(req, pkg.id, "pin_failed");
          return shareNotFound(res);
        }
      }
      const blob = await readBlob(pkg.pdfBlobId);
      if (!blob) return shareNotFound(res);
      await auditShareAccess(req, pkg.id, "pdf_granted");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${blob.blob.filename.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
      );
      return res.send(blob.buffer);
    } catch (error: unknown) {
      console.error("[shared-call-list:pdf] error:", error instanceof Error ? error.message : error);
      return shareNotFound(res);
    }
  });
}

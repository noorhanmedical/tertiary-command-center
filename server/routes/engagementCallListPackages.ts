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
  callListPackagesTableExists,
} from "../repositories/callListPackages.repo";
import { getPackageByTokenHash } from "../repositories/callListPackages.repo";
import { saveBlob, readBlob } from "../services/blobStore";
import {
  hashShareToken,
  resolveShareAccess,
} from "../services/engagement/callListShareToken";
import {
  requireManagerOrAdmin,
  schedulerIdsInScope,
  type ManagerScope,
} from "../services/teams/managerScope";
import {
  facilityInScope,
  packageFacilityInScope,
  allMembersInScope,
  resolveListFacilityScope,
} from "../services/engagement/callListAuthz";

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
  if (!packageFacilityInScope(scopeOf(req), pkg.facilityId)) {
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
        const rows = await listRecentPackages({
          facilityIds,
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

  // ─── PUBLIC secure share endpoints (Task 8) ───────────────────────────────
  // Token-authenticated (NO session). The share URL itself is the credential.
  // The token resolves EXACTLY ONE package; no traversal into other patients,
  // members, facilities, packages, EHR, or the Patient Directory. Invalid,
  // expired, and revoked tokens return the SAME uniform 404 so a caller cannot
  // tell whether another package exists. Feature-off also returns the uniform
  // 404 (indistinguishable). No PHI in the URL.

  /** Uniform "not found" — used for invalid/expired/revoked/off, never leaking
   *  which. */
  function shareNotFound(res: Response) {
    return res.status(404).json({ error: "Not found" });
  }

  /** Resolve a presented token → an accessible package, or null (uniform). */
  async function resolveSharePackage(tokenParam: string | string[] | undefined) {
    if (!featureFlags.callListPackages) return null;
    const token = typeof tokenParam === "string" ? tokenParam : undefined;
    if (!token) return null;
    const pkg = await getPackageByTokenHash(hashShareToken(token));
    if (!pkg) return null;
    const state = resolveShareAccess(token, {
      storedHash: pkg.shareTokenHash,
      expiresAt: pkg.shareExpiresAt,
      revokedAt: pkg.shareRevokedAt,
      status: pkg.status,
    });
    return state === "ok" ? pkg : null;
  }

  // GET /api/shared-call-list/:token — read-only frozen package snapshot.
  app.get("/api/shared-call-list/:token", async (req: Request, res: Response) => {
    try {
      const pkg = await resolveSharePackage(req.params.token);
      if (!pkg) return shareNotFound(res);
      const withMembers = await getPackageWithMembers(pkg.id);
      if (!withMembers) return shareNotFound(res);
      // Public view: expose ONLY the frozen presentation snapshot. Strip
      // internal ids (executionCaseId / patientScreeningId / clinicId / blob /
      // token hash) so the token can never be used to pivot into live systems.
      return res.json({
        teamMemberName: pkg.teamMemberNameSnapshot,
        facility: pkg.facilityId,
        serviceDate: pkg.serviceDate,
        cohortLabel: pkg.cohortLabelSnapshot,
        patientCount: pkg.patientCount,
        summaryMetrics: pkg.summaryMetrics,
        generationStatus: pkg.generationStatus,
        pdfAvailable: pkg.pdfBlobId != null,
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
      });
    } catch (error: unknown) {
      console.error(
        "[shared-call-list:get] error:",
        error instanceof Error ? error.message : error,
      );
      // Even on internal error, do not reveal existence — uniform 404.
      return shareNotFound(res);
    }
  });

  // GET /api/shared-call-list/:token/pdf — the durable stored combined PDF.
  app.get("/api/shared-call-list/:token/pdf", async (req: Request, res: Response) => {
    try {
      const pkg = await resolveSharePackage(req.params.token);
      if (!pkg || pkg.pdfBlobId == null) return shareNotFound(res);
      const blob = await readBlob(pkg.pdfBlobId);
      if (!blob) return shareNotFound(res);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${blob.blob.filename.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
      );
      return res.send(blob.buffer);
    } catch (error: unknown) {
      console.error(
        "[shared-call-list:pdf] error:",
        error instanceof Error ? error.message : error,
      );
      return shareNotFound(res);
    }
  });
}

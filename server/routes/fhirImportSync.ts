// FHIR Import Sync — API route
//
// POST /api/import/fhir-sync
//   Manually triggers a FHIR bulk export import for a given clinic/group.
//   Requires admin role.
//
// GET  /api/import/fhir-sync/status
//   Returns the scheduler's recent run history and config.
//   Requires admin role.

import type { Express } from "express";
import { z } from "zod";
import { getMappingByGroupId } from "../services/fhirImport/config";
import { runFhirImport } from "../services/fhirImport/fhirImportOrchestrator";
import {
  getFhirSchedulerRunHistory,
  triggerFhirSchedulerTick,
} from "../services/fhirImport/fhirImportScheduler";
import { FHIR_AUTO_IMPORT_ENABLED } from "../services/fhirImport/config";

// ─── Validation schema ────────────────────────────────────────────────────

const fhirSyncBodySchema = z.object({
  /** ECW bulk export group ID — must match a configured clinic mapping */
  groupId: z.string().min(1, "groupId is required"),

  /**
   * Optional override: integer FK to clinics.id.
   * When omitted the clinicId is resolved from the groupId mapping.
   */
  clinicId: z.number().int().positive().optional(),

  /**
   * Optional S3 export timestamp folder name.
   * Pass "latest" or omit to auto-detect the most recent export.
   */
  timestamp: z.string().optional(),

  /**
   * When true, fire Plexus IQ batch analysis after import (default: false).
   */
  autoQualify: z.boolean().default(false),

  /**
   * When true, parse and validate the S3 data without writing to the DB.
   * Useful for testing the S3 connection and NDJSON structure.
   */
  dryRun: z.boolean().default(false),
});

// ─── Route registration ────────────────────────────────────────────────────

export function registerFhirImportRoutes(app: Express): void {
  // ── POST /api/import/fhir-sync — manual trigger ─────────────────────────
  app.post("/api/import/fhir-sync", async (req, res) => {
    // Auth: admin only (requireAdmin middleware is registered globally in
    // routes.ts via app.use("/api", requireAuth); role check is inline here
    // to match the pattern used by other admin-only handlers in this codebase).
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (req.session?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin access required" });
    }

    // Validate request body
    const parsed = fhirSyncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.errors[0]?.message ?? "Invalid request body",
        details: parsed.error.errors,
      });
    }

    const { groupId, clinicId: clinicIdOverride, timestamp, autoQualify, dryRun } = parsed.data;

    // Resolve clinic mapping
    const mapping = getMappingByGroupId(groupId);
    if (!mapping && clinicIdOverride == null) {
      return res.status(400).json({
        error: `groupId "${groupId}" is not in the configured clinic-group mappings. ` +
          "Either add it to FHIR_CLINIC_MAPPINGS_JSON or supply clinicId explicitly.",
      });
    }

    const clinicId = clinicIdOverride ?? mapping!.clinicId;
    const clinicSlug = mapping?.clinicSlug ?? String(clinicId);
    const clinicName = mapping?.clinicName ?? `Clinic ${clinicId}`;

    // Respond immediately with 202 Accepted and run the import in the background.
    // The import can take 10–60 seconds for large exports and we don't want the
    // HTTP connection to timeout waiting for it. The client should poll the
    // batch status endpoint (/api/screening-batches/:id) for progress once the
    // batchId is returned.
    //
    // We await a short "pre-flight" check (just the S3 timestamp resolution) so
    // we can return a meaningful 400 before sending 202 if the group has no data.
    // The full import runs after the response is sent.

    let resolvedTimestamp: string | undefined;
    if (timestamp && timestamp !== "latest") {
      resolvedTimestamp = timestamp;
    } else {
      // We do NOT pre-resolve here — the orchestrator handles "latest" resolution.
      // Just pass it through.
      resolvedTimestamp = timestamp;
    }

    // Fire the import asynchronously so the HTTP response goes back immediately
    let importStarted = false;
    let startupError: string | null = null;

    const importPromise = runFhirImport({
      groupId,
      timestamp: resolvedTimestamp,
      clinicId,
      clinicSlug,
      clinicName,
      autoQualify,
      dryRun,
    });

    importStarted = true;

    // Return 202 right away
    res.status(202).json({
      accepted: true,
      message: dryRun
        ? "FHIR import dry-run started — no DB writes will occur"
        : "FHIR import started in background",
      groupId,
      clinicId,
      clinicName,
      autoQualify,
      dryRun,
      // The batchId will be in the import result once it completes; clients
      // should listen for the batch to appear via GET /api/screening-batches
    });

    // Log the final result once the background task finishes
    importPromise
      .then((result) => {
        if (result.ok) {
          console.log(
            `[fhirImportSync] POST /api/import/fhir-sync completed: ${result.message}`,
          );
        } else {
          console.error(
            `[fhirImportSync] POST /api/import/fhir-sync failed: ${result.error} — ${result.message}`,
          );
        }
      })
      .catch((err: any) => {
        console.error(
          `[fhirImportSync] POST /api/import/fhir-sync unhandled error: ${err?.message ?? err}`,
        );
      });

    return; // explicit return to satisfy TypeScript's void return check
  });

  // ── POST /api/import/fhir-sync/run-now — synchronous trigger ────────────
  // Like the POST above but WAITS for the import to finish and returns the
  // full ImportResult. Useful for scripted / curl testing. Admin only.
  // Response can be slow (10–60 s) for large exports.
  app.post("/api/import/fhir-sync/run-now", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (req.session?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin access required" });
    }

    const parsed = fhirSyncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.errors[0]?.message ?? "Invalid request body",
        details: parsed.error.errors,
      });
    }

    const { groupId, clinicId: clinicIdOverride, timestamp, autoQualify, dryRun } = parsed.data;

    const mapping = getMappingByGroupId(groupId);
    if (!mapping && clinicIdOverride == null) {
      return res.status(400).json({
        error: `groupId "${groupId}" is not in the configured clinic-group mappings.`,
      });
    }

    const clinicId = clinicIdOverride ?? mapping!.clinicId;
    const clinicSlug = mapping?.clinicSlug ?? String(clinicId);
    const clinicName = mapping?.clinicName ?? `Clinic ${clinicId}`;

    try {
      const result = await runFhirImport({
        groupId,
        timestamp,
        clinicId,
        clinicSlug,
        clinicName,
        autoQualify,
        dryRun,
      });

      return res.status(result.ok ? 200 : 500).json({
        success: result.ok,
        message: result.message,
        stats: result.stats,
        error: result.error,
      });
    } catch (err: any) {
      console.error("[fhirImportSync] run-now unhandled error:", err?.message ?? err);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });

  // ── GET /api/import/fhir-sync/status — scheduler status ─────────────────
  app.get("/api/import/fhir-sync/status", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (req.session?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin access required" });
    }

    const history = getFhirSchedulerRunHistory();

    return res.json({
      schedulerEnabled: FHIR_AUTO_IMPORT_ENABLED,
      intervalHours: parseFloat(process.env.FHIR_IMPORT_INTERVAL_HOURS ?? "6"),
      recentRuns: history.slice(0, 20).map((r) => ({
        groupId: r.groupId,
        clinicId: r.clinicId,
        ranAt: r.ranAt,
        ok: r.result.ok,
        message: r.result.message,
        stats: r.result.stats,
      })),
    });
  });

  // ── POST /api/import/fhir-sync/scheduler/trigger — force scheduler tick ──
  // Triggers one scheduler tick immediately (checks all configured groups for
  // new exports). Admin only.
  app.post("/api/import/fhir-sync/scheduler/trigger", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (req.session?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin access required" });
    }

    try {
      // Fire-and-forget — the tick runs in the background
      void triggerFhirSchedulerTick().catch((err: any) => {
        console.error("[fhirImportSync] manual scheduler tick error:", err?.message ?? err);
      });

      return res.json({
        accepted: true,
        message: "Scheduler tick triggered — check /api/import/fhir-sync/status for results",
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });
}

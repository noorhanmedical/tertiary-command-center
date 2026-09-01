// Phase 2E-B — clinic-scoped Ancillary Documents read APIs.
//
// Two read-only routes over the canonical reference index (never bytes):
//   • GET /api/ancillary-cases/:ancillaryCaseId/documents  (per-case)
//   • GET /api/ancillary-documents                          (global list)
//
// Rules enforced here:
//   • clinicId comes ONLY from req.clinicId (never query/body).
//   • Another clinic's case reads as not-found (no detail disclosure).
//   • Feature OFF → explicit disabled contract, ZERO migration-0053 reads.
//   • Flag ON + migration missing → controlled 503 (never legacy fallback).
//   • No global Plexus identity search; no retry-ledger internals; no bytes.

import type { Express, Request, Response } from "express";
import { featureFlags } from "../lib/featureFlags";
import {
  getAncillaryDocumentsProjection,
  getAncillaryDocumentsList,
} from "../services/ancillaryDocuments/documentProjection";
import { getAncillaryCaseById } from "../repositories/ancillaryCases.repo";

function requireClinicScope(req: Request, res: Response): number | null {
  const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) {
    res.status(403).json({ error: "Clinic scope required" });
    return null;
  }
  return clinicId;
}

function parseIntOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function is503(e: unknown): boolean {
  return (e as { code?: string })?.code === "ANCILLARY_DOCUMENT_MIGRATION_MISSING"
    || (e as { status?: number })?.status === 503;
}

export function registerAncillaryDocumentsRoutes(app: Express): void {
  // ─── GET /api/ancillary-cases/:ancillaryCaseId/documents ──────────
  app.get("/api/ancillary-cases/:ancillaryCaseId/documents", async (req, res) => {
    // Flag OFF → explicit disabled contract, zero canonical reads.
    if (!featureFlags.unifiedAncillaryDocuments) {
      return res.json({ disabled: true, ancillaryCaseId: null, cases: [] });
    }
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    const ancillaryCaseId = parseIntOrNull(req.params.ancillaryCaseId);
    if (ancillaryCaseId == null) return res.status(400).json({ error: "Invalid ancillaryCaseId" });
    try {
      // Tenant gate: an absent case and an other-clinic case both read as
      // not-found — no cross-tenant existence disclosure.
      const acase = await getAncillaryCaseById(ancillaryCaseId);
      if (!acase || acase.clinicId !== clinicId) {
        return res.status(404).json({ error: "Not Found" });
      }
      const projection = await getAncillaryDocumentsProjection({
        clinicId,
        ancillaryCaseId,
        includeHistory: req.query.includeHistory !== "false",
      });
      return res.json(projection);
    } catch (e) {
      if (is503(e)) return res.status(503).json({ error: "Ancillary Documents unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      console.error("[ancillary-cases/documents] error:", (e as Error)?.message ?? e);
      return res.status(500).json({ error: "Failed to load case documents" });
    }
  });

  // ─── GET /api/ancillary-documents ─────────────────────────────────
  app.get("/api/ancillary-documents", async (req, res) => {
    if (!featureFlags.unifiedAncillaryDocuments) {
      // Explicit disabled contract — no migration-0053 reads.
      return res.json({ disabled: true, items: [], nextCursor: null });
    }
    const clinicId = requireClinicScope(req, res);
    if (clinicId == null) return;
    const q = req.query as Record<string, string | undefined>;
    try {
      const result = await getAncillaryDocumentsList({
        clinicId,
        ancillaryCaseId: parseIntOrNull(q.ancillaryCaseId) ?? undefined,
        patientScreeningId: parseIntOrNull(q.patientScreeningId) ?? undefined,
        executionCaseId: parseIntOrNull(q.executionCaseId) ?? undefined,
        globalPlexusPatientId: parseIntOrNull(q.globalPlexusPatientId) ?? undefined,
        serviceType: q.serviceType || undefined,
        documentKind: q.documentKind || undefined,
        documentStatus: q.documentStatus || undefined,
        includeHistory: q.includeHistory !== "false",
        limit: parseIntOrNull(q.limit) ?? undefined,
        // Opaque compound cursor (string), decoded/validated in the service.
        cursor: typeof q.cursor === "string" && q.cursor.length > 0 ? q.cursor : undefined,
      });
      return res.json({ items: result.items, nextCursor: result.nextCursor });
    } catch (e) {
      if ((e as { code?: string })?.code === "INVALID_CURSOR") {
        return res.status(400).json({ error: "Invalid cursor", code: "INVALID_CURSOR" });
      }
      if (is503(e)) return res.status(503).json({ error: "Ancillary Documents unavailable", code: "ANCILLARY_DOCUMENT_MIGRATION_MISSING" });
      console.error("[ancillary-documents] error:", (e as Error)?.message ?? e);
      return res.status(500).json({ error: "Failed to load ancillary documents" });
    }
  });
}

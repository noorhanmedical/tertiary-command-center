// Physician Portal — signatures + reports + ancillary metrics.
//
// Aggregates from canonical tables only — no parallel data store.
//   Signatures        → procedure_notes (signature_status state machine)
//   Reports           → case_document_readiness (document_type='report')
//   Ancillary metrics → procedure_events + case_document_readiness +
//                       procedure_notes, per-service, scoped to a window.
//
// Finance is intentionally NOT included. Real financial data is complex
// (invoices, payments, denials) and the archive shape mixed live billing
// tables with derived "financial health" values that felt like KPIs but
// were not audited numbers. The client's Finance tab renders an honest
// "not enabled yet" state instead of pretending values are live.
//
// Layering rules enforced here:
//   • Zero db.select / db.execute / db.update calls in this file.
//   • Route validates request → delegates to signatureWorkflow /
//     reportsService → services delegate DB reads to
//     physicianPortal.repo + physicianPortalOps.repo.
//   • Auth: global requireAuth is already applied at /api. This file
//     enforces the additional clinician/admin role gate.

import type { Express, Request, Response, NextFunction } from "express";
import { logAudit } from "../services/auditService";
import {
  listSignatureItems,
  signNote,
  bulkSignNotes,
  returnNoteForCorrection,
} from "../services/physicianPortal/signatureWorkflow";
import {
  listReports,
  ancillaryMetrics,
} from "../services/physicianPortal/reportsService";

function requireClinicianOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const role = req.session.role ?? "clinician";
  if (role !== "clinician" && role !== "admin") {
    return res.status(403).json({ error: "Forbidden — clinician role required" });
  }
  return next();
}

function parseIntSafe(v: unknown): number | null {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function registerPhysicianPortalRoutes(app: Express) {
  // ─── GET /api/physician-portal/signature-items ────────────────────────────
  // Worklist for the SignaturesTab. Optional filters: serviceType,
  // signatureStatus, facilityId, limit. Delegates to the signature
  // workflow service; no direct DB access.
  app.get(
    "/api/physician-portal/signature-items",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const q = req.query as Record<string, string | undefined>;
        const items = await listSignatureItems({
          limit: q.limit ? parseInt(q.limit, 10) || undefined : undefined,
          serviceType: q.serviceType,
          signatureStatus: q.signatureStatus,
          facilityId: q.facilityId,
        });
        res.json(items);
      } catch (error: any) {
        console.error("[physician-portal/signature-items] error:", error?.message ?? error);
        res.status(500).json({ error: "Failed to load signature items" });
      }
    },
  );

  // ─── POST /api/physician-portal/signature-items/:id/sign ──────────────────
  app.post(
    "/api/physician-portal/signature-items/:id/sign",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const id = parseIntSafe(req.params.id);
        if (id == null) return res.status(400).json({ error: "Invalid id" });
        const outcome = await signNote(id, req.session.userId ?? null);
        if (!outcome.ok) return res.status(outcome.code).json({ error: outcome.error });
        void logAudit(req, "sign", "procedure_note", id, {
          serviceType: outcome.note.serviceType,
          noteType: outcome.note.noteType,
        });
        res.json(outcome.note);
      } catch (error: any) {
        console.error("[physician-portal/sign] error:", error?.message ?? error);
        res.status(500).json({ error: "Failed to sign note" });
      }
    },
  );

  // ─── POST /api/physician-portal/signature-items/bulk-sign ─────────────────
  app.post(
    "/api/physician-portal/signature-items/bulk-sign",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const raw: unknown = req.body?.ids;
        if (!Array.isArray(raw) || raw.length === 0) {
          return res.status(400).json({ error: "ids[] is required" });
        }
        const ids = raw
          .map((v) => parseIntSafe(v))
          .filter((v): v is number => v != null);
        if (ids.length === 0) {
          return res.status(400).json({ error: "No valid ids supplied" });
        }
        const results = await bulkSignNotes(ids, req.session.userId ?? null);
        if (results.signed.length > 0) {
          void logAudit(req, "bulk_sign", "procedure_note", 0, {
            signed: results.signed,
            skipped: results.skipped,
          });
        }
        res.json(results);
      } catch (error: any) {
        console.error("[physician-portal/bulk-sign] error:", error?.message ?? error);
        res.status(500).json({ error: "Failed to bulk-sign notes" });
      }
    },
  );

  // ─── POST /api/physician-portal/signature-items/:id/return ────────────────
  app.post(
    "/api/physician-portal/signature-items/:id/return",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const id = parseIntSafe(req.params.id);
        if (id == null) return res.status(400).json({ error: "Invalid id" });
        const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
        const outcome = await returnNoteForCorrection(id, reason);
        if (!outcome.ok) return res.status(outcome.code).json({ error: outcome.error });
        void logAudit(req, "return_for_correction", "procedure_note", id, {
          reason: reason.trim(),
        });
        res.json(outcome.note);
      } catch (error: any) {
        console.error("[physician-portal/return] error:", error?.message ?? error);
        res.status(500).json({ error: "Failed to return note" });
      }
    },
  );

  // ─── GET /api/physician-portal/reports ────────────────────────────────────
  // Ancillary reports from case_document_readiness. Defaults to onlyOpen=true
  // so the tab surfaces outstanding items first.
  app.get(
    "/api/physician-portal/reports",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const q = req.query as Record<string, string | undefined>;
        const items = await listReports({
          facilityId: q.facilityId,
          serviceType: q.serviceType,
          documentStatus: q.documentStatus,
          onlyOpen: q.onlyOpen ? q.onlyOpen !== "false" : true,
          limit: q.limit ? parseInt(q.limit, 10) || undefined : undefined,
        });
        res.json(items);
      } catch (error: any) {
        console.error(
          "[physician-portal/reports] error:",
          error?.message ?? error,
        );
        res.status(500).json({ error: "Failed to load reports" });
      }
    },
  );

  // ─── GET /api/physician-portal/ancillary-metrics ─────────────────────────
  // Per-service rollup: procedures completed, reports uploaded, notes signed
  // in a scoped window (default 30d). Reports-outstanding is the current
  // backlog and is not date-scoped.
  app.get(
    "/api/physician-portal/ancillary-metrics",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const q = req.query as Record<string, string | undefined>;
        const items = await ancillaryMetrics({
          days: q.days ? parseInt(q.days, 10) : undefined,
          facilityId: q.facilityId,
        });
        res.json(items);
      } catch (error: any) {
        console.error(
          "[physician-portal/ancillary-metrics] error:",
          error?.message ?? error,
        );
        res.status(500).json({ error: "Failed to load ancillary metrics" });
      }
    },
  );
}

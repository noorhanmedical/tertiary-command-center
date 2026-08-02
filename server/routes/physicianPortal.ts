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

import type { Express, Request, Response } from "express";
import { logAudit } from "../services/auditService";
import { requireClinicianOrAdmin, requireClinicScope } from "./clinicianPortalGuard";
import {
  listSignatureItems,
  signProcedureNote,
  bulkSignNotes,
  returnProcedureNoteForCorrection,
} from "../services/physicianPortal/signatureWorkflow";
import {
  getPhysicianPortalSummary,
  getFinancialHealth,
} from "../services/physicianPortal/summaryService";
import {
  listReports,
  ancillaryMetrics,
} from "../services/physicianPortal/reportsService";

// Auth boundary (role gate + clinic scope) is the SHARED Clinician Portal
// guard — see server/routes/clinicianPortalGuard.ts. A missing/unknown role
// now fails closed (403) rather than defaulting to clinician.

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
        const clinicId = requireClinicScope(req, res);
        if (clinicId == null) return;
        const q = req.query as Record<string, string | undefined>;
        const items = await listSignatureItems({
          clinicId,
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
        const clinicId = requireClinicScope(req, res);
        if (clinicId == null) return;
        const id = parseIntSafe(req.params.id);
        if (id == null) return res.status(400).json({ error: "Invalid id" });
        const outcome = await signProcedureNote({
          id,
          clinicId,
          authenticatedSignerUserId: req.session.userId ?? null,
        });
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
        const clinicId = requireClinicScope(req, res);
        if (clinicId == null) return;
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
        const results = await bulkSignNotes(ids, clinicId, req.session.userId ?? null);
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
        const clinicId = requireClinicScope(req, res);
        if (clinicId == null) return;
        const id = parseIntSafe(req.params.id);
        if (id == null) return res.status(400).json({ error: "Invalid id" });
        const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
        const outcome = await returnProcedureNoteForCorrection({ id, clinicId, reason });
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

  // ─── GET /api/physician-portal/summary ─────────────────────────────────
  // Tile counts for HomeDashboard + physician DashboardHome.
  // Delegates to summaryService → physicianPortalOps.repo (scoped counts,
  // no getAll, no raw db.select in this route).
  app.get(
    "/api/physician-portal/summary",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const facility = String((req.query as any).facility ?? "").trim() || null;
        const summary = await getPhysicianPortalSummary({ facilityId: facility });
        res.json(summary);
      } catch (error: any) {
        console.error("[physician-portal/summary] error:", error?.message ?? error);
        res.status(500).json({ error: "Failed to load summary" });
      }
    },
  );

  // ─── GET /api/physician-portal/financial-health ────────────────────────
  // Overall invoice-based aggregation for FinancialHealthTab. The Plexus
  // service contribution breakdown is returned as { unavailable: true }
  // until its scoped repo helper lands — no fabricated financial values.
  app.get(
    "/api/physician-portal/financial-health",
    requireClinicianOrAdmin,
    async (req, res) => {
      try {
        const facility = String((req.query as any).facility ?? "").trim() || null;
        const health = await getFinancialHealth({ facilityId: facility });
        res.json(health);
      } catch (error: any) {
        console.error(
          "[physician-portal/financial-health] error:",
          error?.message ?? error,
        );
        res.status(500).json({ error: "Failed to load financial health" });
      }
    },
  );
}

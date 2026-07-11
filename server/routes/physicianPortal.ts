// Physician Portal — signature endpoints only (Phase A).
//
// Aggregates from canonical tables only — no parallel data store.
//   Signatures → procedure_notes (signature_status state machine)
//
// This route is intentionally MINIMAL: only the signature worklist +
// sign/return endpoints. The archive's Reports / Ancillary Metrics /
// Financial Health tabs are deferred as mock-backed UI. When they land,
// their route handlers must live in a repository-layered service the
// same way this file's signature endpoints do.
//
// Layering rules enforced here:
//   • Zero db.select / db.execute / db.update calls in this file.
//   • Route validates request → delegates to signatureWorkflow service →
//     service delegates DB reads to physicianPortal.repo and writes to
//     the existing generatedNotes.repo.
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
}

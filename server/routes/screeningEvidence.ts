// Slice A0 — structured screening evidence routes.
//
// Thin route layer: validate request → delegate to screeningEvidenceService.
// A0-UI (separate slice) is the intended caller. Legacy PDF/flag completion
// keeps using POST /api/case-document-readiness/complete (uploaded_document);
// that route is untouched here.
//
// Rollout: FEATURE_SCREENING_EVIDENCE_ENFORCE (env) OFF ⇒ validate-and-log
// (invalid payloads are logged, never rejected, and nothing is persisted /
// marked completed). ON ⇒ validate + persist + 422 on invalid.
//
// This slice adds no physician-signature endpoint and no signature writes.

import type { Express, Request, Response } from "express";
import {
  submitScreeningEvidence,
  getCurrentScreeningEvidence,
  ensureScreeningContext,
} from "../services/screening/screeningEvidenceService";

function enforcementEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.FEATURE_SCREENING_EVIDENCE_ENFORCE ?? "").trim());
}

function resolveClinicId(req: Request): number | null {
  const fromReq = (req as Request & { clinicId?: number }).clinicId;
  const fromSession = (req as Request & { session?: { clinicId?: number } }).session?.clinicId;
  const v = fromReq ?? fromSession;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const ALLOWED_ROLES = new Set(["admin", "clinician", "technician", "acs", "pcs"]);

export function registerScreeningEvidenceRoutes(app: Express) {
  // Submit structured screening evidence (direct entry OR verified paper
  // transcription). The response set — not any uploaded PDF — is what will
  // satisfy the future Order Note signing prerequisite (Slice C).
  app.post("/api/screening-evidence", async (req: Request, res: Response) => {
    try {
      const role = String((req as Request & { session?: { role?: string } }).session?.role ?? "").toLowerCase();
      if (!ALLOWED_ROLES.has(role)) return res.status(403).json({ error: "Insufficient permissions" });
      const clinicId = resolveClinicId(req);
      if (clinicId == null) return res.status(400).json({ error: "No clinic scope" });
      const userId = (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      // Stamp the documenter identity from the authenticated session — the
      // patient's answers stay patient-reported; staff identity is provenance
      // only and is never trusted from the client body.
      const payload = req.body as { capture?: Record<string, unknown> } | undefined;
      if (payload && typeof payload === "object" && payload.capture && typeof payload.capture === "object") {
        const cap = payload.capture as Record<string, unknown>;
        cap.documentedByUserId = userId;
        if (!cap.documentedAt) cap.documentedAt = new Date().toISOString();
        if (cap.transcription && typeof cap.transcription === "object") {
          const t = cap.transcription as Record<string, unknown>;
          if (!t.transcribedByUserId) t.transcribedByUserId = userId;
        }
      }

      const enforce = enforcementEnabled();
      const out = await submitScreeningEvidence({ clinicId, payload: req.body, validateOnly: !enforce });

      if (out.status === "invalid") {
        if (!enforce) {
          console.warn(
            JSON.stringify({ level: "warn", source: "screening_evidence", kind: "validate_and_log_reject", reasons: out.reasons }),
          );
          // Validate-and-log rollout: never reject; report what would fail.
          return res.status(200).json({ mode: "validate_and_log", accepted: false, reasons: out.reasons });
        }
        return res.status(422).json({ error: "SCREENING_EVIDENCE_INVALID", reasons: out.reasons });
      }
      if (out.status === "validated_not_persisted") {
        return res.status(200).json({ mode: "validate_and_log", accepted: true, ...out });
      }
      return res.status(200).json(out);
    } catch (error) {
      const msg = (error as { message?: string })?.message ?? "error";
      console.error("[screening-evidence] submit error:", msg);
      return res.status(500).json({ error: "Failed to submit screening evidence" });
    }
  });

  // A0-UI support: resolve/ensure the screening context (readiness row + ids +
  // questionnaire + current-evidence summary) for an ancillary case.
  app.post("/api/screening-evidence/context", async (req: Request, res: Response) => {
    try {
      const role = String((req as Request & { session?: { role?: string } }).session?.role ?? "").toLowerCase();
      if (!ALLOWED_ROLES.has(role)) return res.status(403).json({ error: "Insufficient permissions" });
      const clinicId = resolveClinicId(req);
      if (clinicId == null) return res.status(400).json({ error: "No clinic scope" });
      const ancillaryCaseId = Number(req.body?.ancillaryCaseId);
      if (!Number.isFinite(ancillaryCaseId)) return res.status(400).json({ error: "ancillaryCaseId required" });
      const out = await ensureScreeningContext({ clinicId, ancillaryCaseId });
      if (out.status !== "ok") return res.status(out.status === "case_not_found" ? 404 : 409).json({ error: out.status });
      return res.json(out.context);
    } catch (error) {
      console.error("[screening-evidence] context error:", (error as { message?: string })?.message ?? error);
      return res.status(500).json({ error: "Failed to resolve screening context" });
    }
  });

  // Read the current completed structured screening evidence + FULL version
  // for an exact case+service. Consumed by A1 / the signing gate later.
  app.get("/api/screening-evidence/current", async (req: Request, res: Response) => {
    try {
      const clinicId = resolveClinicId(req);
      const ancillaryCaseId = Number(req.query.ancillaryCaseId);
      const serviceType = String(req.query.serviceType ?? "");
      if (clinicId == null || !Number.isFinite(ancillaryCaseId) || !serviceType) {
        return res.status(400).json({ error: "Invalid params" });
      }
      const cur = await getCurrentScreeningEvidence({ clinicId, ancillaryCaseId, serviceType });
      if (!cur) return res.status(404).json({ error: "No current completed structured screening evidence" });
      return res.json(cur);
    } catch (error) {
      const msg = (error as { message?: string })?.message ?? "error";
      console.error("[screening-evidence] read error:", msg);
      return res.status(500).json({ error: "Failed to read screening evidence" });
    }
  });
}

import type { Express } from "express";
import {
  getPatientClinicalData,
  listEncounters,
  listPriorTests,
  getAdminReviewView,
  getEpisodeDocumentsView,
} from "../repositories/clinicalData.repo";
import { listCommunicationsForPatient, logCommunication } from "../repositories/communications.repo";

// Canonical clinical reference domains for the Patient EHR chart.
//   GET /api/patients/:screeningId/clinical-data
//     → { providers, allergies, labs, imaging, vitals, encounters, encounterTotal }
//   GET /api/patients/:screeningId/encounters?limit=&offset=
//     → { rows, total, limit, offset }   (Load More pagination)
//
// Registered after the generic /api/patients/:id handler; the deeper path
// segments never collide with it.
export function registerClinicalDataRoutes(app: Express) {
  app.get("/api/patients/:screeningId/clinical-data", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      const encounterLimit = req.query.encounterLimit
        ? parseInt(String(req.query.encounterLimit), 10)
        : undefined;
      const data = await getPatientClinicalData(screeningId, { encounterLimit });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/patients/:screeningId/encounters", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;
      const page = await listEncounters(screeningId, { limit, offset });
      res.json(page);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Prior ancillary test episodes (patient_test_history) for the Plexus Notes
  // "Previous Episodes" + Journey "Previous Tests" views.
  app.get("/api/patients/:screeningId/prior-tests", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      const rows = await listPriorTests(screeningId);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Canonical Admin Review view — per-service admin-review status straight off
  // patient_ancillary_cases (the same source the Plexus IQ workspace writes)
  // plus the append-only review event timeline. No mock/duplicate state.
  app.get("/api/patients/:screeningId/admin-review", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      const view = await getAdminReviewView(screeningId);
      res.json(view);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Per-episode canonical document set (Order Note, Screening Addendum,
  // Procedure Note, Consent, Screening Form, Test Report, Billing Document)
  // + note version/diff lineage. Episode-keyed (no cross-episode leakage).
  app.get("/api/patients/:screeningId/episode-documents", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) {
        return res.status(400).json({ error: "Invalid screening id" });
      }
      const view = await getEpisodeDocumentsView(screeningId);
      res.json(view);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Canonical patient communications (calls/SMS/email/portal) — reads the
  // extended outreach_calls table. Section visibility is governed by the
  // patient-directory section-access matrix; this read is requireAuth like the
  // other EHR domain reads (not portal-role gated).
  app.get("/api/patients/:screeningId/communications", async (req, res) => {
    try {
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) return res.status(400).json({ error: "Invalid screening id" });
      const rows = await listCommunicationsForPatient(screeningId);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Log a communication (call/SMS/email/portal). Propagates to operational
  // state (attempts, next action, engagement) + emits a Plexus Story event.
  // Write is limited to outreach-capable roles (explicit comms action perm).
  app.post("/api/patients/:screeningId/communications", async (req, res) => {
    try {
      const role = (req as { session?: { role?: string } }).session?.role ?? "";
      if (!["admin", "scheduler", "liaison"].includes(role)) {
        return res.status(403).json({ error: "Communication logging requires an outreach role (PCS/scheduler/admin)." });
      }
      const screeningId = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(screeningId)) return res.status(400).json({ error: "Invalid screening id" });
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (typeof b.outcome !== "string" || !b.outcome) return res.status(400).json({ error: "outcome required" });
      const row = await logCommunication({
        patientScreeningId: screeningId,
        clinicId: (req as { clinicId?: number | null }).clinicId ?? null,
        patientName: typeof b.patientName === "string" ? b.patientName : null,
        patientDob: typeof b.patientDob === "string" ? b.patientDob : null,
        ancillaryCaseId: typeof b.ancillaryCaseId === "number" ? b.ancillaryCaseId : null,
        serviceType: typeof b.serviceType === "string" ? b.serviceType : null,
        channel: typeof b.channel === "string" ? b.channel : "phone",
        direction: typeof b.direction === "string" ? b.direction : "outbound",
        destination: typeof b.destination === "string" ? b.destination : null,
        schedulerUserId: (req as { session?: { userId?: string } }).session?.userId ?? null,
        staffName: typeof b.staffName === "string" ? b.staffName : null,
        staffRole: role,
        outcome: b.outcome,
        notes: typeof b.notes === "string" ? b.notes : null,
        disposition: typeof b.disposition === "string" ? b.disposition : null,
        nextAction: typeof b.nextAction === "string" ? b.nextAction : null,
        callbackAt: typeof b.callbackAt === "string" ? new Date(b.callbackAt) : null,
        durationSeconds: typeof b.durationSeconds === "number" ? b.durationSeconds : null,
      });
      res.status(201).json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

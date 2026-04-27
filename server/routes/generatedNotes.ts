import type { Express } from "express";
import { storage } from "../storage";
import { saveGeneratedNoteSchema } from "./helpers";
import { invalidatePatientDatabase } from "./patientDatabase";
import {
  listGeneratedNotes,
  getGeneratedNoteById,
} from "../repositories/generatedNotes.repo";

export function registerGeneratedNotesRoutes(app: Express) {
  app.get("/api/generated-notes", async (_req, res) => {
    try {
      const notes = await storage.getAllGeneratedNotes();
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/generated-notes/batch/:batchId", async (req, res) => {
    try {
      const batchId = parseInt(String(req.params.batchId), 10);
      const notes = await storage.getGeneratedNotesByBatch(batchId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/generated-notes", async (req, res) => {
    try {
      const body = Array.isArray(req.body) ? req.body : [req.body];
      const parsed = body.map((item) => saveGeneratedNoteSchema.parse(item));
      const patientId = parsed[0]?.patientId;
      if (patientId) {
        await storage.deleteGeneratedNotesByPatient(patientId);
      }
      const saved = await storage.saveGeneratedNotes(parsed);
      invalidatePatientDatabase();
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/generated-notes/service", async (req, res) => {
    try {
      const body = Array.isArray(req.body) ? req.body : [req.body];
      const parsed = body.map((item) => saveGeneratedNoteSchema.parse(item));
      const patientId = parsed[0]?.patientId;
      const service = parsed[0]?.service;
      if (patientId && service) {
        await storage.deleteGeneratedNotesByPatientAndService(patientId, service);
      }
      const saved = await storage.saveGeneratedNotes(parsed);
      invalidatePatientDatabase();
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/generated-notes/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(String(req.params.patientId), 10);
      await storage.deleteGeneratedNotesByPatient(patientId);
      invalidatePatientDatabase();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/generated-notes/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(String(req.params.patientId), 10);
      const notes = await storage.getGeneratedNotesByPatient(patientId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Procedure Notes (new table: procedure_notes) ─────────────────────────

  // GET /api/procedure-notes
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          serviceType, noteType, generationStatus, limit
  app.get("/api/procedure-notes", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listGeneratedNotes>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.procedureEventId) {
        const id = parseInt(q.procedureEventId, 10);
        if (!isNaN(id)) filters.procedureEventId = id;
      }
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.noteType) filters.noteType = q.noteType;
      if (q.generationStatus) filters.generationStatus = q.generationStatus;

      const notes = await listGeneratedNotes(filters, limit);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/procedure-notes/:id
  app.get("/api/procedure-notes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const note = await getGeneratedNoteById(id);
      if (!note) return res.status(404).json({ error: "Procedure note not found" });
      res.json(note);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

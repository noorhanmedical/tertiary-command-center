import type { Express } from "express";
import { storage } from "../storage";
import { saveGeneratedNoteSchema } from "./helpers";

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
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/generated-notes/patient/:patientId", async (req, res) => {
    try {
      const patientId = parseInt(String(req.params.patientId), 10);
      await storage.deleteGeneratedNotesByPatient(patientId);
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
}

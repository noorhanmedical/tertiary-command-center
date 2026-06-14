import type { Express } from "express";
import { z } from "zod";
import {
  listPatientNotes,
  createPatientNote,
  archivePatientNote,
} from "../repositories/patientNotes.repo";
import { requirePortalRole } from "./portal";
import { PATIENT_NOTE_TYPES } from "@shared/schema/patientNotes";

const createSchema = z.object({
  patientScreeningId: z.number().int().positive(),
  executionCaseId: z.number().int().positive().optional().nullable(),
  noteType: z.enum(PATIENT_NOTE_TYPES).optional(),
  body: z.string().min(1).max(8192),
  isInternal: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function registerPatientNotesRoutes(app: Express) {
  app.get("/api/patient-notes", requirePortalRole, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listPatientNotes>[0] = {};
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.noteType) filters.noteType = q.noteType;
      if (q.includeArchived === "true") filters.includeArchived = true;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const rows = await listPatientNotes(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/patient-notes", requirePortalRole, async (req, res) => {
    try {
      const actorUserId = req.session?.userId ?? null;
      if (!actorUserId) return res.status(401).json({ error: "Not authenticated" });
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const row = await createPatientNote({
        patientScreeningId: parsed.data.patientScreeningId,
        executionCaseId: parsed.data.executionCaseId ?? null,
        noteType: parsed.data.noteType ?? "quick_note",
        body: parsed.data.body,
        isInternal: parsed.data.isInternal ?? true,
        metadata: parsed.data.metadata ?? {},
        authorUserId: actorUserId,
        archivedAt: null,
      });
      res.status(201).json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/patient-notes/:id/archive", requirePortalRole, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await archivePatientNote(id);
      if (!row) return res.status(404).json({ error: "Note not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

/**
 * Phase 5 — Order Note Lifecycle routes.
 *
 * Endpoints for Order Note Draft creation, lifecycle transitions
 * (route to clinician), and addenda management.
 *
 * Signing itself is handled by the existing physicianPortal signature
 * workflow (signProcedureNote, bulkSignNotes, returnProcedureNoteForCorrection).
 * This route file manages the Order-Note-specific operations that precede
 * and follow signing.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  createOrderNoteDraft,
  routeOrderNoteToClinician,
  getActiveOrderNoteForCase,
  listOrderNotesForScreening,
  createNoteAddendum,
  listAddendaForNote,
  getAddendum,
  signAddendum,
} from "../repositories/orderNoteLifecycle.repo";
import { ADDENDUM_TYPES, ADDENDUM_SOURCE_TYPES } from "@shared/schema/noteAddenda";

const createDraftSchema = z.object({
  clinicId: z.number().int().optional().nullable(),
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  serviceType: z.string().min(1).max(100),
  generatedText: z.string().min(1),
  generatedByAi: z.boolean().optional(),
  sourceData: z.record(z.unknown()).optional(),
});

const createAddendumSchema = z.object({
  parentNoteId: z.number().int(),
  clinicId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  addendumType: z.enum(ADDENDUM_TYPES).optional(),
  title: z.string().max(500).optional().nullable(),
  content: z.string().min(1).max(50000),
  structuredData: z.record(z.unknown()).optional(),
  sourceType: z.enum(ADDENDUM_SOURCE_TYPES).optional().nullable(),
  sourceRecordId: z.string().max(200).optional().nullable(),
  requiresSignature: z.boolean().optional(),
});

export function registerOrderNoteLifecycleRoutes(app: Express) {
  // ─── CREATE Order Note Draft ─────────────────────────────────────────────
  // Called when a patient qualifies for a service. Creates the draft in
  // procedure_notes with note_type='order_note' and no signature_status.
  app.post("/api/order-notes/draft", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const parsed = createDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const result = await createOrderNoteDraft({
        ...parsed.data,
        clinicId: parsed.data.clinicId ?? null,
        executionCaseId: parsed.data.executionCaseId ?? null,
        patientScreeningId: parsed.data.patientScreeningId ?? null,
        ancillaryCaseId: parsed.data.ancillaryCaseId ?? null,
        generatedByAi: parsed.data.generatedByAi ?? false,
        sourceData: parsed.data.sourceData ?? {},
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      console.error("[order-notes] create draft error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to create order note draft" });
    }
  });

  // ─── ROUTE Order Note to Clinician ───────────────────────────────────────
  // Called when patient is scheduled. Sets signature_status to 'needs_signature'
  // so it appears in the clinician signature worklist.
  app.post("/api/order-notes/:id/route-to-clinician", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const result = await routeOrderNoteToClinician(id);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result.note);
    } catch (error: any) {
      console.error("[order-notes] route to clinician error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to route order note" });
    }
  });

  // ─── GET active Order Note for an ancillary case ─────────────────────────
  app.get("/api/order-notes/case/:ancillaryCaseId", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.ancillaryCaseId), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid case ID" });
      const note = await getActiveOrderNoteForCase(id);
      if (!note) return res.status(404).json({ error: "No active order note for this case" });
      res.json(note);
    } catch (error: any) {
      console.error("[order-notes] get by case error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get order note" });
    }
  });

  // ─── LIST Order Notes for a screening ────────────────────────────────────
  app.get("/api/order-notes/screening/:screeningId", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.screeningId), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid screening ID" });
      const notes = await listOrderNotesForScreening(id);
      res.json(notes);
    } catch (error: any) {
      console.error("[order-notes] list by screening error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list order notes" });
    }
  });

  // ─── CREATE Addendum ─────────────────────────────────────────────────────
  // Attaches an addendum to a parent note (typically a signed Order Note).
  // Does NOT mutate the parent's signed content.
  app.post("/api/note-addenda", async (req: Request, res: Response) => {
    try {
      const role = req.session.role ?? "clinician";
      if (!["admin", "clinician", "technician"].includes(role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const parsed = createAddendumSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const addendum = await createNoteAddendum({
        ...parsed.data,
        authorUserId: req.session.userId ?? undefined,
      });
      res.status(201).json(addendum);
    } catch (error: any) {
      console.error("[note-addenda] create error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to create addendum" });
    }
  });

  // ─── LIST Addenda for a note ─────────────────────────────────────────────
  app.get("/api/note-addenda/note/:noteId", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.noteId), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid note ID" });
      const addenda = await listAddendaForNote(id);
      res.json(addenda);
    } catch (error: any) {
      console.error("[note-addenda] list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list addenda" });
    }
  });

  // ─── GET single addendum ─────────────────────────────────────────────────
  app.get("/api/note-addenda/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const addendum = await getAddendum(id);
      if (!addendum) return res.status(404).json({ error: "Addendum not found" });
      res.json(addendum);
    } catch (error: any) {
      console.error("[note-addenda] get error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get addendum" });
    }
  });

  // ─── SIGN Addendum (clinician) ───────────────────────────────────────────
  app.post("/api/note-addenda/:id/sign", async (req: Request, res: Response) => {
    try {
      const role = req.session.role ?? "clinician";
      if (!["admin", "clinician"].includes(role)) {
        return res.status(403).json({ error: "Clinician or admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const addendum = await signAddendum(id, req.session.userId!);
      if (!addendum) return res.status(404).json({ error: "Addendum not found" });
      res.json(addendum);
    } catch (error: any) {
      console.error("[note-addenda] sign error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to sign addendum" });
    }
  });
}

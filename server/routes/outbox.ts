import type { Express } from "express";
import { z } from "zod";
import {
  listOutboxItems,
  drainOutbox,
  deleteOutboxItem,
  getOutboxSummary,
  enqueueSheetSync,
} from "../services/outbox";
import { readBlob } from "../services/blobStore";
import { db } from "../db";
import { documentBlobs, generatedNotes, uploadedDocuments } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
  if (req.session?.role !== "admin") return res.status(403).json({ message: "Admin only" });
  return next();
}

export function registerOutboxRoutes(app: Express) {
  app.get("/api/outbox", requireAdmin, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const items = await listOutboxItems({ status });
      const summary = await getOutboxSummary();
      res.json({ items, summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/outbox/drain", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        ids: z.array(z.number()).optional(),
        onlyFailed: z.boolean().optional(),
        isTest: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message });
      const result = await drainOutbox(parsed.data);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/outbox/enqueue-sheets", requireAdmin, async (_req, res) => {
    try {
      const billing = await enqueueSheetSync("sheet_billing");
      const patients = await enqueueSheetSync("sheet_patients");
      res.json({ billing, patients });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/outbox/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      await deleteOutboxItem(id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Document download (local-first; falls back to Drive metadata link) ──
  app.get("/api/documents/blob/:id/download", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const data = await readBlob(id);
      if (!data) return res.status(404).json({ error: "Blob not found" });
      res.setHeader("Content-Type", data.blob.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${data.blob.filename}"`);
      res.send(data.buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List blobs by owner (for the documents page UI)
  app.get("/api/documents/blobs", requireAdmin, async (req, res) => {
    try {
      const ownerType = typeof req.query.ownerType === "string" ? req.query.ownerType : undefined;
      const ownerId = req.query.ownerId ? parseInt(String(req.query.ownerId), 10) : undefined;
      const where = [] as any[];
      if (ownerType) where.push(eq(documentBlobs.ownerType, ownerType));
      if (ownerId) where.push(eq(documentBlobs.ownerId, ownerId));
      const q = db.select().from(documentBlobs);
      const rows = where.length ? await q.where(and(...where)).orderBy(desc(documentBlobs.id)) : await q.orderBy(desc(documentBlobs.id));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

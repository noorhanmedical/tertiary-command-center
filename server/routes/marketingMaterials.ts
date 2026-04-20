import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { saveBlob, readBlob, deleteBlob, getLatestBlobForOwner } from "../services/blobStore";
import type { MarketingMaterial } from "@shared/schema";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  return next();
};

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
  if (req.session.role !== "admin") {
    return res.status(403).json({ message: "Forbidden — admin access required" });
  }
  return next();
};

function isImageMime(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function shapeMaterial(row: MarketingMaterial) {
  const downloadUrl = `/api/marketing-materials/${row.id}/file`;
  const thumbnailUrl = isImageMime(row.contentType)
    ? `${downloadUrl}?disposition=inline`
    : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    downloadUrl,
    thumbnailUrl,
  };
}

export function registerMarketingMaterialRoutes(app: Express) {
  app.get("/api/marketing-materials", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.getAllMarketingMaterials();
      res.json(rows.map(shapeMaterial));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing-materials", requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const title = String(req.body.title ?? "").trim();
      const description = String(req.body.description ?? "").trim();
      if (!title) return res.status(400).json({ error: "title is required" });
      if (title.length > 200) return res.status(400).json({ error: "title too long (max 200)" });
      if (description.length > 1000) return res.status(400).json({ error: "description too long (max 1000)" });

      const contentType: string = req.file.mimetype || "application/octet-stream";
      if (!ALLOWED_MIME.has(contentType)) {
        return res.status(400).json({ error: `Unsupported file type: ${contentType}. Allowed: PDF or image.` });
      }

      const buffer: Buffer = req.file.buffer;
      const filename: string = req.file.originalname || "material";

      const placeholderRow = await storage.createMarketingMaterial({
        title,
        description,
        filename,
        contentType,
        sizeBytes: buffer.length,
        storagePath: "",
        sha256: "",
        createdByUserId: req.session.userId ?? null,
      });

      try {
        const blob = await saveBlob({
          ownerType: "marketing_material",
          ownerId: placeholderRow.id,
          filename,
          contentType,
          buffer,
        });
        const finalRow = await storage.updateMarketingMaterialStorage(placeholderRow.id, {
          storagePath: blob.storagePath,
          sha256: blob.sha256,
          filename: blob.filename,
          sizeBytes: blob.sizeBytes,
        });
        res.status(201).json(shapeMaterial(finalRow));
      } catch (blobErr: any) {
        await storage.deleteMarketingMaterial(placeholderRow.id).catch(() => {});
        throw blobErr;
      }
    } catch (e: any) {
      console.error("[marketing-materials] upload failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/marketing-materials/:id/file", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const row = await storage.getMarketingMaterial(id);
      if (!row) return res.status(404).json({ error: "Not found" });

      const blob = await getLatestBlobForOwner("marketing_material", row.id);
      if (!blob) return res.status(404).json({ error: "File not found" });
      const data = await readBlob(blob.id);
      if (!data) return res.status(404).json({ error: "File not found" });

      const inline = req.query.disposition === "inline";
      res.setHeader("Content-Type", data.blob.contentType);
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${data.blob.filename}"`,
      );
      res.send(data.buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/marketing-materials/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const row = await storage.getMarketingMaterial(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      const blob = await getLatestBlobForOwner("marketing_material", row.id);
      if (blob) {
        try { await deleteBlob(blob.id); }
        catch (err: any) { console.error(`[marketing-materials] blob delete failed id=${id}:`, err.message); }
      }
      await storage.deleteMarketingMaterial(id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

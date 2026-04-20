import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { saveBlob, readBlob, deleteBlob, getLatestBlobForOwner } from "../services/blobStore";
import {
  type Document,
  DOCUMENT_KINDS,
  DOCUMENT_SIGNATURE_REQUIREMENTS,
  DOCUMENT_SURFACES,
  type DocumentKind,
  type DocumentSurface,
} from "@shared/schema";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin access required" });
  }
  return next();
};

function isImageMime(contentType: string): boolean {
  return contentType.startsWith("image/");
}

async function shapeDocument(doc: Document) {
  const assignments = await storage.getDocumentAssignments(doc.id);
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    kind: doc.kind,
    signatureRequirement: doc.signatureRequirement,
    filename: doc.filename,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    version: doc.version,
    supersededByDocumentId: doc.supersededByDocumentId,
    isCurrent: doc.supersededByDocumentId === null,
    createdAt: doc.createdAt,
    surfaces: assignments.map((a) => a.surface),
    downloadUrl: `/api/document-library/${doc.id}/file`,
    thumbnailUrl: isImageMime(doc.contentType) ? `/api/document-library/${doc.id}/file?disposition=inline` : null,
  };
}

export function registerDocumentLibraryRoutes(app: Express) {
  // ── Public-ish reads (any authenticated user can list & download) ─────────
  app.get("/api/document-library", async (req, res) => {
    try {
      const surfaceParam = typeof req.query.surface === "string" ? req.query.surface : undefined;
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;

      let docs: Document[];
      if (surfaceParam) {
        if (!DOCUMENT_SURFACES.includes(surfaceParam as DocumentSurface)) {
          return res.status(400).json({ error: `unknown surface: ${surfaceParam}` });
        }
        docs = await storage.getDocumentsForSurface(surfaceParam as DocumentSurface);
      } else {
        const kind = kindParam && DOCUMENT_KINDS.includes(kindParam as DocumentKind)
          ? (kindParam as DocumentKind)
          : undefined;
        docs = await storage.listCurrentDocuments({ kind });
      }
      const shaped = await Promise.all(docs.map(shapeDocument));
      res.json(shaped);
    } catch (e: any) {
      console.error("[document-library] list failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/document-library/meta", (_req, res) => {
    res.json({
      kinds: DOCUMENT_KINDS,
      signatureRequirements: DOCUMENT_SIGNATURE_REQUIREMENTS,
      surfaces: DOCUMENT_SURFACES,
    });
  });

  app.get("/api/document-library/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      res.json(await shapeDocument(doc));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/document-library/:id/versions", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const chain = await storage.getDocumentVersionChain(id);
      const shaped = await Promise.all(chain.map(shapeDocument));
      res.json(shaped);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/document-library/:id/file", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });

      const blob = await getLatestBlobForOwner("library_document", doc.id);
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

  // ── Admin writes ─────────────────────────────────────────────────────────
  app.post("/api/document-library", requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const title = String(req.body.title ?? "").trim();
      const description = String(req.body.description ?? "").trim();
      const kind = String(req.body.kind ?? "");
      const signatureRequirement = String(req.body.signatureRequirement ?? "none");
      const surfacesRaw = req.body.surfaces;

      if (!title) return res.status(400).json({ error: "title is required" });
      if (title.length > 200) return res.status(400).json({ error: "title too long (max 200)" });
      if (description.length > 1000) return res.status(400).json({ error: "description too long (max 1000)" });
      if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) {
        return res.status(400).json({ error: `kind must be one of: ${DOCUMENT_KINDS.join(", ")}` });
      }
      if (!DOCUMENT_SIGNATURE_REQUIREMENTS.includes(signatureRequirement as any)) {
        return res.status(400).json({ error: `signatureRequirement must be one of: ${DOCUMENT_SIGNATURE_REQUIREMENTS.join(", ")}` });
      }

      const contentType: string = req.file.mimetype || "application/octet-stream";
      if (!ALLOWED_MIME.has(contentType)) {
        return res.status(400).json({ error: `Unsupported file type: ${contentType}` });
      }
      const buffer: Buffer = req.file.buffer;
      const filename: string = req.file.originalname || "document";

      const surfaces: string[] = (() => {
        if (Array.isArray(surfacesRaw)) return surfacesRaw.map(String);
        if (typeof surfacesRaw === "string" && surfacesRaw.trim().length > 0) {
          try {
            const parsed = JSON.parse(surfacesRaw);
            if (Array.isArray(parsed)) return parsed.map(String);
          } catch {
            return surfacesRaw.split(",").map((s) => s.trim()).filter(Boolean);
          }
        }
        return [];
      })();
      for (const s of surfaces) {
        if (!DOCUMENT_SURFACES.includes(s as DocumentSurface)) {
          return res.status(400).json({ error: `unknown surface: ${s}` });
        }
      }

      const doc = await storage.createDocument({
        title,
        description,
        kind: kind as DocumentKind,
        signatureRequirement: signatureRequirement as any,
        filename,
        contentType,
        sizeBytes: buffer.length,
        createdByUserId: req.session.userId ?? null,
      });

      try {
        await saveBlob({
          ownerType: "library_document",
          ownerId: doc.id,
          filename,
          contentType,
          buffer,
        });
        for (const s of surfaces) {
          await storage.addDocumentAssignment(doc.id, s as DocumentSurface);
        }
        res.status(201).json(await shapeDocument(doc));
      } catch (blobErr: any) {
        await storage.deleteDocument(doc.id).catch(() => {});
        throw blobErr;
      }
    } catch (e: any) {
      console.error("[document-library] upload failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Replace a document with a new version. Inherits assignments + bumps version.
  app.post("/api/document-library/:id/supersede", requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      const oldId = parseInt(req.params.id, 10);
      if (Number.isNaN(oldId)) return res.status(400).json({ error: "id must be a number" });
      const oldDoc = await storage.getDocument(oldId);
      if (!oldDoc) return res.status(404).json({ error: "Not found" });
      if (oldDoc.supersededByDocumentId !== null) {
        return res.status(409).json({ error: "Document is already superseded" });
      }
      if (!req.file) return res.status(400).json({ error: "file is required" });

      const contentType: string = req.file.mimetype || "application/octet-stream";
      if (!ALLOWED_MIME.has(contentType)) {
        return res.status(400).json({ error: `Unsupported file type: ${contentType}` });
      }
      const buffer: Buffer = req.file.buffer;
      const filename: string = req.file.originalname || oldDoc.filename;

      const newDoc = await storage.createDocument({
        title: String(req.body.title ?? oldDoc.title),
        description: String(req.body.description ?? oldDoc.description),
        kind: oldDoc.kind as DocumentKind,
        signatureRequirement: oldDoc.signatureRequirement as any,
        filename,
        contentType,
        sizeBytes: buffer.length,
        createdByUserId: req.session.userId ?? null,
      });

      try {
        await saveBlob({
          ownerType: "library_document",
          ownerId: newDoc.id,
          filename,
          contentType,
          buffer,
        });
        await storage.supersedeDocument(oldId, newDoc.id);
        const refreshed = await storage.getDocument(newDoc.id);
        res.status(201).json(await shapeDocument(refreshed!));
      } catch (err: any) {
        await storage.deleteDocument(newDoc.id).catch(() => {});
        throw err;
      }
    } catch (e: any) {
      console.error("[document-library] supersede failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/document-library/:id/assignments", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const surface = String(req.body?.surface ?? "");
      if (!DOCUMENT_SURFACES.includes(surface as DocumentSurface)) {
        return res.status(400).json({ error: `unknown surface: ${surface}` });
      }
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      await storage.addDocumentAssignment(id, surface as DocumentSurface);
      res.json(await shapeDocument(doc));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/document-library/:id/assignments/:surface", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const surface = req.params.surface;
      if (!DOCUMENT_SURFACES.includes(surface as DocumentSurface)) {
        return res.status(400).json({ error: `unknown surface: ${surface}` });
      }
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      await storage.removeDocumentAssignment(id, surface as DocumentSurface);
      res.json(await shapeDocument(doc));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/document-library/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      // Refuse to delete superseded (older) versions so the version chain
      // stays intact. Admins can only delete the *current* version.
      if (doc.supersededByDocumentId !== null) {
        return res.status(409).json({
          error: "Cannot delete a superseded version. Delete the current version instead.",
        });
      }
      const blob = await getLatestBlobForOwner("library_document", doc.id);
      if (blob) {
        try { await deleteBlob(blob.id); }
        catch (err: any) { console.error(`[document-library] blob delete failed id=${id}:`, err.message); }
      }
      await storage.deleteDocument(id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

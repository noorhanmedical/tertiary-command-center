import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { saveBlob, readBlob, deleteBlob, getLatestBlobForOwner } from "../services/blobStore";
import { enqueueDriveFile } from "../services/outbox";
import { db } from "../db";
import { uploadedDocuments, documents as documentsTable, documentSurfaceAssignments, patientScreenings } from "@shared/schema";
import { desc, eq, like, sql } from "drizzle-orm";
import {
  type Document,
  DOCUMENT_KINDS,
  DOCUMENT_SIGNATURE_REQUIREMENTS,
  DOCUMENT_SURFACES,
  type DocumentKind,
  type DocumentSignatureRequirement,
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

// Defense-in-depth auth guard for read endpoints. The platform also mounts a
// global `requireAuth` middleware on every `/api/*` route in
// `server/routes.ts`, but enforcing it locally too means any future change to
// the global pipeline can't accidentally expose patient documents.
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
};

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

// Map an existing `uploaded_documents.docType` value to a library `kind` so
// that legacy patient-chart uploads surface in the new library transparently.
function inferLibraryKindFromLegacyDocType(docType: string): DocumentKind {
  switch (docType) {
    case "informed_consent":
      return "informed_consent";
    case "screening_form":
      return "screening_form";
    case "report":
      return "report";
    default:
      return "other";
  }
}

// Stable, deterministic source-notes prefix used to mark library rows that
// were back-filled from the legacy `uploaded_documents` table. Used both for
// idempotency (skip already-migrated rows) and provenance tracing.
const LEGACY_SOURCE_PREFIX = "legacy_uploaded_document_id=";

// First-read migration: idempotently upsert any unmigrated `uploaded_documents`
// rows into `documents` + a default `patient_chart` `document_surface_assignments`
// row, resolving `patient_screening_id` by exact name match where possible.
// Errors are logged but never thrown — a failed migration must not break reads.
async function migrateLegacyUploadedDocuments(): Promise<void> {
  try {
    const legacyRows = await db.select().from(uploadedDocuments)
      .where(eq(uploadedDocuments.isTest, false));
    if (legacyRows.length === 0) return;

    const migrated = await db.select({ sourceNotes: documentsTable.sourceNotes })
      .from(documentsTable)
      .where(like(documentsTable.sourceNotes, `${LEGACY_SOURCE_PREFIX}%`));
    const migratedIds = new Set<number>();
    for (const r of migrated) {
      if (!r.sourceNotes) continue;
      const idStr = r.sourceNotes.slice(LEGACY_SOURCE_PREFIX.length);
      const n = parseInt(idStr, 10);
      if (!Number.isNaN(n)) migratedIds.add(n);
    }

    const todo = legacyRows.filter((r) => !migratedIds.has(r.id));
    if (todo.length === 0) return;

    for (const row of todo) {
      try {
        const matches = await db.select({ id: patientScreenings.id })
          .from(patientScreenings)
          .where(eq(patientScreenings.name, row.patientName))
          .orderBy(desc(patientScreenings.id))
          .limit(1);
        const patientScreeningId = matches[0]?.id ?? null;

        await db.transaction(async (tx) => {
          const inserted = await tx.insert(documentsTable).values({
            title: `${row.patientName} — ${row.ancillaryType} (${row.docType})`,
            description: "",
            kind: inferLibraryKindFromLegacyDocType(row.docType),
            signatureRequirement: "none",
            filename: `${row.patientName}-${row.docType}.pdf`,
            contentType: "application/pdf",
            sizeBytes: 0,
            patientScreeningId,
            facility: row.facility,
            sourceNotes: `${LEGACY_SOURCE_PREFIX}${row.id}`,
            createdByUserId: null,
          }).returning({ id: documentsTable.id });
          const newId = inserted[0]!.id;
          await tx.insert(documentSurfaceAssignments).values({
            documentId: newId,
            surface: "patient_chart",
          }).onConflictDoNothing();
        });
      } catch (rowErr) {
        console.error(`[document-library] legacy migration failed for uploaded_documents.id=${row.id}:`, rowErr);
      }
    }
  } catch (e) {
    console.error("[document-library] legacy bulk migration failed:", e);
  }
}

// Adapter: shape a legacy uploaded_documents row to look like a library doc so
// it can appear alongside library entries in patient_chart reads.
// Retained as a defensive fallback for read paths that race the migration.
function shapeLegacyUploadedDoc(row: typeof uploadedDocuments.$inferSelect, basePath: string) {
  const kind = inferLibraryKindFromLegacyDocType(row.docType);
  return {
    id: -row.id, // negative id to avoid colliding with real library doc ids
    title: `${row.patientName} — ${row.ancillaryType} (${row.docType})`,
    description: "",
    kind,
    signatureRequirement: "none" as const,
    filename: `${row.patientName}-${row.docType}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 0,
    version: 1,
    supersededByDocumentId: null,
    isCurrent: true,
    createdAt: row.uploadedAt,
    surfaces: ["patient_chart"] as DocumentSurface[],
    legacy: true,
    patientName: row.patientName,
    facility: row.facility,
    downloadUrl: row.driveWebViewLink ?? null,
    thumbnailUrl: null,
  };
}

async function shapeDocument(doc: Document, basePath: string) {
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
    isCurrent: doc.supersededByDocumentId === null && doc.deletedAt === null,
    patientScreeningId: doc.patientScreeningId,
    facility: doc.facility,
    sourceNotes: doc.sourceNotes,
    deletedAt: doc.deletedAt,
    createdAt: doc.createdAt,
    surfaces: assignments.map((a) => a.surface),
    downloadUrl: `${basePath}/${doc.id}/file`,
    thumbnailUrl: isImageMime(doc.contentType) ? `${basePath}/${doc.id}/file?disposition=inline` : null,
  };
}

function parseSurfacesField(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// Register the document-library routes under a given base path. Called twice
// from registerDocumentLibraryRoutes to expose both `/api/document-library`
// (legacy/internal) and `/api/documents-library` (canonical task-spec path).
function mountRoutes(app: Express, basePath: string) {
  // ── Reads (any authenticated user) ──────────────────────────────────────
  app.get(basePath, requireAuth, async (req, res) => {
    try {
      const surfaceParam = typeof req.query.surface === "string" ? req.query.surface : undefined;
      const kindParam = typeof req.query.kind === "string" ? req.query.kind : undefined;
      const patientIdParam = typeof req.query.patientId === "string" ? req.query.patientId : undefined;
      const patientScreeningId = patientIdParam ? parseInt(patientIdParam, 10) : undefined;
      if (patientIdParam && Number.isNaN(patientScreeningId)) {
        return res.status(400).json({ error: "patientId must be a number" });
      }

      if (surfaceParam && !DOCUMENT_SURFACES.includes(surfaceParam as DocumentSurface)) {
        return res.status(400).json({ error: `unknown surface: ${surfaceParam}` });
      }
      if (kindParam && !DOCUMENT_KINDS.includes(kindParam as DocumentKind)) {
        return res.status(400).json({ error: `unknown kind: ${kindParam}` });
      }
      // First-read migration: idempotently back-fill `documents` rows for any
      // legacy `uploaded_documents` that haven't been migrated yet, so a
      // single canonical query below returns both new and legacy content
      // (including patient-scoped reads via `patient_screening_id`).
      await migrateLegacyUploadedDocuments();

      const docs = await storage.listCurrentDocuments({
        surface: surfaceParam ? (surfaceParam as DocumentSurface) : undefined,
        kind: kindParam ? (kindParam as DocumentKind) : undefined,
        patientScreeningId: typeof patientScreeningId === "number" ? patientScreeningId : undefined,
      });
      const shaped = await Promise.all(docs.map((d) => shapeDocument(d, basePath)));
      res.json(shaped);
    } catch (e: any) {
      console.error(`[${basePath}] list failed:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/meta`, requireAuth, (_req, res) => {
    res.json({
      kinds: DOCUMENT_KINDS,
      signatureRequirements: DOCUMENT_SIGNATURE_REQUIREMENTS,
      surfaces: DOCUMENT_SURFACES,
    });
  });

  app.get(`${basePath}/:id`, requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc || doc.deletedAt !== null) return res.status(404).json({ error: "Not found" });
      res.json(await shapeDocument(doc, basePath));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/:id/versions`, requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const head = await storage.getDocument(id);
      if (!head || head.deletedAt !== null) return res.status(404).json({ error: "Not found" });
      const chain = await storage.getDocumentVersionChain(id);
      const shaped = await Promise.all(chain.map((d) => shapeDocument(d, basePath)));
      res.json(shaped);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(`${basePath}/:id/file`, requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      // Soft-deleted docs must not be retrievable by direct id either.
      if (doc.deletedAt !== null) return res.status(404).json({ error: "Not found" });

      let blob = await getLatestBlobForOwner("library_document", doc.id);

      // Legacy fallback: rows back-filled from `uploaded_documents` have no
      // library_document blob of their own — their bytes still live under
      // ownerType "uploaded_document". Always resolve the Drive link up front
      // for legacy-migrated rows so we can redirect any time a local byte
      // read fails, not only when the blob row itself is missing.
      let legacyDriveLink: string | null = null;
      if (doc.sourceNotes && doc.sourceNotes.startsWith(LEGACY_SOURCE_PREFIX)) {
        const legacyIdStr = doc.sourceNotes.slice(LEGACY_SOURCE_PREFIX.length);
        const legacyId = parseInt(legacyIdStr, 10);
        if (!Number.isNaN(legacyId)) {
          const legacyRow = await db.select()
            .from(uploadedDocuments)
            .where(eq(uploadedDocuments.id, legacyId))
            .limit(1);
          legacyDriveLink = legacyRow[0]?.driveWebViewLink ?? null;
          if (!blob) {
            blob = await getLatestBlobForOwner("uploaded_document", legacyId);
          }
        }
      }

      if (!blob) {
        // No blob row at all — redirect to Drive if we have a link.
        if (legacyDriveLink) return res.redirect(legacyDriveLink);
        return res.status(404).json({ error: "File not found" });
      }
      const data = await readBlob(blob.id);
      if (!data) {
        // Blob row exists but local bytes are missing/unreadable — fall back
        // to the Drive link rather than 404'ing the consumer.
        if (legacyDriveLink) return res.redirect(legacyDriveLink);
        return res.status(404).json({ error: "File not found" });
      }

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

  // ── Admin writes ──────────────────────────────────────────────────────
  app.post(basePath, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const title = String(req.body.title ?? "").trim();
      const description = String(req.body.description ?? "").trim();
      const kind = String(req.body.kind ?? "");
      const signatureRequirement = String(req.body.signatureRequirement ?? "none");
      const surfacesRaw = req.body.surfaces;
      const patientScreeningIdRaw = req.body.patientScreeningId;
      const facility = req.body.facility ? String(req.body.facility).slice(0, 200) : null;
      const sourceNotes = req.body.sourceNotes ? String(req.body.sourceNotes).slice(0, 1000) : null;

      if (!title) return res.status(400).json({ error: "title is required" });
      if (title.length > 200) return res.status(400).json({ error: "title too long (max 200)" });
      if (description.length > 1000) return res.status(400).json({ error: "description too long (max 1000)" });
      if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) {
        return res.status(400).json({ error: `kind must be one of: ${DOCUMENT_KINDS.join(", ")}` });
      }
      if (!(DOCUMENT_SIGNATURE_REQUIREMENTS as readonly string[]).includes(signatureRequirement)) {
        return res.status(400).json({ error: `signatureRequirement must be one of: ${DOCUMENT_SIGNATURE_REQUIREMENTS.join(", ")}` });
      }
      const sigReq = signatureRequirement as DocumentSignatureRequirement;

      let patientScreeningId: number | null = null;
      if (patientScreeningIdRaw !== undefined && patientScreeningIdRaw !== null && String(patientScreeningIdRaw).length > 0) {
        const parsed = parseInt(String(patientScreeningIdRaw), 10);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ error: "patientScreeningId must be a number" });
        }
        patientScreeningId = parsed;
      }

      const contentType: string = req.file.mimetype || "application/octet-stream";
      if (!ALLOWED_MIME.has(contentType)) {
        return res.status(400).json({ error: `Unsupported file type: ${contentType}` });
      }
      const buffer: Buffer = req.file.buffer;
      const filename: string = req.file.originalname || "document";

      const surfaces = parseSurfacesField(surfacesRaw);
      for (const s of surfaces) {
        if (!DOCUMENT_SURFACES.includes(s as DocumentSurface)) {
          return res.status(400).json({ error: `unknown surface: ${s}` });
        }
      }

      const doc = await storage.createDocument({
        title,
        description,
        kind: kind as DocumentKind,
        signatureRequirement: sigReq,
        filename,
        contentType,
        sizeBytes: buffer.length,
        patientScreeningId,
        facility,
        sourceNotes,
        createdByUserId: req.session.userId ?? null,
      });

      try {
        const blob = await saveBlob({
          ownerType: "library_document",
          ownerId: doc.id,
          filename,
          contentType,
          buffer,
        });
        for (const s of surfaces) {
          await storage.addDocumentAssignment(doc.id, s as DocumentSurface);
        }
        // Enqueue Drive/S3 sync via existing outbox pipeline so library
        // uploads are durable and propagate to the configured file storage.
        try {
          await enqueueDriveFile({
            blobId: blob.id,
            facility: facility ?? null,
            patientName: null,
            ancillaryType: null,
            docKind: doc.kind,
            filename,
          });
        } catch (outboxErr: any) {
          console.error(`[${basePath}] outbox enqueue failed (non-fatal) doc=${doc.id}:`, outboxErr.message);
        }
        res.status(201).json(await shapeDocument(doc, basePath));
      } catch (blobErr: any) {
        await storage.deleteDocument(doc.id).catch(() => {});
        throw blobErr;
      }
    } catch (e: any) {
      console.error(`[${basePath}] upload failed:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // Replace a document with a new version. Inherits assignments + bumps version.
  app.post(`${basePath}/:id/supersede`, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      const oldId = parseInt(String(req.params.id), 10);
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
        signatureRequirement: oldDoc.signatureRequirement as DocumentSignatureRequirement,
        filename,
        contentType,
        sizeBytes: buffer.length,
        patientScreeningId: oldDoc.patientScreeningId,
        facility: oldDoc.facility,
        sourceNotes: oldDoc.sourceNotes,
        createdByUserId: req.session.userId ?? null,
      });

      try {
        const blob = await saveBlob({
          ownerType: "library_document",
          ownerId: newDoc.id,
          filename,
          contentType,
          buffer,
        });
        await storage.supersedeDocument(oldId, newDoc.id);
        try {
          await enqueueDriveFile({
            blobId: blob.id,
            facility: newDoc.facility ?? null,
            patientName: null,
            ancillaryType: null,
            docKind: newDoc.kind,
            filename,
          });
        } catch (outboxErr: any) {
          console.error(`[${basePath}] outbox enqueue failed (non-fatal) doc=${newDoc.id}:`, outboxErr.message);
        }
        const refreshed = await storage.getDocument(newDoc.id);
        res.status(201).json(await shapeDocument(refreshed!, basePath));
      } catch (err: any) {
        await storage.deleteDocument(newDoc.id).catch(() => {});
        throw err;
      }
    } catch (e: any) {
      console.error(`[${basePath}] supersede failed:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // Add a single surface assignment (additive).
  app.post(`${basePath}/:id/assignments`, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const surface = String(req.body?.surface ?? "");
      if (!DOCUMENT_SURFACES.includes(surface as DocumentSurface)) {
        return res.status(400).json({ error: `unknown surface: ${surface}` });
      }
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      await storage.addDocumentAssignment(id, surface as DocumentSurface);
      res.json(await shapeDocument(doc, basePath));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Replace the full set of surface assignments atomically.
  app.patch(`${basePath}/:id/assignments`, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const surfaces = parseSurfacesField(req.body?.surfaces);
      for (const s of surfaces) {
        if (!DOCUMENT_SURFACES.includes(s as DocumentSurface)) {
          return res.status(400).json({ error: `unknown surface: ${s}` });
        }
      }
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      await storage.replaceDocumentAssignments(id, surfaces as DocumentSurface[]);
      res.json(await shapeDocument(doc, basePath));
    } catch (e: any) {
      console.error(`[${basePath}] patch assignments failed:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete(`${basePath}/:id/assignments/:surface`, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const surface = String(req.params.surface);
      if (!DOCUMENT_SURFACES.includes(surface as DocumentSurface)) {
        return res.status(400).json({ error: `unknown surface: ${surface}` });
      }
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      await storage.removeDocumentAssignment(id, surface as DocumentSurface);
      res.json(await shapeDocument(doc, basePath));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Soft-delete: marks deletedAt; the row remains for audit/version history
  // but is hidden from list/surface reads. Refuses superseded versions to
  // preserve the version chain.
  app.delete(`${basePath}/:id`, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Not found" });
      if (doc.deletedAt !== null) {
        return res.status(204).end(); // already deleted, idempotent
      }
      if (doc.supersededByDocumentId !== null) {
        return res.status(409).json({
          error: "Cannot delete a superseded version. Delete the current version instead.",
        });
      }
      await storage.softDeleteDocument(id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

export function registerDocumentLibraryRoutes(app: Express) {
  // Canonical path per task spec.
  mountRoutes(app, "/api/documents-library");
  // Backward-compat alias used by the initial UI implementation.
  mountRoutes(app, "/api/document-library");
}

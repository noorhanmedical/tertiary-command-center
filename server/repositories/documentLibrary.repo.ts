import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  documents,
  documentSurfaceAssignments,
  type Document,
  type InsertDocument,
  type DocumentSurfaceAssignment,
  type DocumentSurface,
  type DocumentKind,
} from "@shared/schema/documents";

export interface IDocumentLibraryRepository {
  create(record: InsertDocument): Promise<Document>;
  getById(id: number): Promise<Document | undefined>;
  listCurrent(filters?: { kind?: DocumentKind; surface?: DocumentSurface; patientScreeningId?: number }): Promise<Document[]>;
  listForSurface(surface: DocumentSurface, opts?: { patientScreeningId?: number; kind?: DocumentKind }): Promise<Document[]>;
  versionChain(currentDocId: number): Promise<Document[]>;
  supersede(oldId: number, newId: number): Promise<void>;
  listAssignments(documentId: number): Promise<DocumentSurfaceAssignment[]>;
  addAssignment(documentId: number, surface: DocumentSurface): Promise<DocumentSurfaceAssignment>;
  removeAssignment(documentId: number, surface: DocumentSurface): Promise<void>;
  replaceAssignments(documentId: number, surfaces: DocumentSurface[]): Promise<DocumentSurfaceAssignment[]>;
  softDelete(id: number): Promise<void>;
  hardDelete(id: number): Promise<void>;
}

export class DbDocumentLibraryRepository implements IDocumentLibraryRepository {
  async create(record: InsertDocument): Promise<Document> {
    const [row] = await db.insert(documents).values(record).returning();
    return row;
  }

  async getById(id: number): Promise<Document | undefined> {
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    return row;
  }

  async listCurrent(filters?: { kind?: DocumentKind; surface?: DocumentSurface; patientScreeningId?: number }): Promise<Document[]> {
    const conditions = [
      sql`${documents.supersededByDocumentId} IS NULL`,
      sql`${documents.deletedAt} IS NULL`,
    ];
    if (filters?.kind) conditions.push(eq(documents.kind, filters.kind));
    if (typeof filters?.patientScreeningId === "number") {
      conditions.push(eq(documents.patientScreeningId, filters.patientScreeningId));
    } else {
      conditions.push(sql`${documents.patientScreeningId} IS NULL`);
    }
    if (filters?.surface) {
      const rows = await db
        .select({ doc: documents })
        .from(documentSurfaceAssignments)
        .innerJoin(documents, eq(documents.id, documentSurfaceAssignments.documentId))
        .where(and(eq(documentSurfaceAssignments.surface, filters.surface), ...conditions))
        .orderBy(desc(documents.createdAt));
      return rows.map((r) => r.doc);
    }
    return db.select().from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt));
  }

  async listForSurface(
    surface: DocumentSurface,
    opts?: { patientScreeningId?: number; kind?: DocumentKind },
  ): Promise<Document[]> {
    return this.listCurrent({ surface, kind: opts?.kind, patientScreeningId: opts?.patientScreeningId });
  }

  async versionChain(currentDocId: number): Promise<Document[]> {
    const chain: Document[] = [];
    const seen = new Set<number>();
    let pointerId = currentDocId;
    while (true) {
      const [predecessor] = await db.select().from(documents)
        .where(eq(documents.supersededByDocumentId, pointerId)).limit(1);
      if (!predecessor || seen.has(predecessor.id)) break;
      seen.add(predecessor.id);
      chain.unshift(predecessor);
      pointerId = predecessor.id;
    }
    const [current] = await db.select().from(documents).where(eq(documents.id, currentDocId));
    if (current) chain.push(current);
    return chain;
  }

  async supersede(oldId: number, newId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM documents WHERE id = ${oldId} FOR UPDATE`);
      const [oldDoc] = await tx.select().from(documents).where(eq(documents.id, oldId));
      if (!oldDoc) throw new Error(`document ${oldId} not found`);
      if (oldDoc.supersededByDocumentId !== null) {
        throw new Error(`document ${oldId} is already superseded`);
      }
      await tx.update(documents)
        .set({ supersededByDocumentId: newId })
        .where(eq(documents.id, oldId));
      await tx.update(documents)
        .set({ version: oldDoc.version + 1 })
        .where(eq(documents.id, newId));
      const oldAssignments = await tx.select().from(documentSurfaceAssignments)
        .where(eq(documentSurfaceAssignments.documentId, oldId));
      for (const a of oldAssignments) {
        await tx.insert(documentSurfaceAssignments)
          .values({ documentId: newId, surface: a.surface })
          .onConflictDoNothing();
      }
    });
  }

  async listAssignments(documentId: number): Promise<DocumentSurfaceAssignment[]> {
    return db.select().from(documentSurfaceAssignments)
      .where(eq(documentSurfaceAssignments.documentId, documentId));
  }

  async addAssignment(documentId: number, surface: DocumentSurface): Promise<DocumentSurfaceAssignment> {
    const [row] = await db.insert(documentSurfaceAssignments)
      .values({ documentId, surface })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await db.select().from(documentSurfaceAssignments)
      .where(and(
        eq(documentSurfaceAssignments.documentId, documentId),
        eq(documentSurfaceAssignments.surface, surface),
      ));
    return existing;
  }

  async removeAssignment(documentId: number, surface: DocumentSurface): Promise<void> {
    await db.delete(documentSurfaceAssignments)
      .where(and(
        eq(documentSurfaceAssignments.documentId, documentId),
        eq(documentSurfaceAssignments.surface, surface),
      ));
  }

  async replaceAssignments(documentId: number, surfaces: DocumentSurface[]): Promise<DocumentSurfaceAssignment[]> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(documentSurfaceAssignments)
        .where(eq(documentSurfaceAssignments.documentId, documentId));
      const wanted = new Set<string>(surfaces);
      const have = new Set<string>(existing.map((a) => a.surface));
      const toRemove = existing.filter((a) => !wanted.has(a.surface));
      const toAdd = surfaces.filter((s) => !have.has(s));
      for (const a of toRemove) {
        await tx.delete(documentSurfaceAssignments)
          .where(eq(documentSurfaceAssignments.id, a.id));
      }
      for (const s of toAdd) {
        await tx.insert(documentSurfaceAssignments)
          .values({ documentId, surface: s })
          .onConflictDoNothing();
      }
      return tx.select().from(documentSurfaceAssignments)
        .where(eq(documentSurfaceAssignments.documentId, documentId));
    });
  }

  async softDelete(id: number): Promise<void> {
    await db.update(documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(documents.id, id), sql`${documents.deletedAt} IS NULL`));
  }

  async hardDelete(id: number): Promise<void> {
    await db.update(documents)
      .set({ supersededByDocumentId: null })
      .where(eq(documents.supersededByDocumentId, id));
    await db.delete(documents).where(eq(documents.id, id));
  }
}

export const documentLibraryRepository: IDocumentLibraryRepository = new DbDocumentLibraryRepository();

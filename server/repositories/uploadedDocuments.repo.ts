import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import {
  uploadedDocuments,
  type UploadedDocument,
  type InsertUploadedDocument,
} from "@shared/schema/documents";

export interface IUploadedDocumentsRepository {
  save(record: InsertUploadedDocument): Promise<UploadedDocument>;
  listAll(): Promise<UploadedDocument[]>;
  getById(id: number): Promise<UploadedDocument | undefined>;
}

export class DbUploadedDocumentsRepository implements IUploadedDocumentsRepository {
  async save(record: InsertUploadedDocument): Promise<UploadedDocument> {
    const [result] = await db.insert(uploadedDocuments).values(record).returning();
    return result;
  }

  async listAll(): Promise<UploadedDocument[]> {
    return db.select().from(uploadedDocuments).orderBy(desc(uploadedDocuments.uploadedAt));
  }

  async getById(id: number): Promise<UploadedDocument | undefined> {
    const [row] = await db.select().from(uploadedDocuments).where(eq(uploadedDocuments.id, id));
    return row;
  }
}

export const uploadedDocumentsRepository: IUploadedDocumentsRepository = new DbUploadedDocumentsRepository();

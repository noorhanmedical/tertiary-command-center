import { db } from "../db";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { ptoRequests, type PtoRequest, type InsertPtoRequest } from "@shared/schema/pto";

export interface PtoFilters {
  userId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}

export interface IPtoRepository {
  create(record: InsertPtoRequest): Promise<PtoRequest>;
  list(filters?: PtoFilters): Promise<PtoRequest[]>;
  getById(id: number): Promise<PtoRequest | undefined>;
  review(id: number, status: "approved" | "denied", reviewedBy: string): Promise<PtoRequest | undefined>;
  remove(id: number): Promise<void>;
}

export class DbPtoRepository implements IPtoRepository {
  async create(record: InsertPtoRequest): Promise<PtoRequest> {
    const [created] = await db.insert(ptoRequests).values({
      userId: record.userId,
      startDate: record.startDate,
      endDate: record.endDate,
      note: record.note ?? null,
    }).returning();
    return created;
  }

  async list(filters: PtoFilters = {}): Promise<PtoRequest[]> {
    const conditions = [];
    if (filters.userId) conditions.push(eq(ptoRequests.userId, filters.userId));
    if (filters.status) conditions.push(eq(ptoRequests.status, filters.status));
    if (filters.fromDate) conditions.push(gte(ptoRequests.endDate, filters.fromDate));
    if (filters.toDate) conditions.push(lte(ptoRequests.startDate, filters.toDate));
    return db.select().from(ptoRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ptoRequests.createdAt));
  }

  async getById(id: number): Promise<PtoRequest | undefined> {
    const [r] = await db.select().from(ptoRequests).where(eq(ptoRequests.id, id));
    return r;
  }

  async review(id: number, status: "approved" | "denied", reviewedBy: string): Promise<PtoRequest | undefined> {
    const [updated] = await db.update(ptoRequests)
      .set({ status, reviewedBy, reviewedAt: new Date() })
      .where(eq(ptoRequests.id, id))
      .returning();
    return updated;
  }

  async remove(id: number): Promise<void> {
    await db.delete(ptoRequests).where(eq(ptoRequests.id, id));
  }
}

export const ptoRepository: IPtoRepository = new DbPtoRepository();

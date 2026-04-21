import { db } from "../db";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { auditLog, type AuditLog, type InsertAuditLog } from "@shared/schema/audit";

export interface AuditLogFilters {
  userId?: string;
  entityType?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

export interface IAuditRepository {
  create(record: InsertAuditLog): Promise<AuditLog>;
  list(filters?: AuditLogFilters): Promise<AuditLog[]>;
}

export class DbAuditRepository implements IAuditRepository {
  async create(record: InsertAuditLog): Promise<AuditLog> {
    const [entry] = await db.insert(auditLog).values(record).returning();
    return entry;
  }

  async list(filters: AuditLogFilters = {}): Promise<AuditLog[]> {
    const conditions = [];
    if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId));
    if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
    if (filters.fromDate) conditions.push(gte(auditLog.createdAt, filters.fromDate));
    if (filters.toDate) conditions.push(lte(auditLog.createdAt, filters.toDate));

    return db.select().from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(filters.limit ?? 200);
  }
}

export const auditRepository: IAuditRepository = new DbAuditRepository();

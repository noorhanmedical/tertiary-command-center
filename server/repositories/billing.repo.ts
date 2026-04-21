import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import {
  billingRecords,
  type BillingRecord,
  type InsertBillingRecord,
} from "@shared/schema/billing";

export interface IBillingRepository {
  listAll(): Promise<BillingRecord[]>;
  getByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined>;
  create(record: InsertBillingRecord): Promise<BillingRecord>;
  update(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined>;
  remove(id: number): Promise<void>;
}

export class DbBillingRepository implements IBillingRepository {
  async listAll(): Promise<BillingRecord[]> {
    return db.select().from(billingRecords).orderBy(desc(billingRecords.createdAt));
  }

  async getByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined> {
    const [result] = await db.select().from(billingRecords)
      .where(and(eq(billingRecords.patientId, patientId), eq(billingRecords.service, service)));
    return result;
  }

  async create(record: InsertBillingRecord): Promise<BillingRecord> {
    const [result] = await db.insert(billingRecords).values(record).returning();
    return result;
  }

  async update(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined> {
    const [result] = await db.update(billingRecords).set(updates).where(eq(billingRecords.id, id)).returning();
    return result;
  }

  async remove(id: number): Promise<void> {
    await db.delete(billingRecords).where(eq(billingRecords.id, id));
  }
}

export const billingRepository: IBillingRepository = new DbBillingRepository();

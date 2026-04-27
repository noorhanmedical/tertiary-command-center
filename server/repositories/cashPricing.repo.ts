import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  cashPriceSettings,
  type CashPriceSetting,
  type InsertCashPriceSetting,
} from "@shared/schema/cashPricing";

export type ListCashPriceSettingsFilters = {
  serviceType?: string;
  facilityId?: string;
  payerType?: string;
  active?: boolean;
};

export async function createCashPriceSetting(
  input: InsertCashPriceSetting,
): Promise<CashPriceSetting> {
  const [result] = await db.insert(cashPriceSettings).values(input).returning();
  return result;
}

export async function updateCashPriceSetting(
  id: number,
  updates: Partial<InsertCashPriceSetting>,
): Promise<CashPriceSetting | undefined> {
  const [result] = await db
    .update(cashPriceSettings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(cashPriceSettings.id, id))
    .returning();
  return result;
}

export async function getCashPriceSettingById(id: number): Promise<CashPriceSetting | undefined> {
  const [result] = await db
    .select()
    .from(cashPriceSettings)
    .where(eq(cashPriceSettings.id, id))
    .limit(1);
  return result;
}

export async function listCashPriceSettings(
  filters: ListCashPriceSettingsFilters = {},
  limit = 100,
): Promise<CashPriceSetting[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.serviceType) conditions.push(eq(cashPriceSettings.serviceType, filters.serviceType));
  if (filters.facilityId) conditions.push(eq(cashPriceSettings.facilityId, filters.facilityId));
  if (filters.payerType) conditions.push(eq(cashPriceSettings.payerType, filters.payerType));
  if (filters.active !== undefined) conditions.push(eq(cashPriceSettings.active, filters.active));

  const query = db.select().from(cashPriceSettings).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(cashPriceSettings.createdAt)).limit(safeLimit)
    : query.orderBy(desc(cashPriceSettings.createdAt)).limit(safeLimit);
}

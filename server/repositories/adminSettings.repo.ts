import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  adminSettings,
  type AdminSetting,
  type InsertAdminSetting,
} from "@shared/schema/adminSettings";

export type ListAdminSettingsFilters = {
  settingDomain?: string;
  settingKey?: string;
  facilityId?: string;
  userId?: string;
  active?: boolean;
};

export async function createAdminSetting(
  input: InsertAdminSetting,
): Promise<AdminSetting> {
  const [result] = await db
    .insert(adminSettings)
    .values(input)
    .returning();
  return result;
}

export async function updateAdminSetting(
  id: number,
  updates: Partial<InsertAdminSetting>,
): Promise<AdminSetting | undefined> {
  const [result] = await db
    .update(adminSettings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(adminSettings.id, id))
    .returning();
  return result;
}

export async function getAdminSettingById(id: number): Promise<AdminSetting | undefined> {
  const [result] = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.id, id))
    .limit(1);
  return result;
}

export async function listAdminSettings(
  filters: ListAdminSettingsFilters = {},
  limit = 100,
): Promise<AdminSetting[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.settingDomain) conditions.push(eq(adminSettings.settingDomain, filters.settingDomain));
  if (filters.settingKey) conditions.push(eq(adminSettings.settingKey, filters.settingKey));
  if (filters.facilityId) conditions.push(eq(adminSettings.facilityId, filters.facilityId));
  if (filters.userId) conditions.push(eq(adminSettings.userId, filters.userId));
  if (filters.active !== undefined) conditions.push(eq(adminSettings.active, filters.active));

  const query = db.select().from(adminSettings).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(adminSettings.createdAt)).limit(safeLimit)
    : query.orderBy(desc(adminSettings.createdAt)).limit(safeLimit);
}

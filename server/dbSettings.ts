import { db } from "./db";
import { appSettings } from "@shared/schema";
import { eq, like } from "drizzle-orm";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

export async function deleteSettingsByPrefix(prefix: string): Promise<number> {
  const result = await db.delete(appSettings).where(like(appSettings.key, `${prefix}%`));
  return result.rowCount ?? 0;
}

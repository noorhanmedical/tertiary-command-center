import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import {
  workspacePrefsTable,
  type WorkspacePrefsRow,
} from "@shared/schema/portalPrefs";

export async function getWorkspacePrefsForUser(
  userId: string,
): Promise<WorkspacePrefsRow | null> {
  const rows = await db
    .select()
    .from(workspacePrefsTable)
    .where(eq(workspacePrefsTable.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertWorkspacePrefsForUser(
  userId: string,
  prefs: unknown,
): Promise<WorkspacePrefsRow> {
  const rows = await db
    .insert(workspacePrefsTable)
    .values({ userId, prefs })
    .onConflictDoUpdate({
      target: workspacePrefsTable.userId,
      set: { prefs, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .returning();
  return rows[0];
}

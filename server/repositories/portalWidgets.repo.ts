import { db } from "../db";
import { eq, asc } from "drizzle-orm";
import {
  portalWidgets,
  type PortalWidget,
  type InsertPortalWidget,
} from "@shared/schema/portalWidgets";

export async function listWidgetsForUser(userId: string): Promise<PortalWidget[]> {
  return db
    .select()
    .from(portalWidgets)
    .where(eq(portalWidgets.userId, userId))
    .orderBy(asc(portalWidgets.createdAt));
}

/**
 * Replace the full widget set for a user in one transaction. Mirrors the
 * previous localStorage write-through semantics (the whole array is persisted
 * on every mutation) while keeping the store server-authoritative.
 */
export async function replaceWidgetsForUser(
  userId: string,
  widgets: Omit<InsertPortalWidget, "userId">[],
): Promise<PortalWidget[]> {
  return db.transaction(async (tx) => {
    await tx.delete(portalWidgets).where(eq(portalWidgets.userId, userId));
    if (widgets.length === 0) return [];
    const rows = widgets.map((w) => ({ ...w, userId }));
    await tx.insert(portalWidgets).values(rows);
    return tx
      .select()
      .from(portalWidgets)
      .where(eq(portalWidgets.userId, userId))
      .orderBy(asc(portalWidgets.createdAt));
  });
}

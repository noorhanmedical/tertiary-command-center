import { db } from "../db";
import { eq, and, asc, inArray } from "drizzle-orm";
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
 * Incrementally apply widget changes for a user: upsert the given widgets and
 * delete the given ids, all in one transaction. Only rows named in `upserts`
 * or `deletes` are touched — widgets the caller never mentions are left alone.
 *
 * This replaces the previous delete-all-then-insert "replace" semantics, which
 * were last-write-wins: if the same user had the portal open on two devices,
 * one device's full-set save would silently wipe notes the other device had
 * created or edited. With per-widget upsert/delete, two devices editing
 * *different* notes no longer clobber each other — each save only affects the
 * notes that actually changed on that device.
 */
export async function applyWidgetChangesForUser(
  userId: string,
  upserts: Omit<InsertPortalWidget, "userId">[],
  deleteIds: string[],
): Promise<PortalWidget[]> {
  return db.transaction(async (tx) => {
    if (deleteIds.length > 0) {
      await tx
        .delete(portalWidgets)
        .where(and(eq(portalWidgets.userId, userId), inArray(portalWidgets.id, deleteIds)));
    }
    for (const w of upserts) {
      const now = new Date();
      await tx
        .insert(portalWidgets)
        .values({ ...w, userId, updatedAt: now })
        .onConflictDoUpdate({
          target: [portalWidgets.userId, portalWidgets.id],
          set: {
            type: w.type,
            x: w.x,
            y: w.y,
            color: w.color,
            text: w.text,
            collapsed: w.collapsed,
            patientContext: w.patientContext ?? null,
            createdBy: w.createdBy,
            updatedAt: now,
          },
        });
    }
    return tx
      .select()
      .from(portalWidgets)
      .where(eq(portalWidgets.userId, userId))
      .orderBy(asc(portalWidgets.createdAt));
  });
}

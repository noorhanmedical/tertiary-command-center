// portalPrefs — Team Portal workspace preferences, persisted per user.
//
// One row per user holding the serializable WorkspacePrefs object (default
// tray tab, sticky-note visibility, pinned panels, playground layout,
// calendar behavior) as jsonb. The owning user always comes from the server
// session, never the client, so prefs can never bleed across users.
//
// Stored as a single jsonb blob (validated with zod at the route) rather
// than one column per pref so adding a preference never needs a migration.

import {
  sql, pgTable, varchar, jsonb, timestamp, createInsertSchema, z,
} from "./_common";
import { users } from "./users";

export const workspacePrefsTable = pgTable("workspace_prefs", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefs: jsonb("prefs").notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertWorkspacePrefsSchema = createInsertSchema(workspacePrefsTable).omit({
  updatedAt: true,
});

export type WorkspacePrefsRow = typeof workspacePrefsTable.$inferSelect;
export type InsertWorkspacePrefsRow = z.infer<typeof insertWorkspacePrefsSchema>;

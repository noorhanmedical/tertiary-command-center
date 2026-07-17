// portalWidgets — Team Portal Playground sticky notes / widgets (Task #657).
//
// Per-user persistence for the floating Playground widgets (sticky notes,
// email launcher cards, team-chat draft cards). Previously these lived only
// in localStorage keyed by user id, so they survived a refresh but never
// synced across devices/browsers and were lost when storage was cleared.
//
// Each row is one widget. The `id` is the client-generated widget id
// (`w{timestamp}_{seq}`) so it stays stable across the optimistic UI and the
// server round-trip. Widgets are scoped to the owning user via `userId`.

import {
  sql, pgTable, primaryKey, text, varchar, integer, boolean, jsonb, timestamp,
  index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";

// The `id` is the CLIENT-generated widget id (`w{timestamp}_{seq}`) and is
// only unique WITHIN a user's set, so the primary key is composite on
// (userId, id). This lets two users independently generate the same id
// without colliding, while the delete-all-then-insert replace still keys
// each row deterministically inside a single user's bucket.
export const portalWidgets = pgTable("portal_widgets", {
  id: text("id").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  x: integer("x").notNull().default(0),
  y: integer("y").notNull().default(0),
  color: text("color").notNull().default("yellow"),
  text: text("text").notNull().default(""),
  collapsed: boolean("collapsed").notNull().default(false),
  patientContext: jsonb("patient_context"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("idx_portal_widgets_user_id").on(table.userId),
]);

export const insertPortalWidgetSchema = createInsertSchema(portalWidgets).omit({
  createdAt: true,
  updatedAt: true,
});

export type PortalWidget = typeof portalWidgets.$inferSelect;
export type InsertPortalWidget = z.infer<typeof insertPortalWidgetSchema>;

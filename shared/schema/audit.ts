import { sql, pgTable, serial, text, varchar, timestamp, jsonb, index, createInsertSchema, z } from "./_common";
import { users } from "./users";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_audit_log_user_id").on(table.userId),
  index("idx_audit_log_entity_type").on(table.entityType),
  index("idx_audit_log_created_at").on(table.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

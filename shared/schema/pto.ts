import { sql, pgTable, serial, text, varchar, timestamp, index, createInsertSchema, z } from "./_common";
import { users } from "./users";

export const PTO_STATUSES = ["pending", "approved", "denied"] as const;
export type PtoStatus = typeof PTO_STATUSES[number];

export const ptoRequests = pgTable("pto_requests", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pto_requests_user_id").on(table.userId),
  index("idx_pto_requests_status").on(table.status),
  index("idx_pto_requests_dates").on(table.startDate, table.endDate),
]);

export const insertPtoRequestSchema = createInsertSchema(ptoRequests).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  status: true,
}).extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  note: z.string().max(500).optional().nullable(),
});

export type PtoRequest = typeof ptoRequests.$inferSelect;
export type InsertPtoRequest = z.infer<typeof insertPtoRequestSchema>;

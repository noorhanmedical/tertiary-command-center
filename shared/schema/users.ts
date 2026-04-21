import { sql, pgTable, varchar, text, boolean, createInsertSchema, z } from "./_common";

export const USER_ROLES = ["admin", "clinician", "scheduler", "biller", "technician", "liaison"] as const;
export type UserRole = typeof USER_ROLES[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("clinician"),
  active: boolean("active").notNull().default(true),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
}).extend({
  role: z.enum(USER_ROLES).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

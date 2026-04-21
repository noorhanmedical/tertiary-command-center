import { pgTable, text, createInsertSchema, z } from "./_common";

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettings);
export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;

import {
  sql, pgTable, serial, text, varchar, boolean, timestamp, jsonb, index,
  uniqueIndex, createInsertSchema, z,
} from "./_common";
import { users } from "./users";

export const ADMIN_SETTING_DOMAINS = [
  "facility",
  "team_member",
  "scheduler",
  "technician_liaison",
  "ultrasound_technician",
  "global_schedule",
  "engagement_center",
  "insurance",
  "cooldown",
  "scheduling_triage",
  "document_library",
  "billing",
  "invoice",
  "projected_invoice",
  "cash_price",
  "emr_integration",
  "ai",
  "audit",
] as const;
export type AdminSettingDomain = typeof ADMIN_SETTING_DOMAINS[number];

export const adminSettings = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  settingDomain: text("setting_domain").notNull(),
  settingKey: text("setting_key").notNull(),
  settingValue: jsonb("setting_value").notNull().default({}),
  facilityId: text("facility_id"),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_admin_settings_domain").on(table.settingDomain),
  index("idx_admin_settings_key").on(table.settingKey),
  index("idx_admin_settings_facility_id").on(table.facilityId),
  index("idx_admin_settings_user_id").on(table.userId),
  index("idx_admin_settings_active").on(table.active),
  uniqueIndex("idx_admin_settings_domain_key_facility_user").on(
    table.settingDomain, table.settingKey, table.facilityId, table.userId,
  ),
]);

export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AdminSetting = typeof adminSettings.$inferSelect;
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;

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
  // Phase 2 hardening item 5 — test-specific override scope.
  // null when the row applies to all test types in the
  // (facility, user) context.
  testType: text("test_type"),
  active: boolean("active").notNull().default(true),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_admin_settings_domain").on(table.settingDomain),
  index("idx_admin_settings_key").on(table.settingKey),
  index("idx_admin_settings_facility_id").on(table.facilityId),
  index("idx_admin_settings_user_id").on(table.userId),
  index("idx_admin_settings_test_type").on(table.testType),
  index("idx_admin_settings_active").on(table.active),
  // The new unique constraint includes test_type so the same
  // (domain, key) can carry per-test overrides at facility / user
  // scope without colliding with the test-null base row.
  uniqueIndex("idx_admin_settings_domain_key_facility_user_test").on(
    table.settingDomain, table.settingKey, table.facilityId, table.userId, table.testType,
  ),
]);

export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AdminSetting = typeof adminSettings.$inferSelect;
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;

import {
  sql, pgTable, serial, text, boolean, timestamp, jsonb, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";

export const cashPriceSettings = pgTable("cash_price_settings", {
  id: serial("id").primaryKey(),
  serviceType: text("service_type").notNull(),
  facilityId: text("facility_id"),
  payerType: text("payer_type"),
  cashPrice: text("cash_price").notNull(),
  projectedPrice: text("projected_price"),
  active: boolean("active").notNull().default(true),
  effectiveDate: text("effective_date"),
  expirationDate: text("expiration_date"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cps_service_type").on(table.serviceType),
  index("idx_cps_facility_id").on(table.facilityId),
  index("idx_cps_payer_type").on(table.payerType),
  index("idx_cps_active").on(table.active),
  uniqueIndex("idx_cps_unique_price").on(table.serviceType, table.facilityId, table.payerType),
]);

export const insertCashPriceSettingSchema = createInsertSchema(cashPriceSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CashPriceSetting = typeof cashPriceSettings.$inferSelect;
export type InsertCashPriceSetting = z.infer<typeof insertCashPriceSettingSchema>;

import { sql, pgTable, serial, text, timestamp, index, createInsertSchema, z } from "./_common";

export const patientTestHistory = pgTable("patient_test_history", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  dob: text("dob"),
  testName: text("test_name").notNull(),
  dateOfService: text("date_of_service").notNull(),
  insuranceType: text("insurance_type").notNull().default("ppo"),
  clinic: text("clinic").notNull().default("NWPG"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_test_history_patient_name").on(table.patientName),
  index("idx_patient_test_history_date_of_service").on(table.dateOfService),
  index("idx_patient_test_history_name_dob_test_dos").on(
    table.patientName,
    table.dob,
    table.testName,
    table.dateOfService,
  ),
]);

export const insertTestHistorySchema = createInsertSchema(patientTestHistory).omit({
  id: true,
  createdAt: true,
});

export type PatientTestHistory = typeof patientTestHistory.$inferSelect;
export type InsertTestHistory = z.infer<typeof insertTestHistorySchema>;

export const patientReferenceData = pgTable("patient_reference_data", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  diagnoses: text("diagnoses"),
  history: text("history"),
  medications: text("medications"),
  age: text("age"),
  gender: text("gender"),
  insurance: text("insurance"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_reference_data_patient_name").on(table.patientName),
]);

export const insertPatientReferenceSchema = createInsertSchema(patientReferenceData).omit({
  id: true,
  createdAt: true,
});

export type PatientReference = typeof patientReferenceData.$inferSelect;
export type InsertPatientReference = z.infer<typeof insertPatientReferenceSchema>;

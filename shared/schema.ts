import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/chat";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const screeningBatches = pgTable("screening_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clinicianName: text("clinician_name"),
  patientCount: integer("patient_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertScreeningBatchSchema = createInsertSchema(screeningBatches).omit({
  id: true,
  createdAt: true,
});

export type ScreeningBatch = typeof screeningBatches.$inferSelect;
export type InsertScreeningBatch = z.infer<typeof insertScreeningBatchSchema>;

export const patientScreenings = pgTable("patient_screenings", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  time: text("time"),
  name: text("name").notNull(),
  age: integer("age"),
  gender: text("gender"),
  diagnoses: text("diagnoses"),
  history: text("history"),
  medications: text("medications"),
  notes: text("notes"),
  qualifyingTests: text("qualifying_tests").array(),
  reasoning: jsonb("reasoning"),
  cooldownTests: jsonb("cooldown_tests"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPatientScreeningSchema = createInsertSchema(patientScreenings).omit({
  id: true,
  createdAt: true,
});

export type PatientScreening = typeof patientScreenings.$inferSelect;
export type InsertPatientScreening = z.infer<typeof insertPatientScreeningSchema>;

export const patientTestHistory = pgTable("patient_test_history", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  testName: text("test_name").notNull(),
  dateOfService: text("date_of_service").notNull(),
  insuranceType: text("insurance_type").notNull().default("ppo"),
  clinic: text("clinic").notNull().default("NWPG"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

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
});

export const insertPatientReferenceSchema = createInsertSchema(patientReferenceData).omit({
  id: true,
  createdAt: true,
});

export type PatientReference = typeof patientReferenceData.$inferSelect;
export type InsertPatientReference = z.infer<typeof insertPatientReferenceSchema>;

export const testReasoningSchema = z.object({
  clinician_understanding: z.string(),
  patient_talking_points: z.string(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  qualifying_factors: z.array(z.string()).optional(),
  icd10_codes: z.array(z.string()).optional(),
});

export const patientScreeningResultSchema = z.object({
  time: z.string().optional(),
  name: z.string(),
  age: z.number().optional(),
  gender: z.string().optional(),
  diagnoses: z.string().optional(),
  history: z.string().optional(),
  medications: z.string().optional(),
  notes: z.string().optional(),
  qualifyingTests: z.array(z.string()),
  reasoning: z.record(z.string(), z.union([
    testReasoningSchema,
    z.string(),
  ])).optional(),
});

export type TestReasoning = z.infer<typeof testReasoningSchema>;
export type PatientScreeningResult = z.infer<typeof patientScreeningResultSchema>;

import { sql, pgTable, serial, text, integer, timestamp, index, createInsertSchema, z } from "./_common";
import { screeningBatches } from "./screening";

export const analysisJobs = pgTable("analysis_jobs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  totalPatients: integer("total_patients").notNull(),
  completedPatients: integer("completed_patients").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_analysis_jobs_batch_id").on(table.batchId),
  index("idx_analysis_jobs_status").on(table.status),
]);

export const insertAnalysisJobSchema = createInsertSchema(analysisJobs).omit({
  id: true,
  startedAt: true,
});

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type InsertAnalysisJob = z.infer<typeof insertAnalysisJobSchema>;

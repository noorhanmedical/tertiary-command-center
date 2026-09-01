import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb,
  uniqueIndex, index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";

// ─── Structured NEEDS COVERAGE state (Phase 3D / decision K8) ────────────────
//
// When a case cannot be assigned it stays CANONICALLY unassigned
// (patient_execution_cases.assignedTeamMemberId = NULL). This table is NOT a
// second ownership store — it only records the STRUCTURED reason a case is
// currently uncovered, so a manager can understand WHY and act. One row per
// execution case (upserted); cleared when the case gets an owner.
//
// The case's canonical priority is preserved on the execution case itself; we
// snapshot the P-level here only for at-a-glance manager triage.

export const NEEDS_COVERAGE_CATEGORIES = [
  "no_eligible_staff",       // nobody working / on roster to take it
  "capacity_exhausted",      // covering members are all at remaining capacity
  "facility_coverage_mismatch", // no working member covers the facility
  "absent_owner",            // prior owner absent (PTO/absence) and no reassign target
  "failed_redistribution",   // a redistribution attempt could not place it
  "manager_hold",            // a manager intentionally parked it
  "deactivated_owner",       // prior owner was deactivated (3E)
  "other",                   // explicit operational reason (see note)
] as const;
export type NeedsCoverageCategory = (typeof NEEDS_COVERAGE_CATEGORIES)[number];

export const needsCoverage = pgTable("needs_coverage", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id")
    .notNull()
    .references(() => patientExecutionCases.id, { onDelete: "cascade" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),
  category: text("category").notNull().default("other"),
  // Human-readable detail (from the allocator's explainUnplaced or a manager).
  reason: text("reason").notNull(),
  // Snapshot of the case's canonical P-level so priority is visible without a
  // join (the execution case remains the source of truth).
  priorityLevel: text("priority_level"),
  // Where the state came from — auto distribution, redistribution, manager.
  source: text("source").notNull().default("distribution"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // Set when the case leaves needs-coverage (got an owner / manager cleared).
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("uq_needs_coverage_execution_case").on(table.executionCaseId),
  index("idx_needs_coverage_category").on(table.category),
  index("idx_needs_coverage_facility").on(table.facilityId),
  index("idx_needs_coverage_resolved").on(table.resolvedAt),
]);

export const insertNeedsCoverageSchema = createInsertSchema(needsCoverage)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    category: z.enum(NEEDS_COVERAGE_CATEGORIES),
    reason: z.string().min(1).max(500),
  });

export type NeedsCoverage = typeof needsCoverage.$inferSelect;
export type InsertNeedsCoverage = z.infer<typeof insertNeedsCoverageSchema>;

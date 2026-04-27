import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";

export const ELIGIBILITY_STATUSES = [
  "preferred",
  "allowed",
  "requires_admin_approval",
  "blocked",
  "unknown",
] as const;
export type EligibilityStatus = typeof ELIGIBILITY_STATUSES[number];

export const APPROVAL_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "denied",
  "more_info_needed",
] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export const PRIORITY_CLASSES = [
  "straight_medicare",
  "ppo",
  "other",
  "unknown",
] as const;
export type PriorityClass = typeof PRIORITY_CLASSES[number];

export const insuranceEligibilityReviews = pgTable("insurance_eligibility_reviews", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  insuranceName: text("insurance_name"),
  insuranceType: text("insurance_type"),
  eligibilityStatus: text("eligibility_status").notNull().default("unknown"),
  approvalStatus: text("approval_status").notNull().default("not_required"),
  priorityClass: text("priority_class").notNull().default("unknown"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  note: text("note"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ier_execution_case_id").on(table.executionCaseId),
  index("idx_ier_patient_screening_id").on(table.patientScreeningId),
  index("idx_ier_facility_id").on(table.facilityId),
  index("idx_ier_eligibility_status").on(table.eligibilityStatus),
  index("idx_ier_approval_status").on(table.approvalStatus),
  index("idx_ier_priority_class").on(table.priorityClass),
  index("idx_ier_insurance_type").on(table.insuranceType),
]);

export const insertInsuranceEligibilityReviewSchema = createInsertSchema(insuranceEligibilityReviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsuranceEligibilityReview = typeof insuranceEligibilityReviews.$inferSelect;
export type InsertInsuranceEligibilityReview = z.infer<typeof insertInsuranceEligibilityReviewSchema>;

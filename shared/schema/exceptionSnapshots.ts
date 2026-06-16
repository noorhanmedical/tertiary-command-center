// exception_snapshots — Phase 3 PR 3.2.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  uniqueIndex, varchar, createInsertSchema, z,
} from "./_common";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { invoices } from "./invoices";
import { users } from "./users";

export const EXCEPTION_STATUSES = [
  "open", "acknowledged", "in_review", "resolved", "dismissed", "superseded",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_ENTITY_TYPES = [
  "execution_case", "patient_screening", "schedule_event",
  "invoice_readiness", "invoice_batch", "invoice", "denial", "facility",
] as const;
export type ExceptionEntityType = (typeof EXCEPTION_ENTITY_TYPES)[number];

export const exceptionSnapshots = pgTable("exception_snapshots", {
  id: serial("id").primaryKey(),
  exceptionKey: text("exception_key").notNull(),
  exceptionType: text("exception_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),
  testType: text("test_type"),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  recommendedOwnerRole: text("recommended_owner_role"),
  // PR 3.3 review fields (added here so the engine and review
  // service stay aligned).
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedRole: text("assigned_role"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolutionReason: text("resolution_reason"),
  dismissedReason: text("dismissed_reason"),
  // engine lifecycle
  detectedAt: timestamp("detected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  resolvedAt: timestamp("resolved_at"),
  supersededByEngine: integer("superseded_by_engine").notNull().default(0),
  sourceSnapshot: jsonb("source_snapshot").notNull().default({}),
  detectorVersion: text("detector_version"),
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_exception_snapshots_status").on(table.status),
  index("idx_exception_snapshots_type").on(table.exceptionType),
  index("idx_exception_snapshots_severity").on(table.severity),
  index("idx_exception_snapshots_facility_id").on(table.facilityId),
  index("idx_exception_snapshots_execution_case_id").on(table.executionCaseId),
  index("idx_exception_snapshots_invoice_id").on(table.invoiceId),
  uniqueIndex("idx_exception_snapshots_key").on(table.exceptionKey),
]);

export const insertExceptionSnapshotSchema = createInsertSchema(exceptionSnapshots).omit({
  id: true, createdAt: true, updatedAt: true, detectedAt: true, lastSeenAt: true,
});
export type ExceptionSnapshot = typeof exceptionSnapshots.$inferSelect;
export type InsertExceptionSnapshot = z.infer<typeof insertExceptionSnapshotSchema>;

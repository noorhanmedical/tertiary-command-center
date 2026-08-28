import {
  sql, pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb,
  index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { PLEXUS_TASK_PRIORITY_LEVELS } from "./plexus";

// ─── Call handoffs (Phase 3C / decision K6) ──────────────────────────────────
//
// A first-class entity for transferring / requesting ownership of a specific
// call-list case from one team member (PCS/ACS) to another. It is NOT a
// message — messaging only NOTIFIES the recipient (Phase 1 postSystemMessage);
// this row is the source of truth for the transfer, its priority, deadline,
// acknowledgement, and provenance (K8).
//
// LIVE OWNERSHIP still lives on patient_execution_cases.assignedTeamMemberId.
// Creating a handoff canonically reassigns that field to `toUserId`'s roster
// member; the handoff row records who/why/when + acknowledgement state so the
// manager timeline can reconstruct the transfer.

export const CALL_HANDOFF_STATUSES = [
  "pending",       // created, awaiting acknowledgement/action
  "acknowledged",  // recipient has acknowledged (required for P1/P2)
  "completed",     // recipient completed the underlying call/work
  "cancelled",     // sender/manager recalled it before completion
] as const;
export type CallHandoffStatus = (typeof CALL_HANDOFF_STATUSES)[number];

// Where the handoff originated — audit/provenance.
export const CALL_HANDOFF_SOURCES = [
  "peer",      // staff-initiated PCS→PCS handoff
  "manager",   // manager redistribution / manual assign
  "system",    // automated (e.g. absence/PTO redistribution follow-up)
] as const;
export type CallHandoffSource = (typeof CALL_HANDOFF_SOURCES)[number];

export const callHandoffs = pgTable("call_handoffs", {
  id: serial("id").primaryKey(),
  // The canonical case whose ownership is being handed off.
  executionCaseId: integer("execution_case_id")
    .notNull()
    .references(() => patientExecutionCases.id, { onDelete: "cascade" }),
  // Patient context (denormalized for display + PHI-safe joins).
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "set null" }),
  // Parties. from/to are login user ids (users.id); ownership on the case
  // spine is keyed by outreach_schedulers.id, resolved by the service.
  fromUserId: varchar("from_user_id").references(() => users.id, { onDelete: "set null" }),
  toUserId: varchar("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  facilityId: text("facility_id"),
  // Canonical P1..P5 (shared scale with plexus_tasks, decision K5).
  priorityLevel: text("priority_level").notNull().default("P3"),
  reason: text("reason").notNull(),
  note: text("note"),
  dueAt: timestamp("due_at"),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("peer"),
  // Manager override lets a P3–P5 handoff exceed a recipient's normal
  // capacity (P1/P2 may always exceed). Audited.
  managerOverride: boolean("manager_override").notNull().default(false),
  // Acknowledgement + lifecycle provenance (K10).
  viewedAt: timestamp("viewed_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledByUserId: varchar("cancelled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Optional free-form audit bag (previous owner id, messaging conv id, etc.).
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_call_handoffs_execution_case").on(table.executionCaseId),
  index("idx_call_handoffs_to_user").on(table.toUserId),
  index("idx_call_handoffs_from_user").on(table.fromUserId),
  index("idx_call_handoffs_status").on(table.status),
  index("idx_call_handoffs_priority").on(table.priorityLevel),
  index("idx_call_handoffs_facility").on(table.facilityId),
]);

export const insertCallHandoffSchema = createInsertSchema(callHandoffs)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    priorityLevel: z.enum(PLEXUS_TASK_PRIORITY_LEVELS),
    status: z.enum(CALL_HANDOFF_STATUSES).optional(),
    source: z.enum(CALL_HANDOFF_SOURCES).optional(),
    reason: z.string().min(1).max(500),
    note: z.string().max(2000).optional().nullable(),
  });

export type CallHandoff = typeof callHandoffs.$inferSelect;
export type InsertCallHandoff = z.infer<typeof insertCallHandoffSchema>;

// A handoff requires explicit acknowledgement when it is high-priority.
export function handoffRequiresAcknowledgement(
  priorityLevel: string | null | undefined,
): boolean {
  const pl = (priorityLevel ?? "").toUpperCase();
  return pl === "P1" || pl === "P2";
}

// P1/P2 may exceed a recipient's normal capacity; P3–P5 need managerOverride.
export function handoffMayExceedCapacity(
  priorityLevel: string | null | undefined,
  managerOverride: boolean,
): boolean {
  const pl = (priorityLevel ?? "").toUpperCase();
  return pl === "P1" || pl === "P2" || managerOverride;
}

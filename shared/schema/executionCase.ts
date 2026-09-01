import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index, varchar,
  createInsertSchema, z,
} from "./_common";
import { patientScreenings } from "./screening";
import { users } from "./users";
import { clinics } from "./clinics";

export const EXECUTION_CASE_SOURCES = [
  "manual_visit_upload",
  "outreach_import",
  "api_sync",
  "csv_import",
  "system_generated",
] as const;
export type ExecutionCaseSource = typeof EXECUTION_CASE_SOURCES[number];

export const ENGAGEMENT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;
export type EngagementBucket = typeof ENGAGEMENT_BUCKETS[number];

export const QUALIFICATION_STATUSES = ["unscreened", "qualified", "not_qualified", "pending_review"] as const;
export type QualificationStatus = typeof QUALIFICATION_STATUSES[number];

export const LIFECYCLE_STATUSES = ["active", "completed", "archived", "cancelled"] as const;
export type LifecycleStatus = typeof LIFECYCLE_STATUSES[number];

export const ENGAGEMENT_STATUSES = ["new", "contacted", "scheduled", "completed", "not_reached", "unable_to_reach"] as const;
export type EngagementStatus = typeof ENGAGEMENT_STATUSES[number];

export const patientExecutionCases = pgTable("patient_execution_cases", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  source: text("source").notNull().default("system_generated"),
  engagementBucket: text("engagement_bucket").notNull().default("visit"),
  qualificationStatus: text("qualification_status").notNull().default("unscreened"),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  engagementStatus: text("engagement_status").notNull().default("new"),
  selectedServices: text("selected_services").array(),
  assignedTeamMemberId: integer("assigned_team_member_id"),
  assignedRole: text("assigned_role"),
  priorityScore: integer("priority_score"),
  nextActionAt: timestamp("next_action_at"),
  // Phase 2 hardening — canonical call-attempt tracking.
  callAttemptCount: integer("call_attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastCallOutcome: text("last_call_outcome"),
  unableToReachAt: timestamp("unable_to_reach_at"),
  // Phase 2C — authoritative "list became available in Engagement"
  // timestamp. Server-owned; NEVER accepted from client. Never copied
  // from serviceDate. Never a future/backdated timestamp. Populated
  // exactly at the moment a real Send-to-Engagement completes (see
  // server/services/engagementLists/sendToEngagement.ts). Nullable so
  // legacy pre-Phase-2C rows continue to compile; the backfill script
  // will populate from committed_at where necessary.
  sentToEngagementAt: timestamp("sent_to_engagement_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_execution_cases_screening_id").on(table.patientScreeningId),
  index("idx_execution_cases_patient_name_dob").on(table.patientName, table.patientDob),
  index("idx_execution_cases_lifecycle_status").on(table.lifecycleStatus),
  index("idx_execution_cases_engagement_bucket").on(table.engagementBucket),
  index("idx_execution_cases_call_attempt_count").on(table.callAttemptCount),
  index("idx_execution_cases_unable_to_reach_at").on(table.unableToReachAt),
  index("idx_pec_sent_to_engagement_at").on(table.sentToEngagementAt),
]);

export const insertPatientExecutionCaseSchema = createInsertSchema(patientExecutionCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Phase 2C — server-owned. Only the Send-to-Engagement service
  // writes this field; never accepted from client input.
  sentToEngagementAt: true,
});

export type PatientExecutionCase = typeof patientExecutionCases.$inferSelect;
export type InsertPatientExecutionCase = z.infer<typeof insertPatientExecutionCaseSchema>;

export const JOURNEY_EVENT_TYPES = [
  "execution_case_created",
  "execution_case_updated",
  "screening_committed",
] as const;
export type JourneyEventType = typeof JOURNEY_EVENT_TYPES[number];

export const patientJourneyEvents = pgTable("patient_journey_events", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  eventSource: text("event_source").notNull(),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_journey_events_patient_name_dob").on(table.patientName, table.patientDob),
  index("idx_journey_events_screening_id").on(table.patientScreeningId),
  index("idx_journey_events_execution_case_id").on(table.executionCaseId),
  index("idx_journey_events_event_type").on(table.eventType),
]);

export const insertPatientJourneyEventSchema = createInsertSchema(patientJourneyEvents).omit({
  id: true,
  createdAt: true,
});

export type PatientJourneyEvent = typeof patientJourneyEvents.$inferSelect;
export type InsertPatientJourneyEvent = z.infer<typeof insertPatientJourneyEventSchema>;

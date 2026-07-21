// Phase 2C — Engagement list identity + memberships + retry ledger.
//
// Every independently-sent Engagement list gets its own row in
// `engagement_lists`. Multiple lists may share clinic + facility +
// service_date; those are DISPLAY fields, not identity. The identity
// is (clinic_id, source_type, source_id) which is enforced by a real
// unique index in the migration and by the reconciler.
//
// Ancillary cases are attached to lists via `engagement_list_memberships`.
// One ancillary case may have many memberships across different lists.
// One operational work item may be supported by multiple memberships;
// removing one membership does NOT remove the work item if any other
// active membership supports it.
//
// Every write path is gated by FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC
// (default OFF) and the migration (0051) is not applied automatically.

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";
import { users } from "./users";

// ─── Enums ──────────────────────────────────────────────────────
export const ENGAGEMENT_LIST_STATUSES = ["active", "archived", "cancelled"] as const;
export type EngagementListStatus = (typeof ENGAGEMENT_LIST_STATUSES)[number];

export const ENGAGEMENT_MEMBERSHIP_STATUSES = ["active", "removed", "withdrawn"] as const;
export type EngagementMembershipStatus =
  (typeof ENGAGEMENT_MEMBERSHIP_STATUSES)[number];

export const ENGAGEMENT_RECONCILIATION_ACTIONS = [
  "activate",
  "deactivate",
  "restore",
  "refresh_memberships",
  "refresh_projection",
] as const;
export type EngagementReconciliationAction =
  (typeof ENGAGEMENT_RECONCILIATION_ACTIONS)[number];

// ─── engagement_lists ───────────────────────────────────────────
// Identity fields:
//   • clinic_id + source_type + source_id  — UNIQUE (migration)
// Display fields:
//   • facility, service_date, label
export const engagementLists = pgTable(
  "engagement_lists",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "no action" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    /**
     * Explicit idempotency key. Empty string is the "default" bucket
     * (repeat sends without an explicit key collapse). Distinct keys
     * enable independent re-sends of the same source.
     */
    sendIdempotencyKey: text("send_idempotency_key").notNull().default(""),
    label: text("label").notNull(),
    facility: text("facility"),
    serviceDate: text("service_date"),
    sentToEngagementAt: timestamp("sent_to_engagement_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("idx_el_clinic").on(table.clinicId),
    index("idx_el_sent_at").on(table.sentToEngagementAt),
    index("idx_el_service_date").on(table.serviceDate),
    index("idx_el_source").on(table.sourceType, table.sourceId),
    // uq_el_source_identity declared in the migration (partial-unique
    // is unnecessary — every row participates).
  ],
);

export const insertEngagementListSchema = createInsertSchema(engagementLists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentToEngagementAt: true,
});
export type EngagementList = typeof engagementLists.$inferSelect;
export type InsertEngagementList = z.infer<typeof insertEngagementListSchema>;

// ─── engagement_list_memberships ────────────────────────────────
export const engagementListMemberships = pgTable(
  "engagement_list_memberships",
  {
    id: serial("id").primaryKey(),
    engagementListId: integer("engagement_list_id").notNull(),
    // FKs to ancillary case / screening / execution case declared in
    // the migration only (circular imports).
    ancillaryCaseId: integer("ancillary_case_id"),
    patientScreeningId: integer("patient_screening_id"),
    executionCaseId: integer("execution_case_id"),
    serviceType: text("service_type").notNull(),
    status: text("status").notNull().default("active"),
    addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    removedAt: timestamp("removed_at"),
    removalReason: text("removal_reason"),
  },
  (table) => [
    index("idx_elm_list").on(table.engagementListId),
    index("idx_elm_ancillary_case").on(table.ancillaryCaseId),
    index("idx_elm_screening").on(table.patientScreeningId),
    index("idx_elm_execution_case").on(table.executionCaseId),
  ],
);

export const insertEngagementListMembershipSchema = createInsertSchema(
  engagementListMemberships,
).omit({
  id: true,
  addedAt: true,
  removedAt: true,
});
export type EngagementListMembership =
  typeof engagementListMemberships.$inferSelect;
export type InsertEngagementListMembership = z.infer<
  typeof insertEngagementListMembershipSchema
>;

// ─── engagement_reconciliation_failures ─────────────────────────
// Durable retry ledger. No PHI columns. Mirrors the shape of
// ancillary_case_reconciliation_failures.
export const engagementReconciliationFailures = pgTable(
  "engagement_reconciliation_failures",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientScreeningId: integer("patient_screening_id"),
    ancillaryCaseId: integer("ancillary_case_id"),
    serviceType: text("service_type"),
    sourceListId: integer("source_list_id"),
    requestedAction: text("requested_action").notNull(),
    previousAdminReviewStatus: text("previous_admin_review_status"),
    newAdminReviewStatus: text("new_admin_review_status"),
    sourceSystem: text("source_system"),
    errorCode: text("error_code"),
    attemptCount: integer("attempt_count").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastAttemptedAt: timestamp("last_attempted_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_erf_clinic").on(table.clinicId),
    index("idx_erf_ancillary_case").on(table.ancillaryCaseId),
    index("idx_erf_screening").on(table.patientScreeningId),
  ],
);

export const insertEngagementReconciliationFailureSchema = createInsertSchema(
  engagementReconciliationFailures,
).omit({
  id: true,
  firstFailedAt: true,
  lastAttemptedAt: true,
});
export type EngagementReconciliationFailure =
  typeof engagementReconciliationFailures.$inferSelect;
export type InsertEngagementReconciliationFailure = z.infer<
  typeof insertEngagementReconciliationFailureSchema
>;

// New Phase 2C journey event catalog (engagement-side).
export const ENGAGEMENT_JOURNEY_EVENT_TYPES = {
  eligibilityAdded: "engagement_eligibility_added",
  eligibilityRemoved: "engagement_eligibility_removed",
  eligibilityRestored: "engagement_eligibility_restored",
  listCreated: "engagement_list_created",
  membershipAdded: "engagement_list_membership_added",
  membershipRemoved: "engagement_list_membership_removed",
  reconciliationFailed: "engagement_reconciliation_failed",
  reconciliationResolved: "engagement_reconciliation_resolved",
} as const;
export type EngagementJourneyEventType =
  (typeof ENGAGEMENT_JOURNEY_EVENT_TYPES)[keyof typeof ENGAGEMENT_JOURNEY_EVENT_TYPES];

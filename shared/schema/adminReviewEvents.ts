// Phase 2C — Service-specific Admin Review events (append-only history).
//
// The `patient_screenings.admin_approval_status` field is preserved as
// a screening-level compatibility projection. When
// FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW is ON, per-service decisions
// are recorded here as immutable events, the ancillary case's
// admin_review_status is projected from the latest event, and the
// screening column is derived from all active ancillary cases.

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
import { users } from "./users";

// The four canonical review statuses. Legacy denial terminology
// ("denied") is mapped to "rejected" at the service layer and never
// stored in this shape.
export const ANCILLARY_REVIEW_STATUSES = [
  "pending",
  "approved",
  "needs_info",
  "rejected",
] as const;
export type AncillaryReviewStatus = (typeof ANCILLARY_REVIEW_STATUSES)[number];

// Provenance of the review action. Distinguishes bulk / retroactive
// / reanalysis so audit consumers can filter.
export const ANCILLARY_REVIEW_SOURCES = [
  "manual",
  "bulk",
  "same_day_retroactive",
  "reanalysis",
  "migration",
  "system_reconciliation",
] as const;
export type AncillaryReviewSource = (typeof ANCILLARY_REVIEW_SOURCES)[number];

export const ancillaryCaseAdminReviewEvents = pgTable(
  "ancillary_case_admin_review_events",
  {
    id: serial("id").primaryKey(),
    // FK declared in the migration only — reverse import would
    // require adminReviewEvents.ts to import from ancillaryCases.ts,
    // which itself imports from plexusIdentity.ts.
    ancillaryCaseId: integer("ancillary_case_id").notNull(),
    serviceType: text("service_type").notNull(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status").notNull(),
    reviewerUserId: varchar("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerRole: text("reviewer_role"),
    actualReviewedAt: timestamp("actual_reviewed_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    effectiveClinicalDate: text("effective_clinical_date"),
    rationale: text("rationale"),
    evidenceSnapshot: jsonb("evidence_snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("idx_acare_case").on(table.ancillaryCaseId),
    index("idx_acare_reviewed_at").on(table.actualReviewedAt),
    index("idx_acare_new_status").on(table.newStatus),
  ],
);

// insertPatientAncillaryCaseSchema-style validation. actualReviewedAt
// and createdAt are server-managed — client cannot backdate.
export const insertAncillaryCaseAdminReviewEventSchema = createInsertSchema(
  ancillaryCaseAdminReviewEvents,
).omit({
  id: true,
  createdAt: true,
  actualReviewedAt: true,
});
export type AncillaryCaseAdminReviewEvent =
  typeof ancillaryCaseAdminReviewEvents.$inferSelect;
export type InsertAncillaryCaseAdminReviewEvent = z.infer<
  typeof insertAncillaryCaseAdminReviewEventSchema
>;

// New Phase 2C journey event catalog. Written to the existing
// `patient_journey_events` table with `patient_name = sentinel`.
export const ADMIN_REVIEW_JOURNEY_EVENT_TYPES = {
  created: "ancillary_admin_review_created",
  statusChanged: "ancillary_admin_review_status_changed",
  reanalysisPreserved: "ancillary_admin_review_reanalysis_preserved",
} as const;
export type AdminReviewJourneyEventType =
  (typeof ADMIN_REVIEW_JOURNEY_EVENT_TYPES)[keyof typeof ADMIN_REVIEW_JOURNEY_EVENT_TYPES];

/**
 * Normalize any legacy denial terminology to the canonical enum
 * value. Never produce two competing statuses.
 */
export function normalizeReviewStatus(input: string): AncillaryReviewStatus {
  const s = input.trim().toLowerCase();
  if (s === "denied") return "rejected";
  if ((ANCILLARY_REVIEW_STATUSES as readonly string[]).includes(s)) {
    return s as AncillaryReviewStatus;
  }
  return "pending";
}

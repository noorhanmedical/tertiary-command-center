// ai_recommendation_logs — Phase 3 PR 3.4.
//
// Append-only log of every AI / rules recommendation proposal. The engine
// inserts. Humans accept or reject. No automatic execution.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  uniqueIndex, varchar, createInsertSchema, z,
} from "./_common";
import { exceptionSnapshots } from "./exceptionSnapshots";
import { users } from "./users";

export const AI_RECOMMENDATION_STATUSES = [
  "proposed", "accepted", "rejected", "superseded",
] as const;
export type AiRecommendationStatus = (typeof AI_RECOMMENDATION_STATUSES)[number];

export const aiRecommendationLogs = pgTable("ai_recommendation_logs", {
  id: serial("id").primaryKey(),
  recommendationKey: text("recommendation_key").notNull(),
  exceptionSnapshotId: integer("exception_snapshot_id")
    .references(() => exceptionSnapshots.id, { onDelete: "set null" }),

  // What was proposed.
  recommendationType: text("recommendation_type").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),

  // Explainability — required by the AI safety contract.
  modelProvider: text("model_provider").notNull(),
  modelName: text("model_name"),
  confidenceLabel: text("confidence_label").notNull(),
  ruleIds: jsonb("rule_ids").notNull().default([]),
  rationale: text("rationale").notNull(),
  inputs: jsonb("inputs").notNull().default({}),

  // Lifecycle — human review required.
  status: text("status").notNull().default("proposed"),
  requiresHumanReview: integer("requires_human_review").notNull().default(1),
  acceptedAt: timestamp("accepted_at"),
  acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at"),
  rejectedByUserId: varchar("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  supersededAt: timestamp("superseded_at"),

  // Audit reproducibility.
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  sourceSnapshot: jsonb("source_snapshot").notNull().default({}),
  detectorVersion: text("detector_version"),
  metadata: jsonb("metadata").notNull().default({}),

  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ai_recommendation_logs_status").on(table.status),
  index("idx_ai_recommendation_logs_provider").on(table.modelProvider),
  index("idx_ai_recommendation_logs_exception").on(table.exceptionSnapshotId),
  index("idx_ai_recommendation_logs_action").on(table.recommendedAction),
  uniqueIndex("idx_ai_recommendation_logs_key").on(table.recommendationKey),
]);

export const insertAiRecommendationLogSchema = createInsertSchema(aiRecommendationLogs)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type AiRecommendationLog = typeof aiRecommendationLogs.$inferSelect;
export type InsertAiRecommendationLog = z.infer<typeof insertAiRecommendationLogSchema>;

// Phase 6 — TELEPHONY SESSIONS (provider evidence ONLY).
//
// WHY THIS TABLE EXISTS (reuse proof): a provider-backed call begins BEFORE the
// employee records a business disposition, and provider events (ringing /
// answered / ended / duration) can arrive late, duplicated, or out of order.
// The canonical business record `outreach_calls` CANNOT safely hold this
// in-progress state:
//   • outreach_calls.outcome is NOT NULL + a business enum (reached / no_answer
//     / voicemail / …) and Call Results / KPIs read outreach_calls — a
//     provisional "ringing/connecting/in_progress" row would corrupt metrics
//     and violate the "ONE outreach_calls row per real attempt" invariant.
// So a SEPARATE, minimal, durable record holds provider TELEPHONY EVIDENCE
// until the employee dispositions. At disposition, the ONE outreach_calls row
// is written and linked to this session's provider id + duration.
//
// THIS TABLE IS NOT: another call-history system, another disposition system,
// another assignment system, or a patient communication timeline. It answers
// exactly ONE question: "Did a provider call session exist, and what did the
// provider observe?" Business meaning lives in outreach_calls.
//
// EVIDENCE ONLY: provider_state is a line-level fact (connected != "reached").
// It NEVER becomes a business outcome — the employee always records that.
//
// No PHI beyond the same identity FKs already used elsewhere; no provider
// payload blobs. Migration: 0085_add_telephony_sessions.sql (applied manually).

import {
  sql,
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { outreachSchedulers } from "./outreach";
import { users } from "./users";
import { TELEPHONY_SESSION_STATES } from "../phoneProvider";

export const telephonySessions = pgTable(
  "telephony_sessions",
  {
    id: serial("id").primaryKey(),
    /** Provider id (manual / doximity / ringcentral / future). */
    provider: text("provider").notNull(),
    /** Provider-issued call/session id. Present only for providers that supply
     *  one (canProvideProviderSessionId). Unique when present → idempotent
     *  correlation of provider events + linkage to the disposition record. */
    providerSessionId: text("provider_session_id"),
    /** Canonical correlation to the patient interaction (nullable for ad-hoc). */
    executionCaseId: integer("execution_case_id").references(
      () => patientExecutionCases.id,
      { onDelete: "set null" },
    ),
    patientScreeningId: integer("patient_screening_id").references(
      () => patientScreenings.id,
      { onDelete: "set null" },
    ),
    /** Acting team member (roster id) + login user who initiated the session. */
    actingSchedulerId: integer("acting_scheduler_id").references(
      () => outreachSchedulers.id,
      { onDelete: "set null" },
    ),
    actingUserId: varchar("acting_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull().default("outbound"),
    /** Line-level provider state (EVIDENCE, not a business disposition). */
    providerState: text("provider_state").notNull().default("initiated"),
    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    /** Set when the provider reports the call answered/connected (if supported). */
    connectedAt: timestamp("connected_at"),
    endedAt: timestamp("ended_at"),
    /** Provider-reported talk time (if supported). */
    durationSeconds: integer("duration_seconds"),
    /** Timestamp of the most recent APPLIED provider event — out-of-order guard. */
    lastProviderEventAt: timestamp("last_provider_event_at"),
    /** Provider event sequence/version (if supported) — monotonic ordering guard. */
    eventSeq: integer("event_seq"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    // Idempotent provider-session correlation (partial: manual/assisted rows
    // without a provider id are unaffected — mirrors uq_outreach_calls_*).
    uniqueIndex("uq_telephony_sessions_provider_session_id")
      .on(table.provider, table.providerSessionId)
      .where(sql`provider_session_id IS NOT NULL`),
    index("idx_telephony_sessions_execution_case").on(table.executionCaseId),
    index("idx_telephony_sessions_screening").on(table.patientScreeningId),
    index("idx_telephony_sessions_scheduler").on(table.actingSchedulerId),
  ],
);

export const insertTelephonySessionSchema = createInsertSchema(telephonySessions)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    providerState: z.enum(TELEPHONY_SESSION_STATES).optional(),
    direction: z.enum(["outbound", "inbound"]).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
    eventSeq: z.number().int().min(0).nullable().optional(),
  });

export type TelephonySession = typeof telephonySessions.$inferSelect;
export type InsertTelephonySession = z.infer<typeof insertTelephonySessionSchema>;

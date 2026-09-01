// Global Plexus patient identity — Phase 2A.
//
// See docs/full-patient-journey-platform-audit.md §3 for the full
// architecture. Nothing in this file is used by any registered route
// or write path until the flags FEATURE_PLEXUS_IDENTITY_WRITE and
// FEATURE_PLEXUS_IDENTITY_REVIEW are flipped ON and the migration
// (migrations/0049_add_plexus_identity.sql) is applied.
//
// Ownership model (v3.1):
//   • Plexus is a separate platform/operator entity from each clinic.
//   • Every real-world patient has ONE global_plexus_patients row.
//   • Each clinic's relationship to that patient lives on
//     patient_clinic_memberships (one active row per (patient, clinic)).
//   • Clinic-facing endpoints join through patient_clinic_memberships
//     and NEVER return a global_plexus_patients row directly.
//   • Identity resolution, match review, merge, and alias management
//     are Plexus-central functions. Not visible to clinic users.
//
// Every table below uses `serial int` PK to match the repo convention
// (matches patient_screenings, patient_execution_cases, procedure_notes,
// documents, invoices, ...). users.id is the varchar-uuid exception;
// we FK varchar to it from reviewer / actor columns only.

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  numeric,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";
import { users } from "./users";

// ─── Enums (referenced by validation) ─────────────────────────────
export const IDENTITY_STATUSES = [
  "active",
  "possible_duplicate",
  "merged",
  "inactive",
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const MEMBERSHIP_STATUSES = [
  "active",
  "inactive",
  "withdrawn",
  "merged_away",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const EXTERNAL_IDENTIFIER_TYPES = [
  "clinic_mrn",
  "ehr_patient_id",
  "payer_member_id",
  "medicare_identifier",
  "external_import_id",
  "prior_plexus_id_alias",
] as const;
export type ExternalIdentifierType =
  (typeof EXTERNAL_IDENTIFIER_TYPES)[number];

// Identifier types whose raw values are considered SENSITIVE and must
// be encrypted at rest. Until an approved encryption mechanism lands
// (see server/services/plexusIdentity/authorization.ts + unresolved
// blocker note), writes with these types are blocked at the service
// layer regardless of feature-flag state.
export const SENSITIVE_IDENTIFIER_TYPES: readonly ExternalIdentifierType[] = [
  "payer_member_id",
  "medicare_identifier",
] as const;

export const MATCH_TIERS = ["definitive", "high", "medium", "low"] as const;
export type MatchTier = (typeof MATCH_TIERS)[number];

export const MATCH_REVIEW_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "deferred",
] as const;
export type MatchReviewStatus = (typeof MATCH_REVIEW_STATUSES)[number];

// ─── global_plexus_patients ───────────────────────────────────────
// Globally unique record per real-world patient across the Plexus
// ecosystem. Not clinic-scoped. Access restricted to Plexus-internal
// authorization boundary.
//
// Plexus ID (`plexus_id`) is:
//   • globally unique
//   • immutable after assignment
//   • opaque + non-PHI (never derived from name / DOB / clinic / MRN /
//     diagnosis / sex / insurance)
//   • `PLX-` prefixed + ULID-suffix
//   • preserved as an alias in `plexus_id_aliases` when the row is
//     merged into another (never reused)
export const globalPlexusPatients = pgTable(
  "global_plexus_patients",
  {
    id: serial("id").primaryKey(),
    plexusId: text("plexus_id").notNull().unique(),
    displayName: text("display_name"),
    normalizedName: text("normalized_name"),
    dob: text("dob"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    identityStatus: text("identity_status").notNull().default("active"),
    // Nullable self-FK — populated when this row was merged into a
    // surviving row. Reads always follow the merge chain.
    mergedIntoPatientId: integer("merged_into_patient_id"),
    // Derived — never manually editable. Materialized by an ancillary
    // completion trigger in a later phase (Phase 2J will wire it).
    hasPlexusAncillaryHistory: boolean("has_plexus_ancillary_history")
      .notNull()
      .default(false),
    firstAncillaryCompletedAt: timestamp("first_ancillary_completed_at"),
    mostRecentAncillaryCompletedAt: timestamp(
      "most_recent_ancillary_completed_at",
    ),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    // Non-unique search indexes only. NO unique constraint on
    // (name, dob) — identity is opaque and resolver-controlled.
    index("idx_gpp_normalized_name").on(table.normalizedName),
    index("idx_gpp_dob").on(table.dob),
    index("idx_gpp_identity_status").on(table.identityStatus),
    index("idx_gpp_merged_into").on(table.mergedIntoPatientId),
  ],
);

export const insertGlobalPlexusPatientSchema = createInsertSchema(
  globalPlexusPatients,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type GlobalPlexusPatient = typeof globalPlexusPatients.$inferSelect;
export type InsertGlobalPlexusPatient = z.infer<
  typeof insertGlobalPlexusPatientSchema
>;

// ─── patient_clinic_memberships ───────────────────────────────────
// One row per (global patient, clinic) — the tenant boundary used by
// every clinic-facing route. Only one active membership per
// (patient, clinic). Clinic MRN uniqueness enforced within
// (clinic_id, source_system) only.
export const patientClinicMemberships = pgTable(
  "patient_clinic_memberships",
  {
    id: serial("id").primaryKey(),
    globalPlexusPatientId: integer("global_plexus_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    clinicMrn: text("clinic_mrn"),
    sourceSystem: text("source_system"),
    sourcePatientIdentifier: text("source_patient_identifier"),
    membershipStatus: text("membership_status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastSeenAt: timestamp("last_seen_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_pcm_global_patient").on(table.globalPlexusPatientId),
    index("idx_pcm_clinic").on(table.clinicId),
    index("idx_pcm_status").on(table.membershipStatus),
    // Partial-unique-index equivalent constraints are declared in the
    // migration SQL (Drizzle's tables API only supports simple unique
    // indexes; partial indexes go in the migration).
  ],
);

export const insertPatientClinicMembershipSchema = createInsertSchema(
  patientClinicMemberships,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type PatientClinicMembership =
  typeof patientClinicMemberships.$inferSelect;
export type InsertPatientClinicMembership = z.infer<
  typeof insertPatientClinicMembershipSchema
>;

// ─── patient_external_identifiers ─────────────────────────────────
// Identifiers used for future matching. Sensitive types
// (payer_member_id, medicare_identifier) require encryption; the
// service layer blocks writes for these types until an approved
// encryption mechanism is wired.
export const patientExternalIdentifiers = pgTable(
  "patient_external_identifiers",
  {
    id: serial("id").primaryKey(),
    globalPlexusPatientId: integer("global_plexus_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    patientClinicMembershipId: integer("patient_clinic_membership_id").references(
      () => patientClinicMemberships.id,
      { onDelete: "set null" },
    ),
    clinicId: integer("clinic_id").references(() => clinics.id, {
      onDelete: "set null",
    }),
    sourceSystem: text("source_system"),
    identifierType: text("identifier_type").notNull(),
    // Sensitive-value column. Stored as bytea (encrypted) in the
    // migration; typed as text here purely for TS shape. Repository
    // layer refuses to write / read raw sensitive values until the
    // encryption blocker is resolved.
    identifierValueEncrypted: text("identifier_value_encrypted"),
    // Normalized lookup value — appropriate for non-sensitive types
    // (clinic_mrn, ehr_patient_id, external_import_id, alias). For
    // sensitive types, this MUST be an HMAC or comparable one-way
    // digest, never the raw value. Repository enforces.
    normalizedOrHashedMatchValue: text("normalized_or_hashed_match_value"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_pei_global_patient").on(table.globalPlexusPatientId),
    index("idx_pei_clinic_source").on(table.clinicId, table.sourceSystem),
    index("idx_pei_type_match").on(
      table.identifierType,
      table.normalizedOrHashedMatchValue,
    ),
    index("idx_pei_active").on(table.active),
  ],
);

export const insertPatientExternalIdentifierSchema = createInsertSchema(
  patientExternalIdentifiers,
).omit({
  id: true,
  createdAt: true,
});
export type PatientExternalIdentifier =
  typeof patientExternalIdentifiers.$inferSelect;
export type InsertPatientExternalIdentifier = z.infer<
  typeof insertPatientExternalIdentifierSchema
>;

// ─── patient_identity_match_candidates ────────────────────────────
// Plexus-only review queue. Never returned from any clinic-facing
// route.
export const patientIdentityMatchCandidates = pgTable(
  "patient_identity_match_candidates",
  {
    id: serial("id").primaryKey(),
    incomingMembershipId: integer("incoming_membership_id").references(
      () => patientClinicMemberships.id,
      { onDelete: "cascade" },
    ),
    stagedImportRowId: integer("staged_import_row_id"),
    candidateGlobalPatientId: integer("candidate_global_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    matchScore: numeric("match_score", { precision: 6, scale: 3 }),
    matchTier: text("match_tier"),
    matchedSignals: jsonb("matched_signals").notNull().default(sql`'[]'::jsonb`),
    conflictingSignals: jsonb("conflicting_signals")
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_pimc_candidate").on(table.candidateGlobalPatientId),
    index("idx_pimc_status").on(table.reviewStatus),
    index("idx_pimc_incoming").on(table.incomingMembershipId),
  ],
);

export const insertPatientIdentityMatchCandidateSchema = createInsertSchema(
  patientIdentityMatchCandidates,
).omit({
  id: true,
  createdAt: true,
});
export type PatientIdentityMatchCandidate =
  typeof patientIdentityMatchCandidates.$inferSelect;
export type InsertPatientIdentityMatchCandidate = z.infer<
  typeof insertPatientIdentityMatchCandidateSchema
>;

// ─── patient_identity_merge_events ────────────────────────────────
// Append-only Plexus audit history. Rows are IMMUTABLE. Reversal
// creates a new row, never mutates.
export const patientIdentityMergeEvents = pgTable(
  "patient_identity_merge_events",
  {
    id: serial("id").primaryKey(),
    survivingGlobalPatientId: integer("surviving_global_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    mergedGlobalPatientId: integer("merged_global_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    survivingPlexusId: text("surviving_plexus_id").notNull(),
    mergedPlexusId: text("merged_plexus_id").notNull(),
    reviewedByUserId: varchar("reviewed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    evidenceSnapshot: jsonb("evidence_snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    mergedAt: timestamp("merged_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("idx_pime_surviving").on(table.survivingGlobalPatientId),
    index("idx_pime_merged").on(table.mergedGlobalPatientId),
    index("idx_pime_merged_at").on(table.mergedAt),
  ],
);

export const insertPatientIdentityMergeEventSchema = createInsertSchema(
  patientIdentityMergeEvents,
).omit({ id: true });
export type PatientIdentityMergeEvent =
  typeof patientIdentityMergeEvents.$inferSelect;
export type InsertPatientIdentityMergeEvent = z.infer<
  typeof insertPatientIdentityMergeEventSchema
>;

// ─── plexus_id_aliases ────────────────────────────────────────────
// Old Plexus IDs preserved after merge. Searchable, never reused,
// always redirect to the surviving global patient.
export const plexusIdAliases = pgTable(
  "plexus_id_aliases",
  {
    aliasPlexusId: text("alias_plexus_id").primaryKey(),
    survivingGlobalPatientId: integer("surviving_global_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_pia_surviving").on(table.survivingGlobalPatientId),
  ],
);

export const insertPlexusIdAliasSchema = createInsertSchema(plexusIdAliases);
export type PlexusIdAlias = typeof plexusIdAliases.$inferSelect;
export type InsertPlexusIdAlias = z.infer<typeof insertPlexusIdAliasSchema>;

// ─── plexus_identity_link_failures ────────────────────────────────
// Durable retry ledger for identity-link failures. Populated when a
// screening was persisted OK but the follow-on Plexus identity commit
// failed. The reconciliation service reads this table and retries
// idempotently.
//
// NEVER stores PHI. Only ids, timestamps, source path, error code,
// and attempt count.
//
// The partial-unique index on (patient_screening_id) WHERE
// resolved_at IS NULL is declared in the migration so a retry can
// UPDATE the existing unresolved row instead of accumulating dupes.
// The FK to patient_screenings is declared in the migration only —
// declaring it here would introduce a circular import (screening.ts
// already imports from this file).
export const plexusIdentityLinkFailures = pgTable(
  "plexus_identity_link_failures",
  {
    id: serial("id").primaryKey(),
    patientScreeningId: integer("patient_screening_id").notNull(),
    clinicId: integer("clinic_id").references(() => clinics.id, {
      onDelete: "cascade",
    }),
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
    index("idx_pilf_screening").on(table.patientScreeningId),
  ],
);

export const insertPlexusIdentityLinkFailureSchema = createInsertSchema(
  plexusIdentityLinkFailures,
).omit({
  id: true,
  firstFailedAt: true,
  lastAttemptedAt: true,
});
export type PlexusIdentityLinkFailure =
  typeof plexusIdentityLinkFailures.$inferSelect;
export type InsertPlexusIdentityLinkFailure = z.infer<
  typeof insertPlexusIdentityLinkFailureSchema
>;

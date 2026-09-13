// Engagement Call List — FROZEN DISTRIBUTION SNAPSHOT / SHARE PACKAGES.
//
// Two dedicated tables (migration 0088). These are the immutable historical
// record of "what this manager distributed to this employee at this exact
// moment" — NOT the live source of truth. Live ownership + the live call list
// stay on patient_execution_cases (assignedTeamMemberId / nextActionAt) and
// /api/scheduler-portal/cases. A package is never mutated to mimic live state;
// only its lifecycle/link/artifact metadata may change (expiry extension,
// token regeneration, revocation, PDF status/retry, retention).
//
// Why not reuse existing tables:
//   • engagement_lists — different identity/semantics ("sent-to-Engagement
//     eligibility lists" keyed by clinic+source_type+source_id) and consumed by
//     canonical overview/stage reads; would pollute them + lacks token/expiry.
//   • scheduler_assignments — per-patient/day snapshot (one active row per
//     patient/day); cannot host a package header (token, expiry, PDF, counts)
//     and cannot represent two packages generated the same day.
//
// SECURITY: only the token HASH is stored (sha256 hex). The plaintext bearer
// token is returned to the manager exactly once at create/regenerate time and
// is never persisted. No PHI is placed in any token or URL.

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
  uniqueIndex,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";
import { users } from "./users";

// ─── Enums ──────────────────────────────────────────────────────────────────
// Package lifecycle (independent of PDF artifact state).
export const CALL_LIST_PACKAGE_STATUSES = ["active", "archived", "cancelled"] as const;
export type CallListPackageStatus = (typeof CALL_LIST_PACKAGE_STATUSES)[number];

// PDF / artifact generation state. `failed` is retryable and NEVER implies the
// canonical assignments failed — assignments commit first and independently.
export const CALL_LIST_PACKAGE_GENERATION_STATUSES = [
  "pending",
  "ready",
  "failed",
] as const;
export type CallListPackageGenerationStatus =
  (typeof CALL_LIST_PACKAGE_GENERATION_STATUSES)[number];

// ─── call_list_packages (per team member, per generation) ────────────────────
export const callListPackages = pgTable(
  "call_list_packages",
  {
    id: serial("id").primaryKey(),
    // Tenant isolation. Nullable during backfill; filter enforced in repo layer.
    clinicId: integer("clinic_id").references(() => clinics.id, {
      onDelete: "set null",
    }),
    // Display / scope fields (frozen at generation).
    facilityId: text("facility_id").notNull(),
    // outreach_schedulers.id — the employee this package was generated for. No
    // drizzle FK by design (mirrors patient_execution_cases.assignedTeamMemberId);
    // the roster row may change/deactivate without rewriting frozen history.
    teamMemberId: integer("team_member_id").notNull(),
    teamMemberNameSnapshot: text("team_member_name_snapshot"),
    // Manager who generated the package.
    generatedByUserId: varchar("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Operational date the distribution targets (YYYY-MM-DD, clinic-local).
    serviceDate: text("service_date"),
    // Idempotency key linking every package produced by ONE Confirm operation.
    distributionOperationId: text("distribution_operation_id").notNull(),
    // Cohort provenance (frozen).
    cohortKey: text("cohort_key").notNull(),
    cohortLabelSnapshot: text("cohort_label_snapshot"),
    // Service/ancillary filter used (array of service strings) or null.
    serviceFilterSnapshot: jsonb("service_filter_snapshot"),
    patientCount: integer("patient_count").notNull().default(0),
    // Frozen summary metrics (totals, ancillary mix, cohort/status counts).
    summaryMetrics: jsonb("summary_metrics").notNull().default(sql`'{}'::jsonb`),
    // Artifact (PDF) generation state.
    generationStatus: text("generation_status").notNull().default("pending"),
    // PHI-SAFE short failure code (never patient data).
    generationErrorCode: text("generation_error_code"),
    // Durable stored PDF (document_blobs.id). FK declared in migration only to
    // avoid a cross-domain circular import. Null until the PDF is stored.
    pdfBlobId: integer("pdf_blob_id"),
    // ─ Secure share link (bearer token) ─
    // Only the sha256 hex hash of the token is stored. Null before first mint.
    shareTokenHash: text("share_token_hash"),
    shareExpiresAt: timestamp("share_expires_at"),
    shareRevokedAt: timestamp("share_revoked_at"),
    shareRegeneratedAt: timestamp("share_regenerated_at"),
    // ─ Optional share PIN (second factor) ─
    // Only a bcrypt hash is stored; plaintext PIN is never persisted. Null =
    // no PIN (token-only access, the default). Migration 0091.
    sharePinHash: text("share_pin_hash"),
    sharePinSetAt: timestamp("share_pin_set_at"),
    // ─ Retention (approved: 90 days) ─
    // Snapshot/audit PHI retention cutoff (SEPARATE from the 72h share expiry).
    // Set to created_at + 90 days on creation. At/after this instant a purge
    // job removes member PHI + the PDF blob and stamps `purgedAt`, preserving
    // only minimal non-PHI audit metadata on the header.
    snapshotRetentionUntil: timestamp("snapshot_retention_until"),
    // Set when the snapshot PHI + PDF blob have been purged (retention expiry).
    // Null = still within retention. Purge is idempotent (skips non-null).
    purgedAt: timestamp("purged_at"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_clp_clinic").on(table.clinicId),
    index("idx_clp_facility_date").on(table.facilityId, table.serviceDate),
    index("idx_clp_team_member").on(table.teamMemberId),
    index("idx_clp_operation").on(table.distributionOperationId),
    // One package per (operation, team member) — idempotent Confirm can never
    // create a duplicate package for the same member on retry.
    uniqueIndex("uq_clp_operation_member").on(
      table.distributionOperationId,
      table.teamMemberId,
    ),
    // Token hash is unique when present (partial index declared in migration).
    index("idx_clp_share_token_hash").on(table.shareTokenHash),
    // Purge scan: find due, not-yet-purged packages.
    index("idx_clp_retention").on(table.snapshotRetentionUntil, table.purgedAt),
  ],
);

export const insertCallListPackageSchema = createInsertSchema(callListPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CallListPackage = typeof callListPackages.$inferSelect;
export type InsertCallListPackage = z.infer<typeof insertCallListPackageSchema>;

// ─── call_list_package_members (frozen per-patient rows) ─────────────────────
// Minimal bounded PHI only — enough to reproduce the roster summary,
// qualification summary, ancillary list, and Clinician Atlas section. The full
// chart is NEVER copied. See PHI-minimization notes in the feature docs.
export const callListPackageMembers = pgTable(
  "call_list_package_members",
  {
    id: serial("id").primaryKey(),
    packageId: integer("package_id")
      .notNull()
      .references(() => callListPackages.id, { onDelete: "cascade" }),
    // References (NOT owners). FKs declared in the migration only to avoid
    // cross-domain circular imports (mirrors engagement_list_memberships).
    executionCaseId: integer("execution_case_id").notNull(),
    patientScreeningId: integer("patient_screening_id"),
    // Deterministic rendering order within the package.
    orderIndex: integer("order_index").notNull().default(0),
    // Frozen minimal PHI.
    patientNameSnapshot: text("patient_name_snapshot").notNull(),
    patientDobSnapshot: text("patient_dob_snapshot"),
    patientPhoneSnapshot: text("patient_phone_snapshot"),
    // Bounded demographics needed for the roster (age/sex/insurance/facility).
    demographicsSnapshot: jsonb("demographics_snapshot"),
    // Ancillary/service list delivered.
    servicesSnapshot: text("services_snapshot").array(),
    // Employee call context.
    reasonForCallSnapshot: text("reason_for_call_snapshot"),
    // Bounded qualification summary (per-service qualification context).
    qualificationSummarySnapshot: jsonb("qualification_summary_snapshot"),
    // Cohort/status classification at generation time.
    cohortClassificationSnapshot: text("cohort_classification_snapshot"),
    // Bounded Clinician Atlas structured payload (verified render contract in
    // Task 6) — reproduces the frozen Atlas section without the full chart.
    atlasPayloadSnapshot: jsonb("atlas_payload_snapshot"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_clpm_package").on(table.packageId),
    index("idx_clpm_execution_case").on(table.executionCaseId),
    index("idx_clpm_screening").on(table.patientScreeningId),
    // No duplicate patient/objective within a package (idempotent create).
    uniqueIndex("uq_clpm_package_execution_case").on(
      table.packageId,
      table.executionCaseId,
    ),
  ],
);

export const insertCallListPackageMemberSchema = createInsertSchema(
  callListPackageMembers,
).omit({
  id: true,
  createdAt: true,
});
export type CallListPackageMember = typeof callListPackageMembers.$inferSelect;
export type InsertCallListPackageMember = z.infer<
  typeof insertCallListPackageMemberSchema
>;

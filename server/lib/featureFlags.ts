// Server-side feature flags for Phase 4 internal-persistence surfaces.
//
// All Phase 4 flags default OFF. Each is read from process.env at
// startup. Flipping a flag ON at runtime is not supported — that would
// bypass migration approval. Deployment checklist: set the env var
// before restarting the process.
//
// PERMANENT EXCLUSION: no flag under any name is provided for Twilio /
// patient SMS. Any request to add one must be rejected at review.

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export const featureFlags = {
  /** Internal (user-to-user, tenant-scoped) direct messages backend. */
  internalDirectMessages: readBool("FEATURE_INTERNAL_DIRECT_MESSAGES", false),
  /** Portal Assistant (AI chat) backend. */
  portalAssistant: readBool("FEATURE_PORTAL_ASSISTANT", false),
  /** Clinical Intelligence live server persistence (currently on client localStorage). */
  clinicalIntelligenceLive: readBool("FEATURE_CLINICAL_INTELLIGENCE_LIVE", false),
  /** Clinician Portal alt backend — Phase 4 kept disabled pending shell canonical decision. */
  clinicianPortalBackend: readBool("FEATURE_CLINICIAN_PORTAL_BACKEND", false),

  // ─── Phase 2A — Global Plexus patient identity ─────────────────
  // Both flags default OFF. The corresponding SQL migration
  // (migrations/0049_add_plexus_identity.sql) is NOT applied
  // automatically. Flipping either flag ON without the migration
  // applied will fail-fast at write time.

  /**
   * Enable writes to the Plexus identity tables (global_plexus_patients,
   * patient_clinic_memberships, patient_external_identifiers, aliases,
   * merge events, match candidates). Read helpers on the resolver still
   * function (returning empty results if the migration hasn't been
   * applied) so screening / clinic-facing endpoints can preview
   * matches, but nothing is persisted until this is ON.
   */
  plexusIdentityWrite: readBool("FEATURE_PLEXUS_IDENTITY_WRITE", false),

  /**
   * Enable Plexus-internal identity review endpoints (match candidates,
   * merges, alias management). MUST remain OFF until a Plexus-internal
   * user role exists — see
   * server/services/plexusIdentity/authorization.ts for the unresolved
   * blocker. Clinic users and general clinic administrators must never
   * receive this access.
   */
  plexusIdentityReview: readBool("FEATURE_PLEXUS_IDENTITY_REVIEW", false),

  // ─── Phase 2B — Ancillary case reconciliation ──────────────────
  // Default OFF. The corresponding SQL migration
  // (migrations/0050_add_patient_ancillary_cases.sql) is NOT applied
  // automatically. Phase 2B has a hard runtime dependency on Phase 2A
  // (this flag being ON without FEATURE_PLEXUS_IDENTITY_WRITE also
  // ON will produce structured "missing_identity_links" outcomes and
  // NEVER write incorrect data).
  //
  // Enabling checklist:
  //   1. Apply migrations/0049 (Phase 2A).
  //   2. Set FEATURE_PLEXUS_IDENTITY_WRITE=true and restart.
  //   3. Run backfill 0049 in dry-run then apply.
  //   4. Apply migrations/0050 (Phase 2B).
  //   5. Set FEATURE_ANCILLARY_CASE_WRITE=true and restart.
  //   6. Run backfill 0050 in dry-run then apply.
  ancillaryCaseWrite: readBool("FEATURE_ANCILLARY_CASE_WRITE", false),

  // ─── Phase 2C — Service-specific Admin Review + Engagement lists ─
  // All four flags default OFF. Migration 0051 is NOT applied
  // automatically. Enabling checklist:
  //   1. Phase 2A + 2B applied and flags ON.
  //   2. Apply migrations/0051.
  //   3. Introduce Plexus-internal clinical reviewer role
  //      (see server/services/adminReview/authorization.ts blocker).
  //   4. Flip FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW to enable the
  //      write path. Reads (compatibility projection) work without it.
  //   5. Flip FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC to have every
  //      review status change reconcile Engagement eligibility.
  //   6. Flip FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY to expose the
  //      new Repository tab / multi-list model in the client.
  //   7. Flip FEATURE_ENGAGEMENT_RECENT_LISTS to enable the Most
  //      Recently Sent (top-10) section.

  /** Service-specific Admin Review write path. */
  serviceSpecificAdminReview: readBool("FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW", false),

  /** Engagement eligibility reconciles on Admin Review status changes. */
  engagementAdminReviewSync: readBool("FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC", false),

  /** Multi-list Engagement Repository — surfaces the new engagement_lists model. */
  engagementMultiListRepository: readBool("FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY", false),

  /** Most Recently Sent (top-10) section on the Repository tab. */
  engagementRecentLists: readBool("FEATURE_ENGAGEMENT_RECENT_LISTS", false),

  // ─── Phase 2D — Canonical ancillary appointments ─────────────
  // Default OFF. Migration 0052 (canonical ancillary appointments in
  // global_schedule_events) is NOT applied automatically.
  //
  // Enabling checklist:
  //   1. Migrations 0049–0051 applied.
  //   2. Phase 2A–2C backfills completed.
  //   3. Phase 2A–2C flags enabled and validated.
  //   4. Apply migrations/0052.
  //   5. Run Phase 2D backfill dry-run + apply.
  //   6. Set FEATURE_CANONICAL_APPOINTMENT=true and restart.
  //   7. Production validation.
  canonicalAppointment: readBool("FEATURE_CANONICAL_APPOINTMENT", false),

  // ─── Phase 2E — Unified Ancillary Documents + Order Note ─────
  // Both default OFF. Migration 0053 (ancillary_document_references +
  // retry ledger) is NOT applied automatically.
  //
  // Enabling sequence:
  //   1. Migrations 0049–0052 applied; Phase 2A–2D backfills done.
  //   2. Phase 2A–2D flags enabled + validated.
  //   3. Apply migrations/0053.
  //   4. Run Phase 2E backfill dry-run + apply.
  //   5. Enable FEATURE_UNIFIED_ANCILLARY_DOCUMENTS; validate projections.
  //   6. Enable FEATURE_CANONICAL_ORDER_NOTE; validate Order Note flow.
  unifiedAncillaryDocuments: readBool("FEATURE_UNIFIED_ANCILLARY_DOCUMENTS", false),
  canonicalOrderNote: readBool("FEATURE_CANONICAL_ORDER_NOTE", false),

  // ─── Phase 2F — Canonical procedure lifecycle + Procedure Note ─────
  // Both default OFF. Migration 0054 (procedure_events ancillary identity +
  // procedure_notes report evidence + case-scoped post_procedure_note
  // identity) is NOT applied automatically.
  //
  // Enabling sequence:
  //   1. Migrations 0049–0053 applied; Phase 2A–2E backfills done.
  //   2. Phase 2A–2E flags enabled + validated.
  //   3. Apply migrations/0054.
  //   4. Run Phase 2F backfill dry-run + apply (procedure_events ancillary
  //      linkage) once authored.
  //   5. Enable FEATURE_CANONICAL_PROCEDURE_LIFECYCLE; the completion hook
  //      begins writing the ancillary-case linkage onto procedure_events.
  //   6. Enable FEATURE_CANONICAL_PROCEDURE_NOTE; validate the two-condition
  //      Procedure Note flow (procedure complete AND current report).
  //
  // Both gate ZERO Phase 2F reads/writes while OFF. Neither auto-signs and
  // neither generates any Procedure Note body.

  /** Writes the canonical ancillary-case linkage onto completed
   *  procedure_events and fires the Procedure Note orchestration hook. */
  canonicalProcedureLifecycle: readBool("FEATURE_CANONICAL_PROCEDURE_LIFECYCLE", false),

  /** Enables the canonical Procedure Note (post_procedure_note) eligibility +
   *  create/reuse foundation. Pair-gated: the eligibility read of the report
   *  reference also needs the Phase 2E reference index applied/ON. */
  canonicalProcedureNote: readBool("FEATURE_CANONICAL_PROCEDURE_NOTE", false),
} as const;

export type FeatureFlagName = keyof typeof featureFlags;

export function isEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name];
}

/**
 * The SINGLE canonical Procedure Note runtime gate. The canonical Procedure
 * Note path (eligibility reads, create/reuse, evidence sync, retry execution,
 * report-side hook, and legacy-writer suppression) requires ALL THREE flags —
 * lifecycle (so the completed procedure event carries its case linkage), note
 * (the canonical creator), and unified documents (the reference index). Partial
 * enablement must NEVER perform partial canonical reads/writes and must NEVER
 * suppress the legacy writer — otherwise the workflow is stranded with neither
 * a legacy nor a canonical note.
 */
export function procedureNoteRuntimeEnabled(): boolean {
  return (
    featureFlags.canonicalProcedureLifecycle &&
    featureFlags.canonicalProcedureNote &&
    featureFlags.unifiedAncillaryDocuments
  );
}

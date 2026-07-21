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
} as const;

export type FeatureFlagName = keyof typeof featureFlags;

export function isEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name];
}

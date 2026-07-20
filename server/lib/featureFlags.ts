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
} as const;

export type FeatureFlagName = keyof typeof featureFlags;

export function isEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name];
}

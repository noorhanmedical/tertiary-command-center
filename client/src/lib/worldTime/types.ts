// Shared World Time types — used by the dashboard card, the location registry,
// and the admin image-approval surface. The runtime dashboard reads a small,
// data-only shape (label, timezone, approved image); it never performs image
// discovery. Image discovery/approval is an admin/configuration workflow.

/** Lifecycle of a location's background image. Only APPROVED ever renders on
 *  the production-facing World Time card; everything else falls back to the
 *  Plexus navy gradient. */
export type WorldTimeImageStatus =
  | "no_image"
  | "pending_approval"
  | "approved"
  | "rejected"
  // Optional: an approved image an admin has flagged for re-selection. Treated
  // as non-approved at runtime (falls back to gradient).
  | "needs_replacement";

/** The full, admin-visible image record for a location. */
export type WorldTimeImageRecord = {
  /** Public URL of the candidate/approved asset (e.g. "/world-time/dubai.svg"). */
  assetUrl: string;
  /** Human-readable landmark used for review + alt text (e.g. "Burj Khalifa"). */
  landmarkName: string;
  /** CSS object-position for the crop (e.g. "center 42%"). */
  imagePosition: string;
  /** Optional provenance for asset management / attribution. */
  sourceName?: string;
  sourceReference?: string;
  /** Approval state machine. */
  status: WorldTimeImageStatus;
  proposedAt?: string;
  proposedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
};

/** The public (dashboard-facing) projection of an image record. The `assetUrl`
 *  is only present when `status === "approved"`, so an unapproved candidate can
 *  never leak onto the production card. */
export type WorldTimeImagePublic = {
  status: WorldTimeImageStatus;
  landmarkName?: string;
  imagePosition?: string;
  /** Present ONLY when status === "approved". */
  assetUrl?: string;
};

/** A configured World Time location. Cities are added from configuration; no
 *  per-location JSX/CSS is required. */
export type WorldTimeLocation = {
  id: string;
  label: string;
  city?: string;
  country?: string;
  timezone: string;
  timezoneAbbreviation?: string;
  aliases?: string[];
};

export type WorldTimeImageRegistry = Record<string, WorldTimeImageRecord>;
export type WorldTimeImagePublicMap = Record<string, WorldTimeImagePublic>;

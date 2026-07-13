// Plexus IQ runtime hardening — shared formatting + aggregation helpers
// for the qualification-job status surfaces (single-job + multi-job).
//
// Kept local to the plexus-iq folder because both consumers live here
// and the helpers are too small to justify a top-level lib module.

import type { QualificationJobStatus } from "@/lib/plexusIqClinicalImportApi";

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m - h * 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

export type FailureCategory = NonNullable<
  QualificationJobStatus["errors"][number]["category"]
>;

export function categoryLabel(category: FailureCategory): string {
  switch (category) {
    case "missing_clinical":
      return "missing clinical";
    case "missing_demographic":
      return "missing demographic";
    case "technical_failed":
      return "technical";
    case "ai_error":
      return "ai error";
  }
}

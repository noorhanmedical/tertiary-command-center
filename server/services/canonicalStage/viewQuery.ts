// Phase 2I — shared, validated query helpers for the PCS/ACS canonical views.
//
// Cursor is an OPAQUE base64url of the last ancillaryCaseId (a stable, unique,
// deterministic keyset) — never a patient name/date. Filters are whitelisted to
// exact canonical columns; unknown/invalid values are dropped (never fabricated).

import { ANCILLARY_LIFECYCLE_STATUSES, ANCILLARY_ADMIN_REVIEW_STATUSES } from "@shared/schema/ancillaryCases";

export type CanonicalViewFilters = {
  serviceType?: string | null;
  lifecycleStatus?: string | null;
  adminReviewStatus?: string | null;
};

const LIFECYCLE = new Set<string>(ANCILLARY_LIFECYCLE_STATUSES as unknown as string[]);
// The canonical case column stores the four base review statuses; validate to them.
const ADMIN_REVIEW = new Set<string>(ANCILLARY_ADMIN_REVIEW_STATUSES as unknown as string[]);
// Bounded service-type acceptance: any non-empty short token (canonical services
// are free-text but exact). We only pass an exact-match string to SQL, never a
// pattern; an over-long value is rejected to avoid abuse.
function cleanService(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 64 ? s : null;
}

export function loadCaseFilters(f?: CanonicalViewFilters): Required<CanonicalViewFilters> {
  const lifecycle = typeof f?.lifecycleStatus === "string" && LIFECYCLE.has(f.lifecycleStatus) ? f.lifecycleStatus : null;
  const admin = typeof f?.adminReviewStatus === "string" && ADMIN_REVIEW.has(f.adminReviewStatus) ? f.adminReviewStatus : null;
  return { serviceType: cleanService(f?.serviceType), lifecycleStatus: lifecycle, adminReviewStatus: admin };
}

export function decodeCursor(cursor?: string | null): number | null {
  if (typeof cursor !== "string" || cursor.length === 0) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const n = Number.parseInt(raw, 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}
export function encodeCursor(lastId: number): string {
  return Buffer.from(String(lastId), "utf8").toString("base64url");
}

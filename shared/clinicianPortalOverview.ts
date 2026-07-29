// Phase 2H — shared serialized DTO for the canonical Clinician Portal overview.
//
// One clinic-scoped, READ-ONLY contract rendered by the client (never recomputed
// from raw rows). Each of the three tiles (Finance / Orders & Notes / Engagement)
// carries its OWN availability + warnings + bounded counts/rows so a failed or
// upstream-disabled section is shown TRUTHFULLY (unavailable), never as a zero
// count. No revenue / claim / payment fields. No raw document bytes. No global
// Plexus identity ids — only an opaque ancillaryCaseId + existing display fields.

export const CLINICIAN_PORTAL_OVERVIEW_VERSION = "clinician_portal_overview_v1";
export const CLINICIAN_PORTAL_OVERVIEW_ROW_LIMIT = 50;

/** Per-section availability — a section is NEVER silently zero. */
export type SectionAvailability =
  | "available"
  | "disabled_flag_off"    // the Phase 2H flag is OFF
  | "upstream_flag_off"    // this section's required upstream canonical flag is OFF
  | "migration_missing"    // the canonical migration is not applied
  | "unavailable";         // the section's read failed

export type CodeCount = { code: string; count: number };

// ─── Finance tile — operational billing readiness ONLY (no financial totals) ──
export type FinanceOverviewRow = {
  ancillaryCaseId: number;
  serviceType: string;
  patientDisplay: string | null;
  readinessStatus: string | null;          // canonical readiness canonical_status
  billingDocumentStatus: string | null;    // canonical Billing Document canonical_status
  billingBlockerCount: number;
  claimBlockerCount: number;
  evaluatedAt: string | null;
};
export type FinanceOverview = {
  availability: SectionAvailability;
  warnings: string[];
  counts: {
    evaluated: number;
    readyToGenerate: number;
    missingRequirements: number;
    billingDocumentPending: number;
    billingDocumentGenerated: number;
    claimBlockedOnly: number;
    supersededOrInvalidated: number;
  };
  billingBlockersByCode: CodeCount[];
  claimBlockersByCode: CodeCount[];
  lastEvaluatedAt: string | null;
  rows: FinanceOverviewRow[];
};

// ─── Orders & Notes tile — Unified Ancillary Documents spine ──────────────────
export type OrdersNotesRow = {
  ancillaryCaseId: number;
  serviceType: string | null;
  patientDisplay: string | null;
  documentKind: "order_note" | "procedure_note" | "report";
  documentStatus: string;
  signedAt: string | null;
  effectiveClinicalDate: string | null;
  actualCreatedAt: string | null;
};
export type OrdersNotesOverview = {
  availability: SectionAvailability;
  warnings: string[];
  counts: {
    currentOrderNotes: number;
    currentProcedureNotes: number;
    currentReports: number;
    pendingSignatures: number;
    returnedForCorrection: number;
    generatedNotes: number;
    missingEvidence: number;
  };
  rows: OrdersNotesRow[];
};

// ─── Engagement tile — service-specific ancillary case + Admin Review ─────────
export type EngagementRow = {
  ancillaryCaseId: number;
  serviceType: string;
  patientDisplay: string | null;
  adminReviewStatus: string | null;
  lifecycleStatus: string | null;
  engagementListName: string | null;
  lastSentAt: string | null;
};
export type EngagementOverview = {
  availability: SectionAvailability;
  warnings: string[];
  counts: {
    activeCases: number;
    approved: number;
    needsInformation: number;
    pending: number;
    rejected: number;
  };
  rows: EngagementRow[];
};

export type ClinicianPortalCanonicalOverview = {
  disabled: boolean;
  generatedAt: string;
  dataVersion: string;
  clinicScoped: boolean;
  finance: FinanceOverview;
  ordersNotes: OrdersNotesOverview;
  engagement: EngagementOverview;
};

/** The explicit disabled contract returned when the Phase 2H flag is OFF —
 *  produced BEFORE any canonical read. */
export function disabledClinicianPortalOverview(generatedAt: string): ClinicianPortalCanonicalOverview {
  const off = (): SectionAvailability => "disabled_flag_off";
  return {
    disabled: true,
    generatedAt,
    dataVersion: CLINICIAN_PORTAL_OVERVIEW_VERSION,
    clinicScoped: true,
    finance: { availability: off(), warnings: [], counts: { evaluated: 0, readyToGenerate: 0, missingRequirements: 0, billingDocumentPending: 0, billingDocumentGenerated: 0, claimBlockedOnly: 0, supersededOrInvalidated: 0 }, billingBlockersByCode: [], claimBlockersByCode: [], lastEvaluatedAt: null, rows: [] },
    ordersNotes: { availability: off(), warnings: [], counts: { currentOrderNotes: 0, currentProcedureNotes: 0, currentReports: 0, pendingSignatures: 0, returnedForCorrection: 0, generatedNotes: 0, missingEvidence: 0 }, rows: [] },
    engagement: { availability: off(), warnings: [], counts: { activeCases: 0, approved: 0, needsInformation: 0, pending: 0, rejected: 0 }, rows: [] },
  };
}

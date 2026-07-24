// Engagement call-list service module — scaffold (Batch 15 of
// Engagement completion run).
//
// DORMANT — no route or runtime caller imports this service yet.
// Defines the read-model envelope + the dep-injected contract a
// future Batch 17 route will use to read the canonical call list.
//
// READ-ONLY CONTRACT
//   - The service performs ZERO writes. No drizzle insert / update /
//     delete verbs; no storage-layer mutators; no journey-event
//     append; no assignment-table mutators.
//   - All actual reads happen through dep-injected fetcher functions
//     so this module stays pure (no DB / Express / @shared/schema /
//     route / storage imports).
//   - The route (Batch 17) wires the deps to real repositories.
//   - The future Team Portal projection caller may extend the service
//     with surface-specific transformations without touching this
//     scaffold's contract.
//
// REFERENCED CONTRACTS
//   - docs/architecture/engagement-call-list-ownership-final-contract.md
//   - docs/architecture/engagement-call-list-service-module-plan.md

// Type-only import — erased at compile, preserves the module's purity.
import type { AncillaryAppointmentProjection } from "@shared/types/canonicalAppointment";

/** Canonical engagement-status transitions (non-terminal). */
export type EngagementCallListEngagementStatus =
  | "contacted"
  | "in_progress"
  | "not_reached"
  | "needs_followup"
  | null;

/**
 * One canonical engagement call-list item. No PHI — patient name /
 * DOB / MRN stay route-side and are joined for display only by
 * downstream consumers.
 */
export type EngagementCallListItem = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  engagementStatus: EngagementCallListEngagementStatus;
  lifecycleStatus: string | null;
  assignedTeamMemberId: string | null;
  /** Legacy role string preserved per Batch D §6 of split-brain run. */
  assignedRole: string | null;
  appointmentStatus: string | null;
  nextActionAt: string | null;
  facilityId: string | null;
  /** Present when joined from scheduler_assignments for the day. */
  callListAssignmentDate: string | null;
  /**
   * Phase 2C — service-level eligibility. When
   * FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC is ON, this reflects the
   * approved-and-membership-active services only. When OFF, this
   * mirrors selectedServices (legacy compat).
   */
  eligibleServices?: string[];
  /**
   * Phase 2D-D1 — canonical per-service appointment projection. Present
   * only when FEATURE_CANONICAL_APPOINTMENT is ON and keyed by
   * serviceType (one active event per ancillary case; historical events
   * are history-only). Never inferred from appointmentStatus/doctor_visit.
   */
  appointmentByService?: Record<string, AncillaryAppointmentProjection>;
};

/**
 * Filter envelope. All fields optional. The route maps query strings
 * onto this shape before invoking the service.
 */
export type EngagementCallListFilters = {
  facilityId?: string | null;
  assignedTeamMemberId?: string | null;
  assignedRole?: string | null;
  engagementStatus?: EngagementCallListEngagementStatus;
  callListAssignmentDate?: string | null;
  limit?: number;
};

/**
 * The injected fetcher returns a list of items already projected
 * onto the canonical envelope. The service does NOT itself parse
 * filters or compute pagination — the route + repository own those.
 * The service exists to be the single canonical surface every future
 * consumer goes through, so any cross-cutting concerns
 * (terminology, role coercion, status normalization) can live HERE.
 */
export type EngagementCallListDependencies = {
  listEngagementCallListItems: (
    filters: EngagementCallListFilters,
  ) => Promise<ReadonlyArray<EngagementCallListItem>>;
};

export type EngagementCallListResponse = {
  items: ReadonlyArray<EngagementCallListItem>;
  /** Count returned (after the repository's limit applied). */
  count: number;
};

/**
 * Read the canonical engagement call list. The service:
 *   1. Validates the filters envelope (limit clamp + role coercion).
 *   2. Delegates the actual read to the injected fetcher.
 *   3. Returns the canonical response envelope.
 *
 * Pure: no DB / no Express / no PHI logging.
 */
export async function getEngagementCallList(
  filters: EngagementCallListFilters,
  deps: EngagementCallListDependencies,
): Promise<EngagementCallListResponse> {
  const safeLimit = clampLimit(filters.limit);
  const normalizedFilters: EngagementCallListFilters = {
    ...filters,
    limit: safeLimit,
  };
  const items = await deps.listEngagementCallListItems(normalizedFilters);
  return { items, count: items.length };
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

// Engagement Center board — module contracts (Batch 13 / Bundle 5).
//
// READ-ONLY module skeleton. NOT WIRED to any route in this batch.
// The future Batch 13 wiring will add additive endpoints alongside
// the legacy GET /api/engagement/assignment-board handler. The legacy
// handler is preserved verbatim during the additive rollout and is
// only retired after the v2 endpoint reaches parity.
//
// Same pattern as the operational-queue module — see
// server/modules/operational-queue/contracts.ts for the precedent
// established by Batch 11a.

import type { EngagementBoardRow } from "@shared/contracts/engagementBoard";

export type { EngagementBoardRow };

/**
 * Filter shape for the v2 read-side helper. Mirrors the query-param
 * surface of GET /api/engagement/assignment-board with one addition
 * (`cursor`) reserved for pagination.
 *
 * `cursor` is NOT supported by the legacy endpoint; it lives here so
 * future v2 callers can request the next page without rebuilding the
 * filter object. The v2 service will return `nextCursor` when more
 * rows exist.
 */
export type EngagementBoardFilters = {
  facility?: string;
  assignedTeamMemberId?: number;
  engagementStatus?: string;
  engagementBucket?: string;
  patientType?: string;
  unassignedOnly?: boolean;
  missingInfoOnly?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
};

/**
 * Summary aggregate returned alongside rows. Mirrors the inline
 * `BoardSummary` type in the legacy route file.
 */
export type EngagementBoardSummary = {
  total: number;
  assigned: number;
  unassigned: number;
  needsInfo: number;
  byFacility: Array<{ facility: string; count: number }>;
  byAssignedTeamMember: Array<{ name: string; count: number }>;
  byEngagementStatus: Array<{ status: string; count: number }>;
};

/**
 * V2 response envelope. Adds `nextCursor` for pagination; the legacy
 * `{ rows, summary }` shape remains the canonical body for the v1
 * endpoint.
 */
export type EngagementBoardResponse = {
  rows: EngagementBoardRow[];
  summary: EngagementBoardSummary;
  nextCursor: string | null;
};

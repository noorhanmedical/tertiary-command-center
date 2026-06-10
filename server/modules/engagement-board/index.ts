// Engagement Center board — module barrel (Batch 13 / Bundle 5).
//
// Re-exports the contract types only. No service helpers yet —
// the v2 read service ships in a later batch behind its own
// additive route. Until that route lands, NO code path imports
// from this module at runtime; only TypeScript type imports are
// active today.
//
// See server/modules/operational-queue/index.ts for the same
// dormant-module pattern from Batch 11a.

export * from "./contracts";

// Bundle 23 — dormant pure-helpers service. Re-exported so the
// future v2 wiring PR adopts the helpers with one import. The
// dormancy invariant in scripts/qa-engagement-board-dormant-service.mjs
// fails CI if any non-test file imports from this module.
export {
  applyEngagementBoardFilters,
  computeEngagementBoardSummary,
  computeMissingInfoFromScreening,
  sortEngagementBoardRows,
  type ScreeningInfoSlice,
} from "./service";

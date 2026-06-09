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

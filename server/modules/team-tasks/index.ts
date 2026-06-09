// Team-task spine — barrel.
//
// Re-exports the public contract types and read-only service helpers.
// This module is intentionally not wired to any route in this batch
// (Batch 11). Future batches will switch portal callers from their
// per-domain queries to getTeamTaskView / getTeamTaskViewByPatient.

export * from "./contracts";
export { getTeamTaskView, getTeamTaskViewByPatient } from "./service";

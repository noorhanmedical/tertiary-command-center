// API Integration Station — shared status catalog.
//
// Single source of truth for sync / connection / job status strings.
// Vendor adapters reuse these instead of redefining their own.

import type { IntegrationSyncStatus } from "./integrationTypes";

export const INTEGRATION_SYNC_STATUSES: IntegrationSyncStatus[] = [
  "Requested",
  "Accepted",
  "In Progress",
  "Complete",
  "Partial Complete",
  "Failed",
  "Cancelled",
  "Paused",
  "Not Configured",
  "Backend Pending",
];

// UI tone hint for status badges. Kept here so every vendor adapter
// renders the same colors for the same status.
export const INTEGRATION_STATUS_TONE: Record<
  IntegrationSyncStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  Requested: "secondary",
  Accepted: "secondary",
  "In Progress": "default",
  Complete: "default",
  "Partial Complete": "secondary",
  Failed: "destructive",
  Cancelled: "outline",
  Paused: "outline",
  "Not Configured": "outline",
  "Backend Pending": "outline",
};

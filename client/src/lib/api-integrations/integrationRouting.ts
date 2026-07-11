// API Integration Station — generic downstream routing model.
//
// Every vendor adapter normalizes upstream data through the same
// pipeline:
//   EMR endpoint  →  raw resource store
//                 →  normalization
//                 →  canonical platform modules (Patient Directory,
//                    Plexus IQ, Imaging Central, Ancillary Docs,
//                    Billing Readiness, Engagement Center, …)
//
// Vendor-specific routing tables (e.g., eCW's ServiceRequest →
// Plexus IQ vs Imaging Central rules) live under the vendor
// adapter folder.

import type { IntegrationDownstreamDestination } from "./integrationTypes";

export const INTEGRATION_DOWNSTREAM_DESTINATIONS: IntegrationDownstreamDestination[] = [
  "Patient Directory",
  "Scheduling",
  "Engagement Center",
  "Plexus IQ",
  "Imaging Central",
  "Ancillary Documents",
  "Billing Readiness",
  "Document Library",
  "Patient Journey Timeline",
  "Mission Control",
  "Team Ops",
];

// Pipeline stages — used by the Downstream Routing section in the UI
// and by Phase 2 worker code as the canonical step names.
export const INTEGRATION_PIPELINE_STAGES = [
  {
    id: "fetch",
    label: "Fetch from EMR",
    detail: "Vendor-specific HTTP / SMART-on-FHIR / Bulk FHIR call.",
  },
  {
    id: "raw-store",
    label: "Raw resource store",
    detail: "Append-only `integration_raw_resources` row per upstream resource version.",
  },
  {
    id: "field-map",
    label: "Field mapping",
    detail: "Resolve vendor-native paths to internal columns via `integration_field_mappings`.",
  },
  {
    id: "identity-match",
    label: "Patient identity match",
    detail: "Score the candidate against existing patients; auto-merge above threshold.",
  },
  {
    id: "downstream-route",
    label: "Downstream route",
    detail: "Write into the destination module table(s).",
  },
  {
    id: "audit",
    label: "Audit log",
    detail: "Append a `Sync Completed` / `Sync Failed` row to `integration_audit_log`.",
  },
  {
    id: "stats",
    label: "Stats update",
    detail: "Update per-resource counts on `integration_scopes`.",
  },
] as const;

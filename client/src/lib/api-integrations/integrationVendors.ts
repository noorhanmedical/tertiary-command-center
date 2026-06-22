// API Integration Station — vendor catalog.
//
// PHASE 1 SCOPE: eClinicalWorks ships as the first available vendor
// adapter. Every other vendor below is a placeholder marked
// "Future vendor adapter" — disabled in the UI, never wired to a
// network call, never able to look active.

import {
  Activity,
  Cable,
  Hospital,
  Network,
  PlugZap,
  Stethoscope,
  Workflow,
  Layers,
} from "lucide-react";
import type { IntegrationVendorAdapterCard } from "./integrationTypes";

export const INTEGRATION_VENDOR_ADAPTERS: IntegrationVendorAdapterCard[] = [
  {
    vendor: "eClinicalWorks",
    shortLabel: "eCW",
    description:
      "FHIR R4 — 18 read/import scopes. First supported vendor adapter. Backend, credential vault, and sync worker land in Phase 2.",
    Icon: PlugZap,
    status: "Available",
    adapterSectionId: "ecw-connection",
  },
  {
    vendor: "Epic",
    shortLabel: "Epic",
    description:
      "FHIR R4 + App Orchard. Future vendor adapter — not implemented in Phase 1.",
    Icon: Hospital,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "Athena",
    shortLabel: "Athena",
    description:
      "athenahealth FHIR + proprietary API. Future vendor adapter — not implemented in Phase 1.",
    Icon: Activity,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "Oracle Health (Cerner)",
    shortLabel: "Cerner",
    description:
      "FHIR R4 via Code Console. Future vendor adapter — not implemented in Phase 1.",
    Icon: Network,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "NextGen",
    shortLabel: "NextGen",
    description:
      "FHIR R4. Future vendor adapter — not implemented in Phase 1.",
    Icon: Stethoscope,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "Veradigm",
    shortLabel: "Veradigm",
    description:
      "FHIR R4. Future vendor adapter — not implemented in Phase 1.",
    Icon: Workflow,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "Meditech",
    shortLabel: "Meditech",
    description:
      "Greenfield + Expanse FHIR. Future vendor adapter — not implemented in Phase 1.",
    Icon: Layers,
    status: "Future",
    adapterSectionId: null,
  },
  {
    vendor: "Other FHIR R4 EMR",
    shortLabel: "Other",
    description:
      "Generic FHIR R4 endpoint. Future vendor adapter — register-by-spec only, not implemented in Phase 1.",
    Icon: Cable,
    status: "Future",
    adapterSectionId: null,
  },
];

export function getVendorAdapter(
  vendor: IntegrationVendorAdapterCard["vendor"],
): IntegrationVendorAdapterCard | undefined {
  return INTEGRATION_VENDOR_ADAPTERS.find((v) => v.vendor === vendor);
}

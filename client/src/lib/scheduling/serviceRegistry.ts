// Client access to the canonical ancillary service registry for the unified
// scheduler. The registry (ancillary_service_registry + facility_service_settings)
// is the single source of truth for which services exist and which are active
// for a given facility — replacing the old hardcoded SERVICE_OPTIONS arrays.

import { getAncillaryCategory, type AncillaryCategory } from "@shared/ancillaryCategory";

// The subset of the registry row the scheduler needs.
export type RegistryService = {
  id: number;
  internalCode: string;
  displayName: string;
  category: string; // fine taxonomy (neurocognitive/vascular_*/cardiac/...)
  anatomicRegion: string | null;
  active: boolean;
  cptCode: string | null;
  sortOrder: number;
};

// Fetch the ACTIVE configured services for the selected facility (by canonical
// clinic NAME). Falls back to all globally-active services when the name has no
// clinics row. Returns registry order (sortOrder).
export async function fetchActiveServicesForFacility(
  facilityName: string | null,
): Promise<RegistryService[]> {
  const qs = new URLSearchParams();
  if (facilityName && facilityName.trim()) qs.set("name", facilityName.trim());
  const res = await fetch(
    `/api/service-registry/by-facility-name${qs.toString() ? `?${qs}` : ""}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to load services (${res.status})`);
  const rows = (await res.json()) as RegistryService[];
  return Array.isArray(rows) ? rows : [];
}

// Top-level scheduler category buckets. BrainWave + VitalWave are simple
// top-level choices; every ultrasound/vascular/cardiac study lives under the
// single "Ultrasound" dropdown. Derived from the canonical getAncillaryCategory
// so we never invent a second mapping.
export type SchedulerCategory = "brainwave" | "vitalwave" | "ultrasound";

export function schedulerCategoryOf(service: RegistryService): SchedulerCategory | null {
  const cat: AncillaryCategory = getAncillaryCategory(service.internalCode);
  if (cat === "brainwave") return "brainwave";
  if (cat === "vitalwave") return "vitalwave";
  if (cat === "ultrasound") return "ultrasound";
  // "other" — fold into ultrasound only if it is clearly an imaging study;
  // otherwise exclude from the three-bucket top-level UI.
  return null;
}

// Split active services into the three top-level buckets the scheduler renders.
export function bucketServices(services: RegistryService[]): {
  brainwave: RegistryService | null;
  vitalwave: RegistryService | null;
  ultrasound: RegistryService[];
} {
  let brainwave: RegistryService | null = null;
  let vitalwave: RegistryService | null = null;
  const ultrasound: RegistryService[] = [];
  for (const s of services) {
    const b = schedulerCategoryOf(s);
    if (b === "brainwave" && !brainwave) brainwave = s;
    else if (b === "vitalwave" && !vitalwave) vitalwave = s;
    else if (b === "ultrasound") ultrasound.push(s);
  }
  return { brainwave, vitalwave, ultrasound };
}

import { ClinicianPortalShell } from "./ClinicianPortalShell";

// The Clinician Portal was redesigned into a 3-tile command center
// (Finance, Orders & Notes, Plexus Engagement). The named export is kept
// so the existing /clinician-portal route + physician-portal.tsx entry
// point continue to work unchanged.
export function PhysicianPortalShell() {
  return <ClinicianPortalShell />;
}

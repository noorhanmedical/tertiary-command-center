// Physician Portal — reports + ancillary metrics service.
//
// Owns the workflow decisions (default filters, window sizing) and
// delegates all SQL to server/repositories/physicianPortalOps.repo.ts.
// Route handlers must delegate here — they never touch the DB directly.

import {
  listPhysicianReports,
  buildAncillaryMetrics,
  type PhysicianReportRow,
  type ListPhysicianReportsFilters,
  type AncillaryMetricsRow,
} from "../../repositories/physicianPortalOps.repo";

export type {
  PhysicianReportRow,
  AncillaryMetricsRow,
} from "../../repositories/physicianPortalOps.repo";

/** List physician-visible reports. Defaults to onlyOpen=true so the
 *  default view shows outstanding items, not signed history. */
export async function listReports(
  filters: ListPhysicianReportsFilters & { limit?: number } = {},
): Promise<PhysicianReportRow[]> {
  return listPhysicianReports(
    {
      facilityId: filters.facilityId,
      serviceType: filters.serviceType,
      documentStatus: filters.documentStatus,
      onlyOpen: filters.onlyOpen ?? true,
    },
    filters.limit ?? 100,
  );
}

// Pure clamp / window math lives in ./reportsRules.ts so unit tests can
// import without a DB connection. Re-exported for the single import path.
export {
  defaultAncillaryMetricsWindow,
  clampDaysWindow,
} from "./reportsRules";
import {
  defaultAncillaryMetricsWindow,
  clampDaysWindow,
} from "./reportsRules";

export async function ancillaryMetrics(
  filters: { days?: number; facilityId?: string } = {},
): Promise<AncillaryMetricsRow[]> {
  const days = clampDaysWindow(filters.days, 30);
  const window = defaultAncillaryMetricsWindow(new Date(), days);
  return buildAncillaryMetrics({
    ...window,
    facilityId: filters.facilityId,
  });
}

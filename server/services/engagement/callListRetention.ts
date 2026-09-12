// 90-day snapshot PHI retention purge for Engagement call-list packages.
//
// At/after a package's snapshot_retention_until (created_at + 90 days), this
// removes all frozen member PHI (name/DOB/phone/demographics/services/
// qualification/Atlas) and deletes the durable PDF blob, preserving only the
// minimal NON-PHI audit header (id, tenant/clinic, facility, team member,
// generatedBy, createdAt, patientCount, distributionOperationId, share events,
// generationStatus) plus a purged_at stamp.
//
// This is SEPARATE from the 72h share-access expiry (expiry only blocks the
// link; it never deletes the snapshot). The purge is IDEMPOTENT and TENANT-SAFE
// (per-row FOR UPDATE + purged_at guard in the repository), so re-running is
// safe and an already-purged package is skipped.
//
// Run on a schedule (see script/purgeCallListPackages.ts). No-op when the
// feature/table is absent (getPackagesDueForPurge fails safe to []).

import {
  getPackagesDueForPurge,
  purgePackagePhi,
} from "../../repositories/callListPackages.repo";
import { deleteBlob } from "../blobStore";

export type PurgeSummary = {
  scanned: number;
  purged: number;
  alreadyPurged: number;
  blobsDeleted: number;
  errors: number;
};

/** Optional test seam (mirrors distributionService's deps pattern). Production
 *  callers omit this and get the real repo + blob store. */
export type PurgeDeps = {
  listDue?: (now: Date, limit: number) => Promise<{ id: number }[]>;
  purgeOne?: (
    id: number,
    now: Date,
  ) => Promise<{ purged: boolean; alreadyPurged: boolean; pdfBlobIdToDelete: number | null }>;
  deleteBlobFn?: (blobId: number) => Promise<void>;
};

/** Purge every package past its 90-day snapshot retention. Best-effort per
 *  package: one failure never aborts the batch. */
export async function purgeExpiredCallListPackages(
  now: Date = new Date(),
  limit = 500,
  deps: PurgeDeps = {},
): Promise<PurgeSummary> {
  const listDue = deps.listDue ?? getPackagesDueForPurge;
  const purgeOne = deps.purgeOne ?? purgePackagePhi;
  const deleteBlobFn = deps.deleteBlobFn ?? deleteBlob;
  const due = await listDue(now, limit);
  const summary: PurgeSummary = {
    scanned: due.length,
    purged: 0,
    alreadyPurged: 0,
    blobsDeleted: 0,
    errors: 0,
  };
  for (const pkg of due) {
    try {
      const outcome = await purgeOne(pkg.id, now);
      if (outcome.alreadyPurged) {
        summary.alreadyPurged += 1;
        continue;
      }
      if (outcome.purged) {
        summary.purged += 1;
        if (outcome.pdfBlobIdToDelete != null) {
          try {
            await deleteBlobFn(outcome.pdfBlobIdToDelete);
            summary.blobsDeleted += 1;
          } catch (blobErr) {
            // The PHI is already gone from the DB; a blob-delete failure is
            // logged but does not fail the purge (the row is marked purged and
            // its pdf pointer is null — the orphaned blob can be swept later).
            console.error(
              "[callListRetention] blob delete failed (PHI already purged):",
              { packageId: pkg.id, blobErr: blobErr instanceof Error ? blobErr.message : blobErr },
            );
          }
        }
      }
    } catch (err) {
      summary.errors += 1;
      console.error(
        "[callListRetention] purge failed for package:",
        { packageId: pkg.id, err: err instanceof Error ? err.message : err },
      );
    }
  }
  return summary;
}

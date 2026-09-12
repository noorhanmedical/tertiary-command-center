// Repository for Engagement call-list FROZEN SNAPSHOT / SHARE PACKAGES.
//
// All writes are gated by FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES. Reads
// gracefully return null/empty when the flag is OFF and the migration (0088)
// is absent; when the flag is ON but the table is missing, reads re-throw a
// structured 503 so the misconfiguration is observable (mirrors
// engagementLists.repo).
//
// This layer owns package identity, idempotent creation (by
// distribution_operation_id + team_member_id), the frozen member rows, and the
// share-token lifecycle (mint on create, regenerate, revoke, extend). It never
// mutates member snapshot content after creation — only header lifecycle /
// artifact / link metadata may change.

import { db } from "../db";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  callListPackages,
  callListPackageMembers,
  type CallListPackage,
  type CallListPackageMember,
  type CallListPackageGenerationStatus,
} from "@shared/schema/callListPackages";

/** Approved snapshot PHI retention window (SEPARATE from the 72h share expiry). */
export const SNAPSHOT_RETENTION_DAYS = 90;

// Deploy-blocker fail-safe: memoized probe for whether migration 0088 has been
// applied. Used to refuse the surface (503) when the feature flag is ON but the
// schema is absent — never a silent success and never a partial write.
let _tableProbe: Promise<boolean> | null = null;
export function callListPackagesTableExists(): Promise<boolean> {
  if (_tableProbe == null) {
    _tableProbe = db
      .execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'call_list_packages' LIMIT 1
      `)
      .then((res: unknown) => {
        const rows = (res as { rows?: unknown[] })?.rows;
        return Array.isArray(rows) && rows.length > 0;
      })
      .catch(() => false);
  }
  return _tableProbe;
}

/** Test-only: reset the memoized table probe. */
export function __resetCallListPackagesTableProbe(): void {
  _tableProbe = null;
}

/** created_at + 90 days. */
export function computeSnapshotRetentionUntil(createdAt: Date = new Date()): Date {
  return new Date(createdAt.getTime() + SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
import { featureFlags } from "../lib/featureFlags";
import {
  mintShareToken,
  defaultShareExpiry,
  extendShareExpiry,
  type MintedShareToken,
} from "../services/engagement/callListShareToken";

const PG_UNDEFINED_TABLE = "42P01";

function guardWrite(): void {
  if (!featureFlags.callListPackages) {
    const err = new Error(
      "call_list_packages_write_disabled: enable FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES after applying migration 0088",
    ) as Error & { code?: string; status?: number };
    err.code = "CALL_LIST_PACKAGES_WRITE_DISABLED";
    err.status = 503;
    throw err;
  }
}

async function safeRead<T>(op: () => Promise<T>, fallback: T, opName: string): Promise<T> {
  try {
    return await op();
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === PG_UNDEFINED_TABLE) {
      if (!featureFlags.callListPackages) return fallback;
      const err = new Error(
        `call_list_packages_migration_missing: table absent while flag is ON (op=${opName})`,
      ) as Error & { code?: string; status?: number };
      err.code = "CALL_LIST_PACKAGES_MIGRATION_MISSING";
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
export type CreatePackageMemberInput = {
  executionCaseId: number;
  patientScreeningId?: number | null;
  orderIndex: number;
  patientNameSnapshot: string;
  patientDobSnapshot?: string | null;
  patientPhoneSnapshot?: string | null;
  demographicsSnapshot?: Record<string, unknown> | null;
  servicesSnapshot?: string[] | null;
  reasonForCallSnapshot?: string | null;
  qualificationSummarySnapshot?: Record<string, unknown> | null;
  cohortClassificationSnapshot?: string | null;
  atlasPayloadSnapshot?: Record<string, unknown> | null;
};

export type CreatePackageInput = {
  clinicId?: number | null;
  facilityId: string;
  teamMemberId: number;
  teamMemberNameSnapshot?: string | null;
  generatedByUserId?: string | null;
  serviceDate?: string | null;
  distributionOperationId: string;
  cohortKey: string;
  cohortLabelSnapshot?: string | null;
  serviceFilterSnapshot?: string[] | null;
  summaryMetrics?: Record<string, unknown>;
  members: CreatePackageMemberInput[];
  /** Mint a share token immediately (default true). */
  mintToken?: boolean;
  now?: Date;
};

export type CreatePackageResult = {
  pkg: CallListPackage;
  /** Plaintext token — returned ONCE when a token was minted on this call. */
  token: string | null;
  /** True when this call inserted a new package; false when it already existed
   *  for the (operation, member) identity (idempotent retry). */
  isNew: boolean;
};

export type PackageWithMembers = {
  pkg: CallListPackage;
  members: CallListPackageMember[];
};

// ─── Idempotent creation ──────────────────────────────────────────────────────
/**
 * Create ONE package (+ its frozen members) for a (distributionOperationId,
 * teamMemberId) identity. Idempotent: a retry with the same identity returns
 * the existing package WITHOUT inserting duplicates and WITHOUT minting a new
 * token (token is null on the idempotent return — it was surfaced on the first
 * call only). Runs in a transaction so header + members commit atomically.
 */
export async function createPackageForMember(
  input: CreatePackageInput,
): Promise<CreatePackageResult> {
  guardWrite();
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(callListPackages)
      .where(
        and(
          eq(callListPackages.distributionOperationId, input.distributionOperationId),
          eq(callListPackages.teamMemberId, input.teamMemberId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { pkg: existing[0], token: null, isNew: false };
    }

    let minted: MintedShareToken | null = null;
    const wantToken = input.mintToken !== false;
    if (wantToken) minted = mintShareToken();

    let pkg: CallListPackage;
    try {
      [pkg] = await tx
      .insert(callListPackages)
      .values({
        clinicId: input.clinicId ?? null,
        facilityId: input.facilityId,
        teamMemberId: input.teamMemberId,
        teamMemberNameSnapshot: input.teamMemberNameSnapshot ?? null,
        generatedByUserId: input.generatedByUserId ?? null,
        serviceDate: input.serviceDate ?? null,
        distributionOperationId: input.distributionOperationId,
        cohortKey: input.cohortKey,
        cohortLabelSnapshot: input.cohortLabelSnapshot ?? null,
        serviceFilterSnapshot: (input.serviceFilterSnapshot ?? null) as unknown as never,
        patientCount: input.members.length,
        summaryMetrics: (input.summaryMetrics ?? {}) as unknown as never,
        generationStatus: "pending",
        shareTokenHash: minted?.tokenHash ?? null,
        shareExpiresAt: minted ? defaultShareExpiry(now) : null,
        // 90-day snapshot PHI retention (separate from the 72h share expiry).
        snapshotRetentionUntil: computeSnapshotRetentionUntil(now),
        status: "active",
      })
      .returning();
    } catch (e: unknown) {
      // Concurrency: a parallel confirm with the same (operation, member)
      // identity won the unique index. Re-read and return it idempotently
      // (no new token surfaced — the winner already has one).
      if ((e as { code?: string })?.code === "23505") {
        const [winner] = await tx
          .select()
          .from(callListPackages)
          .where(
            and(
              eq(callListPackages.distributionOperationId, input.distributionOperationId),
              eq(callListPackages.teamMemberId, input.teamMemberId),
            ),
          )
          .limit(1);
        if (winner) return { pkg: winner, token: null, isNew: false };
      }
      throw e;
    }

    if (input.members.length > 0) {
      await tx.insert(callListPackageMembers).values(
        input.members.map((m) => ({
          packageId: pkg.id,
          executionCaseId: m.executionCaseId,
          patientScreeningId: m.patientScreeningId ?? null,
          orderIndex: m.orderIndex,
          patientNameSnapshot: m.patientNameSnapshot,
          patientDobSnapshot: m.patientDobSnapshot ?? null,
          patientPhoneSnapshot: m.patientPhoneSnapshot ?? null,
          demographicsSnapshot: (m.demographicsSnapshot ?? null) as unknown as never,
          servicesSnapshot: (m.servicesSnapshot ?? null) as unknown as never,
          reasonForCallSnapshot: m.reasonForCallSnapshot ?? null,
          qualificationSummarySnapshot: (m.qualificationSummarySnapshot ?? null) as unknown as never,
          cohortClassificationSnapshot: m.cohortClassificationSnapshot ?? null,
          atlasPayloadSnapshot: (m.atlasPayloadSnapshot ?? null) as unknown as never,
        })),
      );
    }

    return { pkg, token: minted?.token ?? null, isNew: true };
  });
}

// ─── Reads ─────────────────────────────────────────────────────────────────
export async function getPackageById(id: number): Promise<CallListPackage | null> {
  return safeRead(
    async () => {
      const [row] = await db
        .select()
        .from(callListPackages)
        .where(eq(callListPackages.id, id))
        .limit(1);
      return row ?? null;
    },
    null,
    "getPackageById",
  );
}

/** Look up a package by the sha256 hash of a presented token. Access validity
 *  (expiry/revocation) is resolved by the caller via resolveShareAccess. */
export async function getPackageByTokenHash(
  tokenHash: string,
): Promise<CallListPackage | null> {
  return safeRead(
    async () => {
      const [row] = await db
        .select()
        .from(callListPackages)
        .where(eq(callListPackages.shareTokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },
    null,
    "getPackageByTokenHash",
  );
}

export async function getPackageWithMembers(
  id: number,
): Promise<PackageWithMembers | null> {
  return safeRead(
    async () => {
      const [pkg] = await db
        .select()
        .from(callListPackages)
        .where(eq(callListPackages.id, id))
        .limit(1);
      if (!pkg) return null;
      const members = await db
        .select()
        .from(callListPackageMembers)
        .where(eq(callListPackageMembers.packageId, id))
        .orderBy(callListPackageMembers.orderIndex, callListPackageMembers.id);
      return { pkg, members };
    },
    null,
    "getPackageWithMembers",
  );
}

/** All packages produced by one Confirm operation (one per team member). */
export async function listPackagesByOperation(
  distributionOperationId: string,
): Promise<CallListPackage[]> {
  return safeRead(
    async () =>
      db
        .select()
        .from(callListPackages)
        .where(eq(callListPackages.distributionOperationId, distributionOperationId))
        .orderBy(desc(callListPackages.id)),
    [] as CallListPackage[],
    "listPackagesByOperation",
  );
}

/** Recent Generated Lists (Engagement-internal), scoped by facility/clinic.
 *  `facilityIds` (when provided) restricts to that SET — the server-authoritative
 *  manager facility scope. An EMPTY facilityIds means "no authorized facility"
 *  → returns nothing (fail-closed), never all. */
export async function listRecentPackages(args: {
  clinicId?: number | null;
  facilityId?: string | null;
  facilityIds?: string[] | null;
  limit?: number;
}): Promise<CallListPackage[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 25), 200);
  return safeRead(
    async () => {
      const conds = [];
      if (args.clinicId != null) conds.push(eq(callListPackages.clinicId, args.clinicId));
      if (args.facilityIds != null) {
        if (args.facilityIds.length === 0) return [] as CallListPackage[]; // fail-closed
        conds.push(inArray(callListPackages.facilityId, args.facilityIds));
      } else if (args.facilityId) {
        conds.push(eq(callListPackages.facilityId, args.facilityId));
      }
      const q = db.select().from(callListPackages);
      const rows = await (conds.length > 0 ? q.where(and(...conds)) : q)
        .orderBy(desc(callListPackages.createdAt), desc(callListPackages.id))
        .limit(limit);
      return rows;
    },
    [] as CallListPackage[],
    "listRecentPackages",
  );
}

// ─── Header lifecycle mutations (never touch frozen member snapshots) ─────────
async function touch(id: number, patch: Partial<typeof callListPackages.$inferInsert>) {
  const [row] = await db
    .update(callListPackages)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(callListPackages.id, id))
    .returning();
  return row ?? null;
}

/** Set PDF generation status (+ optional stored blob / error code). */
export async function setGenerationStatus(
  id: number,
  status: CallListPackageGenerationStatus,
  opts: { pdfBlobId?: number | null; errorCode?: string | null } = {},
): Promise<CallListPackage | null> {
  guardWrite();
  const patch: Partial<typeof callListPackages.$inferInsert> = { generationStatus: status };
  if (opts.pdfBlobId !== undefined) patch.pdfBlobId = opts.pdfBlobId;
  if (opts.errorCode !== undefined) patch.generationErrorCode = opts.errorCode;
  return touch(id, patch);
}

/** Revoke the share link — effective immediately (public endpoint denies). */
export async function revokePackageShare(
  id: number,
  now: Date = new Date(),
): Promise<CallListPackage | null> {
  guardWrite();
  return touch(id, { shareRevokedAt: now });
}

/** Extend the share access window by `hours` from now (never shortens). */
export async function extendPackageShare(
  id: number,
  hours: number,
  now: Date = new Date(),
): Promise<CallListPackage | null> {
  guardWrite();
  const pkg = await getPackageById(id);
  if (!pkg) return null;
  const next = extendShareExpiry(pkg.shareExpiresAt ?? null, hours, now);
  return touch(id, { shareExpiresAt: next });
}

export type RegenerateResult = { pkg: CallListPackage; token: string } | null;

/** Regenerate the share token: mint a new random token, atomically replace the
 *  stored hash (old token instantly invalid), clear revocation, reset expiry to
 *  the default window, and record the regeneration instant. Returns the new
 *  plaintext token ONCE. */
export async function regeneratePackageShareToken(
  id: number,
  now: Date = new Date(),
): Promise<RegenerateResult> {
  guardWrite();
  const minted = mintShareToken();
  const [row] = await db
    .update(callListPackages)
    .set({
      shareTokenHash: minted.tokenHash,
      shareExpiresAt: defaultShareExpiry(now),
      shareRevokedAt: null,
      shareRegeneratedAt: now,
      updatedAt: now,
    })
    .where(eq(callListPackages.id, id))
    .returning();
  if (!row) return null;
  return { pkg: row, token: minted.token };
}

// ─── Retention purge (90-day snapshot PHI purge) ─────────────────────────────

/** Packages whose snapshot retention has passed and that are NOT yet purged.
 *  Fail-safe: returns [] when the table is absent (flag-off). */
export async function getPackagesDueForPurge(
  now: Date = new Date(),
  limit = 500,
): Promise<CallListPackage[]> {
  const safeLimit = Math.min(Math.max(1, limit), 5000);
  return safeRead(
    async () =>
      db
        .select()
        .from(callListPackages)
        .where(
          and(
            isNull(callListPackages.purgedAt),
            lte(callListPackages.snapshotRetentionUntil, now),
          ),
        )
        .orderBy(callListPackages.snapshotRetentionUntil)
        .limit(safeLimit),
    [] as CallListPackage[],
    "getPackagesDueForPurge",
  );
}

export type PurgeOutcome = {
  purged: boolean;
  alreadyPurged: boolean;
  /** The PDF blob id that must be deleted by the caller (service layer), or
   *  null. Returned only when THIS call performed the purge. */
  pdfBlobIdToDelete: number | null;
};

/**
 * Purge one package's member PHI + mark the header purged. IDEMPOTENT and
 * TENANT-SAFE: a row-level FOR UPDATE lock + `purged_at IS NULL` guard means a
 * concurrent/duplicate purge is a no-op (alreadyPurged=true). Preserves the
 * non-PHI audit header (id, clinic, facility, team member, generatedBy,
 * createdAt, patientCount, distributionOperationId, status, share events,
 * generationStatus) and stamps purged_at. The PDF blob is deleted by the
 * caller using the returned id (filesystem/blob store lives outside this tx).
 */
export async function purgePackagePhi(
  id: number,
  now: Date = new Date(),
): Promise<PurgeOutcome> {
  guardWrite();
  return db.transaction(async (tx) => {
    const [pkg] = await tx
      .select()
      .from(callListPackages)
      .where(eq(callListPackages.id, id))
      .for("update")
      .limit(1);
    if (!pkg) return { purged: false, alreadyPurged: false, pdfBlobIdToDelete: null };
    if (pkg.purgedAt != null) {
      return { purged: false, alreadyPurged: true, pdfBlobIdToDelete: null };
    }
    const pdfBlobId = pkg.pdfBlobId ?? null;

    // Null out ALL member PHI. patient_name_snapshot is NOT NULL → sentinel.
    await tx
      .update(callListPackageMembers)
      .set({
        patientNameSnapshot: "[purged]",
        patientDobSnapshot: null,
        patientPhoneSnapshot: null,
        demographicsSnapshot: null,
        servicesSnapshot: null,
        reasonForCallSnapshot: null,
        qualificationSummarySnapshot: null,
        cohortClassificationSnapshot: null,
        atlasPayloadSnapshot: null,
      })
      .where(eq(callListPackageMembers.packageId, id));

    // Header: drop the PDF pointer, stamp purge. Non-PHI audit fields preserved.
    await tx
      .update(callListPackages)
      .set({ pdfBlobId: null, purgedAt: now, updatedAt: now })
      .where(eq(callListPackages.id, id));

    return { purged: true, alreadyPurged: false, pdfBlobIdToDelete: pdfBlobId };
  });
}

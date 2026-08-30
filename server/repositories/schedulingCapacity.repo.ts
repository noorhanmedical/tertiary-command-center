// Scheduling Resource Capacity repository.
//
// Reads/writes the per-facility equipment configuration
// (facility_resource_capacity) and temporary date-range outages
// (temporary_capacity_overrides). The availability engine consumes the
// EFFECTIVE capacity produced here (defaults merged with stored rows, then an
// active override for the target date applied).

import { and, eq, lte, gte, desc } from "drizzle-orm";
import { db } from "../db";
import {
  facilityResourceCapacity,
  temporaryCapacityOverrides,
  RESOURCE_TYPES,
  type ResourceType,
  type FacilityResourceCapacity,
  type InsertFacilityResourceCapacity,
  type TemporaryCapacityOverride,
  type InsertTemporaryCapacityOverride,
} from "@shared/schema/schedulingCapacity";
import {
  DEFAULT_RESOURCE_CAPACITY,
  type ResourceCapacityConfig,
} from "@shared/scheduling/capacityDefaults";

// ─── facility_resource_capacity ─────────────────────────────────────────────

export async function listFacilityCapacity(
  clinicId: number,
): Promise<FacilityResourceCapacity[]> {
  return db
    .select()
    .from(facilityResourceCapacity)
    .where(eq(facilityResourceCapacity.clinicId, clinicId))
    .orderBy(facilityResourceCapacity.resourceType);
}

/**
 * The effective DEFAULT (permanent) capacity for every resource at a facility:
 * stored rows overriding the code defaults. Always returns all three resources.
 */
export async function getEffectiveCapacityConfig(
  clinicId: number | null,
): Promise<Record<ResourceType, ResourceCapacityConfig>> {
  const out: Record<ResourceType, ResourceCapacityConfig> = {
    brainwave: { ...DEFAULT_RESOURCE_CAPACITY.brainwave },
    vitalwave: { ...DEFAULT_RESOURCE_CAPACITY.vitalwave },
    ultrasound: { ...DEFAULT_RESOURCE_CAPACITY.ultrasound },
  };
  if (clinicId == null) return out;
  const rows = await listFacilityCapacity(clinicId);
  for (const r of rows) {
    if (!RESOURCE_TYPES.includes(r.resourceType as ResourceType)) continue;
    const rt = r.resourceType as ResourceType;
    out[rt] = {
      resourceType: rt,
      machineCount: r.machineCount,
      durationMinutes: r.durationMinutes,
      minutesPerStudy: r.minutesPerStudy ?? DEFAULT_RESOURCE_CAPACITY[rt].minutesPerStudy,
      turnoverMinutes: r.turnoverMinutes,
    };
  }
  return out;
}

/** Upsert one resource's permanent capacity for a facility (by clinic+resource). */
export async function upsertFacilityCapacity(
  clinicId: number,
  input: Omit<InsertFacilityResourceCapacity, "clinicId">,
): Promise<FacilityResourceCapacity> {
  const [existing] = await db
    .select()
    .from(facilityResourceCapacity)
    .where(
      and(
        eq(facilityResourceCapacity.clinicId, clinicId),
        eq(facilityResourceCapacity.resourceType, input.resourceType),
      ),
    )
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(facilityResourceCapacity)
      .set({
        machineCount: input.machineCount,
        durationMinutes: input.durationMinutes,
        minutesPerStudy: input.minutesPerStudy ?? null,
        turnoverMinutes: input.turnoverMinutes,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(facilityResourceCapacity.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(facilityResourceCapacity)
    .values({ ...input, clinicId })
    .returning();
  return row;
}

// ─── temporary_capacity_overrides ────────────────────────────────────────────

export async function listOverridesForClinic(
  clinicId: number,
  opts: { activeOnly?: boolean } = {},
): Promise<TemporaryCapacityOverride[]> {
  const conds = [eq(temporaryCapacityOverrides.clinicId, clinicId)];
  if (opts.activeOnly) conds.push(eq(temporaryCapacityOverrides.active, true));
  return db
    .select()
    .from(temporaryCapacityOverrides)
    .where(and(...conds))
    .orderBy(desc(temporaryCapacityOverrides.startDate));
}

/** Active overrides that cover a specific date (YYYY-MM-DD) for a clinic. */
export async function listActiveOverridesForDate(
  clinicId: number,
  isoDate: string,
): Promise<TemporaryCapacityOverride[]> {
  return db
    .select()
    .from(temporaryCapacityOverrides)
    .where(
      and(
        eq(temporaryCapacityOverrides.clinicId, clinicId),
        eq(temporaryCapacityOverrides.active, true),
        lte(temporaryCapacityOverrides.startDate, isoDate),
        gte(temporaryCapacityOverrides.endDate, isoDate),
      ),
    );
}

export async function getOverrideById(
  id: number,
): Promise<TemporaryCapacityOverride | undefined> {
  const [row] = await db
    .select()
    .from(temporaryCapacityOverrides)
    .where(eq(temporaryCapacityOverrides.id, id))
    .limit(1);
  return row;
}

export async function createOverride(
  input: InsertTemporaryCapacityOverride,
): Promise<TemporaryCapacityOverride> {
  const [row] = await db
    .insert(temporaryCapacityOverrides)
    .values(input)
    .returning();
  return row;
}

/** Lift an override early (soft-disable, preserving history). */
export async function deactivateOverride(
  id: number,
): Promise<TemporaryCapacityOverride | undefined> {
  const [row] = await db
    .update(temporaryCapacityOverrides)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(temporaryCapacityOverrides.id, id))
    .returning();
  return row;
}

/**
 * Apply active overrides for a date onto the default config, producing the
 * effective machine count per resource for that specific date. Duration /
 * turnover are unaffected by outages — only the concurrency (machineCount).
 */
export function applyOverridesForDate(
  base: Record<ResourceType, ResourceCapacityConfig>,
  overrides: TemporaryCapacityOverride[],
): Record<ResourceType, ResourceCapacityConfig> {
  const out: Record<ResourceType, ResourceCapacityConfig> = {
    brainwave: { ...base.brainwave },
    vitalwave: { ...base.vitalwave },
    ultrasound: { ...base.ultrasound },
  };
  // If multiple overrides target the same resource on the same date, the most
  // restrictive (lowest available capacity) wins — the equipment reality.
  for (const o of overrides) {
    const rt = o.resourceType as ResourceType;
    if (!out[rt]) continue;
    out[rt] = { ...out[rt], machineCount: Math.min(out[rt].machineCount, o.availableCapacity) };
  }
  return out;
}

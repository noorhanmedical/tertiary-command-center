import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  ancillaryServiceRegistry,
  facilityServiceSettings,
  type AncillaryServiceRegistryEntry,
  type InsertAncillaryServiceRegistryEntry,
  type FacilityServiceSetting,
  type InsertFacilityServiceSetting,
} from "@shared/schema/ancillaryServiceRegistry";

// ─── Service Registry ─────────────────────────────────────────────────────

export async function listServices(
  opts: { activeOnly?: boolean } = {},
): Promise<AncillaryServiceRegistryEntry[]> {
  if (opts.activeOnly) {
    return db
      .select()
      .from(ancillaryServiceRegistry)
      .where(eq(ancillaryServiceRegistry.active, true))
      .orderBy(ancillaryServiceRegistry.sortOrder);
  }
  return db
    .select()
    .from(ancillaryServiceRegistry)
    .orderBy(ancillaryServiceRegistry.sortOrder);
}

export async function getServiceByCode(
  internalCode: string,
): Promise<AncillaryServiceRegistryEntry | undefined> {
  const [result] = await db
    .select()
    .from(ancillaryServiceRegistry)
    .where(eq(ancillaryServiceRegistry.internalCode, internalCode))
    .limit(1);
  return result;
}

export async function getServiceById(
  id: number,
): Promise<AncillaryServiceRegistryEntry | undefined> {
  const [result] = await db
    .select()
    .from(ancillaryServiceRegistry)
    .where(eq(ancillaryServiceRegistry.id, id))
    .limit(1);
  return result;
}

export async function createService(
  input: InsertAncillaryServiceRegistryEntry,
): Promise<AncillaryServiceRegistryEntry> {
  const [result] = await db
    .insert(ancillaryServiceRegistry)
    .values(input)
    .returning();
  return result;
}

export async function updateService(
  id: number,
  updates: Partial<Omit<InsertAncillaryServiceRegistryEntry, "id">>,
): Promise<AncillaryServiceRegistryEntry | undefined> {
  const [result] = await db
    .update(ancillaryServiceRegistry)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(ancillaryServiceRegistry.id, id))
    .returning();
  return result;
}

// ─── Facility Service Settings ────────────────────────────────────────────

export async function listFacilityServices(
  clinicId: number,
): Promise<FacilityServiceSetting[]> {
  return db
    .select()
    .from(facilityServiceSettings)
    .where(eq(facilityServiceSettings.clinicId, clinicId));
}

export async function upsertFacilityService(
  input: InsertFacilityServiceSetting,
): Promise<FacilityServiceSetting> {
  const [existing] = await db
    .select()
    .from(facilityServiceSettings)
    .where(
      and(
        eq(facilityServiceSettings.clinicId, input.clinicId),
        eq(facilityServiceSettings.serviceCode, input.serviceCode),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(facilityServiceSettings)
      .set({
        enabled: input.enabled,
        qualificationModeOverride: input.qualificationModeOverride ?? undefined,
        cooldownMonthsOverride: input.cooldownMonthsOverride ?? undefined,
        metadata: input.metadata ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(facilityServiceSettings.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(facilityServiceSettings)
    .values(input)
    .returning();
  return created;
}

// ─── Convenience: active services for a facility ──────────────────────────

export async function getActiveServicesForFacility(
  clinicId: number,
): Promise<AncillaryServiceRegistryEntry[]> {
  // Get all globally active services, then filter by facility enablement.
  // If no facility_service_settings row exists for a service, it defaults to enabled.
  const allActive = await listServices({ activeOnly: true });
  const facilitySettings = await listFacilityServices(clinicId);
  const disabledSet = new Set(
    facilitySettings
      .filter((fs) => !fs.enabled)
      .map((fs) => fs.serviceCode),
  );
  return allActive.filter((s) => !disabledSet.has(s.internalCode));
}

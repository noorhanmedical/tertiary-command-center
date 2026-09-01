// Phase 2F-B — service-specific procedure prerequisite configuration reads.
//
// Clinic-scoped: returns a clinic's active configs for a (service, stage)
// PLUS the platform defaults (clinic_id IS NULL); a clinic row overrides the
// default for the same requirementCode. Reads are safe when the migration is
// absent AND the lifecycle flag is OFF (return empty); a structured
// migration-missing surfaces when the flag is ON.

import { db } from "../db";
import { and, eq, or, isNull } from "drizzle-orm";
import {
  ancillaryServicePrerequisiteConfig,
  type AncillaryServicePrerequisiteConfig,
} from "@shared/schema/procedurePrerequisites";
import { featureFlags } from "../lib/featureFlags";

const PG_UNDEFINED_TABLE = "42P01";
const PG_UNDEFINED_COLUMN = "42703";

/** Active configs for (clinic OR default) + service + stage, with clinic rows
 *  taking precedence over defaults per requirementCode. */
export async function listActivePrerequisiteConfigs(
  clinicId: number,
  serviceType: string,
  stage: string,
): Promise<AncillaryServicePrerequisiteConfig[]> {
  let rows: AncillaryServicePrerequisiteConfig[];
  try {
    rows = await db
      .select()
      .from(ancillaryServicePrerequisiteConfig)
      .where(and(
        eq(ancillaryServicePrerequisiteConfig.serviceType, serviceType),
        eq(ancillaryServicePrerequisiteConfig.blocksStage, stage),
        eq(ancillaryServicePrerequisiteConfig.active, true),
        or(isNull(ancillaryServicePrerequisiteConfig.clinicId), eq(ancillaryServicePrerequisiteConfig.clinicId, clinicId)),
      ));
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if ((code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) && !featureFlags.canonicalProcedureLifecycle) return [];
    if (code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN) {
      const err = new Error("procedure_prerequisite_migration_missing") as Error & { code?: string };
      err.code = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
      throw err;
    }
    throw e;
  }
  // Defensive: never trust the returned clinic — only this clinic or the default.
  const own = rows.filter((r) => r.clinicId === clinicId || r.clinicId == null);
  // Clinic override wins over the default per requirementCode.
  const byCode = new Map<string, AncillaryServicePrerequisiteConfig>();
  for (const r of own) {
    const existing = byCode.get(r.requirementCode);
    if (!existing || (existing.clinicId == null && r.clinicId != null)) byCode.set(r.requirementCode, r);
  }
  return [...byCode.values()];
}

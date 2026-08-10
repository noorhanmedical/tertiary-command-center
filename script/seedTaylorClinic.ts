#!/usr/bin/env tsx
/**
 * Seed: Taylor Family Practice clinic row (EMR roster sync prerequisite)
 *
 * The EMR Encounter → schedule sync resolves a facility text to a
 * clinics.id via slug (see server/repositories/emrEncounterResolvers.ts,
 * FACILITY_TO_CLINIC_SLUG). That resolver THROWS if the clinic row is
 * missing — tenancy must be explicit. This seed creates the single
 * launch clinic so the resolver works end-to-end.
 *
 * Idempotent: matches on the unique `slug`. Re-running is a no-op.
 *
 * PREREQUISITES
 *   - DATABASE_URL set in the environment.
 *   - clinics table present (migration 0000+).
 *
 * USAGE
 *   npx tsx script/seedTaylorClinic.ts             # real run
 *   npx tsx script/seedTaylorClinic.ts --dry-run   # preview only
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { clinics } from "../shared/schema/clinics";

const CLINIC_NAME = "Taylor Family Practice";
const CLINIC_SLUG = "taylor-family-practice"; // must match FACILITY_TO_CLINIC_SLUG

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  console.log(`\n[seed:taylor-clinic] ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE RUN"}`);

  const [existing] = await db
    .select({ id: clinics.id, name: clinics.name, slug: clinics.slug })
    .from(clinics)
    .where(eq(clinics.slug, CLINIC_SLUG))
    .limit(1);

  if (existing) {
    console.log(
      `  ✓ Clinic already present (id=${existing.id}, slug="${existing.slug}"). No-op.`,
    );
    return;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] Would insert clinic name="${CLINIC_NAME}" slug="${CLINIC_SLUG}".`);
    return;
  }

  const [created] = await db
    .insert(clinics)
    .values({ name: CLINIC_NAME, slug: CLINIC_SLUG })
    .returning({ id: clinics.id });

  console.log(`  + Created clinic id=${created.id} ("${CLINIC_NAME}", slug="${CLINIC_SLUG}").`);
}

main()
  .catch((err) => {
    console.error("[seed:taylor-clinic] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

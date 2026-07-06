#!/usr/bin/env tsx
/**
 * Backfill: Patient Directory (Batch 5b)
 *
 * Groups all non-deleted patient_screenings by (lower(trim(name)), dob),
 * creates one patient_directory row per unique identity group, then links
 * every screening in the group back via patient_screenings.patient_directory_id.
 *
 * PREREQUISITES
 *   1. Migrations 0039 and 0040 must already be applied.
 *   2. DATABASE_URL must be set in the environment.
 *
 * USAGE
 *   npx tsx scripts/backfill-patient-directory.ts            # real run
 *   npx tsx scripts/backfill-patient-directory.ts --dry-run  # preview only
 *
 * The script is safe to re-run: it skips groups whose primary screening is
 * already linked (patient_directory_id IS NOT NULL).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Bootstrap DB connection (standalone — does not import server/db to avoid
// pulling the full Express dependency tree)
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// Guard: ensure the required tables exist before proceeding
// ---------------------------------------------------------------------------

async function assertMigrationsApplied(): Promise<void> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'patient_directory'
    ) AS exists
  `);
  const exists = (result as unknown as { rows: Array<{ exists: boolean }> }).rows[0]?.exists;
  if (!exists) {
    console.error(
      "ERROR: Table `patient_directory` does not exist.\n" +
      "Apply migrations 0039 and 0040 first, then re-run this script.",
    );
    process.exit(1);
  }

  const fkResult = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'patient_screenings'
        AND column_name = 'patient_directory_id'
    ) AS exists
  `);
  const fkExists = (fkResult as unknown as { rows: Array<{ exists: boolean }> }).rows[0]?.exists;
  if (!fkExists) {
    console.error(
      "ERROR: Column `patient_screenings.patient_directory_id` does not exist.\n" +
      "Apply migration 0040 first, then re-run this script.",
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawScreening = {
  id: number;
  name: string;
  dob: string | null;
  mrn: string | null;
  gender: string | null;
  phone_number: string | null;
  email: string | null;
  insurance: string | null;
  facility: string | null;
  patient_directory_id: number | null;
};

// ---------------------------------------------------------------------------
// Name splitting helper
// ---------------------------------------------------------------------------

/**
 * Split a full name into firstName + lastName.
 * Strategy: last whitespace-delimited token = lastName, everything before = firstName.
 * Falls back to the whole string as firstName when there's only one token.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`\nPatient Directory backfill — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE RUN"}`);
  console.log("Checking prerequisites…");
  await assertMigrationsApplied();
  console.log("  ✓ Tables present.\n");

  // Pull all non-deleted screenings.
  const rawResult = await db.execute<RawScreening>(sql`
    SELECT
      id,
      name,
      dob,
      mrn,
      gender,
      phone_number,
      email,
      insurance,
      facility,
      patient_directory_id
    FROM patient_screenings
    WHERE deleted_at IS NULL
    ORDER BY id ASC
  `);
  const screenings = (rawResult as unknown as { rows: RawScreening[] }).rows;
  console.log(`Found ${screenings.length} non-deleted screening(s).`);

  // Group by canonical key (lower(trim(name)), dob).
  const groups = new Map<string, RawScreening[]>();
  for (const s of screenings) {
    const key = `${(s.name ?? "").trim().toLowerCase()}|${(s.dob ?? "").trim()}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  console.log(`Grouped into ${groups.size} canonical identity group(s).\n`);

  let skipped = 0;
  let created = 0;
  let linked = 0;
  let errors = 0;

  for (const [key, rows] of groups) {
    // Sort newest-first (highest id = primary / freshest).
    rows.sort((a, b) => b.id - a.id);
    const primary = rows[0];

    // Skip if the primary is already linked — group was backfilled in a
    // prior run. All peers are assumed to also be linked.
    if (primary.patient_directory_id !== null) {
      skipped++;
      continue;
    }

    const { firstName, lastName } = splitName(primary.name ?? "Unknown");
    const screeningIds = rows.map((r) => r.id);

    if (DRY_RUN) {
      console.log(
        `[DRY] Would create patient_directory row for "${primary.name}" ` +
        `(dob=${primary.dob ?? "null"}, ${screeningIds.length} screening(s): ${screeningIds.join(", ")})`
      );
      created++;
      linked += screeningIds.length;
      continue;
    }

    try {
      // Insert one patient_directory row; plexus_id is filled by DB trigger.
      const insertResult = await db.execute<{ id: number }>(sql`
        INSERT INTO patient_directory
          (plexus_id, mrn, first_name, last_name, dob, gender, phone, email, insurance, facility_id, status)
        VALUES
          ('',
           ${primary.mrn ?? null},
           ${firstName},
           ${lastName},
           ${primary.dob ?? null},
           ${primary.gender ?? null},
           ${primary.phone_number ?? null},
           ${primary.email ?? null},
           ${primary.insurance ?? null},
           ${primary.facility ?? null},
           'active')
        RETURNING id
      `);
      const directoryId = (insertResult as unknown as { rows: Array<{ id: number }> }).rows[0]?.id;
      if (!directoryId) throw new Error("INSERT did not return an id");

      // Link every screening in the group back to the new directory row.
      await db.execute(sql`
        UPDATE patient_screenings
        SET patient_directory_id = ${directoryId}
        WHERE id = ANY(${sql`ARRAY[${sql.join(screeningIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})
      `);

      created++;
      linked += screeningIds.length;
      console.log(
        `  Created PLX row id=${directoryId} for "${primary.name}" ` +
        `(${screeningIds.length} screening(s) linked)`
      );
    } catch (err) {
      errors++;
      console.error(
        `  ERROR processing group key="${key}" (primary screening id=${primary.id}):`,
        (err as Error).message,
      );
    }
  }

  console.log(`
─────────────────────────────────────────────
Backfill complete (${DRY_RUN ? "DRY RUN" : "LIVE"})
  Groups skipped (already linked) : ${skipped}
  Directory rows created           : ${created}
  Screenings linked                : ${linked}
  Errors                           : ${errors}
─────────────────────────────────────────────`);

  if (errors > 0) {
    console.error(`\n${errors} group(s) failed — review errors above before flipping the flag.`);
    process.exit(1);
  }
  if (!DRY_RUN) {
    console.log("\n✓ Backfill finished. You can now flip USE_PATIENT_DIRECTORY_ACTIVATION=1.");
  }
}

main()
  .catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

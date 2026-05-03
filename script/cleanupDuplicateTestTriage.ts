// Safe cleanup of duplicate open scheduling_triage_cases for the seeded
// test patients only. Run with `npm run cleanup:test-triage-duplicates`.
// Requires DATABASE_URL.
//
// Why this exists:
//   The audit "duplicate open triage per (patient_screening_id, main_type,
//   subtype)" check (auditCanonicalIntegrity.ts) flags multiple non-terminal
//   triage rows for the same patient + main_type + subtype. Older versions
//   of the call-result handler used a plain INSERT that produced these
//   duplicates on re-runs. This script resolves only the duplicates owned
//   by the three is_test seed patients — never touches real patients.
//
// Behavior:
//   - For each (TestVisit, TestOutreach, TestGuy) is_test screening, group
//     non-terminal triage rows by (main_type, subtype). Keep the newest row
//     in each group and mark older ones status="resolved" (non-destructive).
//   - Adds metadata.cleanupSource = "cleanup_duplicate_test_triage" and
//     metadata.resolvedReason = "duplicate_open_triage_cleanup" to resolved
//     rows so the action is auditable.
//   - Does not delete rows.
//   - Exits 0 only when no duplicate non-terminal triage rows remain for the
//     three seed patients.

import { and, asc, desc, eq, inArray, ne, notInArray } from "drizzle-orm";

const SEED_PATIENTS: Array<{ name: string; dob: string }> = [
  { name: "TestVisit Patient",    dob: "02/02/1950" },
  { name: "TestOutreach Patient", dob: "03/03/1950" },
  { name: "TestGuy Robot",        dob: "01/01/1950" },
];

const TERMINAL_STATUSES = ["resolved", "closed", "cancelled"] as const;

type Outcome = {
  patientLabel: string;
  patientScreeningId: number;
  groups: Array<{
    mainType: string;
    subtype: string | null;
    keptId: number;
    resolvedIds: number[];
  }>;
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[cleanup:test-triage-duplicates] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { schedulingTriageCases } = await import("@shared/schema/schedulingTriage");

  const outcomes: Outcome[] = [];
  let totalResolved = 0;
  let exitCode = 0;

  try {
    for (const seed of SEED_PATIENTS) {
      const [screening] = await db
        .select()
        .from(patientScreenings)
        .where(
          and(
            eq(patientScreenings.name, seed.name),
            eq(patientScreenings.dob, seed.dob),
            eq(patientScreenings.isTest, true),
          ),
        )
        .limit(1);

      if (!screening) {
        console.log(`  · seed not found, skipping: ${seed.name} (${seed.dob})`);
        continue;
      }

      const psid = screening.id;
      const patientLabel = `${seed.name} (psid=${psid})`;
      console.log(`\n── ${patientLabel} ──────────────────────────────────────`);

      const openRows = await db
        .select()
        .from(schedulingTriageCases)
        .where(
          and(
            eq(schedulingTriageCases.patientScreeningId, psid),
            notInArray(schedulingTriageCases.status, [...TERMINAL_STATUSES]),
          ),
        )
        .orderBy(desc(schedulingTriageCases.id));

      // Group by mainType + subtype (subtype null treated as a distinct key)
      type GroupKey = string;
      const groups = new Map<GroupKey, typeof openRows>();
      for (const row of openRows) {
        const key = `${row.mainType}::${row.subtype ?? "<null>"}`;
        const arr = groups.get(key) ?? [];
        arr.push(row);
        groups.set(key, arr);
      }

      const outcome: Outcome = {
        patientLabel,
        patientScreeningId: psid,
        groups: [],
      };

      for (const [key, rows] of groups) {
        if (rows.length <= 1) continue; // Already idempotent — nothing to do

        // rows are sorted DESC by id → first is newest, rest are older dups.
        const [keep, ...dups] = rows;
        console.log(
          `  group ${key} — keeping id=${keep.id}, resolving older ids=${dups.map((d) => d.id).join(",")}`,
        );

        const olderIds = dups.map((d) => d.id);
        // Bulk status flip — we set metadata per-row below to preserve each
        // row's prior context (jsonb merge isn't expressible in one UPDATE).
        await db
          .update(schedulingTriageCases)
          .set({ status: "resolved", updatedAt: new Date() })
          .where(inArray(schedulingTriageCases.id, olderIds));

        for (const dup of dups) {
          const existingMeta = (typeof dup.metadata === "object" && dup.metadata !== null
            ? (dup.metadata as Record<string, unknown>)
            : {});
          const merged = {
            ...existingMeta,
            cleanupSource: "cleanup_duplicate_test_triage",
            resolvedReason: "duplicate_open_triage_cleanup",
            keptCanonicalId: keep.id,
            resolvedAt: new Date().toISOString(),
          };
          await db
            .update(schedulingTriageCases)
            .set({ metadata: merged, updatedAt: new Date() })
            .where(eq(schedulingTriageCases.id, dup.id));
        }

        totalResolved += dups.length;
        outcome.groups.push({
          mainType: keep.mainType,
          subtype: keep.subtype ?? null,
          keptId: keep.id,
          resolvedIds: olderIds,
        });
      }

      if (outcome.groups.length === 0) {
        console.log("  · no duplicate open triage rows");
      }
      outcomes.push(outcome);
    }

    // Verify no duplicate non-terminal triage rows remain for the seeds.
    const screeningIds = outcomes.map((o) => o.patientScreeningId);
    let remainingDuplicates = 0;
    if (screeningIds.length > 0) {
      const stillOpen = await db
        .select()
        .from(schedulingTriageCases)
        .where(
          and(
            inArray(schedulingTriageCases.patientScreeningId, screeningIds),
            notInArray(schedulingTriageCases.status, [...TERMINAL_STATUSES]),
          ),
        );

      const buckets = new Map<string, number>();
      for (const row of stillOpen) {
        const key = `${row.patientScreeningId}::${row.mainType}::${row.subtype ?? "<null>"}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      for (const [, n] of buckets) {
        if (n > 1) remainingDuplicates += n - 1;
      }
    }

    console.log("\n════════════════════════════════════════════════════════════");
    for (const o of outcomes) {
      if (o.groups.length === 0) {
        console.log(`  ${o.patientLabel}: no duplicates`);
      } else {
        console.log(`  ${o.patientLabel}:`);
        for (const g of o.groups) {
          console.log(
            `    · ${g.mainType}/${g.subtype ?? "<null>"} kept=${g.keptId} resolved=${g.resolvedIds.join(",")}`,
          );
        }
      }
    }
    console.log(`  total resolved        = ${totalResolved}`);
    console.log(`  remaining duplicates  = ${remainingDuplicates}`);
    console.log("════════════════════════════════════════════════════════════");

    if (remainingDuplicates > 0) {
      console.error("[cleanup:test-triage-duplicates] FAIL — duplicates remain");
      exitCode = 1;
    } else {
      console.log("[cleanup:test-triage-duplicates] OK");
    }
  } catch (err: any) {
    console.error("[cleanup:test-triage-duplicates] unexpected failure:", err);
    exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[cleanup:test-triage-duplicates] top-level error:", err);
  process.exit(1);
});

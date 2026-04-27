// One-shot reconciler for the synthetic TestGuy Robot patient.
// Run with `npm run reconcile:testguy`. Requires DATABASE_URL.
//
// What it does:
//   1. Lists every TestGuy Robot row (screenings + execution cases) BEFORE.
//   2. Picks a single canonical screening row using this priority:
//        a. Screening linked to the newest patient_execution_case
//        b. Newest commit_status="Ready" screening
//   3. Normalizes ALL is_test=true TestGuy screening rows to the canonical
//      identity: dob="01/01/1950", facility="Test Facility",
//      insurance="Straight Medicare". Non-test rows are NEVER touched.
//   4. Re-attaches any orphan TestGuy execution case (patient_screening_id
//      IS NULL) to the canonical screening so the canonical-link preference
//      in patientPacket.repo.ts can find the spine.
//   5. Lists everything AFTER and prints the canonical id.
//
// What it deliberately does NOT do:
//   • Delete anything (idempotent normalize-only).
//   • Touch screenings whose name != "TestGuy Robot".
//   • Touch screenings whose is_test = false.
//   • Touch execution cases whose patient_name != "TestGuy Robot".

import { eq, and, desc, isNull } from "drizzle-orm";

const CANONICAL_NAME = "TestGuy Robot";
const CANONICAL_DOB = "01/01/1950";
const CANONICAL_FACILITY = "Test Facility";
const CANONICAL_INSURANCE = "Straight Medicare";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[reconcile:testguy] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");

  let exitCode = 0;
  try {
    // ── BEFORE ────────────────────────────────────────────────────────────
    const beforeScreenings = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, CANONICAL_NAME),
          eq(patientScreenings.isTest, true),
        ),
      )
      .orderBy(desc(patientScreenings.id));

    console.log(`[reconcile:testguy] BEFORE — ${beforeScreenings.length} TestGuy screening(s) (is_test=true):`);
    for (const s of beforeScreenings) {
      console.log(
        `  screening id=${s.id} dob=${s.dob} facility=${s.facility} ` +
        `insurance=${s.insurance} commitStatus=${s.commitStatus} batchId=${s.batchId}`,
      );
    }

    const beforeCases = await db
      .select()
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.patientName, CANONICAL_NAME))
      .orderBy(desc(patientExecutionCases.id));
    console.log(`[reconcile:testguy] BEFORE — ${beforeCases.length} TestGuy execution case(s):`);
    for (const c of beforeCases) {
      console.log(
        `  case id=${c.id} screeningId=${c.patientScreeningId ?? "(null)"} ` +
        `dob=${c.patientDob} lifecycle=${c.lifecycleStatus}`,
      );
    }

    // ── PICK CANONICAL ───────────────────────────────────────────────────
    let canonicalId: number | null = null;
    let canonicalSource: "execution_case_link" | "newest_ready" | null = null;

    // Priority 1: linked to newest execution case
    const [linkedRow] = await db
      .select({ screeningId: patientScreenings.id })
      .from(patientScreenings)
      .innerJoin(
        patientExecutionCases,
        eq(patientExecutionCases.patientScreeningId, patientScreenings.id),
      )
      .where(
        and(
          eq(patientScreenings.name, CANONICAL_NAME),
          eq(patientScreenings.isTest, true),
        ),
      )
      .orderBy(desc(patientExecutionCases.id))
      .limit(1);
    if (linkedRow) {
      canonicalId = linkedRow.screeningId;
      canonicalSource = "execution_case_link";
    }

    // Priority 2: newest Ready row
    if (canonicalId == null) {
      const [readyRow] = await db
        .select({ id: patientScreenings.id })
        .from(patientScreenings)
        .where(
          and(
            eq(patientScreenings.name, CANONICAL_NAME),
            eq(patientScreenings.isTest, true),
            eq(patientScreenings.commitStatus, "Ready"),
          ),
        )
        .orderBy(desc(patientScreenings.id))
        .limit(1);
      if (readyRow) {
        canonicalId = readyRow.id;
        canonicalSource = "newest_ready";
      }
    }

    if (canonicalId == null) {
      console.log(`[reconcile:testguy] no canonical TestGuy row found — nothing to reconcile`);
      console.log(`[reconcile:testguy] (run \`npm run seed:testguy-flow\` first to create one)`);
      await pool.end();
      process.exit(0);
    }

    console.log(
      `[reconcile:testguy] canonical screening id=${canonicalId} (chosen by ${canonicalSource})`,
    );

    // ── NORMALIZE FIELDS ──────────────────────────────────────────────────
    const normalized = await db
      .update(patientScreenings)
      .set({
        dob: CANONICAL_DOB,
        facility: CANONICAL_FACILITY,
        insurance: CANONICAL_INSURANCE,
      })
      .where(
        and(
          eq(patientScreenings.name, CANONICAL_NAME),
          eq(patientScreenings.isTest, true),
        ),
      )
      .returning({ id: patientScreenings.id });
    console.log(
      `[reconcile:testguy] normalized ${normalized.length} screening row(s) to canonical identity`,
    );

    // ── REATTACH ORPHAN EXECUTION CASES ──────────────────────────────────
    const reattached = await db
      .update(patientExecutionCases)
      .set({ patientScreeningId: canonicalId })
      .where(
        and(
          eq(patientExecutionCases.patientName, CANONICAL_NAME),
          isNull(patientExecutionCases.patientScreeningId),
        ),
      )
      .returning({ id: patientExecutionCases.id });
    console.log(
      `[reconcile:testguy] re-attached ${reattached.length} orphan execution case(s) to screening id=${canonicalId}`,
    );

    // ── AFTER ────────────────────────────────────────────────────────────
    const afterScreenings = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, CANONICAL_NAME),
          eq(patientScreenings.isTest, true),
        ),
      )
      .orderBy(desc(patientScreenings.id));
    console.log(`[reconcile:testguy] AFTER — ${afterScreenings.length} TestGuy screening(s):`);
    for (const s of afterScreenings) {
      console.log(
        `  screening id=${s.id} dob=${s.dob} facility=${s.facility} ` +
        `insurance=${s.insurance} commitStatus=${s.commitStatus}`,
      );
    }

    const afterCases = await db
      .select()
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.patientName, CANONICAL_NAME))
      .orderBy(desc(patientExecutionCases.id));
    console.log(`[reconcile:testguy] AFTER — ${afterCases.length} TestGuy execution case(s):`);
    for (const c of afterCases) {
      console.log(
        `  case id=${c.id} screeningId=${c.patientScreeningId ?? "(null)"} ` +
        `dob=${c.patientDob} lifecycle=${c.lifecycleStatus}`,
      );
    }

    console.log(`[reconcile:testguy] OK — canonical screening id=${canonicalId}`);
  } catch (err: any) {
    console.error("[reconcile:testguy] failed:", err);
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
  console.error("[reconcile:testguy] unexpected failure:", err);
  process.exit(1);
});

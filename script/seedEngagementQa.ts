// script/seedEngagementQa.ts
//
// Deterministic Engagement QA fixtures for the end-to-end assignment/queue
// matrix. Creates THREE canonical execution cases with explicit, known
// assignment state so the QA matrix (A–H) can be exercised against a REAL
// staff login (e2e_playwright_pcs / _acs), not just admin view-as.
//
//   ENG-A  "QA Eng Alpha Unassigned"  → unassigned (Send-to-Engagement / pool)
//   ENG-B  "QA Eng Bravo PCS"          → assigned to the PCS fixture roster row
//   ENG-C  "QA Eng Charlie Reassign"   → assigned to PCS (reassignment target)
//
// Ownership is the canonical field: patient_execution_cases.assigned_team_member_id
// = outreach_schedulers.id. It NEVER writes scheduler_assignments. When it
// assigns, it appends a patient_journey_events row (eventType
// engagement_assignment_changed) exactly like the real assignment route.
//
// The PCS/ACS roster rows are the "(E2E fixture)" rows seeded by
// seedE2EPlaywrightUsers.ts (linked to e2e_playwright_pcs / _acs). This seed
// resolves them by their linked user_id — it never guesses a real roster
// identity. If the roster fixtures are missing it fails loudly, telling the
// operator to run `seed:e2e-users` first.
//
// ── Safety ────────────────────────────────────────────────────────
//   • Refuses under NODE_ENV=production.
//   • Requires DATABASE_URL.
//   • Idempotent: patients dedupe on (name, batchId); execution cases dedupe
//     per screening via the canonical repo; assignment is set to the exact
//     desired value each run.
//   • Marks every screening isTest=true. Never touches non-fixture rows.
//
// Usage:  npm run seed:engagement-qa

import { and, desc, eq } from "drizzle-orm";

const BATCH_NAME = "QA Engagement Batch";
const FACILITY = "Taylor Family Practice"; // must match the fixture roster facility
const PCS_USERNAME = "e2e_playwright_pcs";
const ACS_USERNAME = "e2e_playwright_acs";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[seed:engagement-qa] Refusing to run under NODE_ENV=production.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[seed:engagement-qa] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { clinics } = await import("@shared/schema/clinics");
  const { screeningBatches, patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases } = await import("@shared/schema/executionCase");
  const { users, outreachSchedulers } = await import("@shared/schema");
  const { createOrUpdateExecutionCaseFromScreening } = await import("../server/repositories/executionCase.repo");
  const { resolveAndLinkPlexusIdentityForScreening } = await import("../server/services/plexusIdentity/screeningIntegration");
  const { appendJourneyEvent } = await import("../server/services/journey/appendJourneyEvent");

  let exitCode = 0;
  try {
    // Resolve the Taylor clinic (facility must match the roster fixture).
    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.name, FACILITY))
      .limit(1);
    if (!clinic) {
      console.error(`[seed:engagement-qa] Clinic ${JSON.stringify(FACILITY)} not found. Cannot align facility with the roster fixtures.`);
      process.exit(1);
    }
    const clinicId = clinic.id;

    // Resolve the PCS / ACS fixture roster ids by their linked login.
    async function rosterIdForUsername(username: string): Promise<number | null> {
      const [row] = await db
        .select({ id: outreachSchedulers.id })
        .from(outreachSchedulers)
        .innerJoin(users, eq(users.id, outreachSchedulers.userId))
        .where(and(eq(users.username, username), eq(outreachSchedulers.facility, FACILITY)))
        .limit(1);
      return row?.id ?? null;
    }
    const pcsSchedulerId = await rosterIdForUsername(PCS_USERNAME);
    const acsSchedulerId = await rosterIdForUsername(ACS_USERNAME);
    if (pcsSchedulerId == null || acsSchedulerId == null) {
      console.error(
        "[seed:engagement-qa] Missing PCS/ACS fixture roster rows. Run `E2E_SEED_APPLY=YES E2E_TEST_CLINIC_ID=1 E2E_TEST_PASSWORD=... npm run seed:e2e-users` first.",
      );
      process.exit(1);
    }
    console.log(`[seed:engagement-qa] roster: PCS=${pcsSchedulerId} ACS=${acsSchedulerId} (facility=${JSON.stringify(FACILITY)})`);

    // Batch (idempotent by name + isTest).
    const [existingBatch] = await db
      .select()
      .from(screeningBatches)
      .where(and(eq(screeningBatches.name, BATCH_NAME), eq(screeningBatches.isTest, true)))
      .orderBy(desc(screeningBatches.id))
      .limit(1);
    let batchId: number;
    if (existingBatch) {
      batchId = existingBatch.id;
    } else {
      const [created] = await db
        .insert(screeningBatches)
        .values({ clinicId, name: BATCH_NAME, facility: FACILITY, status: "draft", patientCount: 3, isTest: true })
        .returning();
      batchId = created.id;
    }

    type Fixture = {
      key: string;
      name: string;
      // Desired canonical owner: null = unassigned, or a roster id.
      assignTo: number | null;
    };
    const fixtures: Fixture[] = [
      { key: "ENG-A", name: "QA Eng Alpha Unassigned", assignTo: null },
      { key: "ENG-B", name: "QA Eng Bravo PCS", assignTo: pcsSchedulerId },
      { key: "ENG-C", name: "QA Eng Charlie Reassign", assignTo: pcsSchedulerId },
    ];

    const now = new Date();
    for (const fx of fixtures) {
      // Qualified, committed screening so the canonical execution case exists
      // and would surface in the queue when assigned.
      const base = {
        clinicId,
        batchId,
        facility: FACILITY,
        name: fx.name,
        dob: "1950-01-01",
        gender: "Female",
        phoneNumber: "(602) 555-0300",
        insurance: "Medicare",
        patientType: "outreach", // → engagementBucket "outreach" (call work)
        status: "completed" as const,
        appointmentStatus: "pending" as const,
        commitStatus: "Ready" as const,
        committedAt: now,
        qualifyingTests: ["VitalWave"],
        reasoning: {
          VitalWave: {
            clinician_understanding: "QA engagement fixture — vascular screening.",
            patient_talking_points: "A quick circulation check.",
            qualifying_factors: ["QA fixture"],
            confidence: "high",
            icd10_codes: [],
            pearls: [],
            approvalRequired: false,
          },
        },
        isTest: true,
      };

      const [existing] = await db
        .select()
        .from(patientScreenings)
        .where(and(eq(patientScreenings.name, fx.name), eq(patientScreenings.batchId, batchId)))
        .orderBy(desc(patientScreenings.id))
        .limit(1);

      let screening;
      if (existing) {
        const [updated] = await db
          .update(patientScreenings)
          .set(base as never)
          .where(eq(patientScreenings.id, existing.id))
          .returning();
        screening = updated;
      } else {
        const [created] = await db.insert(patientScreenings).values(base as never).returning();
        screening = created;
      }
      const sid = screening.id;

      // Canonical identity linkage (same orchestrator every screening runs).
      await resolveAndLinkPlexusIdentityForScreening({
        screeningId: sid,
        clinicId,
        sourceSystem: "engagement_qa_seed",
        demographics: {
          displayName: fx.name,
          dob: (screening.dob ?? null) as string | null,
          phone: (screening.phoneNumber ?? null) as string | null,
          email: null,
        },
      });
      const [linkedRow] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, sid)).limit(1);
      const effective = linkedRow ?? screening;

      // Canonical execution case (dedupes per screening).
      const { executionCase } = await createOrUpdateExecutionCaseFromScreening(effective, null);

      // Set the desired canonical ownership deterministically. This mirrors the
      // real assignment route: writes assigned_team_member_id + assignedRole +
      // engagementStatus, and appends a journey event. NEVER scheduler_assignments.
      const desiredOwner = fx.assignTo;
      const nextEngagement = desiredOwner != null ? "assigned" : "new";
      await db
        .update(patientExecutionCases)
        .set({
          assignedTeamMemberId: desiredOwner,
          assignedRole: desiredOwner != null ? "scheduler" : null,
          engagementStatus: nextEngagement,
          nextActionAt: desiredOwner != null ? now : null,
          updatedAt: now,
        })
        .where(eq(patientExecutionCases.id, executionCase.id));

      if (desiredOwner != null) {
        try {
          await appendJourneyEvent({
            patientScreeningId: sid,
            executionCaseId: executionCase.id,
            actorUserId: null,
            patientName: fx.name,
            patientDob: effective.dob ?? null,
            eventType: "engagement_assignment_changed",
            eventSource: "engagement_qa_seed",
            summary: `QA fixture assigned to roster #${desiredOwner}`,
            metadata: { newSchedulerId: desiredOwner, assignedRole: "scheduler", qaFixture: true },
          });
        } catch {
          /* audit best-effort */
        }
      }

      console.log(
        `  ${fx.key}  ${fx.name.padEnd(26)} screeningId=${sid} executionCaseId=${executionCase.id} assignedTo=${desiredOwner ?? "UNASSIGNED"}`,
      );
    }

    console.log(`[seed:engagement-qa] OK — 3 engagement fixtures seeded in batch ${batchId}`);
  } catch (err: unknown) {
    console.error("[seed:engagement-qa] failed:", err);
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
  console.error("[seed:engagement-qa] unexpected failure:", err);
  process.exit(1);
});

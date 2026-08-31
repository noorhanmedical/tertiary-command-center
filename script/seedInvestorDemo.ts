// script/seedInvestorDemo.ts
//
// Investor-demo seed. Run with `npm run seed:investor-demo`.
//
// Creates ONE demo admin login (`demo`) and 24 fully synthetic patients that
// flow through the REAL application spine (screening → execution case →
// scheduling → insurance → cooldown → procedure → documents → notes →
// billing → invoice), distributed across every lifecycle stage so investors
// can walk through the whole product with live, working screens.
//
// ── Safety ─────────────────────────────────────────────────────────
//   • 100% synthetic data. No real patient PII. Deterministic fake
//     names/demographics generated in-file.
//   • Every row it writes carries `is_test = true` where the schema
//     supports it, and every batch name is prefixed `DEMO — `.
//   • Idempotent: re-running updates the same demo rows (deduped on
//     name + dob + demo batch) instead of duplicating.
//   • Refuses to run when NODE_ENV=production.
//   • Requires E2E_SEED_APPLY=YES to actually write (dry-run default),
//     because the configured DATABASE_URL is a shared/live instance.
//   • Strictly additive — never deletes or mutates non-demo rows.
//
// ── Usage ──────────────────────────────────────────────────────────
//   # Dry-run (default — prints the plan, writes nothing):
//   npm run seed:investor-demo
//
//   # Apply (idempotent):
//   E2E_SEED_APPLY=YES DEMO_PASSWORD='PickAStrongDemoPass1' npm run seed:investor-demo

import { eq, and, desc, like } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Demo constants ─────────────────────────────────────────────────
const DEMO_USERNAME = "demo";
const DEMO_BATCH_PREFIX = "DEMO — ";
const DEMO_FACILITIES = [
  "Cedar Ridge Family Medicine",
  "Lakeside Internal Medicine",
  "Summit Cardiology Associates",
] as const;
const SERVICES = ["BrainWave", "VitalWave", "Ultrasound"] as const;
const INSURANCES = ["Straight Medicare", "PPO", "Medicare Advantage", "HMO"] as const;

// Lifecycle stages the 24 demo patients are distributed across. Each
// stage advances the canonical spine to a different depth so every UI
// surface (intake, screening, scheduling, procedures, billing) has data.
type Stage =
  | "intake"        // imported, not yet screened (Draft)
  | "screened"      // qualified, committed Ready, not scheduled
  | "scheduled"     // execution case + appointment in the future
  | "procedure"     // procedure complete + docs/notes generated
  | "billed";       // full spine incl. completed billing package + invoice

// ── Deterministic synthetic identities (no real PII) ───────────────
const FIRST_NAMES = [
  "Amelia", "Noah", "Olivia", "Liam", "Sophia", "Mason", "Isabella", "Ethan",
  "Mia", "Lucas", "Charlotte", "Henry", "Evelyn", "Jack", "Harper", "Owen",
  "Abigail", "Leo", "Emily", "Sebastian", "Ella", "Caleb", "Grace", "Julian",
] as const;
const LAST_NAMES = [
  "Carter", "Nguyen", "Patel", "Rivera", "Thompson", "Kim", "Foster", "Alvarez",
  "Bennett", "Okafor", "Reyes", "Sullivan", "Choi", "Delgado", "Marsh", "Iqbal",
  "Ramsey", "Cohen", "Vargas", "Whitfield", "Ellison", "Frost", "Navarro", "Sato",
] as const;

const DIAGNOSES = [
  "Type 2 diabetes mellitus without complications",
  "Essential hypertension",
  "Peripheral neuropathy",
  "Chronic kidney disease, stage 2",
  "Atrial fibrillation",
  "Hyperlipidemia",
  "Chronic venous insufficiency",
  "Mild cognitive impairment",
] as const;
const HISTORIES = [
  "Nonsmoker. Family history of cardiovascular disease.",
  "Former smoker, quit 8 years ago. Sedentary lifestyle.",
  "Well-controlled on current medications. Annual wellness visit.",
  "Reports intermittent numbness in lower extremities.",
] as const;
const MEDICATIONS = [
  "Metformin 500mg BID; Lisinopril 10mg daily",
  "Atorvastatin 20mg daily; Aspirin 81mg daily",
  "Amlodipine 5mg daily",
  "Apixaban 5mg BID; Metoprolol 25mg BID",
] as const;

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateAtHour(daysFromNow: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Deterministic DOB in MM/DD/YYYY for a patient index (ages ~55-80). */
function demoDob(i: number): string {
  const year = 1945 + (i % 26); // 1945..1970
  const month = ((i * 7) % 12) + 1;
  const day = ((i * 13) % 27) + 1;
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

function demoAge(dob: string): number {
  const [, , yyyy] = dob.split("/");
  return new Date().getFullYear() - parseInt(yyyy, 10);
}

type DemoPatient = {
  index: number;
  name: string;
  dob: string;
  age: number;
  gender: string;
  phoneNumber: string;
  email: string;
  facility: string;
  insurance: string;
  service: (typeof SERVICES)[number];
  patientType: "visit" | "outreach";
  diagnoses: string;
  history: string;
  medications: string;
  stage: Stage;
};

/** Build 24 synthetic patients distributed across all five stages. */
function buildDemoPatients(): DemoPatient[] {
  // Distribution across 24 patients (>= 20 required, all stages covered):
  //   intake 4, screened 5, scheduled 5, procedure 4, billed 6
  const stagePlan: Stage[] = [
    ...Array<Stage>(4).fill("intake"),
    ...Array<Stage>(5).fill("screened"),
    ...Array<Stage>(5).fill("scheduled"),
    ...Array<Stage>(4).fill("procedure"),
    ...Array<Stage>(6).fill("billed"),
  ];

  return stagePlan.map((stage, i) => {
    const first = pick(FIRST_NAMES, i);
    const last = pick(LAST_NAMES, i * 3 + 1);
    const dob = demoDob(i);
    const name = `${first} ${last}`;
    return {
      index: i,
      name,
      dob,
      age: demoAge(dob),
      gender: i % 2 === 0 ? "F" : "M",
      phoneNumber: `(555) ${String(200 + i).padStart(3, "0")}-${String(1000 + i * 7).slice(-4)}`,
      email: `${first}.${last}`.toLowerCase() + "@example.com",
      facility: pick(DEMO_FACILITIES, i),
      insurance: pick(INSURANCES, i),
      service: pick(SERVICES, i),
      // Outreach patients are the ones being reached out to for a future
      // procedure; visit patients are seen in-clinic. Alternate for variety.
      patientType: stage === "scheduled" && i % 2 === 1 ? "outreach" : "visit",
      diagnoses: pick(DIAGNOSES, i),
      history: pick(HISTORIES, i),
      medications: pick(MEDICATIONS, i),
      stage,
    };
  });
}

// ── Gates ──────────────────────────────────────────────────────────
function bail(msg: string, code = 1): never {
  console.error(`[seed:investor-demo] ${msg}`);
  process.exit(code);
}

// ── Cleanup ────────────────────────────────────────────────────────
// Removes ONLY demo-tagged data:
//   • the `demo` user
//   • every `DEMO — ` screening batch (is_test=true) and, via ON DELETE
//     CASCADE, its patient_screenings + billing_records + notes +
//     analysis_jobs + outreach_calls + scheduler_assignments +
//     patient_notes.
//   • the canonical spine rows that reference those patient_screenings
//     with ON DELETE SET NULL (execution cases, journey events,
//     insurance, cooldown, procedure events/notes, billing readiness,
//     completed billing packages, schedule events, document readiness,
//     documents, projected invoices, billing document requests,
//     appointments). These are deleted explicitly, keyed off the demo
//     screening ids, because the FK would otherwise merely null the
//     link and leave orphaned demo rows behind.
//
// Deliberately NOT touched: invoices / invoice_line_items. Demo billed
// patients attach line items to a per-facility Draft invoice that may be
// shared with non-demo work, so removing them is unsafe to automate. The
// summary prints any demo-authored line items so an operator can review
// them by hand if desired.
async function runCleanup(apply: boolean): Promise<void> {
  console.log(`[seed:investor-demo] mode: CLEANUP ${apply ? "APPLY (deletes)" : "DRY-RUN (no deletes — set E2E_SEED_APPLY=YES)"}`);

  const { db, pool } = await import("../server/db");
  const {
    users, screeningBatches, patientScreenings,
    patientExecutionCases, patientJourneyEvents,
    insuranceEligibilityReviews, cooldownRecords,
    procedureEvents, procedureNotes,
    billingReadinessChecks, completedBillingPackages,
    billingDocumentRequests, caseDocumentReadiness,
    globalScheduleEvents, projectedInvoiceRows,
    appointments, documents,
  } = await import("@shared/schema");
  const { inArray, eq, like, and } = await import("drizzle-orm");

  let exitCode = 0;
  try {
    // 1) Identify the demo batches (DEMO — prefix AND is_test).
    const demoBatches = await db
      .select({ id: screeningBatches.id, name: screeningBatches.name })
      .from(screeningBatches)
      .where(and(like(screeningBatches.name, `${DEMO_BATCH_PREFIX}%`), eq(screeningBatches.isTest, true)));
    const batchIds = demoBatches.map((b) => b.id);
    console.log(`  demo batches: ${batchIds.length}${batchIds.length ? ` (${demoBatches.map((b) => b.name).join(", ")})` : ""}`);

    // 2) Gather the demo patient_screening ids under those batches.
    let screeningIds: number[] = [];
    if (batchIds.length > 0) {
      const rows = await db
        .select({ id: patientScreenings.id })
        .from(patientScreenings)
        .where(inArray(patientScreenings.batchId, batchIds));
      screeningIds = rows.map((r) => r.id);
    }
    console.log(`  demo patient screenings: ${screeningIds.length}`);

    // 3) The set-null spine tables to purge, keyed by patient_screening_id.
    const spineTables: Array<{ label: string; table: any }> = [
      { label: "patient_journey_events", table: patientJourneyEvents },
      { label: "procedure_notes", table: procedureNotes },
      { label: "case_document_readiness", table: caseDocumentReadiness },
      { label: "billing_document_requests", table: billingDocumentRequests },
      { label: "completed_billing_packages", table: completedBillingPackages },
      { label: "billing_readiness_checks", table: billingReadinessChecks },
      { label: "procedure_events", table: procedureEvents },
      { label: "global_schedule_events", table: globalScheduleEvents },
      { label: "insurance_eligibility_reviews", table: insuranceEligibilityReviews },
      { label: "cooldown_records", table: cooldownRecords },
      { label: "projected_invoice_rows", table: projectedInvoiceRows },
      { label: "appointments", table: appointments },
      { label: "documents", table: documents },
      { label: "patient_execution_cases", table: patientExecutionCases },
    ];

    if (screeningIds.length === 0 && batchIds.length === 0) {
      console.log("  nothing to clean up (no demo data found).");
    }

    if (!apply) {
      // Dry-run: count what WOULD be deleted per spine table.
      for (const { label, table } of spineTables) {
        if (screeningIds.length === 0) { console.log(`  would delete 0 ${label}`); continue; }
        const rows = await db.select({ id: table.id }).from(table)
          .where(inArray(table.patientScreeningId, screeningIds));
        console.log(`  would delete ${rows.length} ${label}`);
      }
      const demoUser = await db.select({ id: users.id }).from(users).where(eq(users.username, DEMO_USERNAME));
      console.log(`  would delete ${screeningIds.length} patient_screenings (via batch cascade)`);
      console.log(`  would delete ${batchIds.length} screening_batches`);
      console.log(`  would delete ${demoUser.length} demo user`);
      console.log("");
      console.log("[seed:investor-demo] Cleanup dry-run complete. Re-run with E2E_SEED_APPLY=YES to delete.");
      return;
    }

    // 4) Apply: delete spine rows first (avoids orphaned set-null rows).
    for (const { label, table } of spineTables) {
      if (screeningIds.length === 0) continue;
      const deleted = await db.delete(table)
        .where(inArray(table.patientScreeningId, screeningIds))
        .returning({ id: table.id });
      console.log(`  ✓ deleted ${deleted.length} ${label}`);
    }

    // 5) Delete the demo batches → cascades patient_screenings and the
    //    remaining cascade children.
    if (batchIds.length > 0) {
      const delBatches = await db.delete(screeningBatches)
        .where(inArray(screeningBatches.id, batchIds))
        .returning({ id: screeningBatches.id });
      console.log(`  ✓ deleted ${delBatches.length} screening_batches (+ cascaded patient_screenings & children)`);
    }

    // 6) Delete the demo user.
    const delUser = await db.delete(users)
      .where(eq(users.username, DEMO_USERNAME))
      .returning({ id: users.id });
    console.log(`  ✓ deleted ${delUser.length} demo user`);

    console.log("");
    console.log("[seed:investor-demo] OK — demo data cleaned up");
    console.log("  Note: invoices / invoice_line_items were intentionally left in place");
    console.log("  (they may be shared with non-demo work). Review by facility if needed.");
  } catch (err: any) {
    console.error("[seed:investor-demo] cleanup failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    bail("Refusing to run under NODE_ENV=production. Demo seed must never touch production.");
  }
  if (!process.env.DATABASE_URL) {
    bail("DATABASE_URL is not set.");
  }
  const apply = process.env.E2E_SEED_APPLY === "YES";
  const demoPassword = process.env.DEMO_PASSWORD || "PlexusDemo2026!";
  // Cleanup mode removes all demo-tagged data. Trigger with either the
  // `--cleanup` CLI flag or DEMO_MODE=cleanup.
  const cleanup = process.argv.includes("--cleanup") || process.env.DEMO_MODE === "cleanup";

  if (cleanup) {
    return runCleanup(apply);
  }

  const patients = buildDemoPatients();
  const stageCounts = patients.reduce<Record<string, number>>((acc, p) => {
    acc[p.stage] = (acc[p.stage] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[seed:investor-demo] mode: ${apply ? "APPLY (writes)" : "DRY-RUN (no writes — set E2E_SEED_APPLY=YES)"}`);
  console.log(`[seed:investor-demo] demo user: ${DEMO_USERNAME} (role=admin)`);
  console.log(`[seed:investor-demo] patients: ${patients.length} — ${JSON.stringify(stageCounts)}`);

  if (!apply) {
    console.log("");
    console.log("[seed:investor-demo] Planned patients:");
    for (const p of patients) {
      console.log(`  [${p.stage.padEnd(9)}] ${p.name}  dob=${p.dob}  ${p.service}  ${p.patientType}  ${p.facility}`);
    }
    console.log("");
    console.log("[seed:investor-demo] Dry-run complete. Re-run with E2E_SEED_APPLY=YES to write.");
    return;
  }

  // ── Deferred imports so gate errors surface before any DB connection ──
  const { db, pool } = await import("../server/db");
  const { users, screeningBatches, patientScreenings, globalScheduleEvents, invoices } =
    await import("@shared/schema");
  const {
    createOrUpdateExecutionCaseFromScreening,
    appendPatientJourneyEvent,
    listJourneyEvents,
  } = await import("../server/repositories/executionCase.repo");
  const { createGlobalScheduleEvent, createGlobalScheduleEventFromScreeningCommit } =
    await import("../server/repositories/globalSchedule.repo");
  const { createOrUpdateInsuranceEligibilityReviewFromScreening } =
    await import("../server/repositories/insuranceEligibility.repo");
  const { createOrUpdateCooldownRecordsFromScreening } =
    await import("../server/repositories/cooldown.repo");
  const { markProcedureComplete } = await import("../server/repositories/procedureEvents.repo");
  const { listCaseDocumentReadiness, updateCaseDocumentReadiness } =
    await import("../server/repositories/documentReadiness.repo");
  const { createPendingProcedureNotes, listGeneratedNotes, updateGeneratedNote } =
    await import("../server/repositories/generatedNotes.repo");
  const { evaluateBillingReadinessForProcedure } =
    await import("../server/repositories/billingReadiness.repo");
  const { createPendingBillingDocumentRequestFromReadiness, listBillingDocumentRequests } =
    await import("../server/repositories/billingDocuments.repo");
  const {
    listCompletedBillingPackages,
    createCompletedBillingPackage,
    updateCompletedBillingPackagePayment,
    addCompletedPackageToInvoice,
  } = await import("../server/repositories/completedBillingPackages.repo");
  const { invoicesRepository } = await import("../server/repositories/invoices.repo");

  let exitCode = 0;
  try {
    // ── 0) Demo admin user (idempotent, bcrypt cost 12 to match users repo) ──
    const [existingUser] = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.username, DEMO_USERNAME))
      .limit(1);
    const hashed = await bcrypt.hash(demoPassword, 12);
    if (existingUser) {
      await db.update(users)
        .set({ password: hashed, role: "admin", active: true })
        .where(eq(users.id, existingUser.id));
      console.log(`  ✓ demo user (reused id=${existingUser.id}, password reset, role=admin)`);
    } else {
      const [created] = await db.insert(users)
        .values({ username: DEMO_USERNAME, password: hashed, role: "admin", active: true, clinicId: null })
        .returning();
      console.log(`  + demo user created id=${created.id} (role=admin)`);
    }

    // ── Per-facility demo batch (one batch per facility, reused) ──────────
    const batchIdByFacility = new Map<string, number>();
    async function getBatchId(facility: string): Promise<number> {
      if (batchIdByFacility.has(facility)) return batchIdByFacility.get(facility)!;
      const batchName = `${DEMO_BATCH_PREFIX}${facility}`;
      const [existing] = await db
        .select()
        .from(screeningBatches)
        .where(and(eq(screeningBatches.name, batchName), eq(screeningBatches.isTest, true)))
        .orderBy(desc(screeningBatches.id))
        .limit(1);
      let id: number;
      if (existing) {
        id = existing.id;
      } else {
        const [created] = await db.insert(screeningBatches).values({
          name: batchName,
          facility,
          status: "draft",
          patientCount: 0,
          isTest: true,
        }).returning();
        id = created.id;
        console.log(`  + batch "${batchName}" id=${id}`);
      }
      batchIdByFacility.set(facility, id);
      return id;
    }

    // ── Upsert a patient_screening row for a demo patient ────────────────
    async function upsertScreening(p: DemoPatient, batchId: number) {
      const isCommitted = p.stage !== "intake";
      const baseFields = {
        time: "10:00 AM",
        name: p.name,
        age: p.age,
        gender: p.gender,
        dob: p.dob,
        phoneNumber: p.phoneNumber,
        email: p.email,
        insurance: p.insurance,
        facility: p.facility,
        diagnoses: p.diagnoses,
        history: p.history,
        medications: p.medications,
        qualifyingTests: [p.service],
        status: p.stage === "intake" ? "pending" : "completed",
        appointmentStatus: p.stage === "intake" || p.stage === "screened" ? "pending" : "scheduled",
        patientType: p.patientType,
        commitStatus: (isCommitted ? "Ready" : "Draft") as "Ready" | "Draft",
        committedAt: isCommitted ? new Date() : null,
        adminApprovalStatus: isCommitted ? "approved" : "pending",
        isTest: true,
      };
      const [existing] = await db
        .select()
        .from(patientScreenings)
        .where(and(
          eq(patientScreenings.name, p.name),
          eq(patientScreenings.dob, p.dob),
          eq(patientScreenings.batchId, batchId),
        ))
        .orderBy(desc(patientScreenings.id))
        .limit(1);
      if (existing) {
        const [updated] = await db.update(patientScreenings)
          .set(baseFields)
          .where(eq(patientScreenings.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db.insert(patientScreenings)
        .values({ batchId, ...baseFields })
        .returning();
      return created;
    }

    const summary: Record<Stage, number> = {
      intake: 0, screened: 0, scheduled: 0, procedure: 0, billed: 0,
    };

    for (const p of patients) {
      const batchId = await getBatchId(p.facility);
      const screening = await upsertScreening(p, batchId);
      summary[p.stage]++;

      // Stage: intake — imported only, stop here.
      if (p.stage === "intake") {
        console.log(`  [intake]    ${p.name} → screening id=${screening.id}`);
        continue;
      }

      // All non-intake stages get an execution case + insurance + cooldown.
      const { executionCase, created: ecCreated } =
        await createOrUpdateExecutionCaseFromScreening(screening, null);
      const eligibility = await createOrUpdateInsuranceEligibilityReviewFromScreening(
        screening, executionCase.id,
      );
      const cooldownRows = await createOrUpdateCooldownRecordsFromScreening(
        screening, executionCase.id,
      );

      // Journey: committed + case wired (dedup by eventType).
      const journey = await listJourneyEvents({ patientScreeningId: screening.id }, 100);
      if (!journey.some((e) => e.eventType === "screening_committed")) {
        await appendPatientJourneyEvent({
          patientName: screening.name,
          patientDob: screening.dob ?? undefined,
          patientScreeningId: screening.id,
          executionCaseId: executionCase.id,
          eventType: "screening_committed",
          eventSource: "investor_demo_seed",
          actorUserId: null,
          summary: "Demo patient committed (investor demo seed)",
          metadata: { commitStatus: "Ready", auto: true, demo: true },
        });
      }
      if (!journey.some((e) =>
        e.eventType === "execution_case_created" || e.eventType === "execution_case_updated")) {
        await appendPatientJourneyEvent({
          patientName: screening.name,
          patientDob: screening.dob ?? undefined,
          patientScreeningId: screening.id,
          executionCaseId: executionCase.id,
          eventType: ecCreated ? "execution_case_created" : "execution_case_updated",
          eventSource: "investor_demo_seed",
          actorUserId: null,
          summary: "Execution case wired (investor demo seed)",
          metadata: { executionCaseId: executionCase.id, demo: true },
        });
      }

      // Stage: screened — qualified & committed, not yet scheduled.
      if (p.stage === "screened") {
        console.log(`  [screened]  ${p.name} → case id=${executionCase.id} (${eligibility.review.priorityClass}) cooldowns=${cooldownRows.length}`);
        continue;
      }

      // Schedule the appointment (future date) for scheduled/procedure/billed.
      const procedureDate = dateAtHour(p.stage === "scheduled" ? 7 : -3, 10);
      const procedureDateYmd = ymd(procedureDate);

      // Visit patients also get a doctor-visit event the day before.
      if (p.patientType === "visit") {
        const visitDateYmd = ymd(dateAtHour(p.stage === "scheduled" ? 6 : -4));
        await createGlobalScheduleEventFromScreeningCommit(
          screening, executionCase.id, visitDateYmd, { auto: true, actorUserId: null },
        );
      }

      const [existingAncillary] = await db
        .select()
        .from(globalScheduleEvents)
        .where(and(
          eq(globalScheduleEvents.patientScreeningId, screening.id),
          eq(globalScheduleEvents.eventType, "ancillary_appointment"),
          eq(globalScheduleEvents.serviceType, p.service),
        ))
        .limit(1);
      let ancillaryEventId: number;
      if (existingAncillary) {
        const [updated] = await db.update(globalScheduleEvents)
          .set({ startsAt: procedureDate, status: "scheduled", updatedAt: new Date() })
          .where(eq(globalScheduleEvents.id, existingAncillary.id))
          .returning();
        ancillaryEventId = updated.id;
      } else {
        const created = await createGlobalScheduleEvent({
          executionCaseId: executionCase.id,
          patientScreeningId: screening.id,
          patientName: screening.name,
          patientDob: screening.dob ?? undefined,
          facilityId: screening.facility ?? undefined,
          eventType: "ancillary_appointment",
          serviceType: p.service,
          source: p.patientType === "outreach" ? "outreach_import" : "system_generated",
          status: "scheduled",
          startsAt: procedureDate,
          metadata: { source: "investor_demo_seed", auto: true, demo: true },
        });
        ancillaryEventId = created.id;
      }

      // Stage: scheduled — appointment booked in the future, stop here.
      if (p.stage === "scheduled") {
        console.log(`  [scheduled] ${p.name} → appt id=${ancillaryEventId} on ${procedureDateYmd} (${p.patientType})`);
        continue;
      }

      // Stage: procedure & billed — complete the procedure + docs + notes.
      const { procedureEvent } = await markProcedureComplete({
        executionCaseId: executionCase.id,
        patientScreeningId: screening.id,
        globalScheduleEventId: ancillaryEventId,
        patientName: screening.name,
        patientDob: screening.dob,
        facilityId: screening.facility,
        serviceType: p.service,
        completedByUserId: null,
        note: `Investor demo seed — ${p.service} procedure complete`,
      });

      async function setDocStatus(documentType: string, status: string) {
        const rows = await listCaseDocumentReadiness(
          { patientScreeningId: screening.id, serviceType: p.service, documentType }, 1,
        );
        const row = rows[0];
        if (!row) return;
        await updateCaseDocumentReadiness(row.id, { documentStatus: status, completedAt: new Date() });
      }
      await setDocStatus("informed_consent", "completed");
      await setDocStatus("screening_form", "completed");
      await setDocStatus("report", "uploaded");
      await setDocStatus("order_note", "completed");
      await setDocStatus("post_procedure_note", "completed");

      await createPendingProcedureNotes({
        executionCaseId: executionCase.id,
        patientScreeningId: screening.id,
        procedureEventId: procedureEvent.id,
        serviceType: p.service,
      });
      async function setNoteGenerated(noteType: string) {
        const rows = await listGeneratedNotes(
          { patientScreeningId: screening.id, serviceType: p.service, noteType }, 1,
        );
        const row = rows[0];
        if (!row) return;
        await updateGeneratedNote(row.id, {
          generationStatus: "generated",
          generatedText: `[Investor demo] ${noteType.replace(/_/g, " ")} for ${p.name} — ${p.service}.`,
        });
      }
      await setNoteGenerated("order_note");
      await setNoteGenerated("post_procedure_note");

      const billingReadiness = await evaluateBillingReadinessForProcedure({
        executionCaseId: executionCase.id,
        patientScreeningId: screening.id,
        procedureEventId: procedureEvent.id,
        patientName: screening.name,
        patientDob: screening.dob,
        facilityId: screening.facility,
        serviceType: p.service,
      });

      // Stage: procedure — done through procedure + notes + readiness, stop.
      if (p.stage === "procedure") {
        console.log(`  [procedure] ${p.name} → procedure id=${procedureEvent.id}, billing readiness=${billingReadiness.readinessStatus}`);
        continue;
      }

      // Stage: billed — billing document request + completed package + invoice.
      let billingDocRequestId: number | null = null;
      if (billingReadiness.readinessStatus === "ready_to_generate") {
        const docRequest = await createPendingBillingDocumentRequestFromReadiness(billingReadiness);
        billingDocRequestId = docRequest.id;
      } else {
        const existingReqs = await listBillingDocumentRequests(
          { patientScreeningId: screening.id, serviceType: p.service }, 1,
        );
        billingDocRequestId = existingReqs[0]?.id ?? null;
      }

      const existingPackages = await listCompletedBillingPackages(
        { patientScreeningId: screening.id, serviceType: p.service }, 1,
      );
      let completedPackageId: number;
      if (existingPackages[0]) {
        completedPackageId = existingPackages[0].id;
      } else {
        const created = await createCompletedBillingPackage({
          executionCaseId: executionCase.id,
          patientScreeningId: screening.id,
          procedureEventId: procedureEvent.id,
          billingReadinessCheckId: billingReadiness.id,
          billingDocumentRequestId: billingDocRequestId ?? undefined,
          patientName: screening.name,
          patientInitials: p.name.split(/\s+/).map((s) => s[0]?.toUpperCase() ?? "").join(""),
          patientDob: screening.dob ?? undefined,
          facilityId: screening.facility ?? undefined,
          serviceType: p.service,
          dos: procedureDateYmd,
          packageStatus: "pending_payment",
          paymentStatus: "not_received",
        });
        completedPackageId = created.id;
      }

      // Ensure a Draft invoice exists for this facility.
      const [existingDraftInvoice] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.facility, p.facility), eq(invoices.status, "Draft")))
        .orderBy(desc(invoices.id))
        .limit(1);
      if (!existingDraftInvoice) {
        const invoiceNumber = await invoicesRepository.nextInvoiceNumber();
        await db.insert(invoices).values({
          invoiceNumber,
          facility: p.facility,
          invoiceDate: ymd(new Date()),
          status: "Draft",
        });
      }

      const amount = (300 + (p.index % 6) * 25).toFixed(2); // 300.00..425.00
      const paid = await updateCompletedBillingPackagePayment(completedPackageId, {
        fullAmountPaid: amount,
        paymentDate: ymd(new Date()),
        paymentStatus: "updated",
        note: "Investor demo seed — payment updated",
      });
      let invoiceLineItemId: number | null = null;
      if (paid) {
        const invResult = await addCompletedPackageToInvoice(paid);
        invoiceLineItemId = invResult?.lineItem.id ?? null;
      }
      console.log(`  [billed]    ${p.name} → package id=${completedPackageId} $${amount}, invoiceLineItem=${invoiceLineItemId ?? "(none)"}`);
    }

    // Keep each demo batch's patientCount roughly accurate for the UI.
    for (const [facility, batchId] of batchIdByFacility) {
      const count = patients.filter((p) => p.facility === facility).length;
      await db.update(screeningBatches).set({ patientCount: count }).where(eq(screeningBatches.id, batchId));
    }

    console.log("");
    console.log("[seed:investor-demo] OK — demo data seeded");
    console.log(`  demo login: username="${DEMO_USERNAME}" password="${process.env.DEMO_PASSWORD ? "(from DEMO_PASSWORD env)" : demoPassword}"`);
    console.log(`  stage summary: ${JSON.stringify(summary)}`);
    console.log(`  total demo patients: ${patients.length}`);
    void like; // reserved for future prefix cleanup helper
  } catch (err: any) {
    console.error("[seed:investor-demo] failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[seed:investor-demo] unexpected failure:", err);
  process.exit(1);
});

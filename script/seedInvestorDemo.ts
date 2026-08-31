// script/seedInvestorDemo.ts
//
// Investor-demo seed. Run with `npm run seed:investor-demo`.
//
// Creates ONE demo admin login (`demo`) and 24 fully synthetic patients that
// populate every stage of the app (screening → execution case → scheduling →
// insurance → cooldown → procedure → documents → notes → billing → invoice),
// so investors can walk through the whole product with live, working screens.
//
// ── Self-contained by design ───────────────────────────────────────
// This script talks to Postgres directly via `pg` + `drizzle` + the
// `shared/schema` table definitions. It deliberately does NOT import
// anything from `server/` so it can run inside the PRODUCTION Docker
// image (which bundles the server into dist/ and does not ship the
// `server/` sources) as a one-shot ECS task. It writes the same ROWS
// the app's repositories would; the app reads and renders them identically.
//
// ── Safety ─────────────────────────────────────────────────────────
//   • 100% synthetic data. No real patient PII.
//   • Every row carries `is_test = true` where supported; batches are
//     prefixed `DEMO — `.
//   • Idempotent: dedupes on name + dob + demo batch.
//   • Strictly additive — never deletes or mutates non-demo rows
//     (except --cleanup, which only removes demo-tagged rows).
//   • Dry-run by default; requires E2E_SEED_APPLY=YES to write.
//
// ── Usage ──────────────────────────────────────────────────────────
//   npm run seed:investor-demo                       # dry-run (seed plan)
//   E2E_SEED_APPLY=YES npm run seed:investor-demo     # apply
//   npm run seed:investor-demo -- --cleanup           # dry-run (cleanup plan)
//   E2E_SEED_APPLY=YES npm run seed:investor-demo -- --cleanup   # apply cleanup

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc, inArray, like } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  users, screeningBatches, patientScreenings,
  patientExecutionCases, patientJourneyEvents,
  insuranceEligibilityReviews, cooldownRecords,
  procedureEvents, procedureNotes,
  billingReadinessChecks, completedBillingPackages,
  caseDocumentReadiness, globalScheduleEvents,
  invoices,
} from "@shared/schema";

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

type Stage = "intake" | "screened" | "scheduled" | "procedure" | "billed";

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
function demoDob(i: number): string {
  const year = 1945 + (i % 26);
  const month = ((i * 7) % 12) + 1;
  const day = ((i * 13) % 27) + 1;
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}
function demoAge(dob: string): number {
  const yyyy = dob.split("/")[2];
  return new Date().getFullYear() - parseInt(yyyy, 10);
}
function priorityClassFor(insurance: string): string {
  const s = insurance.toLowerCase();
  if (s.includes("straight medicare")) return "straight_medicare";
  if (s.includes("ppo")) return "ppo";
  return "other";
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

function buildDemoPatients(): DemoPatient[] {
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
    return {
      index: i,
      name: `${first} ${last}`,
      dob,
      age: demoAge(dob),
      gender: i % 2 === 0 ? "F" : "M",
      phoneNumber: `(555) ${String(200 + i).padStart(3, "0")}-${String(1000 + i * 7).slice(-4)}`,
      email: `${first}.${last}`.toLowerCase() + "@example.com",
      facility: pick(DEMO_FACILITIES, i),
      insurance: pick(INSURANCES, i),
      service: pick(SERVICES, i),
      patientType: stage === "scheduled" && i % 2 === 1 ? "outreach" : "visit",
      diagnoses: pick(DIAGNOSES, i),
      history: pick(HISTORIES, i),
      medications: pick(MEDICATIONS, i),
      stage,
    };
  });
}

// ── DB connection (self-contained; mirrors server/db.ts) ───────────
function makeDb() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:investor-demo] DATABASE_URL is not set.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const db = drizzle(pool);
  return { pool, db };
}

function bail(msg: string, code = 1): never {
  console.error(`[seed:investor-demo] ${msg}`);
  process.exit(code);
}

// ── Cleanup ────────────────────────────────────────────────────────
async function runCleanup(apply: boolean): Promise<void> {
  console.log(`[seed:investor-demo] mode: CLEANUP ${apply ? "APPLY (deletes)" : "DRY-RUN (no deletes — set E2E_SEED_APPLY=YES)"}`);
  const { pool, db } = makeDb();
  let exitCode = 0;
  try {
    const demoBatches = await db
      .select({ id: screeningBatches.id, name: screeningBatches.name })
      .from(screeningBatches)
      .where(and(like(screeningBatches.name, `${DEMO_BATCH_PREFIX}%`), eq(screeningBatches.isTest, true)));
    const batchIds = demoBatches.map((b) => b.id);
    console.log(`  demo batches: ${batchIds.length}${batchIds.length ? ` (${demoBatches.map((b) => b.name).join(", ")})` : ""}`);

    let screeningIds: number[] = [];
    if (batchIds.length > 0) {
      const rows = await db.select({ id: patientScreenings.id }).from(patientScreenings)
        .where(inArray(patientScreenings.batchId, batchIds));
      screeningIds = rows.map((r) => r.id);
    }
    console.log(`  demo patient screenings: ${screeningIds.length}`);

    const spineTables: Array<{ label: string; table: any }> = [
      { label: "patient_journey_events", table: patientJourneyEvents },
      { label: "procedure_notes", table: procedureNotes },
      { label: "case_document_readiness", table: caseDocumentReadiness },
      { label: "completed_billing_packages", table: completedBillingPackages },
      { label: "billing_readiness_checks", table: billingReadinessChecks },
      { label: "procedure_events", table: procedureEvents },
      { label: "global_schedule_events", table: globalScheduleEvents },
      { label: "insurance_eligibility_reviews", table: insuranceEligibilityReviews },
      { label: "cooldown_records", table: cooldownRecords },
      { label: "patient_execution_cases", table: patientExecutionCases },
    ];

    if (!apply) {
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
      console.log("\n[seed:investor-demo] Cleanup dry-run complete. Re-run with E2E_SEED_APPLY=YES to delete.");
      return;
    }

    for (const { label, table } of spineTables) {
      if (screeningIds.length === 0) continue;
      const deleted = await db.delete(table)
        .where(inArray(table.patientScreeningId, screeningIds))
        .returning({ id: table.id });
      console.log(`  ✓ deleted ${deleted.length} ${label}`);
    }
    if (batchIds.length > 0) {
      const delBatches = await db.delete(screeningBatches)
        .where(inArray(screeningBatches.id, batchIds))
        .returning({ id: screeningBatches.id });
      console.log(`  ✓ deleted ${delBatches.length} screening_batches (+ cascaded patient_screenings & children)`);
    }
    const delUser = await db.delete(users)
      .where(eq(users.username, DEMO_USERNAME))
      .returning({ id: users.id });
    console.log(`  ✓ deleted ${delUser.length} demo user`);
    console.log("\n[seed:investor-demo] OK — demo data cleaned up");
    console.log("  Note: invoices / invoice_line_items were intentionally left in place.");
  } catch (err: any) {
    console.error("[seed:investor-demo] cleanup failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

async function main() {
  const apply = process.env.E2E_SEED_APPLY === "YES";
  const demoPassword = process.env.DEMO_PASSWORD || "PlexusDemo2026!";
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
    console.log("\n[seed:investor-demo] Planned patients:");
    for (const p of patients) {
      console.log(`  [${p.stage.padEnd(9)}] ${p.name}  dob=${p.dob}  ${p.service}  ${p.patientType}  ${p.facility}`);
    }
    console.log("\n[seed:investor-demo] Dry-run complete. Re-run with E2E_SEED_APPLY=YES to write.");
    return;
  }

  const { pool, db } = makeDb();
  let exitCode = 0;
  try {
    // ── Demo admin user (idempotent, bcrypt cost 12) ──────────────────
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users).where(eq(users.username, DEMO_USERNAME)).limit(1);
    const hashed = await bcrypt.hash(demoPassword, 12);
    if (existingUser) {
      await db.update(users).set({ password: hashed, role: "admin", active: true })
        .where(eq(users.id, existingUser.id));
      console.log(`  ✓ demo user (reused id=${existingUser.id}, password reset, role=admin)`);
    } else {
      const [created] = await db.insert(users)
        .values({ username: DEMO_USERNAME, password: hashed, role: "admin", active: true, clinicId: null })
        .returning({ id: users.id });
      console.log(`  + demo user created id=${created.id} (role=admin)`);
    }

    // ── One demo batch per facility (reused) ──────────────────────────
    const batchIdByFacility = new Map<string, number>();
    async function getBatchId(facility: string): Promise<number> {
      if (batchIdByFacility.has(facility)) return batchIdByFacility.get(facility)!;
      const batchName = `${DEMO_BATCH_PREFIX}${facility}`;
      const [existing] = await db.select().from(screeningBatches)
        .where(and(eq(screeningBatches.name, batchName), eq(screeningBatches.isTest, true)))
        .orderBy(desc(screeningBatches.id)).limit(1);
      let id: number;
      if (existing) {
        id = existing.id;
      } else {
        const [created] = await db.insert(screeningBatches).values({
          name: batchName, facility, status: "draft", patientCount: 0, isTest: true,
        }).returning({ id: screeningBatches.id });
        id = created.id;
        console.log(`  + batch "${batchName}" id=${id}`);
      }
      batchIdByFacility.set(facility, id);
      return id;
    }

    // ── Upsert one patient_screening for a demo patient ───────────────
    async function upsertScreening(p: DemoPatient, batchId: number) {
      const isCommitted = p.stage !== "intake";
      const baseFields = {
        time: "10:00 AM",
        name: p.name, age: p.age, gender: p.gender, dob: p.dob,
        phoneNumber: p.phoneNumber, email: p.email,
        insurance: p.insurance, facility: p.facility,
        diagnoses: p.diagnoses, history: p.history, medications: p.medications,
        qualifyingTests: [p.service],
        status: p.stage === "intake" ? "pending" : "completed",
        appointmentStatus: (p.stage === "intake" || p.stage === "screened") ? "pending" : "scheduled",
        patientType: p.patientType,
        commitStatus: (isCommitted ? "Ready" : "Draft") as "Ready" | "Draft",
        committedAt: isCommitted ? new Date() : null,
        adminApprovalStatus: isCommitted ? "approved" : "pending",
        isTest: true,
      };
      const [existing] = await db.select().from(patientScreenings)
        .where(and(
          eq(patientScreenings.name, p.name),
          eq(patientScreenings.dob, p.dob),
          eq(patientScreenings.batchId, batchId),
        )).orderBy(desc(patientScreenings.id)).limit(1);
      if (existing) {
        const [updated] = await db.update(patientScreenings).set(baseFields)
          .where(eq(patientScreenings.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(patientScreenings)
        .values({ batchId, ...baseFields }).returning();
      return created;
    }

    // Generic "find one by screeningId (+ optional serviceType/type) or insert" helper.
    async function ensureRow<T extends { id: any; patientScreeningId: any }>(
      table: any,
      screeningId: number,
      extraWhere: any[],
      values: Record<string, unknown>,
    ): Promise<number> {
      const [existing] = await db.select({ id: table.id }).from(table)
        .where(and(eq(table.patientScreeningId, screeningId), ...extraWhere))
        .limit(1);
      if (existing) return existing.id as number;
      const [created] = await db.insert(table).values(values).returning({ id: table.id });
      return created.id as number;
    }

    const summary: Record<Stage, number> = { intake: 0, screened: 0, scheduled: 0, procedure: 0, billed: 0 };

    for (const p of patients) {
      const batchId = await getBatchId(p.facility);
      const screening = await upsertScreening(p, batchId);
      summary[p.stage]++;

      if (p.stage === "intake") {
        console.log(`  [intake]    ${p.name} → screening id=${screening.id}`);
        continue;
      }

      // Execution case (idempotent by screeningId).
      const bucket = p.patientType === "outreach" ? "outreach" : "visit";
      const ecId = await ensureRow(patientExecutionCases, screening.id, [], {
        patientScreeningId: screening.id,
        patientName: p.name, patientDob: p.dob, facilityId: p.facility,
        source: p.patientType === "outreach" ? "outreach_import" : "system_generated",
        engagementBucket: bucket,
        qualificationStatus: "qualified",
        lifecycleStatus: "active",
        engagementStatus: p.stage === "scheduled" ? "scheduled" : "new",
        selectedServices: [p.service],
      });

      // Insurance eligibility (idempotent by screeningId).
      const pc = priorityClassFor(p.insurance);
      await ensureRow(insuranceEligibilityReviews, screening.id, [], {
        executionCaseId: ecId, patientScreeningId: screening.id,
        patientName: p.name, patientDob: p.dob, facilityId: p.facility,
        insuranceName: p.insurance,
        eligibilityStatus: pc === "straight_medicare" ? "preferred" : "allowed",
        approvalStatus: "not_required",
        priorityClass: pc,
      });

      // Cooldown (idempotent by screeningId + serviceType).
      await ensureRow(cooldownRecords, screening.id, [eq(cooldownRecords.serviceType, p.service)], {
        executionCaseId: ecId, patientScreeningId: screening.id,
        patientName: p.name, patientDob: p.dob, facilityId: p.facility,
        serviceType: p.service, cooldownStatus: "not_applicable", overrideStatus: "none",
      });

      // Journey events (dedup by eventType).
      const journey = await db.select({ eventType: patientJourneyEvents.eventType })
        .from(patientJourneyEvents).where(eq(patientJourneyEvents.patientScreeningId, screening.id));
      const jtypes = new Set(journey.map((j) => j.eventType));
      if (!jtypes.has("screening_committed")) {
        await db.insert(patientJourneyEvents).values({
          patientName: p.name, patientDob: p.dob,
          patientScreeningId: screening.id, executionCaseId: ecId,
          eventType: "screening_committed", eventSource: "investor_demo_seed",
          summary: "Demo patient committed (investor demo seed)",
          metadata: { demo: true },
        });
      }
      if (!jtypes.has("execution_case_created")) {
        await db.insert(patientJourneyEvents).values({
          patientName: p.name, patientDob: p.dob,
          patientScreeningId: screening.id, executionCaseId: ecId,
          eventType: "execution_case_created", eventSource: "investor_demo_seed",
          summary: "Execution case wired (investor demo seed)",
          metadata: { demo: true },
        });
      }

      if (p.stage === "screened") {
        console.log(`  [screened]  ${p.name} → case id=${ecId} (${pc})`);
        continue;
      }

      // Scheduling: appointment (future for 'scheduled', past for procedure/billed).
      const procedureDate = dateAtHour(p.stage === "scheduled" ? 7 : -3, 10);
      const procedureDateYmd = ymd(procedureDate);

      if (p.patientType === "visit") {
        const visitDate = dateAtHour(p.stage === "scheduled" ? 6 : -4, 9);
        await ensureRow(globalScheduleEvents, screening.id,
          [eq(globalScheduleEvents.eventType, "doctor_visit")], {
            executionCaseId: ecId, patientScreeningId: screening.id,
            patientName: p.name, patientDob: p.dob, facilityId: p.facility,
            eventType: "doctor_visit", source: "screening_commit",
            status: "scheduled", startsAt: visitDate, metadata: { demo: true },
          });
      }

      const ancillaryId = await ensureRow(globalScheduleEvents, screening.id,
        [eq(globalScheduleEvents.eventType, "ancillary_appointment"),
         eq(globalScheduleEvents.serviceType, p.service)], {
          executionCaseId: ecId, patientScreeningId: screening.id,
          patientName: p.name, patientDob: p.dob, facilityId: p.facility,
          eventType: "ancillary_appointment", serviceType: p.service,
          source: p.patientType === "outreach" ? "outreach_import" : "system_generated",
          status: p.stage === "scheduled" ? "scheduled" : "completed",
          startsAt: procedureDate, metadata: { demo: true },
        });

      if (p.stage === "scheduled") {
        console.log(`  [scheduled] ${p.name} → appt id=${ancillaryId} on ${procedureDateYmd} (${p.patientType})`);
        continue;
      }

      // Procedure complete.
      const procId = await ensureRow(procedureEvents, screening.id,
        [eq(procedureEvents.serviceType, p.service)], {
          executionCaseId: ecId, patientScreeningId: screening.id,
          globalScheduleEventId: ancillaryId,
          patientName: p.name, patientDob: p.dob, facilityId: p.facility,
          serviceType: p.service, procedureStatus: "complete",
          completedAt: procedureDate, note: `Investor demo — ${p.service} complete`,
          metadata: { demo: true },
        });

      // Document readiness (one row per standard doc type, advanced to passing).
      const docStatuses: Array<[string, string]> = [
        ["informed_consent", "completed"], ["screening_form", "completed"],
        ["report", "uploaded"], ["order_note", "completed"], ["post_procedure_note", "completed"],
      ];
      for (const [docType, docStatus] of docStatuses) {
        await ensureRow(caseDocumentReadiness, screening.id,
          [eq(caseDocumentReadiness.serviceType, p.service),
           eq(caseDocumentReadiness.documentType, docType)], {
            executionCaseId: ecId, patientScreeningId: screening.id,
            patientName: p.name, patientDob: p.dob, facilityId: p.facility,
            serviceType: p.service, documentType: docType, documentStatus: docStatus,
            completedAt: new Date(), metadata: { demo: true },
          });
      }

      // Procedure notes (generated), unique by (screeningId, service, noteType).
      for (const noteType of ["order_note", "post_procedure_note"]) {
        await ensureRow(procedureNotes, screening.id,
          [eq(procedureNotes.serviceType, p.service), eq(procedureNotes.noteType, noteType)], {
            executionCaseId: ecId, patientScreeningId: screening.id, procedureEventId: procId,
            serviceType: p.service, noteType, generationStatus: "generated",
            generatedText: `[Investor demo] ${noteType.replace(/_/g, " ")} for ${p.name} — ${p.service}.`,
            sourceData: { demo: true },
          });
      }

      // Billing readiness.
      const brcId = await ensureRow(billingReadinessChecks, screening.id,
        [eq(billingReadinessChecks.serviceType, p.service)], {
          executionCaseId: ecId, patientScreeningId: screening.id, procedureEventId: procId,
          patientName: p.name, patientDob: p.dob, facilityId: p.facility,
          serviceType: p.service, readinessStatus: "ready_to_generate",
          missingRequirements: [], readyAt: new Date(), metadata: { demo: true },
        });

      if (p.stage === "procedure") {
        console.log(`  [procedure] ${p.name} → procedure id=${procId}, billing readiness id=${brcId}`);
        continue;
      }

      // Billed: completed billing package + ensure a Draft invoice exists.
      const amount = (300 + (p.index % 6) * 25).toFixed(2);
      await ensureRow(completedBillingPackages, screening.id,
        [eq(completedBillingPackages.serviceType, p.service)], {
          executionCaseId: ecId, patientScreeningId: screening.id, procedureEventId: procId,
          billingReadinessCheckId: brcId,
          patientName: p.name,
          patientInitials: p.name.split(/\s+/).map((s) => s[0]?.toUpperCase() ?? "").join(""),
          patientDob: p.dob, facilityId: p.facility, serviceType: p.service,
          dos: procedureDateYmd, packageStatus: "completed_package", paymentStatus: "updated",
          fullAmountPaid: amount, paymentDate: ymd(new Date()), paymentUpdatedAt: new Date(),
          metadata: { demo: true },
        });

      const [draftInvoice] = await db.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.facility, p.facility), eq(invoices.status, "Draft")))
        .orderBy(desc(invoices.id)).limit(1);
      if (!draftInvoice) {
        const invoiceNumber = `DEMO-${p.facility.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-6)}`;
        await db.insert(invoices).values({
          invoiceNumber, facility: p.facility, invoiceDate: ymd(new Date()), status: "Draft",
        });
      }
      console.log(`  [billed]    ${p.name} → completed package $${amount}`);
    }

    // Keep each demo batch's patientCount accurate.
    for (const [facility, batchId] of batchIdByFacility) {
      const count = patients.filter((p) => p.facility === facility).length;
      await db.update(screeningBatches).set({ patientCount: count }).where(eq(screeningBatches.id, batchId));
    }

    console.log("\n[seed:investor-demo] OK — demo data seeded");
    console.log(`  demo login: username="${DEMO_USERNAME}" password="${process.env.DEMO_PASSWORD ? "(from DEMO_PASSWORD env)" : demoPassword}"`);
    console.log(`  stage summary: ${JSON.stringify(summary)}`);
    console.log(`  total demo patients: ${patients.length}`);
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

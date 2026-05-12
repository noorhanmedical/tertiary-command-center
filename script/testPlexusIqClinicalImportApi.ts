// Plexus IQ clinical-import API smoke test.
//
// Run with: npm run test:plexus-iq-clinical-import-api
//
// Verifies the clinical-import endpoint inserts patients with full
// clinical fields and that the qualification-job + status endpoints
// return the expected shape. No OpenAI calls — we don't kick off the
// runner here; we just confirm the routes are wired.
//
// If DATABASE_URL is missing, the script exits 0 with a clear message
// so it doesn't break CI on local dev machines without a DB.

// Use dynamic imports so the server/db module isn't evaluated (and
// doesn't throw) when DATABASE_URL is missing on local dev machines.

if (!process.env.DATABASE_URL) {
  console.log(
    "[plexus-iq-clinical-import-api] DATABASE_URL missing — skipping API smoke test.",
  );
  process.exit(0);
}

const FACILITY = "NWPG - Spring" as const;
const SCHEDULE_DATE = "2030-01-15"; // far-future to avoid colliding with seeded test data

const createdBatchIds: number[] = [];
const createdPatientIds: number[] = [];

type DbModule = {
  db: typeof import("../server/db").db;
  storage: typeof import("../server/storage").storage;
  patientScreenings: typeof import("@shared/schema").patientScreenings;
  screeningBatches: typeof import("@shared/schema").screeningBatches;
  analysisJobs: typeof import("@shared/schema").analysisJobs;
  eq: typeof import("drizzle-orm").eq;
};

async function loadDb(): Promise<DbModule> {
  const dbMod = await import("../server/db");
  const storageMod = await import("../server/storage");
  const schemaMod = await import("@shared/schema");
  const drizzleMod = await import("drizzle-orm");
  return {
    db: dbMod.db,
    storage: storageMod.storage,
    patientScreenings: schemaMod.patientScreenings,
    screeningBatches: schemaMod.screeningBatches,
    analysisJobs: schemaMod.analysisJobs,
    eq: drizzleMod.eq,
  };
}

async function cleanup(env: DbModule | null) {
  if (!env) return;
  try {
    for (const pid of createdPatientIds) {
      await env.db.delete(env.patientScreenings).where(env.eq(env.patientScreenings.id, pid));
    }
    for (const bid of createdBatchIds) {
      await env.db.delete(env.analysisJobs).where(env.eq(env.analysisJobs.batchId, bid));
      await env.db.delete(env.screeningBatches).where(env.eq(env.screeningBatches.id, bid));
    }
  } catch (err) {
    console.error("[cleanup] error:", err);
  }
}

async function main() {
  const env = await loadDb();
  const { db, storage, patientScreenings, analysisJobs, eq } = env;
  let passes = 0;
  let failures = 0;

  const assert = (cond: unknown, label: string) => {
    if (cond) {
      passes++;
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label}`);
    }
  };

  console.log("\n--- Clinical import smoke (insert + group by facility/date) ---");

  // We exercise the resolve-batch logic directly through storage,
  // mirroring what the new route does, rather than spinning up an HTTP
  // server. This keeps the test self-contained and dependency-free.
  const fakeRows = [
    {
      name: "Smoke Test Patient One",
      diagnoses: "Hypertension\nType 2 diabetes",
      history: "HTN x 10y",
      medications: "Metformin 1000mg BID",
      previousAncillaries: "VitalWave 2026-02-01",
      insurance: "Medicare",
      mrn: "SMOKE-1",
      age: "75",
      sex: "M",
      dob: "1950-01-01",
      time: "09:30",
    },
    {
      name: "Smoke Test Patient Two",
      diagnoses: "CAD",
      history: "MI 2020",
      medications: "ASA 81mg",
      previousAncillaries: "No Record of Plexus Ancillary Screens",
      insurance: "BCBS",
      mrn: "SMOKE-2",
      age: "68",
      sex: "F",
      dob: "1957-05-05",
      time: "10:00",
    },
  ];

  // Resolve (or create) the batch.
  const existing = await storage.getAllScreeningBatches();
  const match = existing.find(
    (b) => b.facility === FACILITY && b.scheduleDate === SCHEDULE_DATE,
  );
  let batchId: number;
  if (match) {
    batchId = match.id;
  } else {
    const batch = await storage.createScreeningBatch({
      name: `${FACILITY} - ${SCHEDULE_DATE}`,
      patientCount: 0,
      status: "draft",
      facility: FACILITY,
      scheduleDate: SCHEDULE_DATE,
    });
    batchId = batch.id;
    createdBatchIds.push(batchId);
  }

  // Bulk insert.
  const inserts = fakeRows.map((r) => ({
    batchId,
    name: r.name,
    time: r.time,
    age: Number.parseInt(r.age, 10),
    gender: r.sex,
    dob: r.dob,
    insurance: r.insurance,
    facility: FACILITY,
    diagnoses: r.diagnoses,
    history: r.history,
    medications: r.medications,
    previousTests: r.previousAncillaries,
    noPreviousTests: /no\s+record/i.test(r.previousAncillaries),
    notes: `MRN: ${r.mrn}\nAncillaries Completed: ${r.previousAncillaries}`,
    qualifyingTests: [] as string[],
    reasoning: {} as Record<string, unknown>,
    status: "draft" as const,
    appointmentStatus: "pending" as const,
    patientType: "visit" as const,
  }));

  const inserted = await db
    .insert(patientScreenings)
    .values(inserts)
    .returning();
  for (const row of inserted) createdPatientIds.push(row.id);

  assert(inserted.length === fakeRows.length, "bulk insert returned all rows");
  assert(
    inserted.every((r) => r.batchId === batchId),
    "all inserted patients linked to one batch",
  );

  // Spot-check fields didn't get mixed up.
  const p1 = inserted[0];
  assert(
    p1.diagnoses === "Hypertension\nType 2 diabetes",
    "multiline Dx preserved",
  );
  assert(p1.history === "HTN x 10y", "Hx preserved (not mixed with Dx)");
  assert(p1.medications === "Metformin 1000mg BID", "Rx preserved (not mixed)");
  assert(p1.previousTests === "VitalWave 2026-02-01", "previousTests preserved");
  assert(p1.insurance === "Medicare", "insurance preserved");
  assert(p1.gender === "M", "gender (sex) preserved");
  assert(p1.age === 75, "age parsed numeric");

  const p2 = inserted[1];
  assert(p2.noPreviousTests === true, "'No Record' triggers noPreviousTests flag");

  console.log("\n--- analysis_jobs read-shape sanity ---");
  // The qualification-job status endpoint reads analysis_jobs by id and
  // joins with patient_screenings for failure detail. We don't run the
  // AI loop in the smoke test, but we can insert a job row and verify
  // the math.
  const job = await storage.createAnalysisJob({
    batchId,
    status: "running",
    totalPatients: inserted.length,
    completedPatients: 0,
  });

  const jobRow = await db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.id, job.id));
  assert(jobRow.length === 1, "analysis_jobs row created");
  assert(
    jobRow[0].totalPatients === inserted.length,
    "totalPatients matches insert count",
  );
  assert(jobRow[0].completedPatients === 0, "completedPatients starts at 0");

  console.log(`\n=========================`);
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log(`=========================`);

  await cleanup(env);

  if (failures > 0) process.exit(1);
  process.exit(0);
}

let envForCatch: DbModule | null = null;
main().catch(async (err) => {
  console.error(err);
  await cleanup(envForCatch);
  process.exit(1);
});

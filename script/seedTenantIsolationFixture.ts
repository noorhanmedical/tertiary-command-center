// Idempotent SYNTHETIC tenant-isolation test fixture (staging only).
//
// Creates (or reuses) two synthetic clinics, one non-admin clinic-scoped user
// bound to Clinic A, and one synthetic patient screening in each clinic. Used
// to LIVE-verify ADR-002 cross-clinic enforcement.
//
// SAFETY:
//   - SYNTHETIC ONLY. No real PHI. Everything is clearly TEST-labeled.
//   - Idempotent: safe to rerun; uses deterministic markers + ON CONFLICT.
//   - NEVER touches the existing 1,819-patient dataset (distinct clinics/ids).
//   - Password comes from env TENANT_TEST_PASSWORD (passed to the one-shot task);
//     it is NEVER printed by this script.
//
// Run (one-shot ECS task, same image): tsx script/seedTenantIsolationFixture.ts

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";

const CLINIC_A_ID = 90001;
const CLINIC_B_ID = 90002;
const TEST_USER = "synthetic-clinic-a-tester";
const MARKER = "SYNTHETIC_TENANT_TEST";

async function ensureClinic(id: number, name: string, slug: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO clinics (id, name, slug, active)
    VALUES (${id}, ${name}, ${slug}, true)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function ensureBatch(clinicId: number): Promise<number> {
  const existing = await db.execute(sql`
    SELECT id FROM screening_batches WHERE name = ${`${MARKER}_BATCH_${clinicId}`} LIMIT 1
  `);
  const row = (existing as unknown as { rows?: Array<{ id: number }> }).rows?.[0];
  if (row?.id) return row.id;
  const created = await storage.createScreeningBatch({
    clinicId,
    name: `${MARKER}_BATCH_${clinicId}`,
    status: "processing",
    isTest: true,
  } as Parameters<typeof storage.createScreeningBatch>[0]);
  return created.id;
}

async function ensureScreening(clinicId: number, batchId: number, label: string): Promise<number> {
  const existing = await db.execute(sql`
    SELECT id FROM patient_screenings WHERE name = ${label} AND clinic_id = ${clinicId} LIMIT 1
  `);
  const row = (existing as unknown as { rows?: Array<{ id: number }> }).rows?.[0];
  if (row?.id) return row.id;
  const created = await storage.createPatientScreening({
    batchId,
    clinicId,
    name: label,
    facility: `Synthetic Facility ${clinicId}`,
  } as Parameters<typeof storage.createPatientScreening>[0]);
  return created.id;
}

async function ensureUser(clinicId: number): Promise<void> {
  const password = process.env.TENANT_TEST_PASSWORD;
  if (!password) {
    throw new Error("TENANT_TEST_PASSWORD env is required (never hardcode/log it).");
  }
  const found = await db.execute(sql`SELECT id FROM users WHERE username = ${TEST_USER} LIMIT 1`);
  const exists = (found as unknown as { rows?: Array<{ id: string }> }).rows?.[0];
  if (exists?.id) {
    // Keep idempotent: ensure scope/role are correct; reset password to the
    // provided synthetic value so reruns yield a known-good login.
    await storage.updateUserPassword(exists.id, password).catch(() => {});
    await db.execute(sql`
      UPDATE users SET role = 'scheduler', clinic_id = ${clinicId}, active = true, status = 'active'
      WHERE id = ${exists.id}
    `);
    return;
  }
  await storage.createUser({
    username: TEST_USER,
    password,
    role: "scheduler", // non-admin, non-platform
    clinicId,
  } as Parameters<typeof storage.createUser>[0]);
}

async function main(): Promise<void> {
  await ensureClinic(CLINIC_A_ID, "Synthetic Clinic A (TEST)", "synthetic-clinic-a");
  await ensureClinic(CLINIC_B_ID, "Synthetic Clinic B (TEST)", "synthetic-clinic-b");
  await db.execute(sql`SELECT setval(pg_get_serial_sequence('clinics','id'), (SELECT MAX(id) FROM clinics))`);

  const batchA = await ensureBatch(CLINIC_A_ID);
  const batchB = await ensureBatch(CLINIC_B_ID);
  const patientA = await ensureScreening(CLINIC_A_ID, batchA, `${MARKER}_PATIENT_A`);
  const patientB = await ensureScreening(CLINIC_B_ID, batchB, `${MARKER}_PATIENT_B`);
  await ensureUser(CLINIC_A_ID);

  // Structural output only — NO password, NO PHI. IDs are needed for the live
  // cross-clinic verification matrix.
  console.log(JSON.stringify({
    source: "tenant_fixture_seed",
    outcome: "ok",
    clinicA: CLINIC_A_ID,
    clinicB: CLINIC_B_ID,
    userClinicA: TEST_USER,
    patientA_screeningId: patientA,
    patientB_screeningId: patientB,
  }));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ source: "tenant_fixture_seed", outcome: "failed", category: typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "error" }));
  process.exit(1);
});

// Idempotent SYNTHETIC tenant-isolation test fixture (staging only).
//
// SELF-CONTAINED: uses `pg` + `bcryptjs` + raw SQL only, so it runs inside the
// production image (which bundles the server into dist/ and does NOT ship raw
// server/ source). Depends only on node_modules present in the image and the
// canonical schema column names.
//
// Creates (or reuses) two synthetic clinics, one non-admin clinic-A-scoped user,
// and one synthetic patient per clinic. Used to LIVE-verify ADR-002 cross-clinic
// enforcement.
//
// SAFETY:
//   - SYNTHETIC ONLY. No real PHI. TEST-labeled. Idempotent (safe to rerun).
//   - NEVER touches the existing 1,819-patient dataset (distinct clinic ids).
//   - Password from env TENANT_TEST_PASSWORD; NEVER printed.
//   - TLS to RDS uses NODE_EXTRA_CA_CERTS baked into the image (verified TLS).
//
// Run (one-shot ECS task, same image): npx tsx script/seedTenantIsolationFixture.ts

import { Client } from "pg";
import bcrypt from "bcryptjs";

const CLINIC_A_ID = 90001;
const CLINIC_B_ID = 90002;
const TEST_USER = "synthetic-clinic-a-tester";
const MARKER = "SYNTHETIC_TENANT_TEST";

async function main(): Promise<void> {
  const password = process.env.TENANT_TEST_PASSWORD;
  if (!password) throw new Error("TENANT_TEST_PASSWORD env required (never hardcode/log).");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // Two synthetic clinics (high fixed ids — never collide with real data).
    for (const [id, name, slug] of [
      [CLINIC_A_ID, "Synthetic Clinic A (TEST)", "synthetic-clinic-a"],
      [CLINIC_B_ID, "Synthetic Clinic B (TEST)", "synthetic-clinic-b"],
    ] as Array<[number, string, string]>) {
      await c.query(
        `INSERT INTO clinics (id, name, slug, active) VALUES ($1,$2,$3,true)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, slug],
      );
    }
    await c.query(
      `SELECT setval(pg_get_serial_sequence('clinics','id'), (SELECT MAX(id) FROM clinics))`,
    );

    // One batch per clinic (idempotent by deterministic name).
    async function ensureBatch(clinicId: number): Promise<number> {
      const found = await c.query(
        `SELECT id FROM screening_batches WHERE name=$1 LIMIT 1`,
        [`${MARKER}_BATCH_${clinicId}`],
      );
      if (found.rows[0]) return found.rows[0].id;
      const ins = await c.query(
        `INSERT INTO screening_batches (clinic_id, name, status, is_test)
         VALUES ($1,$2,'processing',true) RETURNING id`,
        [clinicId, `${MARKER}_BATCH_${clinicId}`],
      );
      return ins.rows[0].id;
    }

    async function ensureScreening(clinicId: number, batchId: number, label: string): Promise<number> {
      const found = await c.query(
        `SELECT id FROM patient_screenings WHERE name=$1 AND clinic_id=$2 LIMIT 1`,
        [label, clinicId],
      );
      if (found.rows[0]) return found.rows[0].id;
      const ins = await c.query(
        `INSERT INTO patient_screenings (batch_id, clinic_id, name, facility)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [batchId, clinicId, label, `Synthetic Facility ${clinicId}`],
      );
      return ins.rows[0].id;
    }

    const batchA = await ensureBatch(CLINIC_A_ID);
    const batchB = await ensureBatch(CLINIC_B_ID);
    const patientA = await ensureScreening(CLINIC_A_ID, batchA, `${MARKER}_PATIENT_A`);
    const patientB = await ensureScreening(CLINIC_B_ID, batchB, `${MARKER}_PATIENT_B`);

    // Non-admin, clinic-A-scoped synthetic user (bcrypt hash, cost 12 to match app).
    const hash = await bcrypt.hash(password, 12);
    const existing = await c.query(`SELECT id FROM users WHERE username=$1 LIMIT 1`, [TEST_USER]);
    if (existing.rows[0]) {
      await c.query(
        `UPDATE users SET password=$1, role='scheduler', clinic_id=$2, active=true, status='active'
         WHERE id=$3`,
        [hash, CLINIC_A_ID, existing.rows[0].id],
      );
    } else {
      await c.query(
        `INSERT INTO users (username, password, role, clinic_id, active, status)
         VALUES ($1,$2,'scheduler',$3,true,'active')`,
        [TEST_USER, hash, CLINIC_A_ID],
      );
    }

    // Structural output only — NO password, NO PHI.
    console.log(JSON.stringify({
      source: "tenant_fixture_seed", outcome: "ok",
      clinicA: CLINIC_A_ID, clinicB: CLINIC_B_ID, userClinicA: TEST_USER,
      patientA_screeningId: patientA, patientB_screeningId: patientB,
    }));
  } finally {
    await c.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({
    source: "tenant_fixture_seed", outcome: "failed",
    category: typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "error",
  }));
  process.exit(1);
});

// Provision the canonical Plexus-internal clinical reviewer QA account.
// Run with `npm run seed:testguy-reviewer`. Requires DATABASE_URL.
//
// Admin Review (service-specific) is authorized ONLY for the
// `plexus_internal_clinical_reviewer` role (server/services/adminReview/
// authorization.ts). This seeds a single QA reviewer user with that role,
// scoped to the clinic that owns the TestGuy ancillary cases, so the real
// approve/reject/modify/needs-info workflow can be exercised end-to-end.
//
// Idempotent: updates the row if it already exists. Only ever touches the
// username below. Non-destructive.

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const USERNAME = "plexus_reviewer";
const ROLE = "plexus_internal_clinical_reviewer";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:testguy-reviewer] DATABASE_URL is not set");
    process.exit(1);
  }
  if (!process.env.PLEXUS_REVIEWER_PASSWORD) {
    console.error("[seed:testguy-reviewer] PLEXUS_REVIEWER_PASSWORD is required. Set it in your environment before running this seed.");
    process.exit(1);
  }
  const password = process.env.PLEXUS_REVIEWER_PASSWORD;
  const { db, pool } = await import("../server/db");
  const { users } = await import("@shared/schema/users");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientAncillaryCases } = await import("@shared/schema/ancillaryCases");
  const { ilike, or, desc } = await import("drizzle-orm");

  let exitCode = 0;
  try {
    // Resolve the clinic that owns TestGuy's ancillary cases so the reviewer
    // is scoped to it (the admin-review write enforces same-clinic).
    const [screening] = await db.select().from(patientScreenings)
      .where(or(ilike(patientScreenings.name, "testguy robot"), ilike(patientScreenings.name, "test guy robot")))
      .orderBy(desc(patientScreenings.id)).limit(1);
    let clinicId = screening?.clinicId ?? null;
    if (screening) {
      const [ac] = await db.select().from(patientAncillaryCases)
        .where(eq(patientAncillaryCases.originatingScreeningId, screening.id)).limit(1);
      if (ac?.clinicId != null) clinicId = ac.clinicId;
    }
    if (clinicId == null) clinicId = 1;

    const hashed = await bcrypt.hash(password, 12);
    const [existing] = await db.select().from(users).where(eq(users.username, USERNAME)).limit(1);
    if (existing) {
      await db.update(users).set({ password: hashed, role: ROLE, active: true, clinicId }).where(eq(users.id, existing.id));
      console.log(`[seed:testguy-reviewer] updated user '${USERNAME}' role=${ROLE} clinicId=${clinicId}`);
    } else {
      await db.insert(users).values({ username: USERNAME, password: hashed, role: ROLE, active: true, clinicId });
      console.log(`[seed:testguy-reviewer] created user '${USERNAME}' role=${ROLE} clinicId=${clinicId}`);
    }
    console.log(`[seed:testguy-reviewer] login: ${USERNAME} (password from PLEXUS_REVIEWER_PASSWORD env var)`);
  } catch (err: any) {
    console.error("[seed:testguy-reviewer] failed:", err);
    exitCode = 1;
  } finally {
    try { await pool.end(); } catch { /* noop */ }
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error("[seed:testguy-reviewer] unexpected failure:", err); process.exit(1); });

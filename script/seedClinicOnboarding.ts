import { seedSectionTemplates } from "../server/repositories/clinicOnboarding.repo";
import { pool } from "../server/db";

async function main() {
  const result = await seedSectionTemplates();
  console.log(
    `[seed:clinic-onboarding] section templates created=${result.created} skipped=${result.skipped}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed:clinic-onboarding] failed:", err);
  try {
    await pool.end();
  } catch {
    /* noop */
  }
  process.exit(1);
});

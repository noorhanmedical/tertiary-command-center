import { seedDefaultAdminSettings } from "../server/repositories/adminSettings.repo";
import { pool } from "../server/db";

async function main() {
  const result = await seedDefaultAdminSettings();
  console.log(
    `[seed:admin-settings] created=${result.created} skipped=${result.skipped}`,
  );
  if (result.created > 0) {
    for (const row of result.createdRows) {
      console.log(`  + ${row.settingDomain}/${row.settingKey} (id=${row.id})`);
    }
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed:admin-settings] failed:", err);
  try {
    await pool.end();
  } catch {
    /* noop */
  }
  process.exit(1);
});

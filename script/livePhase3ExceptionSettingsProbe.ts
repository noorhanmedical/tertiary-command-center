// Live probe — Phase 3 PR 3.1 exception_intelligence admin_settings.
// Honest skip when DATABASE_URL is unset.

import { Pool } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[live-phase3-exception-settings] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name='admin_settings'`
    );
    if (tables.length === 0) {
      console.error("[live-phase3-exception-settings] FAIL — admin_settings table missing");
      process.exit(1);
    }
    // Count rows under our domain — seed:exception-settings should have produced ≥ 28.
    const { rows: counts } = await pool.query<{ count: string }>(
      `select count(*)::text as count from admin_settings where setting_domain='exception_intelligence'`
    );
    const n = Number(counts[0]?.count ?? 0);
    if (n === 0) {
      console.error("[live-phase3-exception-settings] FAIL — no exception_intelligence rows; run npm run seed:exception-settings");
      process.exit(1);
    }
    // Confirm auto-actions row stays disabled if present.
    const { rows: auto } = await pool.query<{ setting_value: any }>(
      `select setting_value from admin_settings
       where setting_domain='exception_intelligence' and setting_key='auto_actions_enabled'
       and facility_id is null and user_id is null and test_type is null
       limit 1`
    );
    if (auto.length > 0) {
      const v = auto[0].setting_value;
      const explicit = v?.value;
      if (explicit === true || explicit === "true" || explicit === 1) {
        console.error("[live-phase3-exception-settings] FAIL — auto_actions_enabled global value is truthy; Phase 3 requires false");
        process.exit(1);
      }
    }
    console.log(`[live-phase3-exception-settings] PASS — ${n} rows under exception_intelligence domain`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[live-phase3-exception-settings] ERROR", err);
  process.exit(1);
});

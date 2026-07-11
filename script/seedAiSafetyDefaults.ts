// Seed AI safety defaults — Phase 3 PR 3.4.
// Honest skip if DATABASE_URL is unset.

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { AI_SAFETY_DOMAIN, AI_SAFETY_KEYS } from "@shared/contracts/aiRecommendation";

const defaults = [
  {
    settingKey: AI_SAFETY_KEYS.allowedModelProviders,
    settingValue: { value: ["rules_engine"] },
    description: "Phase 3 default — only the rules engine is allowed.",
  },
  {
    settingKey: AI_SAFETY_KEYS.defaultModelProvider,
    settingValue: { value: "rules_engine" },
    description: "Phase 3 default provider.",
  },
  {
    settingKey: AI_SAFETY_KEYS.confidenceReportingMode,
    settingValue: { value: "rules_only" },
    description: "Phase 3 default reporting mode.",
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[seed-ai-safety] SKIP — DATABASE_URL not set");
    return;
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  try {
    for (const d of defaults) {
      const existing = await db.execute(sql`
        select id from admin_settings
        where setting_domain = ${AI_SAFETY_DOMAIN}
          and setting_key = ${d.settingKey}
          and facility_id is null
          and user_id is null
          and test_type is null
        limit 1
      `);
      if (existing.rows.length === 0) {
        await db.execute(sql`
          insert into admin_settings (setting_domain, setting_key, setting_value, description, active)
          values (${AI_SAFETY_DOMAIN}, ${d.settingKey}, ${JSON.stringify(d.settingValue)}::jsonb, ${d.description}, true)
        `);
      }
    }
    console.log(`[seed-ai-safety] OK — ${defaults.length} rows ensured`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed-ai-safety] ERROR", err);
  process.exit(1);
});

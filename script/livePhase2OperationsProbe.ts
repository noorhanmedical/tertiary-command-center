// livePhase2OperationsProbe — Phase 2 PR 2.10.
//
// Verifies the canonical Phase 2 tables exist and the seed rows for
// the new admin settings have been applied. Read-only.
//
// Honest skip when DATABASE_URL is unavailable.

const REQUIRED_TABLES = [
  "patient_execution_cases",
  "patient_journey_events",
  "global_schedule_events",
  "admin_settings",
  // PR 2.6 + 2.7 — Phase 2 new tables.
  "patient_notes",
  "contacts",
];

const REQUIRED_SETTING_KEYS = [
  ["engagement_center", "no_answer_callback_hours"],
  ["engagement_center", "voicemail_callback_hours"],
  ["scheduling_triage", "default_callback_due_hours"],
  ["engagement_center", "max_call_attempts"],
  ["engagement_center", "dnc_is_terminal"],
  ["engagement_center", "declined_is_terminal"],
  ["engagement_center", "ready_to_schedule_routes_to_triage"],
  ["engagement_center", "scheduled_closes_assignment"],
  ["engagement_center", "queue_reentry_enabled"],
];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[probe:phase2-ops] DATABASE_URL unavailable — skipped live DB probe.");
    return;
  }
  const { pool } = await import("../server/db");
  const placeholders = REQUIRED_TABLES.map((_, i) => `$${i + 1}`).join(", ");
  const tableRes = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    [...REQUIRED_TABLES],
  );
  const present = new Set(tableRes.rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    console.error(`[probe:phase2-ops] missing tables: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`[probe:phase2-ops] all ${REQUIRED_TABLES.length} tables present.`);

  // Verify the new admin_settings seed rows exist at the global scope.
  const missingSettings: string[] = [];
  for (const [domain, key] of REQUIRED_SETTING_KEYS) {
    const r = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM admin_settings
        WHERE setting_domain = $1 AND setting_key = $2
          AND facility_id IS NULL AND user_id IS NULL`,
      [domain, key],
    );
    const c = parseInt(r.rows[0]?.count ?? "0", 10);
    if (c === 0) missingSettings.push(`${domain}.${key}`);
  }
  if (missingSettings.length > 0) {
    console.error(
      `[probe:phase2-ops] missing global admin_settings seed rows: ${missingSettings.join(", ")} ` +
      `— run npm run seed:admin-settings`,
    );
    process.exit(1);
  }
  console.log(`[probe:phase2-ops] all ${REQUIRED_SETTING_KEYS.length} admin settings present.`);
}

main().catch((err) => {
  console.error("[probe:phase2-ops] failed:", err);
  process.exit(1);
});

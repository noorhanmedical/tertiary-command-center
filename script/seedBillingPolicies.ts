// Seed canonical billing policy defaults — Phase 4 PR 4.1.
//
// Idempotently inserts safe global defaults into admin_settings under
// the `billing_policy` domain. Already-present rows are skipped.
// Honest skip when DATABASE_URL is unavailable.

import type { Pool } from "pg";

const DOMAIN = "billing_policy";

type Default = { key: string; value: Record<string, unknown>; description: string };

const DEFAULTS: Default[] = [
  // schedule
  { key: "schedule_frequency", value: { value: "monthly" }, description: "Default invoice frequency." },
  { key: "schedule_days_of_month", value: { value: [] }, description: "Custom days-of-month list when schedule_frequency = custom_days_of_month." },
  { key: "schedule_weekdays", value: { value: [] }, description: "Custom weekdays list (0=Sun..6=Sat) when frequency = custom_weekdays." },
  { key: "schedule_timezone", value: { value: "America/New_York" }, description: "Timezone for schedule + cutoff computation." },
  { key: "schedule_cutoff_window", value: { value: "through_yesterday" }, description: "Cutoff window for invoice batch period." },
  { key: "schedule_cutoff_hour_local", value: { value: 17 }, description: "Local-time hour (0..23) at which the cutoff fires." },
  // recipients
  { key: "primary_email", value: { value: null }, description: "Primary invoice email recipient (null = use facility contact)." },
  { key: "cc_emails", value: { value: [] }, description: "CC recipients." },
  { key: "bcc_emails", value: { value: [] }, description: "BCC recipients (if supported by delivery channel)." },
  { key: "billing_contact_name", value: { value: null }, description: "Billing contact display name." },
  { key: "fallback_to_facility_contact", value: { value: true }, description: "When true, fall back to the facility contact if no policy primary is set." },
  { key: "escalation_contact_name", value: { value: null }, description: "Escalation contact name for failed deliveries / aging." },
  { key: "delivery_method", value: { value: "download_only" }, description: "Default delivery method (download_only|email|portal_pending|integration_pending)." },
  // pricing
  { key: "per_test_price", value: { value: null }, description: "Per-test unit price in dollars. null blocks invoicing for this testType." },
  { key: "bundled_price", value: { value: null }, description: "Bundled price if the facility/test uses bundled pricing." },
  { key: "minimum_monthly_fee", value: { value: null }, description: "Minimum monthly fee in dollars." },
  { key: "allow_manual_adjustment", value: { value: false }, description: "Whether the biller can manually adjust line items at draft time." },
  { key: "revenue_split", value: { value: { plexusSharePercent: null, clinicSharePercent: null, plexusFixedFee: null } }, description: "Revenue split rules. null shares = not configured (blocks at preview)." },
  // readiness
  { key: "hold_missing_report", value: { value: true }, description: "Hold invoice until the report is uploaded." },
  { key: "hold_missing_consent", value: { value: true }, description: "Hold invoice until consent is signed." },
  { key: "hold_missing_screening", value: { value: true }, description: "Hold invoice until screening form is completed." },
  { key: "hold_missing_order_note", value: { value: true }, description: "Hold invoice until order note is present." },
  { key: "hold_missing_procedure_note", value: { value: true }, description: "Hold invoice until procedure note is present." },
  { key: "hold_pending_physician_signature", value: { value: true }, description: "Hold invoice until physician signature is present." },
  { key: "hold_pending_billing_readiness", value: { value: true }, description: "Hold invoice until billing_readiness_checks pass." },
  { key: "hold_pending_insurance_verification", value: { value: false }, description: "Hold invoice until insurance verification (default off in Phase 4)." },
  { key: "exclude_no_shows", value: { value: true }, description: "Exclude no-show cases from invoicing." },
  { key: "exclude_cancelled", value: { value: true }, description: "Exclude cancelled cases from invoicing." },
  { key: "billable_no_show", value: { value: false }, description: "When true, no-shows still get billed (overrides exclude_no_shows for some facilities)." },
  // approval
  { key: "approval_requirement", value: { value: "admin" }, description: "Who must approve invoice drafts (none|admin|billing_auditor|admin_or_auditor)." },
  { key: "auto_draft_only", value: { value: true }, description: "When true, generated batches stay as drafts until explicit approval." },
  // payment terms
  { key: "payment_term", value: { value: "net_15" }, description: "Default payment terms." },
  { key: "payment_term_custom_days", value: { value: null }, description: "Custom payment term days when payment_term = custom." },
  { key: "reminder_interval_days", value: { value: 7 }, description: "Days between unpaid invoice reminders." },
  // numbering
  { key: "facility_prefix", value: { value: null }, description: "Facility-specific invoice number prefix." },
  { key: "include_period_code", value: { value: true }, description: "Include period code (YYYYMM/YYYYWW) in invoice numbers." },
];

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[seed:billing-policies] DATABASE_URL unavailable — skipped seed.");
    return;
  }
  pool = (await import("../server/db")).pool;
  let created = 0;
  let skipped = 0;
  for (const def of DEFAULTS) {
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM admin_settings
        WHERE setting_domain = $1 AND setting_key = $2
          AND facility_id IS NULL AND user_id IS NULL AND test_type IS NULL`,
      [DOMAIN, def.key],
    );
    if ((r.rows ?? []).length > 0) { skipped++; continue; }
    await pool.query(
      `INSERT INTO admin_settings
         (setting_domain, setting_key, setting_value, description, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [DOMAIN, def.key, JSON.stringify(def.value), def.description],
    );
    created++;
  }
  console.log(`[seed:billing-policies] created=${created} skipped=${skipped} total=${DEFAULTS.length}`);
}

async function closePool() {
  if (!pool) return;
  try { await pool.end(); } catch { /* ignore */ }
}

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[seed:billing-policies] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });

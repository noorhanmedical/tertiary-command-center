// Seed canonical exception_intelligence defaults — Phase 3 PR 3.1.
//
// Idempotently inserts safe global defaults into admin_settings
// under the `exception_intelligence` domain. Already-present rows
// are skipped. Honest skip when DATABASE_URL is unavailable.

import type { Pool } from "pg";

const DOMAIN = "exception_intelligence";

type Default = { key: string; value: Record<string, unknown>; description: string };

const DEFAULTS: Default[] = [
  // Global safety flags
  { key: "human_review_required", value: { value: true }, description: "When true, exception actions require human review (always true in Phase 3)." },
  { key: "auto_actions_enabled", value: { value: false }, description: "When true, the system MAY execute approved recommendations. Phase 3 must keep this false." },

  // Engagement thresholds
  { key: "callback_overdue_threshold_hours", value: { value: 2 }, description: "Hours past nextActionAt before a callback is flagged overdue." },
  { key: "lvm_stale_threshold_hours", value: { value: 8 }, description: "Hours since last LVM before LVM follow-up is flagged stale." },
  { key: "no_answer_stale_threshold_hours", value: { value: 8 }, description: "Hours since last no-answer before follow-up is flagged stale." },
  { key: "unable_to_reach_attempt_threshold", value: { value: 6 }, description: "Call-attempt count that triggers unable-to-reach review." },
  { key: "ready_to_schedule_stale_threshold_hours", value: { value: 24 }, description: "Hours marked ready_to_schedule before flagging stale." },
  { key: "stale_queue_item_threshold_hours", value: { value: 48 }, description: "Hours with no progress before a queue item is flagged stale." },

  // Document / ACS thresholds
  { key: "missing_report_threshold_hours", value: { value: 24 }, description: "Hours after procedure completion before missing report is flagged." },
  { key: "missing_order_note_threshold_hours", value: { value: 24 }, description: "Hours order note has been missing before flagging." },
  { key: "missing_procedure_note_threshold_hours", value: { value: 24 }, description: "Hours procedure note has been missing before flagging." },
  { key: "physician_signature_pending_threshold_hours", value: { value: 24 }, description: "Hours physician signature pending before flagging." },
  { key: "billing_readiness_blocked_threshold_hours", value: { value: 24 }, description: "Hours billing readiness has been blocked before flagging." },
  { key: "insurance_verification_pending_threshold_hours", value: { value: 48 }, description: "Hours insurance verification has been pending before flagging." },
  { key: "duplicate_patient_risk_window_hours", value: { value: 24 }, description: "Window for duplicate-patient detection." },
  { key: "missing_patient_contact_threshold_hours", value: { value: 24 }, description: "Hours patient has no contact info before flagging." },

  // Scheduling thresholds
  { key: "scheduling_delay_threshold_hours", value: { value: 48 }, description: "Hours ready_to_schedule without a schedule event before flagging." },
  { key: "no_show_followup_threshold_hours", value: { value: 4 }, description: "Hours after a no-show before follow-up is due." },

  // Billing thresholds
  { key: "invoice_batch_stale_threshold_days", value: { value: 7 }, description: "Days a non-voided batch has sat without drafts before flagging." },
  { key: "invoice_draft_stale_threshold_days", value: { value: 3 }, description: "Days an invoice has sat in pending_review before flagging." },
  { key: "invoice_approval_stale_threshold_days", value: { value: 2 }, description: "Days an invoice has been approved but not delivered before flagging." },
  { key: "invoice_delivery_failed_severity", value: { value: "high" }, description: "Severity for any failed-delivery event (count threshold 0)." },
  { key: "missing_invoice_recipient_threshold_hours", value: { value: 24 }, description: "Hours an approved invoice has had no resolvable recipient." },
  { key: "payment_overdue_threshold_days", value: { value: 0 }, description: "Days past dueDate before flagging payment overdue (0 = immediately on dueDate)." },
  { key: "denial_followup_threshold_days", value: { value: 3 }, description: "Days an open denial has aged before flagging follow-up due." },
  { key: "disputed_invoice_threshold_hours", value: { value: 24 }, description: "Hours after a dispute_hold adjustment before flagging." },
  { key: "remittance_missing_threshold_days", value: { value: 7 }, description: "Days a sent invoice has had no remittance event before flagging." },
  { key: "high_balance_aging_threshold_days", value: { value: 30 }, description: "Days an unpaid invoice has aged before flagging high-balance aging." },
];

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[seed:exception-settings] DATABASE_URL unavailable — skipped seed.");
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
  console.log(`[seed:exception-settings] created=${created} skipped=${skipped} total=${DEFAULTS.length}`);
}

async function closePool() {
  if (!pool) return;
  try { await pool.end(); } catch { /* ignore */ }
}

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error("[seed:exception-settings] failed:", err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });

// ─── Overdue invoice reminder watcher ───────────────────────────────────
// Runs once per day and creates a Plexus task for every invoice whose
// balance is still > 0 past the configured age threshold (days since
// invoice date). Reminders are throttled per-invoice using
// `invoices.last_reminded_at` so a single overdue invoice is re-surfaced
// at most once per threshold window (e.g. every 30 days at the default).
//
// The threshold is configurable from admin settings via the app_settings
// row `invoice_reminder_threshold_days` (default 30).
//
// Like the other background services in this app, work is gated behind a
// daily Postgres advisory lock so multiple app instances don't fan out
// the same reminders.

import { db } from "../db";
import { invoices } from "@shared/schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { getSetting } from "../dbSettings";

const TICK_MS = Number(process.env.INVOICE_REMINDER_TICK_MS ?? 60 * 60 * 1000); // hourly poll
const RUN_HOUR = Number(process.env.INVOICE_REMINDER_RUN_HOUR ?? 8);
export const INVOICE_REMINDER_SETTING_KEY = "invoice_reminder_threshold_days";
export const DEFAULT_INVOICE_REMINDER_THRESHOLD_DAYS = 30;

const lastRunDate = new Set<string>();
let started = false;
let kickoffTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

export function startInvoiceReminderWatcher() {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.INVOICE_REMINDER_DISABLED === "1") return;
  started = true;
  kickoffTimer = setTimeout(() => {
    runOnce().catch((err) => console.error("[invoiceReminder] first tick:", err));
    tickInterval = setInterval(() => {
      runOnce().catch((err) => console.error("[invoiceReminder] tick:", err));
    }, TICK_MS);
  }, 90_000);
}

export function stopInvoiceReminderWatcher() {
  if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  started = false;
}

export async function getReminderThresholdDays(): Promise<number> {
  const raw = await getSetting(INVOICE_REMINDER_SETTING_KEY);
  if (!raw) return DEFAULT_INVOICE_REMINDER_THRESHOLD_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INVOICE_REMINDER_THRESHOLD_DAYS;
  return n;
}

function num(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function ageDaysFrom(dateStr: string, asOf: Date): number {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  const [y, m, d] = parts;
  const t = Date.UTC(y, m - 1, d);
  const todayUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((todayUtc - t) / 86400000);
}

export interface InvoiceReminderResult {
  threshold: number;
  evaluated: number;
  reminded: number;
}

export async function runOnce(now: Date = new Date()): Promise<InvoiceReminderResult | null> {
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() < RUN_HOUR) return null;
  if (lastRunDate.has(today)) return null;

  const lockName = `invoice_reminder:${today}`;
  let result: InvoiceReminderResult | null = null;
  const { acquired } = await withAdvisoryLock(lockName, async () => {
    result = await sendRemindersNow(now);
    return true;
  });
  if (acquired) lastRunDate.add(today);
  return result;
}

/** Core reminder logic, exported so admin endpoints / tests can invoke it
 *  directly without waiting for the daily tick. Wrapped in an advisory
 *  lock so two concurrent invocations (manual + scheduled, or two manual)
 *  cannot duplicate reminder tasks. */
export async function sendRemindersNow(now: Date = new Date()): Promise<InvoiceReminderResult> {
  const today = now.toISOString().slice(0, 10);
  const lockName = `invoice_reminder_run:${today}`;
  let result: InvoiceReminderResult = { threshold: 0, evaluated: 0, reminded: 0 };
  await withAdvisoryLock(lockName, async () => {
    result = await sendRemindersUnlocked(now);
    return true;
  });
  return result;
}

async function sendRemindersUnlocked(now: Date): Promise<InvoiceReminderResult> {
  const threshold = await getReminderThresholdDays();
  const all = await storage.getAllInvoices();

  const eligibleStatuses = new Set(["Sent", "Partially Paid"]);
  const thresholdMs = threshold * 86_400_000;
  const cutoff = new Date(now.getTime() - thresholdMs);

  let evaluated = 0;
  let reminded = 0;

  for (const inv of all) {
    if (!eligibleStatuses.has(inv.status)) continue;
    if (num(inv.totalBalance) <= 0.005) continue;
    const days = ageDaysFrom(inv.invoiceDate, now);
    if (days < threshold) continue;
    evaluated += 1;

    // Atomic dedupe: only proceed if no reminder yet, or the previous one
    // is older than `threshold` days. The conditional UPDATE ... RETURNING
    // is the source of truth — if a row comes back, we own this reminder
    // and can safely create the task. If concurrent runs race, only one
    // wins the update.
    const [claimed] = await db.update(invoices)
      .set({ lastRemindedAt: now })
      .where(and(
        eq(invoices.id, inv.id),
        or(
          isNull(invoices.lastRemindedAt),
          lt(invoices.lastRemindedAt, cutoff),
        ),
      ))
      .returning();
    if (!claimed) continue;

    const balance = num(inv.totalBalance).toFixed(2);
    const proposal = {
      kind: "invoice_reminder",
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      facility: inv.facility,
      invoiceDate: inv.invoiceDate,
      ageDays: days,
      balance,
      status: inv.status,
      thresholdDays: threshold,
    };
    const description =
      `Invoice ${inv.invoiceNumber} for ${inv.facility} is ${days} day(s) old with ` +
      `an outstanding balance of $${balance} (status: ${inv.status}). ` +
      `Follow up with the clinic to collect payment.\n\n` +
      `<!--proposal:${JSON.stringify(proposal)}-->`;

    try {
      await storage.createTask({
        title: `Overdue invoice: ${inv.invoiceNumber} (${inv.facility})`,
        description,
        taskType: "invoice_reminder",
        urgency: "EOD",
        priority: "high",
        status: "open",
      });
      reminded += 1;
    } catch (err) {
      console.error(`[invoiceReminder] task creation failed for invoice ${inv.id}:`, err);
      // Roll back the claim so the next sweep can retry instead of waiting
      // a full threshold window after a transient failure.
      try {
        await db.update(invoices)
          .set({ lastRemindedAt: inv.lastRemindedAt ?? null })
          .where(eq(invoices.id, inv.id));
      } catch {
        // best-effort rollback; surface the original error in logs above
      }
    }
  }

  return { threshold, evaluated, reminded };
}

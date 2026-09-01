/**
 * Phase 2D — canonical appointment reconciliation retry runner.
 *
 * Maintenance CLI (NOT clinic-facing). Drains
 * `canonical_appointment_reconciliation_failures` by invoking the
 * retry worker, which re-drives quick-schedule linkage and projection
 * refreshes.
 *
 * Contract:
 *   • LIST (dry-run) by default — prints a PHI-free count summary of
 *     unresolved rows and makes zero writes.
 *   • Requires BOTH gates to actually run retries:
 *       RETRY_CANONICAL_APPOINTMENT_APPLY=YES  (explicit opt-in)
 *       FEATURE_CANONICAL_APPOINTMENT=true      (canonical writes)
 *   • Bounded batch (RETRY_CANONICAL_APPOINTMENT_LIMIT, default 100,
 *     hard cap 500). Single pass — no infinite loop, no webhook.
 *   • Clinic-scopable via RETRY_CANONICAL_APPOINTMENT_CLINIC_ID.
 *   • PHI-free output (ids + action + outcome status only).
 *   • Never runs a migration.
 *
 * Usage:
 *   npx tsx script/retryCanonicalAppointmentFailures.ts                 # list only
 *   RETRY_CANONICAL_APPOINTMENT_APPLY=YES FEATURE_CANONICAL_APPOINTMENT=true \
 *     npx tsx script/retryCanonicalAppointmentFailures.ts               # drain
 */

import { featureFlags } from "../server/lib/featureFlags";
import { listUnresolvedCanonicalAppointmentFailures } from "../server/repositories/canonicalAppointments.repo";
import { retryUnresolvedCanonicalAppointmentFailures } from "../server/services/canonicalAppointments/retryWorker";

function parseLimit(): number {
  const raw = parseInt(process.env.RETRY_CANONICAL_APPOINTMENT_LIMIT ?? "100", 10);
  const n = Number.isFinite(raw) && raw > 0 ? raw : 100;
  return Math.min(n, 500);
}

function parseClinicId(): number | undefined {
  const raw = process.env.RETRY_CANONICAL_APPOINTMENT_CLINIC_ID;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const apply = process.env.RETRY_CANONICAL_APPOINTMENT_APPLY === "YES";
  const limit = parseLimit();
  const clinicId = parseClinicId();

  if (apply && !featureFlags.canonicalAppointment) {
    console.error(
      "Refusing to apply: RETRY_CANONICAL_APPOINTMENT_APPLY=YES but FEATURE_CANONICAL_APPOINTMENT is not enabled.",
    );
    process.exit(2);
  }

  if (!apply) {
    // LIST mode — zero writes. Just report the unresolved backlog.
    const rows = await listUnresolvedCanonicalAppointmentFailures({ clinicId, limit });
    const byAction: Record<string, number> = {};
    for (const r of rows) byAction[r.requestedAction] = (byAction[r.requestedAction] ?? 0) + 1;
    console.log(JSON.stringify({
      mode: "LIST_DRY_RUN",
      clinicScope: clinicId ?? "all",
      limit,
      unresolvedCount: rows.length,
      byAction,
      // PHI-free: ids + counts only.
      ids: rows.map((r) => r.id),
    }, null, 2));
    return;
  }

  // APPLY mode — bounded single pass through the retry worker.
  const result = await retryUnresolvedCanonicalAppointmentFailures({ clinicId, limit });
  const byStatus: Record<string, number> = {};
  for (const o of result.outcomes) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  console.log(JSON.stringify({
    mode: "APPLIED",
    clinicScope: clinicId ?? "all",
    limit,
    processed: result.processed,
    byStatus,
    outcomes: result.outcomes.map((o) => ({ failureId: o.failureId, action: o.requestedAction, status: o.status })),
  }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({
      level: "error",
      source: "canonical_appointment_retry_runner",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);

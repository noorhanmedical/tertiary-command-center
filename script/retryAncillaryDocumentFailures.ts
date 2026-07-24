/**
 * Phase 2E-B — ancillary document reconciliation retry runner.
 *
 * Maintenance CLI (NOT clinic-facing). Drains
 * `ancillary_document_reconciliation_failures` by invoking the bounded retry
 * worker, which re-drives Order Note linkage, Admin Review evidence linkage,
 * and (in future) reference linkage.
 *
 * Contract:
 *   • LIST (dry-run) by default — prints a PHI-free count summary of
 *     unresolved rows and makes ZERO writes.
 *   • Requires BOTH gates to actually run retries:
 *       RETRY_ANCILLARY_DOCUMENTS_APPLY=YES        (explicit opt-in)
 *       FEATURE_UNIFIED_ANCILLARY_DOCUMENTS=true    (canonical reads/writes)
 *     (Order Note linking additionally needs FEATURE_CANONICAL_ORDER_NOTE;
 *      the worker/service enforce that per-action and report skipped_flag_off.)
 *   • Bounded batch (RETRY_ANCILLARY_DOCUMENTS_LIMIT, default 100, hard cap
 *     500). Single pass — no infinite loop, no webhook, no setInterval.
 *   • Clinic-scopable via RETRY_ANCILLARY_DOCUMENTS_CLINIC_ID.
 *   • PHI-free output (ids + action + outcome status only).
 *   • Exact per-failure-id resolution (worker resolves only rows it processed).
 *   • Never runs a migration; missing migration surfaces the controlled 503.
 *
 * Usage:
 *   npx tsx script/retryAncillaryDocumentFailures.ts                       # list only
 *   RETRY_ANCILLARY_DOCUMENTS_APPLY=YES FEATURE_UNIFIED_ANCILLARY_DOCUMENTS=true \
 *     FEATURE_CANONICAL_ORDER_NOTE=true \
 *     npx tsx script/retryAncillaryDocumentFailures.ts                     # drain
 */

import { featureFlags } from "../server/lib/featureFlags";
import { listUnresolvedAncillaryDocumentFailures } from "../server/repositories/ancillaryDocuments.repo";
import { retryUnresolvedAncillaryDocumentFailures } from "../server/services/ancillaryDocuments/retryWorker";

function parseLimit(): number {
  const raw = parseInt(process.env.RETRY_ANCILLARY_DOCUMENTS_LIMIT ?? "100", 10);
  const n = Number.isFinite(raw) && raw > 0 ? raw : 100;
  return Math.min(n, 500);
}

function parseClinicId(): number | undefined {
  const raw = process.env.RETRY_ANCILLARY_DOCUMENTS_CLINIC_ID;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const apply = process.env.RETRY_ANCILLARY_DOCUMENTS_APPLY === "YES";
  const limit = parseLimit();
  const clinicId = parseClinicId();

  if (apply && !featureFlags.unifiedAncillaryDocuments) {
    console.error(
      "Refusing to apply: RETRY_ANCILLARY_DOCUMENTS_APPLY=YES but FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is not enabled.",
    );
    process.exit(2);
  }

  if (!apply) {
    // LIST mode — zero writes. Report the unresolved backlog (PHI-free).
    const rows = await listUnresolvedAncillaryDocumentFailures({ clinicId, limit });
    const byAction: Record<string, number> = {};
    for (const r of rows) byAction[r.requestedAction] = (byAction[r.requestedAction] ?? 0) + 1;
    console.log(JSON.stringify({
      mode: "LIST_DRY_RUN",
      clinicScope: clinicId ?? "all",
      limit,
      unresolvedCount: rows.length,
      byAction,
      ids: rows.map((r) => r.id),
    }, null, 2));
    return;
  }

  // APPLY mode — bounded single pass through the retry worker.
  const result = await retryUnresolvedAncillaryDocumentFailures({ clinicId, limit });
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
      source: "ancillary_document_retry_runner",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);

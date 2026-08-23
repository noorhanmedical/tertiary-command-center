// FHIR Import Pipeline — background scheduler
//
// Polls S3 for new FHIR bulk exports on a configurable interval and runs the
// import orchestrator for each configured clinic-group mapping.
//
// Activation:
//   Set FHIR_AUTO_IMPORT_ENABLED=1 to enable.
//   Default: OFF — the scheduler starts in a no-op state.
//
// Interval:
//   FHIR_IMPORT_INTERVAL_HOURS (default: 6 hours)
//
// Per-run deduplication:
//   The scheduler tracks the last successfully processed timestamp per group
//   in memory. Across process restarts it re-fetches the latest timestamp
//   from S3 and imports it only when the content is genuinely new (checked by
//   comparing against the last seen timestamp in the process). For persistent
//   dedup across restarts, connect this to a database-backed last-run table
//   in a future iteration.
//
// Advisory lock:
//   Each run acquires a Postgres advisory lock so that multiple ECS tasks
//   running in parallel never double-import the same export.
//
// PHI-safe: no patient names, DOBs, or clinical data appear in logs.

import { withAdvisoryLock } from "../../lib/advisoryLock";
import { getClinicGroupMappings, getFhirImportIntervalMs, FHIR_AUTO_IMPORT_ENABLED } from "./config";
import { getLatestExportTimestamp } from "./fhirS3Reader";
import { runFhirImport } from "./fhirImportOrchestrator";
import type { FhirSchedulerRunRecord } from "./types";

// ─── Per-group state ──────────────────────────────────────────────────────

/** In-memory map of groupId → last successfully imported timestamp */
const lastImportedTimestamp = new Map<string, string>();

/** Recent run history (last 50, newest first) */
const runHistory: FhirSchedulerRunRecord[] = [];

// ─── Core tick ────────────────────────────────────────────────────────────

async function runSchedulerTick(now: Date = new Date()): Promise<void> {
  if (!FHIR_AUTO_IMPORT_ENABLED) return;

  const mappings = getClinicGroupMappings();
  const lockName = `fhir_import_scheduler:${now.toISOString().slice(0, 13)}`; // per-hour lock

  const { acquired } = await withAdvisoryLock(lockName, async () => {
    for (const mapping of mappings) {
      const { groupId, clinicId, clinicSlug, clinicName } = mapping;

      try {
        const latestTimestamp = await getLatestExportTimestamp(groupId);
        if (!latestTimestamp) {
          console.log(
            `[fhirScheduler] no export found for group ${groupId} (clinic ${clinicId})`,
          );
          continue;
        }

        const lastSeen = lastImportedTimestamp.get(groupId);
        if (lastSeen === latestTimestamp) {
          console.log(
            `[fhirScheduler] group ${groupId}: timestamp ${latestTimestamp} already imported — skipping`,
          );
          continue;
        }

        console.log(
          `[fhirScheduler] group ${groupId}: importing timestamp ${latestTimestamp} for clinic ${clinicId}`,
        );

        const result = await runFhirImport({
          groupId,
          timestamp: latestTimestamp,
          clinicId,
          clinicSlug,
          clinicName,
          autoQualify: true,
        });

        if (result.ok) {
          lastImportedTimestamp.set(groupId, latestTimestamp);
        }

        const record: FhirSchedulerRunRecord = {
          groupId,
          clinicId,
          ranAt: now,
          result,
        };
        runHistory.unshift(record);
        if (runHistory.length > 50) runHistory.pop();

        console.log(
          `[fhirScheduler] group ${groupId}: ${result.ok ? "ok" : "error"} — ${result.message}`,
        );
      } catch (err: any) {
        console.error(
          `[fhirScheduler] group ${groupId} unhandled error: ${err?.message ?? err}`,
        );
      }
    }
    return true;
  });

  if (!acquired) {
    console.log(`[fhirScheduler] lock not acquired for tick at ${now.toISOString()} — another instance is running`);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

let started = false;
let kickoffTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

/**
 * Starts the FHIR import scheduler. Called from server/lifecycle.ts.
 * No-ops when FHIR_AUTO_IMPORT_ENABLED != "1" or already started.
 */
export function startFhirImportScheduler(): void {
  if (started) return;
  if (!FHIR_AUTO_IMPORT_ENABLED) {
    console.log("[fhirScheduler] FHIR_AUTO_IMPORT_ENABLED is not set — scheduler is OFF");
    return;
  }
  if (process.env.NODE_ENV === "test") return;

  started = true;
  const intervalMs = getFhirImportIntervalMs();
  console.log(
    `[fhirScheduler] starting — interval ${intervalMs / 1000 / 60} min, groups: ${
      getClinicGroupMappings()
        .map((m) => m.groupId)
        .join(", ")
    }`,
  );

  // Stagger first tick by 2 minutes so app startup isn't slowed
  kickoffTimer = setTimeout(() => {
    runSchedulerTick().catch((err) =>
      console.error("[fhirScheduler] first tick error:", err),
    );
    tickInterval = setInterval(() => {
      runSchedulerTick().catch((err) =>
        console.error("[fhirScheduler] tick error:", err),
      );
    }, intervalMs);
  }, 2 * 60 * 1000);
}

/**
 * Stops the FHIR import scheduler. Called from server/lifecycle.ts on
 * graceful shutdown.
 */
export function stopFhirImportScheduler(): void {
  if (kickoffTimer) {
    clearTimeout(kickoffTimer);
    kickoffTimer = null;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  started = false;
}

/**
 * Returns a snapshot of the recent run history (newest first).
 * Exposed for the admin status endpoint.
 */
export function getFhirSchedulerRunHistory(): ReadonlyArray<FhirSchedulerRunRecord> {
  return runHistory;
}

/**
 * Manually triggers one scheduler tick outside the normal interval.
 * Useful for testing / admin-triggered runs without waiting for the interval.
 */
export async function triggerFhirSchedulerTick(): Promise<void> {
  return runSchedulerTick();
}

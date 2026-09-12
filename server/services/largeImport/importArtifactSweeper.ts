// Expired temp-artifact sweeper for large-file patient ingestion.
//
// Abandoned imports (uploaded/preview_ready but never confirmed) leave a staged
// temp file on disk. Each job carries `expires_at` (24h). This sweeper reuses
// the SAME background-watcher + Postgres advisory-lock convention as the
// invoice reminder / morning rebuild schedulers — it does NOT introduce a new
// scheduler platform.
//
// Safety contract:
//   • idempotent — re-running does nothing once artifacts are cleared
//   • safe if the temp file is already gone (unlink errors ignored)
//   • NEVER touches an actively parsing/importing job's artifact
//   • multi-instance safe via withAdvisoryLock (one instance sweeps per tick)
//   • no PHI in logs (only counts + job ids)

import fsp from "node:fs/promises";
import { withAdvisoryLock } from "../../lib/advisoryLock";
import { listExpiredImportJobs, updateImportJob } from "../../repositories/importJobs.repo";

const TICK_MS = Number(process.env.IMPORT_SWEEP_TICK_MS ?? 60 * 60 * 1000); // hourly
// Statuses that are mid-flight — their temp file is in active use, never touch.
const ACTIVE_STATUSES = new Set(["parsing", "validating", "importing"]);

let started = false;
let kickoffTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

export function startImportArtifactSweeper(): void {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.IMPORT_SWEEP_DISABLED === "1") return;
  started = true;
  kickoffTimer = setTimeout(() => {
    runImportArtifactSweepOnce().catch((err) => console.error("[importSweep] first tick:", err?.message));
    tickInterval = setInterval(() => {
      runImportArtifactSweepOnce().catch((err) => console.error("[importSweep] tick:", err?.message));
    }, TICK_MS);
  }, 120_000);
}

export function stopImportArtifactSweeper(): void {
  if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  started = false;
}

export type ImportSweepResult = { scanned: number; cleaned: number; skippedActive: number };

/**
 * One sweep pass. Advisory-locked so only one instance runs per tick. Returns
 * a small summary; exported so an admin endpoint or test can invoke it directly.
 */
export async function runImportArtifactSweepOnce(now: Date = new Date()): Promise<ImportSweepResult | null> {
  let summary: ImportSweepResult | null = null;
  const { acquired, result } = await withAdvisoryLock("import_artifact_sweep", async () => {
    return sweepExpiredArtifacts(now);
  });
  if (acquired) summary = result;
  return summary;
}

/** Core sweep — visible to tests without the lock/scheduler wrapper. */
export async function sweepExpiredArtifacts(now: Date = new Date()): Promise<ImportSweepResult> {
  const expired = await listExpiredImportJobs(now);
  let cleaned = 0;
  let skippedActive = 0;

  for (const job of expired) {
    // Never disturb a job that is actively parsing/importing right now, even
    // if its expires_at passed (long-running import on a huge file).
    if (ACTIVE_STATUSES.has(job.status)) { skippedActive += 1; continue; }
    if (!job.tempPath) continue;

    try {
      await fsp.unlink(job.tempPath);
    } catch {
      // Already removed / never existed — safe, proceed to clear the pointer.
    }
    // Clear the pointer so the job is not re-swept; keep the job row (audit).
    await updateImportJob(job.id, { tempPath: null });
    cleaned += 1;
  }

  if (cleaned > 0 || skippedActive > 0) {
    console.log(`[importSweep] scanned=${expired.length} cleaned=${cleaned} skippedActive=${skippedActive}`);
  }
  return { scanned: expired.length, cleaned, skippedActive };
}

// Pure config accessor for batchAnalysisRunner runtime knobs. Lives in
// its own module so the smoke probe + status endpoint can read the
// active values without loading the storage / drizzle / db layer.

function intFromEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const BATCH_ANALYSIS_CONCURRENCY_DEFAULT = 2;
export const JOB_STUCK_THRESHOLD_MS_DEFAULT = 15 * 60 * 1000;

export function getBatchAnalysisConfig() {
  return {
    BATCH_ANALYSIS_CONCURRENCY: intFromEnv(
      "BATCH_ANALYSIS_CONCURRENCY",
      BATCH_ANALYSIS_CONCURRENCY_DEFAULT,
    ),
    JOB_STUCK_THRESHOLD_MS: intFromEnv(
      "JOB_STUCK_THRESHOLD_MS",
      JOB_STUCK_THRESHOLD_MS_DEFAULT,
    ),
  } as const;
}

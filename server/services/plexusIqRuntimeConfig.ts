// Plexus IQ runtime hardening — env-driven runtime config.
//
// One canonical reader for every PLEXUS_IQ_* env var. Defaults are
// conservative (single-patient mode, concurrency 8). Operators tune
// up in .env per facility / per model. The runner stamps the
// resolved config onto analysis_jobs.metadata.runtimeConfig so a
// job's actual settings are always recoverable from its row.

export type PlexusIqRuntimeConfig = {
  /** In-flight AI calls. */
  concurrency: number;
  /** Patients per persisted chunk (controls cursor frequency). */
  chunkSize: number;
  /**
   * Patients per AI call. 1 = today's single-patient behaviour
   * (the safe default). >1 enables opt-in micro-batch mode.
   */
  aiBatchSize: number;
  /**
   * When a micro-batch response fails validation, fall back to
   * single-patient calls for that micro-batch's items.
   */
  aiBatchFallbackEnabled: boolean;
  /** Per-AI-call timeout in milliseconds. */
  aiTimeoutMs: number;
  /** Token-bucket cap for AI requests per minute. */
  rateLimitRpm: number;
  /** Token-bucket burst. */
  rateLimitBurst: number;
  /** Halve in-flight workers on sustained 429s, recover after 60s. */
  adaptiveBackoffEnabled: boolean;
};

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function readPlexusIqRuntimeConfig(): PlexusIqRuntimeConfig {
  // BATCH_ANALYSIS_CONCURRENCY is the legacy env var. New
  // PLEXUS_IQ_ANALYSIS_CONCURRENCY supersedes it when set; otherwise
  // we fall back to BATCH_ANALYSIS_CONCURRENCY so non-Plexus-IQ
  // callers keep their existing behaviour.
  const legacyConcurrency = readNumber("BATCH_ANALYSIS_CONCURRENCY", 5);
  return {
    concurrency: readNumber("PLEXUS_IQ_ANALYSIS_CONCURRENCY", Math.max(legacyConcurrency, 8)),
    chunkSize: readNumber("PLEXUS_IQ_ANALYSIS_CHUNK_SIZE", 25),
    aiBatchSize: Math.max(1, Math.floor(readNumber("PLEXUS_IQ_AI_BATCH_SIZE", 1))),
    aiBatchFallbackEnabled: readBool("PLEXUS_IQ_AI_BATCH_FALLBACK_ENABLED", true),
    aiTimeoutMs: readNumber("PLEXUS_IQ_AI_TIMEOUT_MS", 90_000),
    rateLimitRpm: readNumber("PLEXUS_IQ_RATE_LIMIT_RPM", 300),
    rateLimitBurst: readNumber("PLEXUS_IQ_RATE_LIMIT_BURST", 10),
    adaptiveBackoffEnabled: readBool("PLEXUS_IQ_ADAPTIVE_BACKOFF_ENABLED", true),
  };
}

/** Default config exposed for tests and QA scripts. */
export const PLEXUS_IQ_RUNTIME_CONFIG_DEFAULTS: PlexusIqRuntimeConfig = {
  concurrency: 8,
  chunkSize: 25,
  aiBatchSize: 1,
  aiBatchFallbackEnabled: true,
  aiTimeoutMs: 90_000,
  rateLimitRpm: 300,
  rateLimitBurst: 10,
  adaptiveBackoffEnabled: true,
};

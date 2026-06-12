// Pure config accessor for aiClient runtime knobs. Lives in its own
// module so the smoke probe + status endpoint can read the active
// values without loading the OpenAI SDK (which throws at construction
// when AI_INTEGRATIONS_OPENAI_API_KEY is unset).

function intFromEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const AI_TIMEOUT_MS_DEFAULT = 60_000;
export const AI_MAX_RETRIES_DEFAULT = 3;

export function getAiClientConfig() {
  return {
    AI_TIMEOUT_MS: intFromEnv("AI_TIMEOUT_MS", AI_TIMEOUT_MS_DEFAULT),
    AI_MAX_RETRIES: intFromEnv("AI_MAX_RETRIES", AI_MAX_RETRIES_DEFAULT),
  } as const;
}

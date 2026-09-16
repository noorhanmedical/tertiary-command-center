import OpenAI_import from "openai";
import { withOpenAIConcurrencyLimit } from "../middleware/rateLimiter";

const OpenAI = ((OpenAI_import as any).default ?? OpenAI_import) as typeof OpenAI_import;

// The OpenAI client is constructed at import time and this module is pulled in
// on nearly every startup path, so a missing key must NOT crash the server —
// otherwise the whole app (including non-AI features) fails to boot locally.
// We fall back to a placeholder key so construction succeeds; any actual AI
// call still requires a real key (the request will fail at call time, as it
// should) and non-AI features run normally.
// Resolve the first NON-EMPTY provider key. An empty string is treated as
// MISSING — a set-but-blank AI_INTEGRATIONS_OPENAI_API_KEY must not mask a
// valid OPENAI_API_KEY fallback (previously `??` kept the empty string). Falls
// back to a placeholder so the module still constructs at import time; a real
// call still fails at call time when no valid key is present, as it should.
const OPENAI_API_KEY =
  [process.env.AI_INTEGRATIONS_OPENAI_API_KEY, process.env.OPENAI_API_KEY].find(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  ) ?? "missing-openai-key";

// An empty AI_INTEGRATIONS_OPENAI_BASE_URL must fall through to the SDK default
// (api.openai.com) rather than being passed as an empty base URL (which would
// break every request even with a valid key).
const OPENAI_BASE_URL =
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || undefined;

export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL,
});

const AI_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  label = "AI call"
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await withOpenAIConcurrencyLimit(() =>
        Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
          ),
        ])
      );
      return result;
    } catch (err: any) {
      lastErr = err;
      const isTransient =
        err?.status === 429 ||
        err?.status === 500 ||
        err?.status === 503 ||
        err?.message?.includes("timeout") ||
        err?.message?.includes("ECONNRESET") ||
        err?.message?.includes("socket");

      if (!isTransient || attempt === retries) {
        throw err;
      }
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[${label}] attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

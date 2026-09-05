import OpenAI_import from "openai";
import { withOpenAIConcurrencyLimit } from "../middleware/rateLimiter";

const OpenAI = ((OpenAI_import as any).default ?? OpenAI_import) as typeof OpenAI_import;

// The OpenAI client is constructed at import time and this module is pulled in
// on nearly every startup path, so a missing key must NOT crash the server —
// otherwise the whole app (including non-AI features) fails to boot locally.
// We fall back to a placeholder key so construction succeeds; any actual AI
// call still requires a real key (the request will fail at call time, as it
// should) and non-AI features run normally.
const OPENAI_API_KEY =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
  process.env.OPENAI_API_KEY ??
  "missing-openai-key";

export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
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

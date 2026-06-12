import OpenAI_import from "openai";
import { withOpenAIConcurrencyLimit } from "../middleware/rateLimiter";
import { getAiClientConfig as getRuntimeConfig } from "./aiClientConfig";

const OpenAI = ((OpenAI_import as any).default ?? OpenAI_import) as typeof OpenAI_import;

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Env-controlled timeout + retry. Defaults preserve prior behavior
// (60s timeout, up to 3 attempts including the first) but can be raised
// without code changes when running against a slow proxy or model. The
// pure accessor lives in `aiClientConfig.ts` so callers that just need
// the values can skip the OpenAI SDK load.
const { AI_TIMEOUT_MS, AI_MAX_RETRIES: MAX_RETRIES } = getRuntimeConfig();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn(signal)` with an AbortController so that on timeout the
 *  underlying HTTP request is actually cancelled instead of leaking. */
async function withAbortableTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err: any) {
    if (controller.signal.aborted) {
      const e: any = new Error(`AI timeout after ${timeoutMs}ms (${label})`);
      e.code = "AI_TIMEOUT";
      e.cause = err;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a function with retry, concurrency limiting, and an abortable
 * per-attempt timeout. If `fn` accepts an `AbortSignal`, callers should
 * forward it to the OpenAI SDK (`openai.chat.completions.create(..., { signal })`)
 * so timed-out requests are cancelled at the socket. Callers that
 * ignore the signal still get the timeout via the AbortController race,
 * but the underlying request may keep running in the background.
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  retries = MAX_RETRIES,
  label = "AI call",
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await withOpenAIConcurrencyLimit(() =>
        withAbortableTimeout((signal) => fn(signal), AI_TIMEOUT_MS, label),
      );
      return result;
    } catch (err: any) {
      lastErr = err;
      const isTransient =
        err?.status === 429 ||
        err?.status === 500 ||
        err?.status === 503 ||
        err?.code === "AI_TIMEOUT" ||
        err?.message?.includes("timeout") ||
        err?.message?.includes("ECONNRESET") ||
        err?.message?.includes("socket") ||
        err?.message?.includes("aborted");

      if (!isTransient || attempt === retries) {
        throw err;
      }
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `[${label}] attempt ${attempt}/${retries} failed (${err?.message ?? String(err)}), retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Runtime config snapshot. Re-exported from aiClientConfig so callers
 *  importing only this module don't break. The smoke probe + the
 *  /api/plexus-iq/qualification-config route prefer the pure
 *  aiClientConfig module to avoid loading the OpenAI SDK. */
export { getAiClientConfig } from "./aiClientConfig";

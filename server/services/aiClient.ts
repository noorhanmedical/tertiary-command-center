import OpenAI_import from "openai";

const OpenAI = ((OpenAI_import as any).default ?? OpenAI_import) as typeof OpenAI_import;

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
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
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
        ),
      ]);
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

import OpenAI_import from "openai";
import { withOpenAIConcurrencyLimit } from "../middleware/rateLimiter";
import { getRequestId } from "../middleware/requestObservability";
import { normalizeAiOperation } from "../lib/aiObservability";
import {
  classifyLogSafeProviderError,
  warnPhiSafe,
} from "../lib/phiSafeLogger";

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
  operationLabel = "AI call",
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await withOpenAIConcurrencyLimit(() =>
        Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS),
          ),
        ]),
      );
    } catch (err: unknown) {
      lastErr = err;
      const retryable = isTransientAiError(err);

      if (!retryable || attempt === retries) {
        throw err;
      }

      const delayMs = 1000 * Math.pow(2, attempt - 1);
      warnPhiSafe({
        source: "ai_retry",
        operation: normalizeAiOperation(operationLabel),
        outcome: "retrying",
        category: classifyLogSafeProviderError(err),
        requestId: getRequestId(),
        providerStatus: providerStatus(err),
        attempt,
        delayMs,
        retryable: true,
      });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function isTransientAiError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : "";

  // Preserve the pre-observability retry policy; this change must not alter
  // provider call counts or worst-case latency.
  return status === 429 ||
    status === 500 ||
    status === 503 ||
    message.includes("timeout") ||
    message.includes("ECONNRESET") ||
    message.includes("socket");
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : undefined;
}

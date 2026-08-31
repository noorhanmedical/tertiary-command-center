import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import {
  getLogSafeRouteTemplate,
  logPhiSafe,
  toLogSafeHttpMethod,
  toLogSafeRequestId,
  type LogSafeRequestId,
} from "../lib/phiSafeLogger";

const requestContext = new AsyncLocalStorage<{ requestId: LogSafeRequestId }>();
const responseFailureMarker = Symbol("phi-safe-response-failure");
const approvedOperationalResponseMarker = Symbol("approved-operational-response");

export const INTERNAL_ERROR_MESSAGE = "Internal Server Error";
export const INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

const PUBLIC_OPERATIONAL_RESPONSES = {
  PORTAL_ASSISTANT_DISABLED: {
    status: 501,
    body: Object.freeze({ error: "portal assistant feature disabled" }),
  },
  DIRECT_MESSAGES_DISABLED: {
    status: 501,
    body: Object.freeze({ error: "internal direct messages feature disabled" }),
  },
  GOOGLE_DRIVE_NOT_CONNECTED: {
    status: 503,
    body: Object.freeze({ error: "Google Drive is not connected", connected: false }),
  },
  GOOGLE_DRIVE_PROVIDER_UNAVAILABLE: {
    status: 503,
    body: Object.freeze({ available: false, reason: "S3 provider active" }),
  },
  EMR_SCHEDULE_SYNC_DISABLED: {
    status: 503,
    body: Object.freeze({
      error: "EMR schedule sync is disabled. Set USE_EMR_SCHEDULE_SYNC=1 to enable.",
    }),
  },
  DATABASE_HEALTH_UNAVAILABLE: {
    status: 503,
    body: Object.freeze({ status: "error", db: false }),
  },
} as const;

export type PublicOperationalResponseCode = keyof typeof PUBLIC_OPERATIONAL_RESPONSES;

export function getRequestId(): LogSafeRequestId | undefined {
  return requestContext.getStore()?.requestId;
}

export function createInternalErrorBody(requestId: LogSafeRequestId): {
  error: typeof INTERNAL_ERROR_MESSAGE;
  code: typeof INTERNAL_ERROR_CODE;
  requestId: LogSafeRequestId;
} {
  return {
    error: INTERNAL_ERROR_MESSAGE,
    code: INTERNAL_ERROR_CODE,
    requestId,
  };
}

/**
 * Preserve only centrally predefined, PHI-free operational 5xx contracts.
 * The module-private marker prevents arbitrary route handlers from bypassing
 * the generic API 5xx egress guard with free-form response bodies.
 */
export function sendPublicOperationalResponse(
  res: Response,
  code: PublicOperationalResponseCode,
): Response {
  const definition = PUBLIC_OPERATIONAL_RESPONSES[code];
  (res.locals as Record<PropertyKey, unknown>)[approvedOperationalResponseMarker] = code;
  return res.status(definition.status).json(definition.body);
}

/**
 * Assigns a server-generated correlation ID, records only allowlisted request
 * facts, and prevents legacy API 5xx handlers from returning diagnostics.
 */
export const requestObservability: RequestHandler = (req, res, next) => {
  const requestId = toLogSafeRequestId(randomUUID());
  if (!requestId) {
    // randomUUID() always satisfies the validator. Keep failure behavior safe if
    // the runtime implementation is ever replaced or mocked incorrectly.
    res.status(500).json({ error: INTERNAL_ERROR_MESSAGE, code: INTERNAL_ERROR_CODE });
    return;
  }

  res.setHeader("X-Request-Id", requestId);
  res.locals.requestId = requestId;

  const startedAt = Date.now();
  const originalJson = res.json;
  res.json = function phiSafeJson(this: Response, body: unknown) {
    const shouldReplaceBody = isApiRequest(req) &&
      res.statusCode >= 500 &&
      !isApprovedOperationalResponse(res, body);
    const projectedBody = shouldReplaceBody ? createInternalErrorBody(requestId) : body;
    return originalJson.call(this, projectedBody);
  } as Response["json"];

  let completionLogged = false;
  const logCompletion = (transportAborted: boolean) => {
    if (completionLogged || !isApiRequest(req)) return;
    completionLogged = true;

    const explicitlyFailed = (res.locals as Record<PropertyKey, unknown>)[responseFailureMarker] === true;
    const failed = transportAborted || explicitlyFailed || res.statusCode >= 400;
    logPhiSafe({
      source: "http_request",
      operation: "api_request",
      outcome: failed ? "failed" : "ok",
      category: transportAborted ? "network_failure" : undefined,
      requestId,
      method: toLogSafeHttpMethod(req.method),
      route: getLogSafeRouteTemplate(req),
      statusCode: res.statusCode,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  };
  res.once("finish", () => logCompletion(false));
  res.once("close", () => logCompletion(!res.writableFinished));

  requestContext.run({ requestId }, next);
};

export function markResponseFailed(res: Response): void {
  (res.locals as Record<PropertyKey, unknown>)[responseFailureMarker] = true;
}

export function getOrCreateResponseRequestId(res: Response): LogSafeRequestId {
  const existing = toLogSafeRequestId(res.locals.requestId) ?? getRequestId();
  if (existing) return existing;

  const generated = toLogSafeRequestId(randomUUID());
  if (!generated) throw new Error("Unable to generate request correlation identifier");
  res.locals.requestId = generated;
  if (!res.headersSent) res.setHeader("X-Request-Id", generated);
  return generated;
}

function isApprovedOperationalResponse(res: Response, body: unknown): boolean {
  const code = (res.locals as Record<PropertyKey, unknown>)[approvedOperationalResponseMarker];
  if (typeof code !== "string" || !Object.hasOwn(PUBLIC_OPERATIONAL_RESPONSES, code)) return false;

  const definition = PUBLIC_OPERATIONAL_RESPONSES[code as PublicOperationalResponseCode];
  return res.statusCode === definition.status && body === definition.body;
}

function isApiRequest(req: Request): boolean {
  // Used only as a boolean boundary check; the URL is never retained or logged.
  return /^\/api(?:\/|\?|$)/i.test(req.originalUrl);
}

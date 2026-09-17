import type { Request, Response, NextFunction } from "express";
import { getRequestId } from "./requestObservability";

// Centralized PHI-safe error handling.
//
// Contract:
//   - Client-facing responses NEVER include SQL errors, stack traces, filesystem
//     paths, AWS error detail, secret values, or raw internal messages.
//   - 4xx errors that are explicitly marked client-safe keep their message
//     (validation/authorization messages the UI needs). Convention:
//       err.expose === true  OR  status < 500  → message is client-safe.
//     Everything else (5xx / unmarked) returns a GENERIC message in production.
//   - Every response carries the request_id so support can correlate a user
//     report with the internal (PHI-safe) log line — without leaking detail.
//   - Internal logging is STRUCTURAL: request_id + status + safe error category.
//     We do NOT log the raw error object (it may embed PHI or secrets).

const isProd = process.env.NODE_ENV === "production";

/** Coarse, non-PHI classification of an error for internal logs. */
function classifyLogSafeError(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (code === "42P01") return "undefined_table";
    if (code.startsWith("23")) return "db_constraint";
    if (code.startsWith("08")) return "db_connection";
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT") return "network";
    return "coded_error";
  }
  const status = (err as { status?: number; statusCode?: number });
  if ((status.status ?? status.statusCode ?? 500) < 500) return "client_error";
  return "unclassified";
}

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const status = err?.status || err?.statusCode || 500;
  const code = typeof err?.code === "string" ? err.code : undefined;
  const requestId = getRequestId();

  // Client-safe message only for explicitly-exposed or non-5xx errors.
  const exposeMessage = err?.expose === true || status < 500;
  const clientMessage = exposeMessage
    ? err?.message || "Request failed"
    : "Internal Server Error";

  // PHI-safe internal log — structural only, correlated by request_id.
  // Never log the raw error (it may carry PHI / secrets); in non-prod we add
  // the message + stack to aid local debugging only.
  const logLine: Record<string, unknown> = {
    source: "error_handler",
    request_id: requestId ?? null,
    status,
    category: classifyLogSafeError(err),
    code: code ?? null,
  };
  if (!isProd) {
    logLine.dev_message = err?.message;
    logLine.dev_stack = err?.stack;
  }
  console.error(JSON.stringify(logLine));

  if (res.headersSent) return next(err);

  const body: { error: string; code?: string; requestId?: string } = {
    error: clientMessage,
  };
  if (code) body.code = code;
  if (requestId) body.requestId = requestId;
  res.status(status).json(body);
}

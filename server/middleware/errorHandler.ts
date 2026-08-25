import type { NextFunction, Request, Response } from "express";
import {
  errorPhiSafe,
  getLogSafeRouteTemplate,
  toLogSafeHttpMethod,
} from "../lib/phiSafeLogger";
import {
  createInternalErrorBody,
  getOrCreateResponseRequestId,
  markResponseFailed,
} from "./requestObservability";

const PUBLIC_ERRORS = {
  BAD_REQUEST: { status: 400, message: "Bad Request" },
  UNAUTHORIZED: { status: 401, message: "Unauthorized" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  NOT_FOUND: { status: 404, message: "Not Found" },
  METHOD_NOT_ALLOWED: { status: 405, message: "Method Not Allowed" },
  CONFLICT: { status: 409, message: "Conflict" },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Payload Too Large" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Unsupported Media Type" },
  UNPROCESSABLE_ENTITY: { status: 422, message: "Unprocessable Entity" },
  RATE_LIMITED: { status: 429, message: "Too Many Requests" },
} as const;

export type PublicErrorCode = keyof typeof PUBLIC_ERRORS;

/** Explicit public errors can expose only predefined, non-diagnostic messages. */
export class PublicHttpError extends Error {
  readonly status: number;
  readonly code: PublicErrorCode;

  constructor(code: PublicErrorCode) {
    super(PUBLIC_ERRORS[code].message);
    this.name = "PublicHttpError";
    this.status = PUBLIC_ERRORS[code].status;
    this.code = code;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = getOrCreateResponseRequestId(res);
  markResponseFailed(res);
  const explicitPublicError = err instanceof PublicHttpError ? err : undefined;
  const status = explicitPublicError?.status ?? normalizeHttpStatus(err);

  errorPhiSafe({
    source: "api_error",
    operation: "api_request",
    outcome: "failed",
    category: status < 500 ? "client_error" : "internal_error",
    requestId,
    method: toLogSafeHttpMethod(req.method),
    route: getLogSafeRouteTemplate(req),
    statusCode: status,
  });

  if (res.headersSent) {
    // A clean EOF can make a failed partial stream look successful. Abort the
    // connection without forwarding the exception to Express' raw logger.
    if (!res.destroyed) res.destroy();
    return;
  }

  if (status >= 500) {
    res.status(status).json(createInternalErrorBody(requestId));
    return;
  }

  const publicError = explicitPublicError ?? publicErrorForStatus(status);
  res.status(status).json({
    error: publicError.message,
    code: publicError.code,
    requestId,
  });
}

function normalizeHttpStatus(err: unknown): number {
  if (typeof err !== "object" || err === null) return 500;
  const values = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
  ];
  for (const candidate of values) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }
  return 500;
}

function publicErrorForStatus(status: number): {
  status: number;
  message: string;
  code: PublicErrorCode | "CLIENT_ERROR";
} {
  const entry = (Object.entries(PUBLIC_ERRORS) as Array<[
    PublicErrorCode,
    (typeof PUBLIC_ERRORS)[PublicErrorCode],
  ]>).find(([, value]) => value.status === status);

  if (entry) return new PublicHttpError(entry[0]);
  return { status, message: "Request Failed", code: "CLIENT_ERROR" };
}

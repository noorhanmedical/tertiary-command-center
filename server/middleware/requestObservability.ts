// Request-level observability — PHI-safe.
//
// Provides a per-request correlation ID (request_id) via AsyncLocalStorage so
// any code path (routes, services, background continuations within the request)
// can emit a log line correlated to the originating request WITHOUT threading
// the id through every function signature.
//
// Safety rules (HIPAA):
//   - We NEVER log the request body, raw query strings, headers, cookies, or
//     any URL segment that could carry PHI (patient names, MRNs, tokens).
//   - Only safe structural metadata is recorded: method, ROUTE TEMPLATE (not the
//     concrete path with ids), status, duration, request_id.
//   - The request_id is a random opaque value — not derived from any PHI.

import type { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

type RequestStore = { requestId: string };

const als = new AsyncLocalStorage<RequestStore>();

/** Current request's correlation id, or undefined outside a request. */
export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

/** Run a function within a request-id scope (used by the middleware). */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return als.run({ requestId }, fn);
}

declare global {
  namespace Express {
    interface Request {
      /** Opaque per-request correlation id (safe to log / return in errors). */
      requestId: string;
    }
  }
}

/**
 * Attach a request id and run the rest of the request inside its ALS scope.
 * Also emits ONE PHI-safe access log line on response finish (no body/query).
 * Register EARLY (before body parsing / routes), after which getRequestId()
 * works everywhere in the request.
 */
export function requestObservability(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Honor an inbound trace header if present and well-formed, else generate.
  const inbound = req.header("x-request-id");
  const requestId =
    inbound && /^[A-Za-z0-9._-]{1,128}$/.test(inbound) ? inbound : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const start = Date.now();
  // Skip health probes entirely — they are hit constantly and carry no value.
  const isProbe = req.path === "/healthz" || req.path === "/readyz";

  res.on("finish", () => {
    if (isProbe) return;
    // route template (e.g. "/api/patients/:id") when available, else a coarse
    // fallback that strips obvious id segments so PHI/ids never land in logs.
    const template =
      (req.route && (req.baseUrl || "") + req.route.path) ||
      coarseTemplate(req.path);
    // Structural only — NO body, NO query string, NO headers.
    console.log(
      JSON.stringify({
        source: "http",
        request_id: requestId,
        method: req.method,
        route: template,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      }),
    );
  });

  runWithRequestId(requestId, () => next());
}

/** Replace numeric / uuid-ish path segments with ":id" so concrete resource
 *  identifiers (which can be sensitive) never appear in a log line. */
function coarseTemplate(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) ||
      /^[0-9a-fA-F-]{16,}$/.test(seg) ||
      /^PLX-/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
}

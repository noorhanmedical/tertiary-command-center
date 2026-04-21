import type { Request, Response, NextFunction } from "express";

// Standardized error response shape across the API: { error: string, code?: string }
// Routes may either `throw` (caught here) or `next(err)`. Avoid local try/catch
// in new code — let the global handler do the formatting.
export function errorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  const code = typeof err.code === "string" ? err.code : undefined;

  console.error("Internal Server Error:", err);

  if (res.headersSent) {
    return next(err);
  }

  const body: { error: string; code?: string } = { error: message };
  if (code) body.code = code;
  res.status(status).json(body);
}

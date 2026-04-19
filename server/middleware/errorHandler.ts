import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error("Internal Server Error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(status).json({ message });
}

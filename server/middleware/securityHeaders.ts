// Security headers — dependency-free (no helmet install needed).
//
// Applies defensive HTTP response headers on every response. HSTS is
// DELIBERATELY gated behind ENABLE_HSTS=true and MUST stay off until the
// environment is served over verified HTTPS (enabling HSTS on the current
// HTTP-only staging ALB would break access). Production (behind HTTPS) sets
// ENABLE_HSTS=true.
//
// CSP note: the app is a bundled React SPA served by Express. The policy below
// is intentionally conservative but allows the app's own assets and the inline
// bootstrap that Vite's build emits. Tighten (nonce/hash) as a follow-up if the
// build is changed to support it.

import type { Request, Response, NextFunction } from "express";

const isProd = process.env.NODE_ENV === "production";
const enableHsts = process.env.ENABLE_HSTS === "true";

// Conservative CSP. 'unsafe-inline' for style is kept because the SPA/UI relies
// on inline styles; scripts are restricted to same-origin. Adjust as needed.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Scripts same-origin. 'unsafe-inline' allowed only in non-prod to avoid
  // blocking dev tooling; production relies on the bundled same-origin script.
  isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self'",
  "form-action 'self'",
].join("; ");

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  // HSTS: only when explicitly enabled (i.e. real HTTPS). Never on HTTP staging.
  if (enableHsts) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
}

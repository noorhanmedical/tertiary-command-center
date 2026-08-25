import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { readFileSync } from "node:fs";
import { errorHandler } from "./middleware/errorHandler";
import { clinicContext } from "./middleware/clinicContext";
import { requestObservability } from "./middleware/requestObservability";
import {
  errorPhiSafe,
  logPhiSafe,
  warnPhiSafe,
  toLogSafeSignal,
} from "./lib/phiSafeLogger";
import { validateEnv } from "./lib/validateEnv";
import { startBackgroundServices, stopBackgroundServices } from "./lifecycle";

// Single source of truth for required env + production storage provider check.
validateEnv();

const app = express();
const httpServer = createServer(app);

// Behind ALB / reverse proxy: trust the first hop so req.ip, X-Forwarded-Proto,
// and the secure-cookie check work correctly.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ─── Liveness & readiness (mounted before session/body parsers) ───────────
// /healthz: cheap liveness — no DB, no logging. Safe for ALB target-group polling.
app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

// /readyz: readiness — verifies DB connectivity. Returns 503 when not ready.
// Detailed failure reasons are written to stderr only; the response body is
// intentionally generic to avoid leaking infra details to anyone who can hit
// the load balancer.
app.get("/readyz", async (_req, res) => {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ status: "ready" });
  } catch {
    errorPhiSafe({
      source: "readiness_check",
      operation: "database_readiness",
      outcome: "not_ready",
      category: "database_unavailable",
      statusCode: 503,
    });
    res.status(503).json({ status: "not_ready" });
  }
});

// Correlation and API egress protection must precede body parsing, sessions,
// and tenant context so failures in those layers receive the same request ID
// and completion telemetry as route-handler failures.
app.use(requestObservability);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: "session",
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // `trust proxy` above lets express-session detect TLS termination at the ALB.
      secure: process.env["COOKIE_SECURE"] === "true",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

// Attach req.clinicId from session. Must run after session middleware.
// Admin role gets null (bypasses all clinic filters); others get their clinic.
app.use(clinicContext);

// Suppress the known Vite HMR reconnect race without emitting exception data.
process.on("uncaughtException", (err) => {
  if (err.message?.includes("handleUpgrade() was called more than once")) {
    warnPhiSafe({
      source: "process_exception",
      operation: "websocket_upgrade",
      outcome: "suppressed",
      category: "websocket_race",
    });
    return;
  }
  errorPhiSafe({
    source: "process_exception",
    operation: "process",
    outcome: "failed",
    category: "uncaught_exception",
  });
  process.exit(1);
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      logPhiSafe({
        source: "application_lifecycle",
        operation: "http_server",
        outcome: "started",
        port,
      });
      // Start recurring background services after the HTTP server is up so
      // health checks and request routing aren't blocked by their first tick.
      // Each job acquires a Postgres advisory lock per tick so multiple ECS
      // tasks never double-fire.
      startBackgroundServices();
    },
  );

  // ─── Dev orphan watchdog ──────────────────────────────────────────────────
  // In dev the process tree is `sh -c` → tsx CLI wrapper → this node process.
  // On restart the workflow manager kills an ancestor, but SIGKILL doesn't
  // propagate down, so this node listener (and often the tsx wrapper) leak and
  // keep holding port 5000 — the next start then fails with EADDRINUSE.
  // We watch two signals and self-terminate on either so the port frees up:
  //   1. our own parent changed (we were directly reparented), or
  //   2. our parent's parent (grandparent) changed — an ancestor died and
  //      leaked the whole wrapper+listener subtree while our direct ppid stays
  //      intact (the case a ppid-only check misses).
  // Dev-only: in production the orchestrator owns the process lifecycle.
  if (process.env.NODE_ENV === "development") {
    // Read a pid's parent pid from /proc. comm (field 2) may contain spaces or
    // parens, so parse the fields after the final ')'.
    const readPpidOf = (pid: number): number => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        return Number.parseInt(fields[1], 10); // [0]=state, [1]=ppid
      } catch {
        return -1;
      }
    };
    const originalPpid = process.ppid;
    const originalGrandparentPid = readPpidOf(originalPpid);
    const orphanWatch = setInterval(() => {
      const reparented = process.ppid !== originalPpid;
      const grandparentChanged =
        originalGrandparentPid > 0 &&
        readPpidOf(process.ppid) !== originalGrandparentPid;
      if (reparented || grandparentChanged) {
        errorPhiSafe({
          source: "process_watchdog",
          operation: "process",
          outcome: "exiting",
          category: "shutdown_failure",
        });
        process.exit(0);
      }
    }, 2_000);
    orphanWatch.unref();
  }

  // ─── Graceful shutdown on SIGTERM ─────────────────────────────────────────
  // ECS sends SIGTERM with a configurable stopTimeout (default 30s). Drain
  // HTTP, then close the WS upgrade listener (Vite/HMR in dev), then end the
  // PG pool. Each phase logs so task-stop events are debuggable.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const safeSignal = toLogSafeSignal(signal);
    logPhiSafe({
      source: "application_lifecycle",
      operation: "http_server",
      outcome: "stopping",
      signal: safeSignal,
    });

    const isDev = process.env.NODE_ENV !== "production";

    // Force exit as a safety net. In dev keep it short so a workflow restart
    // never overlaps the old listener with the new one (EADDRINUSE on port
    // 5000); in production allow a longer drain that still stays comfortably
    // before ECS's default 30s stopTimeout.
    const forceExit = setTimeout(() => {
      errorPhiSafe({
        source: "application_lifecycle",
        operation: "http_server",
        outcome: "timed_out",
        category: "timeout",
        signal: safeSignal,
      });
      process.exit(1);
    }, isDev ? 10_000 : 25_000);
    forceExit.unref();

    httpServer.close(async (err) => {
      if (err) {
        errorPhiSafe({
          source: "application_lifecycle",
          operation: "http_server",
          outcome: "failed",
          category: "shutdown_failure",
          signal: safeSignal,
        });
      }
      logPhiSafe({
        source: "application_lifecycle",
        operation: "http_server",
        outcome: "closed",
        signal: safeSignal,
      });

      try {
        await stopBackgroundServices();
      } catch {
        errorPhiSafe({
          source: "application_lifecycle",
          operation: "background_services",
          outcome: "failed",
          category: "shutdown_failure",
          signal: safeSignal,
        });
      }

      logPhiSafe({
        source: "application_lifecycle",
        operation: "websocket_upgrade",
        outcome: "stopping",
        signal: safeSignal,
      });
      // Detach any registered upgrade handlers (Vite HMR in dev attaches one).
      try { httpServer.removeAllListeners("upgrade"); } catch {}

      logPhiSafe({
        source: "application_lifecycle",
        operation: "database_pool",
        outcome: "stopping",
        signal: safeSignal,
      });
      try {
        const { pool } = await import("./db");
        await pool.end();
        logPhiSafe({
          source: "application_lifecycle",
          operation: "database_pool",
          outcome: "closed",
          signal: safeSignal,
        });
      } catch {
        errorPhiSafe({
          source: "application_lifecycle",
          operation: "database_pool",
          outcome: "failed",
          category: "shutdown_failure",
          signal: safeSignal,
        });
      }
      clearTimeout(forceExit);
      process.exit(0);
    });

    // httpServer.close() above only fires its callback once all open
    // connections have ended. In dev, Vite's HMR holds a long-lived connection
    // open, which would otherwise keep the callback from running and leave the
    // process holding port 5000 across a workflow restart. Drop active
    // connections so the drain completes promptly. Dev-only so production
    // requests are allowed to finish draining naturally. (Upgraded WebSocket
    // sockets aren't guaranteed covered by this API, hence the force-exit net.)
    if (isDev) {
      if (typeof httpServer.closeIdleConnections === "function") {
        httpServer.closeIdleConnections();
      }
      if (typeof httpServer.closeAllConnections === "function") {
        httpServer.closeAllConnections();
      }
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

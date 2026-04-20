import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { errorHandler } from "./middleware/errorHandler";
import { validateEnv } from "./lib/validateEnv";

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
  } catch (err: any) {
    console.error("[readyz] DB readiness check failed:", err?.message ?? err);
    res.status(503).json({ status: "not_ready" });
  }
});

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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  // Don't log health probes — ALB hits /healthz every few seconds.
  if (path === "/healthz" || path === "/readyz") return next();
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Suppress harmless Vite HMR WebSocket race condition that occurs during dev server restarts
process.on("uncaughtException", (err) => {
  if (err.message?.includes("handleUpgrade() was called more than once")) {
    console.warn("[vite] Suppressed duplicate WebSocket upgrade (harmless reconnect race)");
    return;
  }
  console.error("Uncaught exception:", err);
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
      log(`serving on port ${port}`);
      import("./integrations/fileStorage").then(({ getStorageProvider }) => {
        if (getStorageProvider() !== "google_drive") {
          log(`Storage provider: ${getStorageProvider()} — skipping Google Drive folder tree initialization`, "startup");
          return;
        }
        import("./integrations/googleDrive").then(({ validateDriveCredentials, initializeDriveFolderTree }) => {
          try {
            validateDriveCredentials();
          } catch {
          }
          initializeDriveFolderTree();
        }).catch(() => {});
      }).catch(() => {});
    },
  );

  // ─── Graceful shutdown on SIGTERM ─────────────────────────────────────────
  // ECS sends SIGTERM with a configurable stopTimeout (default 30s). Drain
  // HTTP, then close the WS upgrade listener (Vite/HMR in dev), then end the
  // PG pool. Each phase logs so task-stop events are debuggable.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received. Draining HTTP server...`, "shutdown");

    // Force exit after 25s so we exit comfortably before ECS's default 30s stopTimeout.
    const forceExit = setTimeout(() => {
      console.error("[shutdown] Graceful shutdown timed out — force exiting.");
      process.exit(1);
    }, 25_000);
    forceExit.unref();

    httpServer.close(async (err) => {
      if (err) console.error("[shutdown] httpServer.close error:", err.message);
      log("HTTP server closed. Closing WebSocket upgrade listeners...", "shutdown");

      // Detach any registered upgrade handlers (Vite HMR in dev attaches one).
      try { httpServer.removeAllListeners("upgrade"); } catch {}

      log("Closing DB pool...", "shutdown");
      try {
        const { pool } = await import("./db");
        await pool.end();
        log("DB pool drained. Exiting.", "shutdown");
      } catch (poolErr: any) {
        console.error("[shutdown] Error draining DB pool:", poolErr.message);
      }
      clearTimeout(forceExit);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

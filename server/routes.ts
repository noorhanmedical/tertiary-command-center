import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool } from "./db";
import { registerTestHistoryRoutes } from "./routes/testHistory";
import { registerPatientReferenceRoutes } from "./routes/patientReferences";
import { registerGeneratedNotesRoutes } from "./routes/generatedNotes";
import { registerGoogleRoutes } from "./routes/google";
import { registerPlexusTasksRoutes } from "./routes/plexusTasks";
import { registerBatchRoutes } from "./routes/batches";
import { registerPatientRoutes } from "./routes/patients";
import { registerBillingRoutes } from "./routes/billing";
import { registerOutreachRoutes } from "./routes/outreach";
import { registerPtoRoutes } from "./routes/pto";
import { registerSchedulerAssignmentRoutes } from "./routes/schedulerAssignments";
import { startAbsenceWatcher } from "./services/absenceWatcher";
import { startMorningRebuildScheduler } from "./services/morningRebuildScheduler";
import { registerSettingsRoutes } from "./routes/settings";
import { registerAppointmentRoutes } from "./routes/appointments";
import { registerAdminRoutes } from "./routes/admin";
import { registerOutboxRoutes } from "./routes/outbox";
import { registerPatientDatabaseRoutes } from "./routes/patientDatabase";
import { registerTestFixtureRoutes } from "./routes/testFixture";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import {
  backgroundSyncPatients,
  backgroundSyncBilling,
} from "./services/syncService";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Reset any batches stuck in "processing" from a previous server run ────
  try {
    const allBatches = await storage.getAllScreeningBatches();
    let resetCount = 0;
    for (const batch of allBatches) {
      if (batch.status === "processing") {
        await storage.updateScreeningBatch(batch.id, { status: "draft" });
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        const processingPatients = patients.filter((patient) => patient.status === "processing");
        for (const p of processingPatients) {
          await storage.updatePatientScreening(p.id, { status: "draft", qualifyingTests: [] });
        }
        console.warn(`[startup] Reset interrupted batch #${batch.id} → draft (${processingPatients.length} patients reset)`);
        resetCount++;
      }
    }
    if (resetCount > 0) {
      console.log(`[startup] Reset ${resetCount} interrupted batch(es) to draft status`);
    }
  } catch (startupErr: any) {
    console.error("[startup] Failed to reset stuck batches:", startupErr.message);
  }

  // ─── Fail any analysis_jobs still marked "running" from the previous process ─
  try {
    await storage.failRunningAnalysisJobs("Server restarted mid-analysis");
  } catch (jobErr: any) {
    console.error("[startup] Failed to fail interrupted analysis jobs:", jobErr.message);
  }

  // ─── Purge analysis_jobs older than 7 days ─────────────────────────────────
  try {
    await storage.purgeOldAnalysisJobs(7);
  } catch (purgeErr: any) {
    console.error("[startup] Failed to purge old analysis jobs:", purgeErr.message);
  }

  // ─── Auth endpoints (exempt from session requirement) ─────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const user = await storage.validateUserPassword(username, password);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }
    if (user.active === false) {
      return res.status(403).json({ message: "This account has been deactivated. Contact your administrator." });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    return res.json({ id: user.id, username: user.username, role: user.role });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return res.json({ id: req.session.userId, username: req.session.username, role: req.session.role ?? "clinician" });
  });

  // ─── /api/healthz — pool telemetry (exempt from auth, debug-friendly) ────
  // Liveness/readiness endpoints (/healthz, /readyz) are mounted in index.ts
  // before session middleware. This one returns pool stats and is intentionally
  // mounted before the auth gate so operators can curl it without a session.
  app.get("/api/healthz", async (_req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      res.json({
        status: "ok",
        db: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      });
    } catch {
      res.status(503).json({ status: "error", db: false });
    }
  });

  const requireAuth = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
  };

  const requireAdmin = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (req.session.role !== "admin") {
      return res.status(403).json({ message: "Forbidden — admin access required" });
    }
    return next();
  };

  const requireRole = (...roles: string[]) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const role = req.session.role ?? "clinician";
    if (!roles.includes(role)) {
      return res.status(403).json({ message: `Forbidden — requires one of: ${roles.join(", ")}` });
    }
    return next();
  };

  app.use("/api", requireAuth);

  // ─── Audit log query endpoints ─────────────────────────────────────────────
  app.get("/api/audit-log", async (req, res) => {
    try {
      const { userId, entityType, fromDate, toDate, limit } = req.query as Record<string, string | undefined>;
      const logs = await storage.getAuditLogs({
        userId: userId || undefined,
        entityType: entityType || undefined,
        fromDate: fromDate ? new Date(fromDate) : undefined,
        toDate: toDate ? new Date(toDate) : undefined,
        limit: limit ? parseInt(limit, 10) : 200,
      });
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/audit-log/users", async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map((u) => ({ id: u.id, username: u.username })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Domain route registrations ────────────────────────────────────────────
  registerGoogleRoutes(app);
  registerTestHistoryRoutes(app, { backgroundSyncPatients });
  registerPatientReferenceRoutes(app, { backgroundSyncPatients });
  registerGeneratedNotesRoutes(app);
  registerPlexusTasksRoutes(app);
  registerBatchRoutes(app);
  // PatientDatabaseRoutes must be registered before PatientRoutes so that
  // the static `/api/patients/database*` paths take precedence over the
  // `/api/patients/:id` parameterised handler.
  registerPatientDatabaseRoutes(app);
  registerPatientRoutes(app, { backgroundSyncPatients });
  registerBillingRoutes(app, { backgroundSyncBilling });
  registerOutreachRoutes(app);
  registerPtoRoutes(app);
  registerSchedulerAssignmentRoutes(app);
  startAbsenceWatcher();
  startMorningRebuildScheduler();
  registerSettingsRoutes(app);
  registerAppointmentRoutes(app);
  registerAdminRoutes(app);
  registerOutboxRoutes(app);
  registerTestFixtureRoutes(app);

  // ─── First-boot seed: create admin/admin if no users exist ────────────────
  try {
    const count = await storage.getUserCount();
    if (count === 0) {
      await storage.createUser({ username: "admin", password: "admin", role: "admin" });
      console.warn("[auth] ⚠ No users found. Created default admin/admin account — CHANGE THIS PASSWORD IMMEDIATELY");
    }
  } catch (seedErr: any) {
    console.error("[auth] Failed to seed default admin account:", seedErr.message);
  }

  // Note: /healthz and /readyz are mounted in server/index.ts before session
  // middleware so they are cheap and unauthenticated for the load balancer.

  // ─── User management (admin-only) ─────────────────────────────────────────
  app.get("/api/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    return res.json(allUsers.map((u) => ({ id: u.id, username: u.username, role: u.role })));
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ message: "Username already exists" });
    }
    const user = await storage.createUser({ username, password, role: role || "clinician" });
    return res.status(201).json({ id: user.id, username: user.username, role: user.role });
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    await storage.deleteUser(id);
    return res.json({ ok: true });
  });

  app.patch("/api/users/:id/deactivate", requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ message: "You cannot deactivate your own account" });
    }
    const target = await storage.getUser(id);
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }
    await storage.deactivateUser(id);
    return res.json({ ok: true });
  });

  app.patch("/api/users/:id/role", requireAdmin, async (req, res) => {
    const { role } = req.body;
    if (!role) return res.status(400).json({ message: "role is required" });
    const { USER_ROLES } = await import("@shared/schema");
    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${USER_ROLES.join(", ")}` });
    }
    const target = await storage.getUser(req.params.id);
    if (!target) return res.status(404).json({ message: "User not found" });
    await storage.updateUserRole(req.params.id, role);
    return res.json({ id: target.id, username: target.username, role });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    const user = await storage.validateUserPassword(req.session.username!, currentPassword);
    if (!user) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    await storage.updateUserPassword(req.session.userId, newPassword);
    return res.json({ ok: true });
  });

  // Note: Vite/static middleware setup is handled by server/index.ts after
  // registerRoutes() returns, so the API routes above are registered first
  // and the SPA catch-all does not shadow them. Do NOT setupVite here — doing
  // so would attach a second HMR WebSocket and break HMR reconnects.

  return httpServer;
}

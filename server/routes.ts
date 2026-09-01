import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool } from "./db";
import { registerTestHistoryRoutes } from "./routes/testHistory";
import { registerPatientReferenceRoutes } from "./routes/patientReferences";
import { registerGeneratedNotesRoutes } from "./routes/generatedNotes";
import { registerPlexusTasksRoutes } from "./routes/plexusTasks";
import { registerBatchRoutes } from "./routes/batches";
import { registerPatientRoutes } from "./routes/patients";
import { registerPlexusIqClinicalImportRoutes } from "./routes/plexusIqClinicalImport";
import { registerEngagementAssignmentBoardRoutes } from "./routes/engagementAssignmentBoard";
import { registerEngagementBasketsRoutes } from "./routes/engagementBaskets";
import { registerEngagementCallSettingsRoutes } from "./routes/engagementCallSettings";
import { registerEngagementDistributionRoutes } from "./routes/engagementDistribution";
import { registerCallHandoffRoutes } from "./routes/callHandoffs";
import { registerEngagementTeamMetricsRoutes } from "./routes/engagementTeamMetrics";
import { registerBillingRoutes } from "./routes/billing";
import { registerInvoiceRoutes } from "./routes/invoices";
import { registerOutreachRoutes } from "./routes/outreach";
import { registerEmailRoutes } from "./routes/email";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerPtoRoutes } from "./routes/pto";
import { registerSchedulerAssignmentRoutes } from "./routes/schedulerAssignments";
import { registerSchedulerAiRoutes } from "./routes/schedulerAi";
import { registerSettingsRoutes } from "./routes/settings";
import { registerAppointmentRoutes } from "./routes/appointments";
import { registerAdminRoutes } from "./routes/admin";
import { registerOutboxRoutes } from "./routes/outbox";
import { registerPatientDatabaseRoutes } from "./routes/patientDatabase";
import { registerClinicalDataRoutes } from "./routes/clinicalData";
import { registerPatientDirectoryRoutes } from "./routes/patientDirectory";
import { registerPatientDirectorySectionAccessRoutes } from "./routes/patientDirectorySectionAccess";
import { registerTestFixtureRoutes } from "./routes/testFixture";
import { registerMarketingMaterialRoutes } from "./routes/marketingMaterials";
import { registerDocumentLibraryRoutes } from "./routes/documentLibrary";
import { registerPortalRoutes } from "./routes/portal";
// Priority 4 backend routes — deferred pending product decision.
// UI is preserved via local/mock/disabled state on the client side.
//   patient messaging / vendor SMS (Twilio)
//   portal assistant (AI chat scope)
//   portal widgets / prefs (persistence layer)
// import { registerPatientMessagesRoutes } from "./routes/patientMessages";
// import { registerPortalAssistantRoutes } from "./routes/portalAssistant";
import { registerExecutionCaseRoutes } from "./routes/executionCases";
import { registerGlobalScheduleRoutes } from "./routes/globalSchedule";
import { registerAcsWorkflowRoutes } from "./routes/acsWorkflow";
import { registerPatientNotesRoutes } from "./routes/patientNotes";
import { registerContactsRoutes } from "./routes/contacts";
// Team Portal — backend-persisted widget/layout prefs. Wired to the
// TeamPortalShell tool dock + floating widgets. Backing schema:
// migrations/0044_add_portal_widgets.sql + 0045_add_workspace_prefs.sql.
import { registerPortalWidgetsRoutes } from "./routes/portalWidgets";
import { registerPortalPrefsRoutes } from "./routes/portalPrefs";
// Phase 4 — internal direct messages (INTERNAL user-to-user only, no
// patient messaging, no Twilio, no SMS). Feature-flagged OFF by
// default; when the flag is off the routes 501 back and the client
// keeps using mockPortalMessages local state.
import { registerDirectMessagesRoutes } from "./routes/directMessages";
// Phase 1 (Team Ops) — first-class internal team messaging. The ONE
// canonical messaging backend (conversations + members + team_messages).
// Not feature-flagged; supersedes the flag-gated /api/internal-messages
// path and the mock inbox.
import { registerMessagingRoutes } from "./routes/messaging";
import { registerPortalAssistantRoutes } from "./routes/portalAssistant";
// Phase 4C — Clinical Intelligence live persistence deferred. The
// canonical schema `shared/schema/clinicalIntelligence.ts` is already
// on main (5 tables: ciLearningItems, ciRules, ciRuleVersions,
// ciEvidenceRecords, ciAuditEntries) but no migration ships them yet
// and the client keeps running on its localStorage prototype. The
// authored migration SQL + a repo/service consuming those five tables
// lands in a follow-up PR once the tables have been reviewed against
// current data.
import { registerBillingPolicyRoutes } from "./routes/billingPolicy";
import { registerInvoiceReadinessRoutes } from "./routes/invoiceReadiness";
import { registerInvoiceBatchRoutes } from "./routes/invoiceBatches";
import { registerInvoiceApprovalRoutes } from "./routes/invoiceApproval";
import { registerInvoiceDeliveryRoutes } from "./routes/invoiceDelivery";
import { registerInvoiceFinancialRoutes } from "./routes/invoiceFinancialEvents";
import { registerBillingAuditorRoutes } from "./routes/billingAuditor";
import { registerBillingReportsRoutes } from "./routes/billingReports";
import { registerSchedulingTriageRoutes } from "./routes/schedulingTriage";
import { registerInsuranceEligibilityRoutes } from "./routes/insuranceEligibility";
import { registerCooldownRoutes } from "./routes/cooldown";
import { registerAdminSettingsRoutes } from "./routes/adminSettings";
import { registerDocumentReadinessRoutes } from "./routes/documentReadiness";
import { registerPortalCaseReadinessRoutes } from "./routes/portalCaseReadiness";
import { registerProcedureEventRoutes } from "./routes/procedureEvents";
import { registerBillingReadinessRoutes } from "./routes/billingReadiness";
import { registerBillingDocumentRoutes } from "./routes/billingDocuments";
import { registerCompletedBillingPackageRoutes } from "./routes/completedBillingPackages";
import { registerCashPricingRoutes } from "./routes/cashPricing";
import { registerProjectedInvoiceRoutes } from "./routes/projectedInvoices";
import { registerPatientPacketRoutes } from "./routes/patientPacket";
import { registerAncillaryDocumentTemplateRoutes } from "./routes/ancillaryDocumentTemplates";
import { registerOperationalQueueRoutes } from "./routes/operationalQueue";
import { registerCallListAuditRoutes } from "./routes/callListAudit";
import { registerHomeStatsRoutes } from "./routes/homeStats";
// Priority 4 backend routes — deferred pending product decision.
//   clinician portal alt backend (canonical shell decision pending)
//   clinical intelligence backend (schema commit decision pending)
// import { registerClinicianPortalRoutes } from "./routes/clinicianPortal";
import { registerMissionControlRoutes } from "./routes/missionControl";
import { registerPhysicianPortalRoutes } from "./routes/physicianPortal";
import { registerPlexusClinicalFindingsRoutes } from "./routes/plexusClinicalFindings";
import { registerAncillaryServiceRegistryRoutes } from "./routes/ancillaryServiceRegistry";
import { registerOrderNoteLifecycleRoutes } from "./routes/orderNoteLifecycle";
import { registerScreeningEvidenceRoutes } from "./routes/screeningEvidence";
import { registerPlexusBankRoutes } from "./routes/plexusBank";
import { registerPlexusEhrAddPatientRoutes } from "./routes/plexusEhrAddPatient";
// import { registerClinicalIntelligenceRoutes } from "./routes/clinicalIntelligence";
// import { seedCiRulesIfEmpty } from "./repositories/clinicalIntelligence.repo";
import { setupVite } from "./vite";
import { serveStatic } from "./static";

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
  // Error responses use the standard `{ error }` shape (see middleware/errorHandler.ts).
  const { z } = await import("zod");
  const loginSchema = z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const { username, password } = parsed.data;
    const user = await storage.validateUserPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (user.active === false) {
      return res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    // Store clinicId in session so clinicContext middleware can populate req.clinicId.
    // Admin role ignores this value (clinicContext forces null for admins).
    req.session.clinicId = user.clinicId ?? null;
    return res.json({ id: user.id, username: user.username, role: user.role, clinicId: user.clinicId ?? null });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json({ id: req.session.userId, username: req.session.username, role: req.session.role ?? "clinician", clinicId: req.session.clinicId ?? null });
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
    // Twilio's inbound SMS webhook can't hold a session — it is validated
    // by X-Twilio-Signature inside the route handler instead (Task #648).
    if (req.path === "/sms/twilio/inbound" && req.method === "POST") {
      return next();
    }
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return next();
  };

  const requireAdmin = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (req.session.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin access required" });
    }
    return next();
  };

  const requireRole = (...roles: string[]) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const role = req.session.role ?? "clinician";
    if (!roles.includes(role)) {
      return res.status(403).json({ error: `Forbidden — requires one of: ${roles.join(", ")}` });
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
  registerTestHistoryRoutes(app);
  registerPatientReferenceRoutes(app);
  registerGeneratedNotesRoutes(app);
  registerPlexusTasksRoutes(app);
  registerBatchRoutes(app);
  // PatientDatabaseRoutes must be registered before PatientRoutes so that
  // the static `/api/patients/database*` paths take precedence over the
  // `/api/patients/:id` parameterised handler.
  registerPatientDatabaseRoutes(app);
  registerPatientRoutes(app);
  // Canonical clinical reference domains (providers/allergies/labs/imaging/
  // vitals/encounters). Deeper path than /api/patients/:id so no collision.
  registerClinicalDataRoutes(app);
  // Patient EHR routes: gated on USE_PATIENT_DIRECTORY_ACTIVATION.
  // Default OFF — no endpoints registered until Ali flips the flag and
  // applies migrations 0027-0029 from the blockers doc.
  registerPatientDirectoryRoutes(app);
  // Section-access config is NOT gated behind the activation flag — it applies
  // to the always-on Patient EHR chart in the Patient Database.
  registerPatientDirectorySectionAccessRoutes(app);
  registerPlexusIqClinicalImportRoutes(app);
  registerEngagementAssignmentBoardRoutes(app);
  registerEngagementBasketsRoutes(app);
  registerEngagementCallSettingsRoutes(app, requireRole);
  registerEngagementDistributionRoutes(app, requireRole);
  registerCallHandoffRoutes(app);
  (await import("./routes/teams")).registerTeamRoutes(app, requireRole);
  registerEngagementTeamMetricsRoutes(app, requireRole);
  (await import("./routes/organizationSettings")).registerOrganizationSettingsRoutes(app, requireRole);
  registerBillingRoutes(app);
  registerInvoiceRoutes(app);
  registerOutreachRoutes(app);
  registerEmailRoutes(app);
  registerNotificationRoutes(app);
  registerPtoRoutes(app);
  registerSchedulerAssignmentRoutes(app);
  registerSchedulerAiRoutes(app);
  registerSettingsRoutes(app);
  registerAppointmentRoutes(app);
  registerAdminRoutes(app);
  registerOutboxRoutes(app);
  registerTestFixtureRoutes(app);
  registerMarketingMaterialRoutes(app);
  registerDocumentLibraryRoutes(app);
  registerPortalRoutes(app);
  // Priority 4 registrations — deferred pending product decision.
  // registerPatientMessagesRoutes(app);
  // registerPortalAssistantRoutes(app, requireRole);
  registerExecutionCaseRoutes(app);
  registerAcsWorkflowRoutes(app);
  registerPatientNotesRoutes(app);
  registerContactsRoutes(app);
  registerPortalWidgetsRoutes(app);
  registerPortalPrefsRoutes(app);
  // Phase 4 — internal direct messages (feature-flagged OFF by default).
  registerDirectMessagesRoutes(app);
  // Phase 1 (Team Ops) — first-class internal team messaging (canonical).
  registerMessagingRoutes(app);
  // Phase 4 — Portal Assistant (AI, feature-flagged OFF by default).
  registerPortalAssistantRoutes(app);
  // Phase 4C — Clinical Intelligence live persistence deferred (see
  // import block above). No route registered until schema migration
  // review completes.
  registerBillingPolicyRoutes(app);
  registerInvoiceReadinessRoutes(app);
  registerInvoiceBatchRoutes(app);
  registerInvoiceApprovalRoutes(app);
  registerInvoiceDeliveryRoutes(app);
  registerInvoiceFinancialRoutes(app);
  registerBillingAuditorRoutes(app);
  registerBillingReportsRoutes(app);
  registerGlobalScheduleRoutes(app);
  // Capacity-aware scheduling: per-facility equipment capacity config +
  // temporary outage overrides, and the ONE availability engine endpoint that
  // both the full UnifiedScheduler and Quick Schedule popover consume.
  (await import("./routes/schedulingCapacity")).registerSchedulingCapacityRoutes(app);
  (await import("./routes/schedulingAvailability")).registerSchedulingAvailabilityRoutes(app);
  (await import("./routes/schedulingVisit")).registerSchedulingVisitRoutes(app);
  registerSchedulingTriageRoutes(app);
  registerInsuranceEligibilityRoutes(app);
  registerCooldownRoutes(app);
  registerAdminSettingsRoutes(app);
  registerDocumentReadinessRoutes(app);
  registerPortalCaseReadinessRoutes(app);
  registerProcedureEventRoutes(app);
  registerBillingReadinessRoutes(app);
  registerBillingDocumentRoutes(app);
  registerCompletedBillingPackageRoutes(app);
  registerCashPricingRoutes(app);
  registerProjectedInvoiceRoutes(app);
  registerPatientPacketRoutes(app);
  registerAncillaryDocumentTemplateRoutes(app);
  registerOperationalQueueRoutes(app);
  registerCallListAuditRoutes(app, requireRole);
  registerHomeStatsRoutes(app);
  // Priority 4 — clinician portal alt backend deferred; canonical shell TBD.
  // registerClinicianPortalRoutes(app);
  registerMissionControlRoutes(app, requireRole);
  registerPhysicianPortalRoutes(app);
  // Phase 3 — Plexus Clinical Findings CRUD + review.
  registerPlexusClinicalFindingsRoutes(app);
  // Phase 4 — Ancillary Service Registry.
  registerAncillaryServiceRegistryRoutes(app);
  // Phase 5 — Order Note Lifecycle + Note Addenda.
  registerOrderNoteLifecycleRoutes(app);
  // Slice A0 — Structured ACS/PCS screening evidence contract (validate/log +
  // persistence into case_document_readiness.metadata). No signing behavior.
  registerScreeningEvidenceRoutes(app);
  // Phase 10 — Plexus Bank.
  registerPlexusBankRoutes(app);
  // Plexus EHR — Direct patient add.
  registerPlexusEhrAddPatientRoutes(app);
  // Phase 2H — canonical Clinician Portal overview (read-only). Registered
  // unconditionally; returns an explicit disabled contract when
  // FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA is OFF (zero canonical reads).
  (await import("./routes/clinicianPortalCanonical")).registerClinicianPortalCanonicalRoutes(app);
  // Phase 2I — canonical PCS/ACS stage-vector read models. Registered
  // unconditionally; each returns an explicit disabled contract when its own
  // FEATURE_PCS_CANONICAL_VIEW / FEATURE_ACS_CANONICAL_VIEW flag is OFF (zero
  // canonical reads).
  (await import("./routes/pcsAcsCanonical")).registerPcsAcsCanonicalRoutes(app);
  // Phase 2J — canonical claim/invoice/payment read model. Registered
  // unconditionally; returns an explicit disabled contract when all three
  // FEATURE_CANONICAL_CLAIMS/INVOICES/PAYMENTS flags are OFF (zero migration-0056
  // reads). READ-ONLY; no external financial operation is ever executed.
  (await import("./routes/canonicalFinancial")).registerCanonicalFinancialRoutes(app);
  // Phase 2C — Engagement Repository + service-specific Admin Review.
  // Both route files are registered unconditionally. Each handler
  // returns 404 when its feature flag is OFF, preserving previous
  // "route does not exist" behavior for any consumer.
  (await import("./routes/engagementRepository")).registerEngagementRepositoryRoutes(app);
  (await import("./routes/adminReviewEvents")).registerAdminReviewEventsRoutes(app);
  // Phase 2E — clinic-scoped Ancillary Documents read APIs. Registered
  // unconditionally; handlers return an explicit disabled contract when
  // FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is OFF (zero migration-0053 reads).
  (await import("./routes/ancillaryDocuments")).registerAncillaryDocumentsRoutes(app);
  // Phase 2G — canonical billing readiness + Billing Document APIs. Registered
  // unconditionally; handlers return an explicit disabled contract when the
  // Phase 2G flags are OFF (zero migration-0055 reads).
  (await import("./routes/canonicalBilling")).registerCanonicalBillingRoutes(app);
  // Priority 4 — clinical intelligence backend deferred; UI runs on local
  // storage prototype. Enable route + seed when schema is approved.
  // registerClinicalIntelligenceRoutes(app, requireRole);
  // try {
  //   await seedCiRulesIfEmpty();
  // } catch (seedErr: any) {
  //   console.error("[clinical-intelligence] Failed to seed rule library:", seedErr.message);
  // }

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

  const { USER_ROLES } = await import("@shared/schema");
  const createUserSchema = z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    role: z.enum(USER_ROLES).optional(),
  });
  const roleUpdateSchema = z.object({
    role: z.enum(USER_ROLES),
  });
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const { username, password, role } = parsed.data;
    const existing = await storage.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: "Username already exists" });
    }
    const user = await storage.createUser({ username, password, role: role || "clinician" });
    return res.status(201).json({ id: user.id, username: user.username, role: user.role });
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    await storage.deleteUser(String(id));
    return res.json({ ok: true });
  });

  app.patch("/api/users/:id/deactivate", requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ error: "You cannot deactivate your own account" });
    }
    const target = await storage.getUser(String(id));
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    await storage.deactivateUser(String(id));

    // Phase 3E — canonically release + redistribute the deactivated user's
    // active call cases immediately (do not wait for absenceWatcher). Anything
    // that cannot be re-placed lands in structured NEEDS COVERAGE
    // (deactivated_owner). Non-blocking: a recovery hiccup never blocks the
    // deactivation itself.
    let recovery: unknown = null;
    try {
      const { recoverDeactivatedUser } = await import(
        "./services/engagement/deactivatedUserRecovery"
      );
      recovery = await recoverDeactivatedUser(String(id), req.session.userId ?? null);
    } catch (recErr) {
      console.error(
        "[users:deactivate] canonical recovery failed (user still deactivated):",
        recErr instanceof Error ? recErr.message : recErr,
      );
    }
    // Relationship-change audit (K25).
    try {
      const { teamsRepository } = await import("./repositories/teams.repo");
      await teamsRepository.recordEvent({
        eventType: "user_deactivated", actorUserId: req.session.userId ?? null, subjectUserId: String(id),
        summary: `User ${target.username} deactivated`, metadata: { recovery },
      });
    } catch { /* best-effort */ }
    return res.json({ ok: true, recovery });
  });

  // Phase 4E — reactivate a user. Restores operational eligibility (users.active
  // + engagement_call_settings.active) but NEVER resurrects historical ownership
  // — the user starts with an empty live queue and receives new work via the
  // normal distribution path. Team memberships / coverage history stand as-is.
  app.patch("/api/users/:id/reactivate", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const target = await storage.getUser(String(id));
    if (!target) return res.status(404).json({ error: "User not found" });
    await storage.reactivateUser(String(id));
    let eligibility: unknown = null;
    try {
      const { reactivateUserEligibility } = await import(
        "./services/engagement/reactivateUser"
      );
      eligibility = await reactivateUserEligibility(String(id));
    } catch (err) {
      console.error(
        "[users:reactivate] eligibility restore failed (user still reactivated):",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const { teamsRepository } = await import("./repositories/teams.repo");
      await teamsRepository.recordEvent({
        eventType: "user_reactivated", actorUserId: req.session.userId ?? null, subjectUserId: String(id),
        summary: `User ${target.username} reactivated`, metadata: { eligibility },
      });
    } catch { /* best-effort */ }
    return res.json({ ok: true, eligibility });
  });

  app.patch("/api/users/:id/role", requireAdmin, async (req, res) => {
    const parsed = roleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${USER_ROLES.join(", ")}` });
    }
    const target = await storage.getUser(String(req.params.id));
    if (!target) return res.status(404).json({ error: "User not found" });
    await storage.updateUserRole(String(req.params.id), parsed.data.role);
    return res.json({ id: target.id, username: target.username, role: parsed.data.role });
  });

  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    const user = await storage.validateUserPassword(req.session.username!, parsed.data.currentPassword);
    if (!user) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    await storage.updateUserPassword(req.session.userId, parsed.data.newPassword);
    return res.json({ ok: true });
  });

  // Note: Vite/static middleware setup is handled by server/index.ts after
  // registerRoutes() returns, so the API routes above are registered first
  // and the SPA catch-all does not shadow them. Do NOT setupVite here — doing
  // so would attach a second HMR WebSocket and break HMR reconnects.

  return httpServer;
}

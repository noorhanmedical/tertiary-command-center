import type { Express, Request } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { VALID_FACILITIES } from "./helpers";
import {
  insertOutreachSchedulerSchema,
  insertOutreachCallSchema,
  patientScreenings,
  screeningBatches,
  outreachSchedulers,
  type OutreachCallOutcome,
} from "../../shared/schema";
import { eq } from "drizzle-orm";
import { buildOutreachDashboard } from "../services/outreachService";

// Look up the user_id of the scheduler currently assigned to a given
// patient screening (via batch.assigned_scheduler_id). Returns null when
// the patient is unassigned, the scheduler row has no user mapping, or
// the patient does not exist.
async function getAssignedSchedulerUserIdForPatient(
  patientScreeningId: number,
): Promise<string | null> {
  const rows = await db
    .select({ userId: outreachSchedulers.userId })
    .from(patientScreenings)
    .innerJoin(screeningBatches, eq(patientScreenings.batchId, screeningBatches.id))
    .leftJoin(outreachSchedulers, eq(screeningBatches.assignedSchedulerId, outreachSchedulers.id))
    .where(eq(patientScreenings.id, patientScreeningId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

// Map a call outcome to the denormalized appointmentStatus bucket on
// patient_screenings. Manual booking still owns the canonical "scheduled"
// state; we never overwrite "scheduled" except when the outcome itself is
// "scheduled".
function deriveAppointmentStatus(outcome: OutreachCallOutcome): string {
  switch (outcome) {
    case "scheduled":            return "scheduled";
    case "callback":
    case "wants_more_info":
    case "will_think_about_it":
    case "language_barrier":
    case "reached":              return "callback";
    case "declined":
    case "not_interested":
    case "refused_dnc":
    case "wrong_number":
    case "moved":
    case "deceased":             return "declined";
    case "no_answer":
    case "voicemail":
    case "mailbox_full":
    case "busy":
    case "hung_up":
    case "disconnected":         return "no_answer";
    default:                     return "pending";
  }
}

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

function sessionRole(req: Request): string | null {
  const sess = (req as Request & { session?: { role?: string } }).session;
  return sess?.role ?? null;
}

export function registerOutreachRoutes(app: Express) {
  app.get("/api/outreach/dashboard", async (_req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dashboard = await buildOutreachDashboard(storage, today);
      res.json(dashboard);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message || "Failed to build outreach dashboard" });
    }
  });

  app.get("/api/outreach/schedulers", async (_req, res) => {
    try {
      const schedulers = await storage.getOutreachSchedulers();
      res.json(schedulers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/outreach/schedulers", async (req, res) => {
    try {
      const parsed = insertOutreachSchedulerSchema.extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ),
        capacityPercent: insertOutreachSchedulerSchema.shape.capacityPercent
          .refine((n) => n != null && n >= 0 && n <= 100, { message: "capacityPercent must be between 0 and 100" })
          .optional(),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const scheduler = await storage.createOutreachScheduler(parsed.data);
      res.status(201).json(scheduler);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const patchSchema = insertOutreachSchedulerSchema.partial().extend({
        facility: insertOutreachSchedulerSchema.shape.facility.refine(
          (f) => (VALID_FACILITIES as readonly string[]).includes(f),
          { message: "facility must be one of the three valid clinics" },
        ).optional(),
        capacityPercent: insertOutreachSchedulerSchema.shape.capacityPercent
          .refine((n) => n != null && n >= 0 && n <= 100, { message: "capacityPercent must be between 0 and 100" })
          .optional(),
      });
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No fields provided to update" });
      const updated = await storage.updateOutreachScheduler(id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Scheduler not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Outreach Calls ─────────────────────────────────────────────────────────

  app.post("/api/outreach/calls", async (req, res) => {
    try {
      const userId = sessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const parsed = insertOutreachCallSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const patient = await storage.getPatientScreening(parsed.data.patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient screening not found" });

      const prior = await storage.listOutreachCallsForPatient(parsed.data.patientScreeningId);
      const attemptNumber = parsed.data.attemptNumber ?? prior.length + 1;
      const desiredStatus = deriveAppointmentStatus(parsed.data.outcome);

      // Authorization:
      //   • Admins may write any disposition for any patient and may attribute
      //     the call to any scheduler (via body.schedulerUserId).
      //   • Non-admins must be the scheduler currently assigned to this
      //     patient's batch. They cannot impersonate another scheduler — their
      //     attribution is always the session user.
      //   • Patients with no assigned scheduler are admin-only to log against,
      //     to avoid drive-by disposition writes from any team member.
      const isAdmin = sessionRole(req) === "admin";
      if (!isAdmin) {
        const assignedUserId = await getAssignedSchedulerUserIdForPatient(
          parsed.data.patientScreeningId,
        );
        if (!assignedUserId || assignedUserId !== userId) {
          return res
            .status(403)
            .json({ error: "Not authorized to log calls for this patient" });
        }
      }
      const attributedScheduler =
        isAdmin && parsed.data.schedulerUserId
          ? parsed.data.schedulerUserId
          : userId;

      // Atomic: insert call + conditional status update in one transaction.
      const call = await storage.createOutreachCallAtomic(
        {
          ...parsed.data,
          schedulerUserId: attributedScheduler,
          attemptNumber,
        },
        desiredStatus,
      );

      res.status(201).json(call);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to create call" });
    }
  });

  app.get("/api/outreach/calls", async (req, res) => {
    try {
      if (!sessionUserId(req)) return res.status(401).json({ error: "Not authenticated" });
      const patientScreeningIdStr = String(req.query.patientScreeningId ?? "");
      const patientScreeningId = parseInt(patientScreeningIdStr, 10);
      if (!Number.isFinite(patientScreeningId)) {
        return res.status(400).json({ error: "patientScreeningId required" });
      }
      const calls = await storage.listOutreachCallsForPatient(patientScreeningId);
      res.json(calls);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list calls" });
    }
  });

  // Bulk: ?ids=1,2,3 → { [patientScreeningId]: OutreachCall[] }
  app.get("/api/outreach/calls/by-patients", async (req, res) => {
    try {
      if (!sessionUserId(req)) return res.status(401).json({ error: "Not authenticated" });
      const idsStr = String(req.query.ids ?? "");
      const ids = idsStr
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) return res.json({});
      const all = await storage.listOutreachCallsForPatients(ids);
      const grouped: Record<number, typeof all> = {};
      for (const id of ids) grouped[id] = [];
      for (const c of all) (grouped[c.patientScreeningId] ??= []).push(c);
      // Calls are already returned ordered desc by startedAt by the storage layer.
      res.json(grouped);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list calls" });
    }
  });

  app.get("/api/outreach/calls/today", async (req, res) => {
    try {
      const sessionId = sessionUserId(req);
      if (!sessionId) return res.status(401).json({ error: "Not authenticated" });
      // Only admins may query another scheduler's calls; everyone else is
      // forced to their own session id (prevents cross-user PII exposure).
      // Spec uses `schedulerId`; we also accept `schedulerUserId` for backward compat.
      const requested = String(req.query.schedulerId ?? req.query.schedulerUserId ?? "");
      const isAdmin = sessionRole(req) === "admin";
      const userId = (isAdmin && requested) ? requested : sessionId;
      const today = new Date().toISOString().slice(0, 10);
      const calls = await storage.listOutreachCallsForSchedulerToday(userId, today);
      res.json(calls);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list calls" });
    }
  });

  app.delete("/api/outreach/schedulers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const deleted = await storage.deleteOutreachScheduler(id);
      if (!deleted) return res.status(404).json({ error: "Scheduler not found" });
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

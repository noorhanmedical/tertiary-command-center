import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientExecutionCases,
  patientJourneyEvents,
  outreachSchedulers,
  ptoRequests,
} from "@shared/schema";

// Engagement-assignment routes.
//
// Reads + writes through the canonical `patient_execution_cases`
// table — no new assignment store is created. The frontend
// EngagementAssignmentBadge calls these to show the current owner
// and to change it.
//
//   GET  /api/patients/:id/engagement-assignment
//   GET  /api/patients/:id/engagement-assignment/options
//   POST /api/patients/:id/engagement-assignment

const changeAssignmentSchema = z.object({
  schedulerId: z.number().int().positive(),
  reason: z.string().optional(),
});

async function loadExecutionCaseForPatient(patientScreeningId: number) {
  const [row] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, patientScreeningId))
    .orderBy(desc(patientExecutionCases.id))
    .limit(1);
  return row ?? null;
}

async function resolveSchedulerById(schedulerId: number) {
  const all = await storage.getOutreachSchedulers();
  return all.find((s) => s.id === schedulerId) ?? null;
}

export function registerEngagementAssignmentRoutes(app: Express) {
  // ─── Current assignment for the patient ────────────────────────────
  app.get(
    "/api/patients/:id/engagement-assignment",
    async (req: Request, res: Response) => {
      const pid = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      try {
        const patient = await storage.getPatientScreening(pid);
        if (!patient) return res.status(404).json({ error: "Patient not found" });
        const execCase = await loadExecutionCaseForPatient(pid);
        let scheduler: { id: number; name: string; facility: string } | null = null;
        if (execCase?.assignedTeamMemberId != null) {
          const found = await resolveSchedulerById(execCase.assignedTeamMemberId);
          if (found) {
            scheduler = {
              id: found.id,
              name: found.name,
              facility: found.facility,
            };
          }
        }
        res.json({
          patientScreeningId: pid,
          executionCaseId: execCase?.id ?? null,
          commitStatus: patient.commitStatus,
          engagementStatus: execCase?.engagementStatus ?? null,
          engagementBucket: execCase?.engagementBucket ?? null,
          assignedRole: execCase?.assignedRole ?? null,
          assignedTeamMemberId: execCase?.assignedTeamMemberId ?? null,
          scheduler,
        });
      } catch (error: unknown) {
        console.error(
          "[engagement-assignment:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load assignment",
        });
      }
    },
  );

  // ─── Eligible scheduler options (facility-preferred) ──────────────
  app.get(
    "/api/patients/:id/engagement-assignment/options",
    async (req: Request, res: Response) => {
      const pid = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      try {
        const patient = await storage.getPatientScreening(pid);
        if (!patient) return res.status(404).json({ error: "Patient not found" });
        const schedulers = await storage.getOutreachSchedulers();
        const patientFacility = (patient.facility ?? "").trim();

        // PTO-awareness: any scheduler whose linked userId has an
        // approved PTO request covering today is flagged + demoted to
        // the bottom of the ranking. They are not removed — the
        // operator may still need to assign them — but they sort
        // last so the default choice is always an available teammate.
        const today = new Date().toISOString().slice(0, 10);
        const userIds = schedulers
          .map((s) => s.userId)
          .filter((id): id is string => !!id);
        const ptoSetForToday = new Set<string>();
        if (userIds.length > 0) {
          const ptoRows = await db
            .select({ userId: ptoRequests.userId })
            .from(ptoRequests)
            .where(
              and(
                eq(ptoRequests.status, "approved"),
                lte(ptoRequests.startDate, today),
                gte(ptoRequests.endDate, today),
              ),
            );
          for (const r of ptoRows) ptoSetForToday.add(r.userId);
        }

        const ranked = [...schedulers].sort((a, b) => {
          const aPto = a.userId && ptoSetForToday.has(a.userId) ? 1 : 0;
          const bPto = b.userId && ptoSetForToday.has(b.userId) ? 1 : 0;
          if (aPto !== bPto) return aPto - bPto;
          const aFac = a.facility === patientFacility ? 0 : 1;
          const bFac = b.facility === patientFacility ? 0 : 1;
          if (aFac !== bFac) return aFac - bFac;
          if (b.capacityPercent !== a.capacityPercent) {
            return b.capacityPercent - a.capacityPercent;
          }
          return a.name.localeCompare(b.name);
        });
        res.json({
          patientFacility,
          schedulers: ranked.map((s) => ({
            id: s.id,
            name: s.name,
            facility: s.facility,
            capacityPercent: s.capacityPercent,
            matchesFacility: s.facility === patientFacility,
            onPtoToday: !!(s.userId && ptoSetForToday.has(s.userId)),
          })),
        });
      } catch (error: unknown) {
        console.error(
          "[engagement-assignment:options] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load options",
        });
      }
    },
  );

  // ─── Change the assignment ────────────────────────────────────────
  app.post(
    "/api/patients/:id/engagement-assignment",
    async (req: Request, res: Response) => {
      const pid = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({ error: "Invalid patient id" });
      }
      const parsed = changeAssignmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const patient = await storage.getPatientScreening(pid);
        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const newScheduler = await resolveSchedulerById(parsed.data.schedulerId);
        if (!newScheduler) {
          return res.status(404).json({ error: "Scheduler not found" });
        }

        const execCase = await loadExecutionCaseForPatient(pid);
        if (!execCase) {
          return res
            .status(409)
            .json({ error: "Patient has no engagement case yet — commit first" });
        }

        const previousSchedulerId = execCase.assignedTeamMemberId ?? null;
        let previousScheduler:
          | { id: number; name: string; facility: string }
          | null = null;
        if (previousSchedulerId != null) {
          const found = await resolveSchedulerById(previousSchedulerId);
          if (found) {
            previousScheduler = {
              id: found.id,
              name: found.name,
              facility: found.facility,
            };
          }
        }

        // Preserve strong engagement states; otherwise mark assigned so
        // the case shows up in the scheduler's call list right away.
        const NEW_STATES = new Set(["new", "ready", "assigned", "not_reached"]);
        const nextEngagementStatus = NEW_STATES.has(execCase.engagementStatus ?? "")
          ? "assigned"
          : execCase.engagementStatus;

        const [updated] = await db
          .update(patientExecutionCases)
          .set({
            assignedTeamMemberId: newScheduler.id,
            assignedRole: "scheduler",
            engagementStatus: nextEngagementStatus,
          })
          .where(eq(patientExecutionCases.id, execCase.id))
          .returning();

        // Audit on the canonical timeline.
        await db.insert(patientJourneyEvents).values({
          patientScreeningId: pid,
          executionCaseId: execCase.id,
          actorUserId: (req.session as any)?.userId ?? null,
          patientName: patient.name,
          patientDob: patient.dob ?? null,
          eventType: "engagement_assignment_changed",
          eventSource: "manual_assignment_change",
          summary: `Engagement assignment changed to ${newScheduler.name}`,
          metadata: {
            previousSchedulerId,
            previousSchedulerName: previousScheduler?.name ?? null,
            newSchedulerId: newScheduler.id,
            newSchedulerName: newScheduler.name,
            reason: parsed.data.reason ?? null,
          },
        });

        res.json({
          ok: true,
          assignedTeamMemberId: updated.assignedTeamMemberId,
          assignedRole: updated.assignedRole,
          engagementStatus: updated.engagementStatus,
          scheduler: {
            id: newScheduler.id,
            name: newScheduler.name,
            facility: newScheduler.facility,
          },
        });
      } catch (error: unknown) {
        console.error(
          "[engagement-assignment:post] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to change assignment",
        });
      }
    },
  );
}

// suppress unused warning if `asc` ends up not used in future variants
void asc;
void and;

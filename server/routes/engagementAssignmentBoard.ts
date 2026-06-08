import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientExecutionCases,
  patientJourneyEvents,
  patientScreenings,
  screeningBatches,
  outreachSchedulers,
} from "@shared/schema";

// Engagement Assignment Board — read + write endpoints powering the
// new "Assignments" surface in Engagement Center. The board is the
// single place an Engagement manager can see every patient that has
// been sent to Engagement and (re)assign team members in bulk.
//
// Everything reads/writes through the canonical spine:
//   - patient_execution_cases (assignment, engagement bucket/status)
//   - patient_screenings + screening_batches (identity + facility/date)
//   - outreach_schedulers (display name + facility for the assignee)
//   - patient_journey_events (audit trail; every change appends)
//
// No new assignment table. No parallel call-list store. The team
// member portal's call list already filters by
// patient_execution_cases.assignedTeamMemberId, so assignments made
// here flow into the right team member's queue immediately.

type BoardRow = {
  patientScreeningId: number | null;
  executionCaseId: number;
  patientName: string;
  patientDob: string | null;
  phoneNumber: string | null;
  facility: string | null;
  scheduleDate: string | null;
  patientType: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  commitStatus: string | null;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  assignedName: string | null;
  assignedFacility: string | null;
  nextActionAt: string | null;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  missingInfo: string[];
  selectedServices: string[];
};

const assignBoardSchema = z.object({
  patientScreeningIds: z.array(z.number().int().positive()).min(1),
  schedulerId: z.number().int().positive(),
  assignedRole: z
    .enum(["scheduler", "patientCareSpecialist", "ancillaryCareSpecialist"])
    .optional(),
  reason: z.string().optional(),
});

// Engagement Center delete removes assignment not patient record.
// Cancel-many flips patient_execution_cases.lifecycleStatus +
// engagementStatus to cancelled and appends a journey-event row;
// the underlying patient_screenings row stays intact so the patient
// can be reopened/recommitted later from Plexus IQ.
//
// SOURCE MARKER: Engagement Center delete removes assignment not patient record
// SOURCE MARKER: Engagement Center delete all is scoped to current group
const cancelManySchema = z.object({
  executionCaseIds: z.array(z.number().int().positive()).min(1),
  reason: z.string().optional(),
});

function computeMissingInfo(
  screening: typeof patientScreenings.$inferSelect | undefined,
): string[] {
  const out: string[] = [];
  if (!screening) return ["patient_record"];
  if (!screening.name?.trim()) out.push("name");
  if (!screening.dob?.trim()) out.push("DOB");
  if (!screening.phoneNumber?.trim()) out.push("phone");
  if (!screening.facility?.trim()) out.push("facility");
  return out;
}

export function registerEngagementAssignmentBoardRoutes(app: Express) {
  // ─── Board read model ─────────────────────────────────────────────
  app.get(
    "/api/engagement/assignment-board",
    async (req: Request, res: Response) => {
      try {
        const q = ((req.query.q as string) ?? "").trim().toLowerCase();
        const facilityParam = ((req.query.facility as string) ?? "").trim();
        const assignedFilter = req.query.assignedTeamMemberId;
        const engagementStatusFilter = ((req.query.engagementStatus as string) ?? "").trim();
        const engagementBucketFilter = ((req.query.engagementBucket as string) ?? "").trim();
        const patientTypeFilter = ((req.query.patientType as string) ?? "").trim();
        const unassignedOnly = String(req.query.unassignedOnly ?? "") === "1";
        const missingInfoOnly = String(req.query.missingInfoOnly ?? "") === "1";

        // Pull every active engagement case. Closed/archived cases
        // are filtered out so the board reflects live workload only.
        const cases = await db
          .select()
          .from(patientExecutionCases)
          .where(
            and(
              or(
                isNull(patientExecutionCases.lifecycleStatus),
                eq(patientExecutionCases.lifecycleStatus, "active"),
              ),
              or(
                isNull(patientExecutionCases.engagementStatus),
                sql`${patientExecutionCases.engagementStatus} NOT IN ('archived','closed','cancelled','completed')`,
              ),
            ),
          );

        if (cases.length === 0) {
          return res.json({
            rows: [],
            summary: {
              total: 0,
              assigned: 0,
              unassigned: 0,
              needsInfo: 0,
              byFacility: [],
              byAssignedTeamMember: [],
              byEngagementStatus: [],
            },
          });
        }

        const screeningIds = Array.from(
          new Set(
            cases
              .map((c) => c.patientScreeningId)
              .filter((id): id is number => id != null),
          ),
        );
        const screenings = screeningIds.length
          ? await db
              .select()
              .from(patientScreenings)
              .where(
                and(
                  inArray(patientScreenings.id, screeningIds),
                  isNull(patientScreenings.deletedAt),
                ),
              )
          : [];
        const screeningById = new Map(screenings.map((s) => [s.id, s]));

        const batchIds = Array.from(
          new Set(
            screenings.map((s) => s.batchId).filter((id): id is number => id != null),
          ),
        );
        const batches = batchIds.length
          ? await db
              .select()
              .from(screeningBatches)
              .where(inArray(screeningBatches.id, batchIds))
          : [];
        const batchById = new Map(batches.map((b) => [b.id, b]));

        const allSchedulers = await storage.getOutreachSchedulers();
        const schedulerById = new Map(allSchedulers.map((s) => [s.id, s]));

        // Latest journey event per case (for lastActivity{At,Summary}).
        const caseIds = cases.map((c) => c.id);
        const journeyByCase = new Map<
          number,
          { createdAt: Date | null; summary: string | null }
        >();
        if (caseIds.length > 0) {
          const journey = await db
            .select({
              executionCaseId: patientJourneyEvents.executionCaseId,
              createdAt: patientJourneyEvents.createdAt,
              summary: patientJourneyEvents.summary,
            })
            .from(patientJourneyEvents)
            .where(inArray(patientJourneyEvents.executionCaseId, caseIds))
            .orderBy(desc(patientJourneyEvents.createdAt));
          for (const e of journey) {
            if (e.executionCaseId == null) continue;
            if (!journeyByCase.has(e.executionCaseId)) {
              journeyByCase.set(e.executionCaseId, {
                createdAt: (e.createdAt as Date | null) ?? null,
                summary: e.summary ?? null,
              });
            }
          }
        }

        const rows: BoardRow[] = cases.map((c) => {
          const screening =
            c.patientScreeningId != null
              ? screeningById.get(c.patientScreeningId)
              : undefined;
          const batch =
            screening?.batchId != null
              ? batchById.get(screening.batchId)
              : undefined;
          const assignedScheduler =
            c.assignedTeamMemberId != null
              ? schedulerById.get(c.assignedTeamMemberId)
              : undefined;
          const latest = journeyByCase.get(c.id);
          const facility =
            screening?.facility ?? batch?.facility ?? c.facilityId ?? null;

          return {
            patientScreeningId: c.patientScreeningId ?? null,
            executionCaseId: c.id,
            patientName: c.patientName ?? screening?.name ?? "Unnamed",
            patientDob: c.patientDob ?? screening?.dob ?? null,
            phoneNumber: screening?.phoneNumber ?? null,
            facility,
            scheduleDate: batch?.scheduleDate ?? null,
            patientType: screening?.patientType ?? null,
            engagementBucket: c.engagementBucket ?? null,
            engagementStatus: c.engagementStatus ?? null,
            commitStatus: screening?.commitStatus ?? null,
            assignedTeamMemberId: c.assignedTeamMemberId ?? null,
            assignedRole: c.assignedRole ?? null,
            assignedName: assignedScheduler?.name ?? null,
            assignedFacility: assignedScheduler?.facility ?? null,
            nextActionAt: c.nextActionAt
              ? new Date(c.nextActionAt as unknown as string).toISOString()
              : null,
            lastActivityAt: latest?.createdAt
              ? new Date(latest.createdAt).toISOString()
              : null,
            lastActivitySummary: latest?.summary ?? null,
            missingInfo: computeMissingInfo(screening),
            selectedServices: Array.isArray(c.selectedServices)
              ? (c.selectedServices as string[])
              : [],
          };
        });

        // Filtering
        let filtered = rows;
        if (q) {
          filtered = filtered.filter(
            (r) =>
              r.patientName.toLowerCase().includes(q) ||
              (r.patientDob ?? "").toLowerCase().includes(q) ||
              (r.facility ?? "").toLowerCase().includes(q),
          );
        }
        if (facilityParam) {
          filtered = filtered.filter((r) => (r.facility ?? "") === facilityParam);
        }
        if (assignedFilter != null && assignedFilter !== "") {
          const asNum = Number.parseInt(String(assignedFilter), 10);
          if (Number.isFinite(asNum)) {
            filtered = filtered.filter((r) => r.assignedTeamMemberId === asNum);
          }
        }
        if (engagementStatusFilter) {
          filtered = filtered.filter(
            (r) => (r.engagementStatus ?? "") === engagementStatusFilter,
          );
        }
        if (engagementBucketFilter) {
          filtered = filtered.filter(
            (r) => (r.engagementBucket ?? "") === engagementBucketFilter,
          );
        }
        if (patientTypeFilter) {
          filtered = filtered.filter((r) => (r.patientType ?? "") === patientTypeFilter);
        }
        if (unassignedOnly) {
          filtered = filtered.filter((r) => r.assignedTeamMemberId == null);
        }
        if (missingInfoOnly) {
          filtered = filtered.filter((r) => r.missingInfo.length > 0);
        }

        // Default sort: unassigned first, then nearest nextActionAt
        // ascending, then most-recent lastActivityAt descending.
        filtered.sort((a, b) => {
          const aAssigned = a.assignedTeamMemberId != null ? 1 : 0;
          const bAssigned = b.assignedTeamMemberId != null ? 1 : 0;
          if (aAssigned !== bAssigned) return aAssigned - bAssigned;
          const aNext = a.nextActionAt ?? "";
          const bNext = b.nextActionAt ?? "";
          if (aNext !== bNext) {
            if (!aNext) return 1;
            if (!bNext) return -1;
            return aNext.localeCompare(bNext);
          }
          const aLast = a.lastActivityAt ?? "";
          const bLast = b.lastActivityAt ?? "";
          return bLast.localeCompare(aLast);
        });

        const byFacilityMap = new Map<string, number>();
        const byAssignedMap = new Map<string, number>();
        const byStatusMap = new Map<string, number>();
        let assigned = 0;
        let unassigned = 0;
        let needsInfo = 0;
        for (const r of filtered) {
          const fac = r.facility ?? "(no facility)";
          byFacilityMap.set(fac, (byFacilityMap.get(fac) ?? 0) + 1);
          const ass = r.assignedName ?? "(unassigned)";
          byAssignedMap.set(ass, (byAssignedMap.get(ass) ?? 0) + 1);
          const st = r.engagementStatus ?? "(unknown)";
          byStatusMap.set(st, (byStatusMap.get(st) ?? 0) + 1);
          if (r.assignedTeamMemberId != null) assigned += 1;
          else unassigned += 1;
          if (r.missingInfo.length > 0) needsInfo += 1;
        }

        res.json({
          rows: filtered,
          summary: {
            total: filtered.length,
            assigned,
            unassigned,
            needsInfo,
            byFacility: Array.from(byFacilityMap, ([facility, count]) => ({
              facility,
              count,
            })),
            byAssignedTeamMember: Array.from(byAssignedMap, ([name, count]) => ({
              name,
              count,
            })),
            byEngagementStatus: Array.from(byStatusMap, ([status, count]) => ({
              status,
              count,
            })),
          },
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/assignment-board:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load board",
        });
      }
    },
  );

  // ─── Bulk / single assignment ─────────────────────────────────────
  app.post(
    "/api/engagement/assignment-board/assign",
    async (req: Request, res: Response) => {
      const parsed = assignBoardSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const { patientScreeningIds, schedulerId, assignedRole, reason } =
          parsed.data;

        const allSchedulers = await storage.getOutreachSchedulers();
        const newScheduler = allSchedulers.find((s) => s.id === schedulerId);
        if (!newScheduler) {
          return res.status(404).json({ error: "Scheduler not found" });
        }
        const role = assignedRole ?? "scheduler";

        const updated: Array<{
          patientScreeningId: number;
          executionCaseId: number;
          previousSchedulerId: number | null;
          previousSchedulerName: string | null;
        }> = [];
        const failed: Array<{ patientScreeningId: number; reason: string }> = [];

        for (const pid of patientScreeningIds) {
          const patient = await storage.getPatientScreening(pid);
          if (!patient) {
            failed.push({ patientScreeningId: pid, reason: "Patient not found" });
            continue;
          }
          const [execCase] = await db
            .select()
            .from(patientExecutionCases)
            .where(eq(patientExecutionCases.patientScreeningId, pid))
            .orderBy(desc(patientExecutionCases.id))
            .limit(1);
          if (!execCase) {
            failed.push({
              patientScreeningId: pid,
              reason: "Patient has no engagement case yet — commit first",
            });
            continue;
          }
          const previousSchedulerId = execCase.assignedTeamMemberId ?? null;
          const previousScheduler =
            previousSchedulerId != null
              ? allSchedulers.find((s) => s.id === previousSchedulerId) ?? null
              : null;

          const NEW_STATES = new Set(["new", "ready", "assigned", "not_reached"]);
          const nextEngagementStatus = NEW_STATES.has(
            execCase.engagementStatus ?? "",
          )
            ? "assigned"
            : execCase.engagementStatus;

          await db
            .update(patientExecutionCases)
            .set({
              assignedTeamMemberId: newScheduler.id,
              assignedRole: role,
              engagementStatus: nextEngagementStatus,
            })
            .where(eq(patientExecutionCases.id, execCase.id));

          await db.insert(patientJourneyEvents).values({
            patientScreeningId: pid,
            executionCaseId: execCase.id,
            actorUserId: (req.session as any)?.userId ?? null,
            patientName: patient.name,
            patientDob: patient.dob ?? null,
            eventType: "engagement_assignment_changed",
            eventSource: "engagement_assignment_board",
            summary: `Assigned to ${newScheduler.name} from Engagement Center`,
            metadata: {
              previousSchedulerId,
              previousSchedulerName: previousScheduler?.name ?? null,
              previousSchedulerFacility: previousScheduler?.facility ?? null,
              newSchedulerId: newScheduler.id,
              newSchedulerName: newScheduler.name,
              newSchedulerFacility: newScheduler.facility,
              assignedRole: role,
              reason: reason ?? null,
              batch: patientScreeningIds.length > 1,
            },
          });

          updated.push({
            patientScreeningId: pid,
            executionCaseId: execCase.id,
            previousSchedulerId,
            previousSchedulerName: previousScheduler?.name ?? null,
          });
        }

        res.json({
          ok: failed.length === 0,
          updated,
          failed,
          summary: {
            requested: patientScreeningIds.length,
            updated: updated.length,
            failed: failed.length,
            schedulerId: newScheduler.id,
            schedulerName: newScheduler.name,
            schedulerFacility: newScheduler.facility,
            assignedRole: role,
          },
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/assignment-board:assign] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to bulk assign",
        });
      }
    },
  );

  // ─── Bulk cancel / delete group ───────────────────────────────────
  //
  // Removes the assignment + closes the execution case for the
  // supplied execution case IDs. Does NOT delete the underlying
  // patient_screenings row — Plexus IQ can still see / re-commit /
  // re-import the patient. Mirrors the assign-many envelope:
  // appends a journey-event row per case so the audit trail
  // documents who cancelled the assignment and when.
  app.post(
    "/api/engagement/assignment-board/cancel-many",
    async (req: Request, res: Response) => {
      const parsed = cancelManySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      try {
        const { executionCaseIds, reason } = parsed.data;
        const cancelled: Array<{
          executionCaseId: number;
          patientScreeningId: number | null;
          previousEngagementStatus: string | null;
          previousLifecycleStatus: string | null;
        }> = [];
        const failed: Array<{ executionCaseId: number; reason: string }> = [];

        for (const caseId of executionCaseIds) {
          const [execCase] = await db
            .select()
            .from(patientExecutionCases)
            .where(eq(patientExecutionCases.id, caseId))
            .limit(1);
          if (!execCase) {
            failed.push({ executionCaseId: caseId, reason: "Execution case not found" });
            continue;
          }
          const previousEngagementStatus = execCase.engagementStatus ?? null;
          const previousLifecycleStatus = execCase.lifecycleStatus ?? null;
          await db
            .update(patientExecutionCases)
            .set({
              engagementStatus: "cancelled",
              lifecycleStatus: "cancelled",
              assignedTeamMemberId: null,
            })
            .where(eq(patientExecutionCases.id, caseId));

          try {
            await db.insert(patientJourneyEvents).values({
              patientScreeningId: execCase.patientScreeningId ?? null,
              executionCaseId: execCase.id,
              actorUserId: (req.session as any)?.userId ?? null,
              patientName: execCase.patientName ?? null,
              patientDob: execCase.patientDob ?? null,
              eventType: "engagement_assignment_cancelled",
              eventSource: "engagement_assignment_board",
              summary: `Engagement assignment cancelled from Engagement Center`,
              metadata: {
                previousEngagementStatus,
                previousLifecycleStatus,
                reason: reason ?? null,
                batch: executionCaseIds.length > 1,
              },
            });
          } catch (auditErr) {
            console.error(
              "[engagement/assignment-board:cancel-many] audit append failed:",
              auditErr instanceof Error ? auditErr.message : auditErr,
            );
          }

          cancelled.push({
            executionCaseId: execCase.id,
            patientScreeningId: execCase.patientScreeningId ?? null,
            previousEngagementStatus,
            previousLifecycleStatus,
          });
        }

        res.json({
          ok: failed.length === 0,
          cancelled,
          failed,
          summary: {
            requested: executionCaseIds.length,
            cancelled: cancelled.length,
            failed: failed.length,
          },
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/assignment-board:cancel-many] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to cancel assignments",
        });
      }
    },
  );

  // suppress unused warnings for narrow type imports in future variants
  void outreachSchedulers;
}

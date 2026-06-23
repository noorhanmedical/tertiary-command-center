import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientExecutionCases,
  patientJourneyEvents,
  patientScreenings,
  screeningBatches,
  outreachSchedulers,
} from "@shared/schema";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import { calculateNextActionAt } from "../services/callList/nextActionPolicy";

// No-duplicate-scheduler-per-date guard.
//
// Two schedulers cannot both have the same patient assigned for the
// same scheduleDate. The same patient (matched by name + DOB) may
// have multiple patient_execution_cases rows because BatchFlow can
// re-import the same person across batches. The guard below walks
// every sibling active execution case for the same name/DOB and
// rejects an assignment that would create divergence across
// different schedulers on the same date.
//
// Outreach (scheduleDate == null) is intentionally skipped — there
// is no "same date" anchor to enforce on outreach lists.
//
// SOURCE MARKER: Two schedulers cannot share the same patient for the same date
// SOURCE MARKER: Duplicate scheduler per date guard
async function findConflictingActiveAssignment(
  excludeExecutionCaseId: number,
  patientName: string | null | undefined,
  patientDob: string | null | undefined,
  scheduleDate: string | null,
  proposedSchedulerId: number,
): Promise<
  | { schedulerId: number; schedulerName: string | null; otherExecutionCaseId: number; scheduleDate: string }
  | null
> {
  if (!scheduleDate) return null;
  const normalizedName = (patientName ?? "").trim().toLowerCase();
  if (!normalizedName) return null;
  // Active sibling cases for the same person already assigned to a
  // DIFFERENT scheduler. We still have to confirm the scheduleDate
  // matches by joining the screening's batch (the execution case
  // itself doesn't carry the date).
  const candidates = await db
    .select({
      id: patientExecutionCases.id,
      patientScreeningId: patientExecutionCases.patientScreeningId,
      assignedTeamMemberId: patientExecutionCases.assignedTeamMemberId,
    })
    .from(patientExecutionCases)
    .where(
      and(
        ne(patientExecutionCases.id, excludeExecutionCaseId),
        eq(sql`lower(${patientExecutionCases.patientName})`, normalizedName),
        patientDob
          ? eq(patientExecutionCases.patientDob, patientDob)
          : isNull(patientExecutionCases.patientDob),
        or(
          isNull(patientExecutionCases.lifecycleStatus),
          eq(patientExecutionCases.lifecycleStatus, "active"),
        ),
        isNotNull(patientExecutionCases.assignedTeamMemberId),
        ne(patientExecutionCases.assignedTeamMemberId, proposedSchedulerId),
      ),
    );
  if (candidates.length === 0) return null;
  const allSchedulers = await storage.getOutreachSchedulers();
  for (const c of candidates) {
    if (c.patientScreeningId == null) continue;
    const screening = await storage.getPatientScreening(c.patientScreeningId);
    if (!screening) continue;
    const batch = await storage.getScreeningBatch(screening.batchId);
    if (!batch?.scheduleDate) continue;
    if (batch.scheduleDate !== scheduleDate) continue;
    const conflictScheduler = allSchedulers.find(
      (s) => s.id === c.assignedTeamMemberId,
    );
    return {
      schedulerId: c.assignedTeamMemberId as number,
      schedulerName: conflictScheduler?.name ?? null,
      otherExecutionCaseId: c.id,
      scheduleDate,
    };
  }
  return null;
}

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

// Board-row shape lives in the shared contract so the client + server
// agree on one canonical type. See shared/contracts/engagementBoard.ts.
import type { EngagementBoardRow as BoardRow } from "@shared/contracts/engagementBoard";

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

  // ─── Per-day assignment target (additive, admin-only) ─────────────
  // Sets outreach_schedulers.daily_target for one roster member. This
  // is a soft planning number surfaced in the workspace — it does not
  // change how assignments are routed, so it is fully additive and
  // behind the existing assignment flow.
  app.patch(
    "/api/engagement/assignment-board/team-members/:schedulerId/daily-target",
    async (req: Request, res: Response) => {
      if ((req.session.role ?? "") !== "admin") {
        return res.status(403).json({ error: "Admin only", code: "forbidden" });
      }
      const schedulerId = Number(req.params.schedulerId);
      if (!Number.isInteger(schedulerId) || schedulerId <= 0) {
        return res
          .status(400)
          .json({ error: "Invalid schedulerId", code: "bad_request" });
      }
      const parsed = z
        .object({ dailyTarget: z.number().int().min(0).nullable() })
        .safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "dailyTarget must be a non-negative integer or null", code: "bad_request" });
      }
      const updated = await storage.updateOutreachScheduler(schedulerId, {
        dailyTarget: parsed.data.dailyTarget,
      });
      if (!updated) {
        return res
          .status(404)
          .json({ error: "Team member not found", code: "not_found" });
      }
      return res.json({
        id: updated.id,
        name: updated.name,
        facility: updated.facility,
        dailyTarget: updated.dailyTarget ?? null,
      });
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

        // Option 2 visibility: the assigned work only appears in the Team
        // Member Portal call list (/api/operational-queue/me) when the
        // scheduler row is linked to a login via outreach_schedulers.user_id.
        // Surface this up-front so the Engagement Center can warn the user.
        const visibility: "visible" | "missing_user_mapping" =
          (newScheduler as { userId?: string | null }).userId
            ? "visible"
            : "missing_user_mapping";

        const updated: Array<{
          patientScreeningId: number;
          executionCaseId: number;
          previousSchedulerId: number | null;
          previousSchedulerName: string | null;
          nextActionAt: string | null;
          visibility: "visible" | "missing_user_mapping";
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
          // No-duplicate-scheduler-per-date guard. If a sibling
          // execution case for the same patient (by name + DOB) on
          // the same scheduleDate is already assigned to a
          // different scheduler, reject this assignment so two
          // schedulers cannot both have the same patient for the
          // same date.
          // SOURCE MARKER: Two schedulers cannot share the same patient for the same date
          const batch = await storage.getScreeningBatch(patient.batchId);
          const scheduleDate = batch?.scheduleDate ?? null;
          const conflict = await findConflictingActiveAssignment(
            execCase.id,
            patient.name,
            patient.dob ?? null,
            scheduleDate,
            newScheduler.id,
          );
          if (conflict) {
            failed.push({
              patientScreeningId: pid,
              reason: `Already assigned to ${conflict.schedulerName ?? "another scheduler"} for ${conflict.scheduleDate}. Two schedulers cannot share the same patient for the same date.`,
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

          // Option 2 (§2 + §4): set next_action_at via the shared policy so the
          // case surfaces on the call list immediately. A pending future
          // callback (e.g. a prior disposition) is preserved instead of being
          // pulled forward; otherwise the fresh assignment surfaces now.
          const now = new Date();
          const existingNext = execCase.nextActionAt
            ? new Date(execCase.nextActionAt as unknown as string)
            : null;
          const existingFuture =
            existingNext && !Number.isNaN(existingNext.getTime()) && existingNext.getTime() > now.getTime()
              ? existingNext
              : null;
          const { nextActionAt: policyNext } = calculateNextActionAt({
            isAssignment: true,
            now,
          });
          const nextActionAt = existingFuture ?? policyNext;

          await db
            .update(patientExecutionCases)
            .set({
              assignedTeamMemberId: newScheduler.id,
              assignedRole: role,
              engagementStatus: nextEngagementStatus,
              nextActionAt: nextActionAt ?? undefined,
              updatedAt: now,
            })
            .where(eq(patientExecutionCases.id, execCase.id));

          await appendJourneyEvent({
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
              nextActionAt: nextActionAt ? nextActionAt.toISOString() : null,
              callListVisibility: visibility,
            },
          });

          updated.push({
            patientScreeningId: pid,
            executionCaseId: execCase.id,
            previousSchedulerId,
            previousSchedulerName: previousScheduler?.name ?? null,
            nextActionAt: nextActionAt ? nextActionAt.toISOString() : null,
            visibility,
          });

          // ─── Optional: engagement-board → call-list bridge (Batch 11c) ───
          //
          // Flag-gated BEFORE the dynamic import so production behaviour
          // with the flag off is byte-identical to today (the only added
          // statement is one `process.env[...]` boolean read).
          //
          // When the flag is ON the bridge writes (or finds) the
          // corresponding active scheduler_assignments row so the
          // Scheduler Portal + Team Portal call lists pick up the
          // assignment immediately without waiting for the next morning
          // rebuild. See server/modules/operational-queue/bridge.ts for
          // the safety rules (never throws, never duplicates, never
          // modifies an existing active row).
          const bridgeFlag = process.env.ENGAGEMENT_TO_CALL_LIST_BRIDGE;
          if (bridgeFlag === "1" || bridgeFlag === "true" || bridgeFlag === "yes") {
            try {
              const { bridgeEngagementAssignmentToCallList } = await import(
                "../modules/operational-queue/bridge"
              );
              const outcome = await bridgeEngagementAssignmentToCallList({
                patientScreeningId: pid,
                schedulerId: newScheduler.id,
                reason: reason ?? null,
              });
              console.log(
                "[engagement→call-list bridge]",
                { patientScreeningId: pid, schedulerId: newScheduler.id, outcome: outcome.kind },
              );
            } catch (bridgeErr) {
              console.error(
                "[engagement→call-list bridge] dispatch failed:",
                bridgeErr instanceof Error ? bridgeErr.message : bridgeErr,
              );
              // Never fail the parent engagement-board assignment.
            }
          }
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
            visibility,
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
            await appendJourneyEvent({
              patientScreeningId: execCase.patientScreeningId ?? null,
              executionCaseId: execCase.id,
              actorUserId: (req.session as any)?.userId ?? null,
              patientName: execCase.patientName ?? "",
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

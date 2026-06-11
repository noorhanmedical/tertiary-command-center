import type { Express, Request } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { patientScreenings } from "@shared/schema/screening";
import {
  listExecutionCases,
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
  listJourneyEvents,
  listEngagementCenterCases,
  listSchedulerPortalCases,
  assignEngagementCases,
} from "../repositories/executionCase.repo";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import {
  createSchedulingTriageCase,
  upsertOpenSchedulingTriageCase,
} from "../repositories/schedulingTriage.repo";
import { getGlobalAdminSettingValue } from "../repositories/adminSettings.repo";
import {
  isRecordCallResultEngagementPreviewEnabled,
  runEngagementCallResultPreview,
} from "../services/callResult/recordCallResultEngagementPreviewFlag";
import { isRecordCallResultEngagementDelegateEnabled } from "../services/callResult/recordCallResultEngagementDelegateFlag";
import {
  recordEngagementCallResult,
  type EngagementCallResultInput,
} from "../services/callResult/recordCallResultEngagementExecutor";
import type {
  CallResultExecutionDependencies,
  AppendJourneyEventArgs,
  UpdateExecutionCaseEngagementArgs,
  UpsertTriageCaseArgs,
  CreateFollowUpTaskArgs,
} from "../services/callResult/recordCallResultExecutionAdapter";

/**
 * Outcomes the canonical recordCallResult planner understands. The
 * engagement-route delegation path is restricted to these — non-canonical
 * outcomes (reschedule, cancelled, no_show, patient_requested_call_later,
 * transportation_issue, technician_unavailable, needs_new_date) fall
 * through to the legacy code path even when the delegate flag is ON.
 */
const ENGAGEMENT_DELEGATION_CANONICAL_OUTCOMES = new Set([
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
]);

const assignBodySchema = z.object({
  facilityId: z.string().optional(),
  targetRole: z.enum(["scheduler", "liaison"]),
  limit: z.number().int().min(1).max(250).optional(),
  assignedTeamMemberId: z.number().int().optional(),
  dryRun: z.boolean().optional(),
});

// ─── Call-result canonical writing ─────────────────────────────────────────
//
// Inputs come from the scheduler portal disposition flow. The route resolves
// patient context from one of (executionCaseId | patientScreeningId | name+dob),
// always appends a patient_journey_events row, optionally opens a scheduling
// triage case, optionally creates a plexus task, and updates engagement state
// + ownership on the execution case.

const callResultBodySchema = z.object({
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  patientName: z.string().optional().nullable(),
  patientDob: z.string().optional().nullable(),
  callResult: z.string().min(1),
  callDisposition: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  nextActionAt: z.string().optional().nullable(),
  assignedUserId: z.union([z.string(), z.number()]).optional().nullable(),
  assignedRole: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

const CALL_RESULTS_NEEDING_TRIAGE = new Set([
  "callback", "reschedule", "no_answer", "voicemail", "cancelled", "no_show",
  "needs_new_date", "patient_requested_call_later", "wrong_number", "needs_records",
  "insurance_prior_auth_issue", "transportation_issue", "manager_review",
  "technician_unavailable", "facility_specific_issue",
]);

const CALL_RESULTS_NEEDING_TASK = new Set([
  "manager_review", "insurance_prior_auth_issue", "needs_records",
  "facility_specific_issue", "technician_unavailable",
]);

type TriageMapping = { mainType: string; subtype: string; nextOwnerRole: string };
const TRIAGE_MAPPINGS: Record<string, TriageMapping> = {
  callback:                       { mainType: "callback",                        subtype: "patient_requested_call_later",            nextOwnerRole: "scheduler" },
  patient_requested_call_later:   { mainType: "callback",                        subtype: "patient_requested_call_later",            nextOwnerRole: "scheduler" },
  reschedule:                     { mainType: "reschedule",                      subtype: "needs_new_date",                          nextOwnerRole: "scheduler" },
  needs_new_date:                 { mainType: "reschedule",                      subtype: "needs_new_date",                          nextOwnerRole: "scheduler" },
  cancelled:                      { mainType: "cancellation_recovery",           subtype: "needs_rebooking_after_cancellation",      nextOwnerRole: "scheduler" },
  no_show:                        { mainType: "no_show_recovery",                subtype: "patient_no_showed",                       nextOwnerRole: "scheduler" },
  wrong_number:                   { mainType: "contact_issue",                   subtype: "wrong_number",                            nextOwnerRole: "scheduler" },
  needs_records:                  { mainType: "records_issue",                   subtype: "needs_records",                           nextOwnerRole: "manager" },
  insurance_prior_auth_issue:     { mainType: "insurance_issue",                 subtype: "prior_auth_needed",                       nextOwnerRole: "manager" },
  transportation_issue:           { mainType: "transportation_issue",            subtype: "transportation_barrier",                  nextOwnerRole: "scheduler" },
  technician_unavailable:         { mainType: "technician_liaison_forwarded",    subtype: "technician_unavailable",                  nextOwnerRole: "manager" },
  facility_specific_issue:        { mainType: "facility_issue",                  subtype: "facility_specific_scheduling_issue",      nextOwnerRole: "manager" },
  manager_review:                 { mainType: "manager_review",                  subtype: "manager_review_needed",                   nextOwnerRole: "manager" },
  // Did-not-reach results — surfaced as callbacks so the scheduler queue can
  // requeue them. Not in the explicit task spec mapping; sensible default.
  no_answer:                      { mainType: "callback",                        subtype: "no_answer",                               nextOwnerRole: "scheduler" },
  voicemail:                      { mainType: "callback",                        subtype: "voicemail_left",                          nextOwnerRole: "scheduler" },
};

const TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT = new Set(["completed", "closed", "scheduled"]);

function sessionUserIdFrom(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

export function registerExecutionCaseRoutes(app: Express) {
  // GET /api/execution-cases
  // Filters: engagementBucket, lifecycleStatus, engagementStatus, facilityId,
  //          patientScreeningId, limit (default 100, max 500)
  app.get("/api/execution-cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listExecutionCases>[0] = {};
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      const rows = await listExecutionCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/engagement-center/cases
  // Filters: engagementBucket, facilityId, assignedTeamMemberId, assignedRole,
  //          lifecycleStatus, engagementStatus, qualificationStatus,
  //          limit (default 100, max 500)
  app.get("/api/engagement-center/cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listEngagementCenterCases>[0] = {};
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.assignedTeamMemberId) {
        const id = parseInt(q.assignedTeamMemberId, 10);
        if (!isNaN(id)) filters.assignedTeamMemberId = id;
      }
      if (q.assignedRole) filters.assignedRole = q.assignedRole;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.qualificationStatus) filters.qualificationStatus = q.qualificationStatus;
      const rows = await listEngagementCenterCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/engagement-center/assign
  // Body: { targetRole: "scheduler"|"liaison" (required), facilityId?, limit?,
  //          assignedTeamMemberId?, dryRun? }
  // Selects active qualified execution cases for the role's bucket scope,
  // applies settings-driven priority sorting, and either previews
  // (dryRun=true) or applies the assignment + appends an engagement_assigned
  // journey event per case.
  app.post("/api/engagement-center/assign", async (req, res) => {
    try {
      const parsed = assignBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const result = await assignEngagementCases(parsed.data);
      return res.json({ ok: true, ...result });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // POST /api/engagement-center/call-result
  // Body: callResult (required), executionCaseId?, patientScreeningId?,
  //       patientName?, patientDob?, callDisposition?, note?, nextActionAt?,
  //       assignedUserId?, assignedRole?, facilityId?, metadata?
  // Always appends a `call_result_logged` patient journey event. For
  // scheduling-action results, opens a scheduling_triage case. For
  // manager/team-action results, opens a plexus task. Updates the execution
  // case's engagementStatus/nextActionAt and (subject to ownership settings)
  // assignedTeamMemberId / assignedRole.
  app.post("/api/engagement-center/call-result", async (req, res) => {
    try {
      const actorUserId = sessionUserIdFrom(req);
      const parsed = callResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;

      // Settings (with task-spec defaults)
      const [callbackSetting, mgrReviewSetting, ownershipSetting] = await Promise.all([
        getGlobalAdminSettingValue<{ hours?: number }>("scheduling_triage", "default_callback_due_hours"),
        getGlobalAdminSettingValue<{ required?: boolean }>("scheduling_triage", "manager_review_requires_task"),
        getGlobalAdminSettingValue<{ enabled?: boolean }>("engagement_center", "preserve_scheduler_ownership"),
      ]);
      const callbackHours = typeof callbackSetting?.hours === "number" ? callbackSetting.hours : 24;
      const managerReviewRequiresTask = mgrReviewSetting?.required ?? true;
      const preserveSchedulerOwnership = ownershipSetting?.enabled ?? true;

      // Resolve patient context — executionCaseId → patientScreeningId → name+dob
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let patientName: string | null = data.patientName ?? null;
      let patientDob: string | null = data.patientDob ?? null;
      let facilityId: string | null = data.facilityId ?? null;
      let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;

      if (executionCaseId !== null) {
        const ec = await getExecutionCaseById(executionCaseId);
        if (ec) {
          executionCase = ec;
          if (patientScreeningId === null) patientScreeningId = ec.patientScreeningId ?? null;
          if (!patientName) patientName = ec.patientName;
          if (!patientDob) patientDob = ec.patientDob ?? null;
          if (!facilityId) facilityId = ec.facilityId ?? null;
        }
      }
      if (executionCase === null && patientScreeningId !== null) {
        const ec = await getExecutionCaseByScreeningId(patientScreeningId);
        if (ec) {
          executionCase = ec;
          executionCaseId = ec.id;
          if (!patientName) patientName = ec.patientName;
          if (!patientDob) patientDob = ec.patientDob ?? null;
          if (!facilityId) facilityId = ec.facilityId ?? null;
        }
      }
      if (executionCase === null && patientName && patientDob) {
        const [screening] = await db
          .select()
          .from(patientScreenings)
          .where(and(eq(patientScreenings.name, patientName), eq(patientScreenings.dob, patientDob)))
          .orderBy(desc(patientScreenings.id))
          .limit(1);
        if (screening) {
          patientScreeningId = patientScreeningId ?? screening.id;
          if (!facilityId) facilityId = screening.facility ?? null;
          const ec = await getExecutionCaseByScreeningId(screening.id);
          if (ec) {
            executionCase = ec;
            executionCaseId = ec.id;
            if (!patientName) patientName = ec.patientName;
            if (!patientDob) patientDob = ec.patientDob ?? null;
          }
        }
      }

      if (!patientName) {
        return res.status(400).json({
          error: "Could not resolve patient (provide executionCaseId, patientScreeningId, or patientName + patientDob)",
        });
      }

      // Compute next-action timestamp — explicit value wins, otherwise default
      // to "now + callback hours" only for callback-style results.
      let computedNextActionAt: Date | null = null;
      if (data.nextActionAt) {
        const dt = new Date(data.nextActionAt);
        if (!isNaN(dt.getTime())) computedNextActionAt = dt;
      }
      if (
        !computedNextActionAt &&
        (data.callResult === "callback" || data.callResult === "patient_requested_call_later")
      ) {
        const dt = new Date();
        dt.setHours(dt.getHours() + callbackHours);
        computedNextActionAt = dt;
      }

      // ─── Engagement-route DELEGATION (Batch 3 of Engagement completion run) ──
      //
      // Default-OFF delegate-flag accessor (isRecordCallResultEngagement
      // DelegateEnabled). When enabled AND the outcome is canonical AND
      // patient context resolved,
      // the route delegates to recordEngagementCallResult. The injected deps
      // wrap the SAME storage/writer calls the legacy path makes (so the
      // actual DB effects are byte-equivalent) and capture returned rows
      // for the legacy 6-key response envelope. engagementStatusSemantics:
      // "coarse" matches the legacy non-terminal-> "in_progress" transition.
      //
      // When the flag is OFF, OR the outcome is not in the canonical set,
      // OR patientScreeningId is null, the legacy code path below runs
      // unchanged.
      if (
        isRecordCallResultEngagementDelegateEnabled() &&
        patientScreeningId !== null &&
        ENGAGEMENT_DELEGATION_CANONICAL_OUTCOMES.has(data.callResult)
      ) {
        const delegationJourneyMetadata: Record<string, unknown> = {
          callResult: data.callResult,
          callDisposition: data.callDisposition ?? null,
          note: data.note ?? null,
          nextActionAt: computedNextActionAt ? computedNextActionAt.toISOString() : null,
          assignedUserId: data.assignedUserId ?? null,
          assignedRole: data.assignedRole ?? null,
          facilityId: facilityId ?? null,
          ...(data.metadata ?? {}),
        };

        // Parse assignedTeamCandidate identically to the legacy path so
        // ownership accounting matches.
        const assignedTeamCandidate = (() => {
          if (data.assignedUserId == null) return null;
          const v = typeof data.assignedUserId === "number"
            ? data.assignedUserId
            : parseInt(data.assignedUserId, 10);
          return Number.isFinite(v) ? v : null;
        })();
        const forceReassign =
          (data.metadata && (data.metadata as Record<string, unknown>).forceReassign === true) ||
          !preserveSchedulerOwnership;

        const mapping = TRIAGE_MAPPINGS[data.callResult];
        const managerReviewRequiresTaskHere = managerReviewRequiresTask;
        const needsTriageHere = CALL_RESULTS_NEEDING_TRIAGE.has(data.callResult);
        const needsTaskHere =
          CALL_RESULTS_NEEDING_TASK.has(data.callResult) &&
          (data.callResult !== "manager_review" || managerReviewRequiresTaskHere);

        // Capture targets for the legacy 6-key envelope.
        let delegatedJourneyEvent: Awaited<ReturnType<typeof appendJourneyEvent>> | null = null;
        let delegatedTriageCase: Awaited<ReturnType<typeof createSchedulingTriageCase>> | null = null;
        let delegatedTask: Awaited<ReturnType<typeof storage.createTask>> | null = null;
        let delegatedExecutionCase = executionCase;
        let delegatedOwnershipUpdated = false;

        const deps: CallResultExecutionDependencies = {
          createOutreachCall: () => {
            // engagement-suppressed step; never reached.
          },
          appendJourneyEvent: async (args: AppendJourneyEventArgs) => {
            try {
              delegatedJourneyEvent = await appendJourneyEvent({
                patientName,
                patientDob: patientDob ?? undefined,
                patientScreeningId: patientScreeningId ?? undefined,
                executionCaseId: executionCaseId ?? undefined,
                eventType: args.eventType,
                eventSource: "scheduler_portal",
                actorUserId,
                summary: "call result logged",
                metadata: (args.metadata as Record<string, unknown> | undefined) ?? delegationJourneyMetadata,
              });
            } catch (err: any) {
              console.error("[call-result] journey event append failed:", err.message);
            }
          },
          updateAppointmentStatus: () => {
            // engagement route does not own appointmentStatus updates.
          },
          updateExecutionCaseEngagement: async (args: UpdateExecutionCaseEngagementArgs) => {
            if (!executionCase) return;
            const updates: Record<string, unknown> = { updatedAt: new Date() };
            // Re-apply the legacy "don't overwrite terminal" guard.
            if (
              args.engagementStatus &&
              !TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT.has(executionCase.engagementStatus)
            ) {
              updates.engagementStatus = args.engagementStatus;
            }
            if (args.nextActionAt instanceof Date) {
              updates.nextActionAt = args.nextActionAt;
            }
            if (args.assignedRole && args.assignedRole !== executionCase.assignedRole) {
              updates.assignedRole = args.assignedRole;
            }
            // Re-apply ownership-preservation guard.
            if (assignedTeamCandidate !== null) {
              if (executionCase.assignedTeamMemberId == null || forceReassign) {
                updates.assignedTeamMemberId = assignedTeamCandidate;
                delegatedOwnershipUpdated = true;
              }
            }
            try {
              const [row] = await db
                .update(patientExecutionCases)
                .set(updates)
                .where(eq(patientExecutionCases.id, executionCase.id))
                .returning();
              if (row) delegatedExecutionCase = row;
            } catch (err: any) {
              console.error("[call-result] execution case update failed:", err.message);
            }
          },
          markAssignmentCompleted: () => {
            // engagement-suppressed step.
          },
          upsertTriageCase: async (_args: UpsertTriageCaseArgs) => {
            if (!needsTriageHere || !mapping) return;
            try {
              const result = await upsertOpenSchedulingTriageCase({
                executionCaseId: executionCaseId ?? undefined,
                patientScreeningId: patientScreeningId ?? undefined,
                patientName: patientName ?? undefined,
                patientDob: patientDob ?? undefined,
                facilityId: facilityId ?? undefined,
                mainType: mapping.mainType,
                subtype: mapping.subtype,
                status: "open",
                priority: data.callResult === "manager_review" ? "high" : "normal",
                nextOwnerRole: mapping.nextOwnerRole,
                assignedUserId: typeof data.assignedUserId === "string" ? data.assignedUserId : undefined,
                dueAt: computedNextActionAt ?? undefined,
                note: data.note ?? undefined,
                metadata: {
                  callResult: data.callResult,
                  callDisposition: data.callDisposition ?? null,
                  createdSource: "scheduler_call_result",
                  ...(data.metadata ?? {}),
                },
              });
              delegatedTriageCase = result.row;
            } catch (err: any) {
              console.error("[call-result] triage case upsert failed:", err.message);
            }
          },
          createFollowUpTask: async (_args: CreateFollowUpTaskArgs) => {
            if (!needsTaskHere) return;
            try {
              const assignedToUserId = typeof data.assignedUserId === "string" ? data.assignedUserId : null;
              delegatedTask = await storage.createTask({
                title: `Call result needs follow-up — ${data.callResult}`,
                description: data.note ?? undefined,
                taskType: "task",
                urgency: "EOD",
                priority: data.callResult === "manager_review" ? "high" : "normal",
                status: "open",
                assignedToUserId,
                createdByUserId: actorUserId,
                patientScreeningId: patientScreeningId ?? null,
                projectId: null,
                parentTaskId: null,
                batchId: null,
                dueDate: null,
              });
            } catch (err: any) {
              console.error("[call-result] task create failed:", err.message);
            }
          },
        };

        const execInput: EngagementCallResultInput = {
          patientScreeningId: String(patientScreeningId),
          patientExecutionCaseId:
            executionCaseId !== null ? String(executionCaseId) : null,
          outcome: data.callResult as
            | "scheduled"
            | "callback"
            | "no_answer"
            | "voicemail"
            | "wrong_number"
            | "declined"
            | "needs_records"
            | "insurance_prior_auth_issue"
            | "manager_review"
            | "facility_specific_issue",
          callbackAt: computedNextActionAt ? computedNextActionAt.toISOString() : null,
          notes: data.note ?? null,
          assignedTeamMemberId:
            assignedTeamCandidate !== null ? String(assignedTeamCandidate) : null,
          assignedRole: data.assignedRole ?? null,
          forceReassign,
          journeyEventMetadata: delegationJourneyMetadata,
          patientName,
          patientDob: patientDob ?? null,
        };

        await recordEngagementCallResult(execInput, deps, {
          callbackHours,
          engagementStatusSemantics: "coarse",
        });

        if (isRecordCallResultEngagementPreviewEnabled()) {
          runEngagementCallResultPreview(
            {
              patientScreeningId: String(patientScreeningId),
              outcome: data.callResult,
              callbackAt: data.nextActionAt ?? null,
            },
            {
              outcome: data.callResult,
              routeAppointmentStatus: null,
              routeEngagementStatusTransition: null,
              routeAssignmentCompleted: false,
              routeFollowUpTaskCreated: delegatedTask !== null,
              routeTriageCaseUpserted: delegatedTriageCase !== null,
              routeNextActionAtSet: computedNextActionAt !== null,
            },
          );
        }

        return res.json({
          ok: true,
          executionCase: delegatedExecutionCase,
          journeyEvent: delegatedJourneyEvent,
          triageCase: delegatedTriageCase,
          task: delegatedTask,
          ownershipUpdated: delegatedOwnershipUpdated,
        });
      }

      // ─── Legacy code path (flag OFF, non-canonical outcome, or no screening) ─

      // Always append journey event (best-effort — never blocks the response)
      const journeyMetadata = {
        callResult: data.callResult,
        callDisposition: data.callDisposition ?? null,
        note: data.note ?? null,
        nextActionAt: computedNextActionAt ? computedNextActionAt.toISOString() : null,
        assignedUserId: data.assignedUserId ?? null,
        assignedRole: data.assignedRole ?? null,
        facilityId: facilityId ?? null,
        ...(data.metadata ?? {}),
      };
      let journeyEvent: Awaited<ReturnType<typeof appendJourneyEvent>> | null = null;
      try {
        journeyEvent = await appendJourneyEvent({
          patientName,
          patientDob: patientDob ?? undefined,
          patientScreeningId: patientScreeningId ?? undefined,
          executionCaseId: executionCaseId ?? undefined,
          eventType: "call_result_logged",
          eventSource: "scheduler_portal",
          actorUserId,
          summary: "call result logged",
          metadata: journeyMetadata,
        });
      } catch (err: any) {
        console.error("[call-result] journey event append failed:", err.message);
      }

      // Scheduling triage case — upsert by (patientScreeningId, mainType,
      // subtype) on non-terminal status so repeated call-result writes for
      // the same disposition reuse the existing open row instead of
      // accumulating duplicates (see audit's "duplicate open triage" check).
      let triageCase: Awaited<ReturnType<typeof createSchedulingTriageCase>> | null = null;
      let triageCreated: boolean | null = null;
      if (CALL_RESULTS_NEEDING_TRIAGE.has(data.callResult)) {
        const mapping = TRIAGE_MAPPINGS[data.callResult];
        if (mapping) {
          try {
            const result = await upsertOpenSchedulingTriageCase({
              executionCaseId: executionCaseId ?? undefined,
              patientScreeningId: patientScreeningId ?? undefined,
              patientName: patientName ?? undefined,
              patientDob: patientDob ?? undefined,
              facilityId: facilityId ?? undefined,
              mainType: mapping.mainType,
              subtype: mapping.subtype,
              status: "open",
              priority: data.callResult === "manager_review" ? "high" : "normal",
              nextOwnerRole: mapping.nextOwnerRole,
              assignedUserId: typeof data.assignedUserId === "string" ? data.assignedUserId : undefined,
              dueAt: computedNextActionAt ?? undefined,
              note: data.note ?? undefined,
              metadata: {
                callResult: data.callResult,
                callDisposition: data.callDisposition ?? null,
                createdSource: "scheduler_call_result",
                ...(data.metadata ?? {}),
              },
            });
            triageCase = result.row;
            triageCreated = result.created;
          } catch (err: any) {
            console.error("[call-result] triage case upsert failed:", err.message);
          }
        }
      }

      // Plexus task — manager_review respects manager_review_requires_task
      const needsTask =
        CALL_RESULTS_NEEDING_TASK.has(data.callResult) &&
        (data.callResult !== "manager_review" || managerReviewRequiresTask);
      let task: Awaited<ReturnType<typeof storage.createTask>> | null = null;
      if (needsTask) {
        try {
          const assignedToUserId = typeof data.assignedUserId === "string" ? data.assignedUserId : null;
          task = await storage.createTask({
            title: `Call result needs follow-up — ${data.callResult}`,
            description: data.note ?? undefined,
            taskType: "task",
            urgency: "EOD",
            priority: data.callResult === "manager_review" ? "high" : "normal",
            status: "open",
            assignedToUserId,
            createdByUserId: actorUserId,
            patientScreeningId: patientScreeningId ?? null,
            projectId: null,
            parentTaskId: null,
            batchId: null,
            dueDate: null,
          });
        } catch (err: any) {
          console.error("[call-result] task create failed:", err.message);
        }
      }

      // Update execution case
      let updatedExecutionCase = executionCase;
      let ownershipUpdated = false;
      if (executionCase) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (computedNextActionAt) updates.nextActionAt = computedNextActionAt;
        if (!TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT.has(executionCase.engagementStatus)) {
          updates.engagementStatus = "in_progress";
        }
        if (data.assignedRole && data.assignedRole !== executionCase.assignedRole) {
          updates.assignedRole = data.assignedRole;
        }

        // Ownership: assignedTeamMemberId is integer. Coerce only when the
        // supplied id is numeric. Preserve existing owner unless force-flagged
        // via metadata.forceReassign or settings disable preservation.
        const assignedTeamCandidate = (() => {
          if (data.assignedUserId == null) return null;
          const v = typeof data.assignedUserId === "number"
            ? data.assignedUserId
            : parseInt(data.assignedUserId, 10);
          return Number.isFinite(v) ? v : null;
        })();
        if (assignedTeamCandidate !== null) {
          const forceReassign =
            (data.metadata && (data.metadata as Record<string, unknown>).forceReassign === true) ||
            !preserveSchedulerOwnership;
          if (executionCase.assignedTeamMemberId == null || forceReassign) {
            updates.assignedTeamMemberId = assignedTeamCandidate;
            ownershipUpdated = true;
          }
        }

        try {
          const [row] = await db
            .update(patientExecutionCases)
            .set(updates)
            .where(eq(patientExecutionCases.id, executionCase.id))
            .returning();
          if (row) updatedExecutionCase = row;
        } catch (err: any) {
          console.error("[call-result] execution case update failed:", err.message);
        }
      }

      // Batch H Step 2 — dormant recordCallResult preview parity check.
      // Default OFF. When enabled, runs the canonical planner on the
      // same input and emits ONE PHI-safe parity line. Never blocks,
      // never throws, never mutates the response. Patient identifiers
      // are NOT forwarded to the helper — only the screeningId (opaque)
      // and the outcome label.
      if (isRecordCallResultEngagementPreviewEnabled()) {
        runEngagementCallResultPreview(
          {
            patientScreeningId:
              patientScreeningId !== null ? String(patientScreeningId) : null,
            outcome: data.callResult,
            callbackAt: data.nextActionAt ?? null,
          },
          {
            outcome: data.callResult,
            routeAppointmentStatus: null,
            routeEngagementStatusTransition:
              updatedExecutionCase && executionCase &&
              updatedExecutionCase.engagementStatus !== executionCase.engagementStatus
                ? updatedExecutionCase.engagementStatus ?? null
                : null,
            routeAssignmentCompleted: false,
            routeFollowUpTaskCreated: task !== null,
            routeTriageCaseUpserted: triageCase !== null,
            routeNextActionAtSet: computedNextActionAt !== null,
          },
        );
      }

      return res.json({
        ok: true,
        executionCase: updatedExecutionCase,
        journeyEvent,
        triageCase,
        task,
        ownershipUpdated,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/scheduler-portal/cases
  // Filters: assignedTeamMemberId, facilityId, engagementBucket, lifecycleStatus,
  //          engagementStatus, qualificationStatus, limit (default 100, max 500)
  // Defaults to scheduler-relevant buckets (visit, outreach, scheduling_triage)
  // and excludes terminal engagement statuses (completed, closed) unless caller
  // provides explicit filters.
  app.get("/api/scheduler-portal/cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listSchedulerPortalCases>[0] = {};
      if (q.assignedTeamMemberId) {
        const id = parseInt(q.assignedTeamMemberId, 10);
        if (!isNaN(id)) filters.assignedTeamMemberId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.qualificationStatus) filters.qualificationStatus = q.qualificationStatus;
      const rows = await listSchedulerPortalCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/execution-cases/by-screening/:patientScreeningId
  // Must be registered before /:id to avoid shadowing
  app.get("/api/execution-cases/by-screening/:patientScreeningId", async (req, res) => {
    try {
      const screeningId = parseInt(req.params.patientScreeningId, 10);
      if (isNaN(screeningId)) return res.status(400).json({ error: "Invalid patientScreeningId" });
      const row = await getExecutionCaseByScreeningId(screeningId);
      if (!row) return res.status(404).json({ error: "Execution case not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/execution-cases/:id
  app.get("/api/execution-cases/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getExecutionCaseById(id);
      if (!row) return res.status(404).json({ error: "Execution case not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/patient-journey-events
  // Filters: executionCaseId, patientScreeningId, patientName, patientDob,
  //          eventType, limit (default 100, max 500)
  app.get("/api/patient-journey-events", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listJourneyEvents>[0] = {};
      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.patientName) filters.patientName = q.patientName;
      if (q.patientDob) filters.patientDob = q.patientDob;
      if (q.eventType) filters.eventType = q.eventType;
      const rows = await listJourneyEvents(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

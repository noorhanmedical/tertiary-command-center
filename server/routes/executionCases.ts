import type { Express, Request, Response } from "express";
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
  findSimilarExecutionCases,
  listJourneyEvents,
  listEngagementCenterCases,
  listSchedulerPortalCases,
  assignEngagementCases,
  recallExecutionCaseToCallList,
} from "../repositories/executionCase.repo";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import { featureFlags } from "../lib/featureFlags";
import {
  runCallResultScheduling,
  engagementActionForOutcome,
} from "../services/canonicalAppointments/callResultSchedulingBridge";
import {
  getSerializedAppointmentsByService,
  filterAppointmentsToEligibleServices,
} from "../services/canonicalAppointments/appointmentProjection";
// PHASE-1 FACILITY SCOPE — Phase 1 Slice 1.2 wires /api/scheduler-
// portal/cases through the same role + facility access checks the
// other portal endpoints already use. See the matching block in
// server/routes/globalSchedule.ts.
import { requirePortalRole, allowedFacilities, type ViewAsWorkspaceType } from "./portal";
import {
  resolveCallListAssignmentScope,
  resolveViewAsRosterMember,
} from "../services/teamMemberScope";
import {
  resolveCallResultAuditIdentity,
  callResultAuditMetadata,
} from "../services/callResult/callResultAuditIdentity";
import { applyCallResultRouting } from "../services/callResult/applyCallResultRouting";
import { getEffectiveAdminSettings } from "../services/adminSettings/adminSettingsEffectiveService";
import { planCallAttempt } from "../services/callResult/callAttemptRuntime";
import { deriveRoutingApplication } from "../services/callResult/callResultRoutingApplier";

// ADMIN VIEW-AS — same shape as the helper in globalSchedule.ts so the
// /api/scheduler-portal/cases endpoint honors `?viewAsTeamMemberId=`
// when the caller is admin. Workspace-role check defends against
// cross-workspace impersonation (PCS↔liaison, ACS↔technician).
async function resolvePhase1FacilityScope(
  req: Request,
  res: Response,
  rawFacilityId: string | undefined,
  rawViewAsTeamMemberId?: string,
  workspace?: ViewAsWorkspaceType,
): Promise<{ ok: true; facilityId: string | null } | { ok: false }> {
  // The roster has no role split, so workspace-role compat does not apply to
  // a roster view-as token; the param is kept for call-site symmetry.
  void workspace;
  const viewAsRoster = await resolveViewAsRosterMember(req, rawViewAsTeamMemberId);
  const allowed = await allowedFacilities(req, {
    viewAsRosterFacility: viewAsRoster?.facility ?? null,
  });
  // Admin view-as: lock the feed to the viewed-as member's facility and
  // ignore any client-supplied facilityId (defense in depth). The session
  // role stays "admin" so writes still log the real admin identity.
  if (viewAsRoster) {
    return { ok: true, facilityId: viewAsRoster.facility };
  }
  const facilityId = (rawFacilityId ?? "").trim() || null;
  if (allowed.all) return { ok: true, facilityId };
  if (!facilityId) {
    res
      .status(400)
      .json({ error: "facilityId is required for non-admin callers" });
    return { ok: false };
  }
  if (!allowed.facilities.has(facilityId)) {
    res
      .status(403)
      .json({ error: "Forbidden — clinic not assigned to this user" });
    return { ok: false };
  }
  return { ok: true, facilityId };
}
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
import { isEngagementCanonicalCallResultsEndpointEnabled } from "../services/callResult/engagementCanonicalCallResultsEndpointFlag";
import { isEngagementCanonicalCallListReadEnabled } from "../services/engagement/engagementCanonicalCallListReadFlag";
import {
  getEngagementCallList,
  type EngagementCallListDependencies,
  type EngagementCallListItem,
} from "../services/engagement/engagementCallListService";
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
  // Phase 2D-B3 — optional real scheduling inputs. Only consulted when
  // FEATURE_CANONICAL_APPOINTMENT is ON and the callResult maps to a
  // canonical scheduling transition. Never fabricated by the server.
  globalScheduleEventId: z.number().int().optional().nullable(),
  cancelReason: z.string().optional().nullable(),
  noShowReason: z.string().optional().nullable(),
  newStartsAt: z.string().optional().nullable(),
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

/**
 * Phase 2E-B4 — pick the EXACT ancillary case identity for a call-list row.
 * Returns the case id + service ONLY when there is exactly one active,
 * same-clinic ancillary case (one service). Multiple (multi-service or two
 * same-service episodes) or zero → both null. Never first/newest.
 */
export function selectSingleActiveAncillaryCase(
  activeCases: Array<{ id: number; clinicId: number; serviceType: string }>,
  clinicId: number | null,
): { ancillaryCaseId: number | null; serviceType: string | null } {
  const sameClinic = activeCases.filter((c) => clinicId != null && c.clinicId === clinicId);
  if (sameClinic.length === 1) return { ancillaryCaseId: sameClinic[0].id, serviceType: sameClinic[0].serviceType };
  return { ancillaryCaseId: null, serviceType: null };
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
      let rows = await listEngagementCenterCases(filters, limit);
      // Phase 2C — apply service-level eligibility projection when the
      // sync flag is ON. Never fall back to unrestricted queue on
      // failure — return 503.
      const { featureFlags: ff } = await import("../lib/featureFlags");
      if (ff.engagementAdminReviewSync && rows.length > 0) {
        try {
          const { projectServiceLevelEligibility } = await import(
            "../services/engagementLists/queueProjection"
          );
          const filtered = await projectServiceLevelEligibility({
            executionCases: rows,
            requireActiveMembership: ff.engagementMultiListRepository,
          });
          rows = filtered.map((f) =>
            Object.assign(f.executionCase, { eligibleServices: f.eligibleServices }),
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({
            level: "error",
            source: "engagement_center_cases",
            kind: "phase_2c_projection_failed",
            code: (e as { code?: string })?.code,
            message: (e as Error)?.message ?? String(e),
          }));
          return res.status(503).json({
            error: "Engagement eligibility projection unavailable",
            code: "ENGAGEMENT_ELIGIBILITY_UNAVAILABLE",
          });
        }
      }

      // Phase 2D-C1 — attach the canonical per-service appointment
      // projection when the flag is ON and the caller opts in
      // (?withAppointments=true). Each eligible service gets its OWN
      // canonical appointment (matched by ancillary case); one
      // execution-case appointment is never fanned out across services.
      // Phase 2C eligibleServices filtering is preserved untouched.
      if (featureFlags.canonicalAppointment && q.withAppointments === "true" && rows.length > 0) {
        const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        if (clinicId != null) {
          try {
            for (const row of rows) {
              // eslint-disable-next-line no-await-in-loop
              const byService = await getSerializedAppointmentsByService({
                clinicId, executionCaseId: row.id, includeHistory: false,
              });
              // Constrain to Phase 2C eligible services (admin-approved).
              // When the sync flag is OFF, eligibleServices is undefined
              // and the legacy selected-service contract is preserved.
              const eligible = (row as { eligibleServices?: string[] }).eligibleServices;
              Object.assign(row, {
                appointmentByService: filterAppointmentsToEligibleServices(byService, eligible),
              });
            }
          } catch (e) {
            const code = (e as { code?: string })?.code;
            if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
              return res.status(503).json({
                error: "canonical appointment schema unavailable — apply migration 0052",
                code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
              });
            }
            throw e;
          }
        }
      }
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

  // GET /api/engagement-center/call-list — Canonical engagement
  // call-list READ endpoint (Batch 17 of Engagement completion run).
  // Default OFF behind isEngagementCanonicalCallListReadEnabled().
  // Returns 404 when flag OFF. When ON, delegates to the dormant
  // engagementCallListService (Batch 15) with a dep that projects
  // listEngagementCenterCases rows onto the canonical envelope.
  // Read-only. No PHI in the response. Team Portal does NOT generate
  // the call list; Operational Queue stays read-only.
  app.get("/api/engagement-center/call-list", async (req, res) => {
    if (!isEngagementCanonicalCallListReadEnabled()) {
      return res.status(404).json({ error: "Not Found" });
    }
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const deps: EngagementCallListDependencies = {
        listEngagementCallListItems: async (filters) => {
          const repoFilters: Parameters<typeof listEngagementCenterCases>[0] = {};
          if (filters.facilityId) repoFilters.facilityId = filters.facilityId;
          if (filters.assignedTeamMemberId) {
            const v = parseInt(filters.assignedTeamMemberId, 10);
            if (Number.isFinite(v)) repoFilters.assignedTeamMemberId = v;
          }
          if (filters.assignedRole) repoFilters.assignedRole = filters.assignedRole;
          if (filters.engagementStatus) repoFilters.engagementStatus = filters.engagementStatus;
          let rows = await listEngagementCenterCases(repoFilters, filters.limit ?? 100);

          // Phase 2C — apply service-specific eligibility for the PCS
          // call list. When the sync flag is ON, only approved services
          // (with active memberships when multi-list is ON) appear,
          // and each row is enriched with eligibleServices[]. Projection
          // failure → throw so the outer route returns a controlled
          // 503 rather than falling back to the unrestricted legacy list.
          const { featureFlags: ff } = await import("../lib/featureFlags");
          // Preserve the eligibleServices map keyed by execution case
          // id so we can attach it to every returned row.
          let eligibilityByCase: Map<number, string[]> | null = null;
          if (ff.engagementAdminReviewSync && rows.length > 0) {
            const { projectServiceLevelEligibility } = await import(
              "../services/engagementLists/queueProjection"
            );
            const filtered = await projectServiceLevelEligibility({
              executionCases: rows,
              requireActiveMembership: ff.engagementMultiListRepository,
            });
            rows = filtered.map((f) => f.executionCase);
            eligibilityByCase = new Map(filtered.map((f) => [f.executionCase.id, f.eligibleServices]));
          }

          const items: EngagementCallListItem[] = rows.map((row) => ({
            patientScreeningId:
              row.patientScreeningId != null ? String(row.patientScreeningId) : "",
            patientExecutionCaseId: String(row.id),
            engagementStatus:
              (row.engagementStatus as EngagementCallListItem["engagementStatus"]) ?? null,
            lifecycleStatus: row.lifecycleStatus ?? null,
            assignedTeamMemberId:
              row.assignedTeamMemberId != null ? String(row.assignedTeamMemberId) : null,
            assignedRole: row.assignedRole ?? null,
            // appointmentStatus + callListAssignmentDate live on related
            // tables (patient_screenings + scheduler_assignments); future
            // expansion can join them in.
            appointmentStatus: null,
            nextActionAt:
              row.nextActionAt instanceof Date ? row.nextActionAt.toISOString() : null,
            facilityId: row.facilityId ?? null,
            callListAssignmentDate: null,
            // Phase 2C — service-level eligibility carried through to
            // the serialized PCS response. When the sync flag is OFF,
            // eligibilityByCase is null and this remains undefined
            // (legacy contract preserved).
            eligibleServices: eligibilityByCase?.get(row.id),
          }));

          // Phase 2D-D1 — attach the canonical per-service appointment
          // projection inline when FEATURE_CANONICAL_APPOINTMENT is ON.
          // One active event per ancillary case; historical events are
          // history-only; doctor_visit excluded. Missing migration
          // propagates so the outer route returns a controlled 503.
          if (ff.canonicalAppointment) {
            const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
            if (clinicId != null) {
              for (let i = 0; i < items.length; i++) {
                const execId = rows[i]?.id;
                if (execId == null) continue;
                // eslint-disable-next-line no-await-in-loop
                const byService = await getSerializedAppointmentsByService({
                  clinicId, executionCaseId: execId, includeHistory: false,
                });
                // keys ⊆ eligibleServices (undefined → legacy passthrough).
                items[i].appointmentByService = filterAppointmentsToEligibleServices(
                  byService, items[i].eligibleServices,
                );
              }
            }
          }
          return items;
        },
      };
      const result = await getEngagementCallList(
        {
          facilityId: q.facilityId ?? null,
          assignedTeamMemberId: q.assignedTeamMemberId ?? null,
          assignedRole: q.assignedRole ?? null,
          engagementStatus:
            (q.engagementStatus as EngagementCallListItem["engagementStatus"]) ?? null,
          callListAssignmentDate: q.callListAssignmentDate ?? null,
          limit,
        },
        deps,
      );
      return res.json(result);
    } catch (error: any) {
      // Phase 2C — if the projector threw (migration missing, etc.),
      // return a controlled 503 rather than fall back to the
      // unrestricted list.
      const code = (error as { code?: string })?.code;
      if (code === "ENGAGEMENT_MIGRATION_MISSING" || code === "ANCILLARY_CASE_MIGRATION_MISSING") {
        return res.status(503).json({
          error: "PCS call-list eligibility projection unavailable",
          code: "ENGAGEMENT_ELIGIBILITY_UNAVAILABLE",
        });
      }
      // Phase 2D-D1 — canonical appointment schema missing → controlled
      // 503, never a fall back to the unrestricted legacy list.
      if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
        return res.status(503).json({
          error: "canonical appointment schema unavailable — apply migration 0052",
          code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
        });
      }
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
  // Extracted handler — shared by the legacy singular route AND the
  // canonical plural route (Batch 8 of Engagement completion run). The
  // plural route is gated by isEngagementCanonicalCallResultsEndpointEnabled().
  // Sharing the handler prevents split-brain: any future change to the
  // call-result write path affects BOTH endpoints in lockstep.
  const callResultHandler = async (req: Request, res: Response): Promise<unknown> => {
    try {
      const actorUserId = sessionUserIdFrom(req);
      const parsed = callResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;

      // PR 2.2 — Resolve the actor audit identity. View-as never
      // overrides actorUserId; impersonation is logged separately
      // via metadata.view_as_user_id.
      const auditIdentity = resolveCallResultAuditIdentity(
        req,
        (data.metadata as Record<string, unknown> | undefined)?.viewAsTeamMemberId as string | undefined,
      );

      // Settings (with task-spec defaults)
      const [callbackSetting, mgrReviewSetting, ownershipSetting, noAnswerSetting, voicemailSetting] = await Promise.all([
        getGlobalAdminSettingValue<{ hours?: number }>("scheduling_triage", "default_callback_due_hours"),
        getGlobalAdminSettingValue<{ required?: boolean }>("scheduling_triage", "manager_review_requires_task"),
        getGlobalAdminSettingValue<{ enabled?: boolean }>("engagement_center", "preserve_scheduler_ownership"),
        getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "no_answer_callback_hours"),
        getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "voicemail_callback_hours"),
      ]);
      const callbackHours = typeof callbackSetting?.hours === "number" ? callbackSetting.hours : 24;
      const managerReviewRequiresTask = mgrReviewSetting?.required ?? true;
      const preserveSchedulerOwnership = ownershipSetting?.enabled ?? true;
      // PR C — admin-settings-driven LVM / no-answer re-queue intervals.
      // Defaults match the canonical planner's defaultCallbackTarget (4h).
      const noAnswerCallbackHours = typeof noAnswerSetting?.hours === "number" ? noAnswerSetting.hours : 4;
      const voicemailCallbackHours = typeof voicemailSetting?.hours === "number" ? voicemailSetting.hours : 4;

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

      // ── Phase 2D-B3: canonical scheduling bridge ───────────────
      // When the flag is ON, route scheduling-state outcomes
      // (cancelled / no_show / reschedule) through the canonical
      // orchestration. The call is recorded first; a scheduling action
      // is attempted only when the caller supplied the REAL inputs
      // (event id + reason / newStartsAt) — otherwise 409, never a
      // fabricated transition. Non-scheduling outcomes fall through to
      // the legacy engagement writes unchanged.
      if (featureFlags.canonicalAppointment) {
        const schedulingAction = engagementActionForOutcome(data.callResult);
        if (schedulingAction !== "none") {
          const reqClinicId = (req as { clinicId?: number | null }).clinicId ?? null;
          const bridged = await runCallResultScheduling({
            clinicId: reqClinicId,
            executionCaseId,
            patientScreeningId,
            callOutcome: data.callResult,
            schedulingAction,
            appointmentInput: {
              eventId: data.globalScheduleEventId ?? undefined,
              reason: schedulingAction === "cancel" ? (data.cancelReason ?? undefined) : (data.noShowReason ?? undefined),
              newStartsAt: data.newStartsAt ? new Date(data.newStartsAt) : undefined,
            },
            actorUserId,
            source: "engagement_call_result",
          });
          if (bridged.handled) {
            return res.status(bridged.http).json(bridged.body);
          }
        }
      }

      // Compute next-action timestamp — explicit value wins, otherwise
      // default from admin settings:
      //   callback / patient_requested_call_later → scheduling_triage.default_callback_due_hours
      //   no_answer                               → engagement_center.no_answer_callback_hours
      //   voicemail (LVM)                          → engagement_center.voicemail_callback_hours
      // Outcomes outside this set get nextActionAt = null (terminal or
      // task-driven). PR C — re-queues LVM / no-answer onto the
      // appropriate call list per admin settings instead of relying on
      // the canonical planner's hardcoded 4-hour fallback.
      let computedNextActionAt: Date | null = null;
      if (data.nextActionAt) {
        const dt = new Date(data.nextActionAt);
        if (!isNaN(dt.getTime())) computedNextActionAt = dt;
      }
      if (!computedNextActionAt) {
        let hours: number | null = null;
        if (data.callResult === "callback" || data.callResult === "patient_requested_call_later") {
          hours = callbackHours;
        } else if (data.callResult === "no_answer") {
          hours = noAnswerCallbackHours;
        } else if (data.callResult === "voicemail") {
          hours = voicemailCallbackHours;
        }
        if (hours !== null) {
          const dt = new Date();
          dt.setHours(dt.getHours() + hours);
          computedNextActionAt = dt;
        }
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
          // PR 2.2 — same audit trail as the legacy path.
          ...callResultAuditMetadata(auditIdentity),
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

      // PR 2.2 — resolve the effective settings + the routing plan
      // so the legacy path also records WHICH settings drove the
      // outcome. The plan is currently advisory (the route still
      // owns DB writes) but the appliedSettings + nextActionReason
      // get added to the journey-event metadata so QA / audits can
      // trace settings-driven decisions across PRs.
      const effectiveBundle = await getEffectiveAdminSettings({
        facilityId: facilityId ?? null,
        userId: auditIdentity.actorUserId ?? null,
      });
      // Phase 2 hardening — read the prior attempt count from the
      // resolved execution case (may be null/undefined for legacy
      // rows without the column populated; treat as 0).
      const previousAttemptCount = executionCase?.callAttemptCount ?? 0;
      const attemptPlan = planCallAttempt({
        currentAttemptCount: previousAttemptCount,
        outcome: data.callResult,
        maxCallAttempts: effectiveBundle.callResult.maxCallAttempts,
      });
      const routingPlan = applyCallResultRouting(
        {
          outcome: data.callResult,
          explicitCallbackAt: data.nextActionAt ?? null,
          currentAttemptCount: previousAttemptCount,
        },
        effectiveBundle,
      );
      // Phase 2 hardening item 2 — derive the application outcome
      // so journey metadata records which downstream actions are
      // wired vs. honestly pending. The route still performs the
      // existing triage / task writes; this just makes the contract
      // visible to audits.
      const routingApplication = deriveRoutingApplication(routingPlan);

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
        // PR 2.2 audit trail.
        ...callResultAuditMetadata(auditIdentity),
        routing_plan: {
          terminal: routingPlan.terminal,
          next_action_reason: routingPlan.nextActionReason,
          open_triage_case: routingPlan.openTriageCase,
          open_follow_up_task: routingPlan.openFollowUpTask,
          should_transition_to_unable_to_reach: routingPlan.shouldTransitionToUnableToReach,
          applied_settings: routingPlan.appliedSettings,
          // Phase 2 hardening item 2 — honest pending audit.
          requires_writer: routingApplication.requiresWriter,
        },
        // Phase 2 hardening — canonical attempt tracking.
        call_attempt: {
          previous_attempt_count: previousAttemptCount,
          new_attempt_count: attemptPlan.newAttemptCount,
          counted_as_attempt: attemptPlan.countedAsAttempt,
          transitioned_to_unable_to_reach: attemptPlan.transitionToUnableToReach,
          max_call_attempts: attemptPlan.maxCallAttempts,
        },
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
        const nowTimestamp = new Date();

        if (computedNextActionAt) updates.nextActionAt = computedNextActionAt;
        if (!TERMINAL_ENGAGEMENT_STATUSES_FOR_CALL_RESULT.has(executionCase.engagementStatus)) {
          updates.engagementStatus = "in_progress";
        }
        if (data.assignedRole && data.assignedRole !== executionCase.assignedRole) {
          updates.assignedRole = data.assignedRole;
        }

        // Phase 2 hardening — apply the canonical attempt-count plan.
        // We always write the new count (which may equal the old one
        // when the outcome did not count as an attempt) so the column
        // is always consistent with the latest call.
        updates.callAttemptCount = attemptPlan.newAttemptCount;
        updates.lastCallOutcome = data.callResult;
        if (attemptPlan.updateLastAttempt) {
          updates.lastAttemptAt = nowTimestamp;
        }
        if (attemptPlan.transitionToUnableToReach) {
          updates.unableToReachAt = nowTimestamp;
          updates.engagementStatus = "unable_to_reach";
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
  };

  // Bind both the legacy singular path AND the canonical plural path
  // (Batch 8) to the SAME handler. The plural endpoint is gated by
  // isEngagementCanonicalCallResultsEndpointEnabled() — when OFF it
  // returns 404 so callers fail loudly until the canonical route is
  // enabled. When ON the two routes serve byte-equivalent responses.
  app.post("/api/engagement-center/call-result", callResultHandler);
  app.post("/api/engagement-center/call-results", async (req, res) => {
    if (!isEngagementCanonicalCallResultsEndpointEnabled()) {
      return res.status(404).json({ error: "Not Found" });
    }
    return callResultHandler(req, res);
  });

  // GET /api/scheduler-portal/cases
  // Filters: assignedTeamMemberId, facilityId, engagementBucket, lifecycleStatus,
  //          engagementStatus, qualificationStatus, limit (default 100, max 500)
  // Defaults to scheduler-relevant buckets (visit, outreach, scheduling_triage)
  // and excludes terminal engagement statuses (completed, closed) unless caller
  // provides explicit filters.
  // PHASE-1 FACILITY SCOPE: same role + facility access pattern as
  // /api/technician-liaison/clinic-visits in globalSchedule.ts.
  app.get("/api/scheduler-portal/cases", requirePortalRole, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      // /api/scheduler-portal/cases is the SHARED call list — both
      // PCS (liaison) and ACS (technician) consume it via
      // TeamPortalShell. The `workspace` query param (when supplied)
      // narrows view-as role-compat to that workspace's role; when
      // omitted the helper accepts any active team member.
      const wsParam = q.workspace === "acs" || q.workspace === "pcs" ? q.workspace : undefined;
      const scope = await resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId, wsParam);
      if (!scope.ok) return;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listSchedulerPortalCases>[0] = {};
      // PR B — Engagement→workspace feed wiring. Resolve the caller's
      // (or viewed-as user's) outreach_schedulers.id and narrow the
      // call list by patient_execution_cases.assignedTeamMemberId.
      // Without this, an Engagement-assigned case never appears in the
      // assigned team-member's workspace queue. See
      // docs/architecture/complete-team-portal-operations-runtime.md
      // §B (Anthony / Callista root cause).
      // View-as identity is a ROSTER id (outreach_schedulers.id), not a
      // login user — resolve it directly so the locked filter matches the
      // Engagement-assigned cases (assignedTeamMemberId = roster id).
      const viewAsRoster = await resolveViewAsRosterMember(req, q.viewAsTeamMemberId);
      const assignmentScope = await resolveCallListAssignmentScope(
        req,
        scope.facilityId,
        viewAsRoster,
      );
      if (assignmentScope.locked) {
        // When locked, ignore any client-supplied override (defense
        // in depth). If schedulerId is null (caller has no row in
        // outreach_schedulers for this facility) the feed returns []
        // because no assignment can match the impossible filter.
        filters.assignedTeamMemberId = assignmentScope.schedulerId ?? -1;
      } else if (q.assignedTeamMemberId) {
        const id = parseInt(q.assignedTeamMemberId, 10);
        if (!isNaN(id)) filters.assignedTeamMemberId = id;
      }
      if (scope.facilityId) filters.facilityId = scope.facilityId;
      if (q.engagementBucket) filters.engagementBucket = q.engagementBucket;
      if (q.lifecycleStatus) filters.lifecycleStatus = q.lifecycleStatus;
      if (q.engagementStatus) filters.engagementStatus = q.engagementStatus;
      if (q.qualificationStatus) filters.qualificationStatus = q.qualificationStatus;
      const rows = await listSchedulerPortalCases(filters, limit);

      // Phase 2E-B4 — attach the EXACT ancillary case id + service when a row
      // has exactly ONE active ancillary case (one service). Multiple
      // (multi-service or two same-service episodes) or zero → both null; never
      // first/newest. ONE batched query for all visible execution cases (no
      // per-row query). Phase 2B absent → rows unchanged.
      try {
        const { listActiveAncillaryCasesByExecutionCaseIds } = await import(
          "../repositories/ancillaryCases.repo"
        );
        const execIds = rows.map((r) => r.id).filter((n): n is number => typeof n === "number");
        const byExec = await listActiveAncillaryCasesByExecutionCaseIds(execIds);
        for (const row of rows) {
          Object.assign(row, selectSingleActiveAncillaryCase(byExec.get(row.id) ?? [], row.clinicId));
        }
      } catch { /* Phase 2B schema absent → leave rows unchanged */ }

      // Phase 2D-C2 — attach the canonical per-service appointment
      // projection when the flag is ON and the caller opts in
      // (?withAppointments=true). One active scheduled event per
      // ancillary case; independent services stay independent; historical
      // cancelled/no_show/rescheduled events are not active. doctor_visit
      // is excluded by the projection. Missing migration → controlled 503.
      if (featureFlags.canonicalAppointment && q.withAppointments === "true" && rows.length > 0) {
        const clinicId = (req as { clinicId?: number | null }).clinicId ?? null;
        if (clinicId != null) {
          try {
            // Compute Phase 2C eligible services so appointmentByService
            // keys stay a subset of eligibleServices — same rule as
            // Engagement/PCS via the shared filter. Sync flag OFF →
            // eligibleServices undefined → legacy passthrough.
            const eligibilityByCase = new Map<number, string[]>();
            if (featureFlags.engagementAdminReviewSync) {
              const { projectServiceLevelEligibility } = await import(
                "../services/engagementLists/queueProjection"
              );
              const filtered = await projectServiceLevelEligibility({
                executionCases: rows,
                requireActiveMembership: featureFlags.engagementMultiListRepository,
              });
              for (const f of filtered) eligibilityByCase.set(f.executionCase.id, f.eligibleServices);
            }
            for (const row of rows) {
              // eslint-disable-next-line no-await-in-loop
              const byService = await getSerializedAppointmentsByService({
                clinicId, executionCaseId: row.id, includeHistory: false,
              });
              const eligible = featureFlags.engagementAdminReviewSync
                ? (eligibilityByCase.get(row.id) ?? [])
                : undefined;
              Object.assign(row, {
                eligibleServices: eligible,
                appointmentByService: filterAppointmentsToEligibleServices(byService, eligible),
              });
            }
          } catch (e) {
            const code = (e as { code?: string })?.code;
            if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
              return res.status(503).json({
                error: "canonical appointment schema unavailable — apply migration 0052",
                code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING",
              });
            }
            throw e;
          }
        }
      }
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/scheduler-portal/call-list/recall
  // Re-surface a completed / dismissed / dormant case back onto the active
  // call list. Body: { executionCaseId? | patientScreeningId?, assignToMe?,
  // facilityId?, reason? }. When assignToMe is true the case is reassigned to
  // the caller's own roster id (resolveCallListAssignmentScope) so it lands on
  // their scoped queue; if the caller has no roster mapping for the facility we
  // surface an honest 409 instead of silently dropping the recall.
  app.post("/api/scheduler-portal/call-list/recall", requirePortalRole, async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        executionCaseId?: unknown;
        patientScreeningId?: unknown;
        assignToMe?: unknown;
        facilityId?: unknown;
        reason?: unknown;
      };
      const executionCaseId =
        typeof body.executionCaseId === "number" ? body.executionCaseId : undefined;
      const patientScreeningId =
        typeof body.patientScreeningId === "number" ? body.patientScreeningId : undefined;
      if (executionCaseId == null && patientScreeningId == null) {
        return res
          .status(400)
          .json({ error: "executionCaseId or patientScreeningId is required" });
      }

      // Resolve the target case FIRST so authorization is enforced against the
      // case's own facility — never against the caller-supplied facilityId,
      // which the client must not be trusted for. A portal user may only recall
      // cases for facilities they're assigned to (admins: all facilities).
      const targetCase =
        executionCaseId != null
          ? await getExecutionCaseById(executionCaseId)
          : await getExecutionCaseByScreeningId(patientScreeningId!);
      if (!targetCase) {
        return res.status(404).json({
          error:
            "No execution case found for that patient. Only patients with an existing case can be added to the call list.",
          code: "case_not_found",
        });
      }

      const allowed = await allowedFacilities(req, {});
      const caseFacility = targetCase.facilityId ?? null;
      if (!allowed.all) {
        if (!caseFacility || !allowed.facilities.has(caseFacility)) {
          return res
            .status(403)
            .json({ error: "Forbidden — clinic not assigned to this user" });
        }
      }

      let assignedTeamMemberId: number | null | undefined;
      if (body.assignToMe === true) {
        // Scope is resolved from the CASE's facility (authorization-trusted),
        // not the client-supplied facilityId.
        const scope = await resolveCallListAssignmentScope(req, caseFacility, null);
        if (scope.schedulerId == null) {
          return res.status(409).json({
            error:
              "You have no clinic-roster mapping for this facility, so the case can't be added to your call list. Ask an admin to add you to the roster.",
            code: "no_roster_mapping",
          });
        }
        assignedTeamMemberId = scope.schedulerId;
      }

      const updated = await recallExecutionCaseToCallList({
        executionCaseId: targetCase.id,
        assignedTeamMemberId,
        actorUserId: req.session.userId ?? null,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      if (!updated) {
        return res.status(404).json({
          error:
            "No execution case found for that patient. Only patients with an existing case can be added to the call list.",
          code: "case_not_found",
        });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/execution-cases/similar?name=…&dob=…&limit=…
  // Must be registered before /:id to avoid shadowing.
  // Duplicate-prevention aid for the quick-schedule dialog: returns
  // existing execution cases whose patient name is an exact (normalized)
  // or near match ("Jon Smith" vs "John Smith"), optionally strengthened
  // by a matching DOB. Read-only — never links anything.
  app.get("/api/execution-cases/similar", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const name = (q.name ?? "").trim();
      if (!name) {
        return res.status(400).json({ error: "name query parameter is required" });
      }
      const dob = (q.dob ?? "").trim() || null;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 5, 20) : 5;
      const matches = await findSimilarExecutionCases(name, dob, limit);
      return res.json({ matches });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
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

// Admin Call List Audit + dry-run repair (Option 2 §6).
//
// Read-only-by-default operational diagnostics for the call-list engine. The
// engine's source of truth is patient_execution_cases (engagement-assigned
// work) surfaced via /api/operational-queue/me. Several silent
// misconfigurations can make assigned work invisible to the assignee:
//   • the scheduler row has no user_id link (missing_user_mapping)
//   • the case has no next_action_at (never surfaces / sorts oddly)
//   • assignedTeamMemberId points at a deleted scheduler (orphan)
//   • the underlying patient screening is gone (missing_patient)
//
// This audit enumerates those states. The repair endpoints are EXPLICIT:
//   • dry-run computes proposals and writes nothing
//   • apply only performs the specific changes named in the request body
//     (mapping links + next_action_at backfills) — never a blanket auto-fix.
//
// All three routes are admin-gated via the requireRole factory passed in
// from server/routes.ts.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  patientExecutionCases,
  outreachSchedulers,
  patientScreenings,
  users,
} from "@shared/schema";
import {
  buildSchedulerMappingAudit,
  applySchedulerUserMapping,
} from "../services/callList/schedulerUserMapping";

type Visibility =
  | "visible"
  | "visible_but_overdue"
  | "missing_user_mapping"
  | "missing_next_action_at"
  | "missing_patient"
  | "needs_admin_review"
  | "assigned_scheduler_missing";

const REVIEW_STATES = new Set([
  "needs_admin_review",
  "manager_review",
  "needs_records",
]);

type AuditCaseRow = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string | null;
  facilityId: string | null;
  assignedTeamMemberId: number | null;
  engagementStatus: string | null;
  nextActionAt: Date | null;
  lastCallOutcome: string | null;
  screeningExists: boolean;
};

function computeVisibility(
  row: AuditCaseRow,
  schedulerById: Map<number, { name: string; userId: string | null }>,
  now: Date,
): { status: Visibility; blocker: string | null } {
  if (row.assignedTeamMemberId == null) {
    return { status: "missing_user_mapping", blocker: "Case has no assigned scheduler" };
  }
  const scheduler = schedulerById.get(row.assignedTeamMemberId);
  if (!scheduler) {
    return {
      status: "assigned_scheduler_missing",
      blocker: `assignedTeamMemberId #${row.assignedTeamMemberId} is not a known scheduler`,
    };
  }
  if (row.patientScreeningId == null || !row.screeningExists) {
    return { status: "missing_patient", blocker: "Underlying patient screening is missing" };
  }
  if (REVIEW_STATES.has(row.engagementStatus ?? "")) {
    return {
      status: "needs_admin_review",
      blocker: `Status "${row.engagementStatus}" — off the normal call list`,
    };
  }
  if (!scheduler.userId) {
    return {
      status: "missing_user_mapping",
      blocker: `Scheduler "${scheduler.name}" is not linked to a login (user_id NULL)`,
    };
  }
  if (row.nextActionAt == null) {
    return {
      status: "missing_next_action_at",
      blocker: "Assigned case has no next_action_at — will not surface on the call list",
    };
  }
  if (row.nextActionAt.getTime() < now.getTime()) {
    return { status: "visible_but_overdue", blocker: null };
  }
  return { status: "visible", blocker: null };
}

async function loadAuditCases(): Promise<AuditCaseRow[]> {
  const rows = await db
    .select({
      executionCaseId: patientExecutionCases.id,
      patientScreeningId: patientExecutionCases.patientScreeningId,
      patientName: patientExecutionCases.patientName,
      facilityId: patientExecutionCases.facilityId,
      assignedTeamMemberId: patientExecutionCases.assignedTeamMemberId,
      engagementStatus: patientExecutionCases.engagementStatus,
      nextActionAt: patientExecutionCases.nextActionAt,
      lastCallOutcome: patientExecutionCases.lastCallOutcome,
      screeningId: patientScreenings.id,
    })
    .from(patientExecutionCases)
    .leftJoin(
      patientScreenings,
      eq(patientExecutionCases.patientScreeningId, patientScreenings.id),
    )
    .where(
      and(
        eq(patientExecutionCases.lifecycleStatus, "active"),
        sql`${patientExecutionCases.assignedTeamMemberId} IS NOT NULL`,
        sql`${patientExecutionCases.engagementStatus} NOT IN ('completed','closed','cancelled','archived')`,
      ),
    );

  return rows.map((r) => ({
    executionCaseId: r.executionCaseId,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    facilityId: r.facilityId,
    assignedTeamMemberId: r.assignedTeamMemberId,
    engagementStatus: r.engagementStatus,
    nextActionAt: r.nextActionAt ? new Date(r.nextActionAt as unknown as string) : null,
    lastCallOutcome: r.lastCallOutcome,
    screeningExists: r.screeningId != null,
  }));
}

async function buildSchedulerIndex() {
  const schedulers = await db
    .select({
      id: outreachSchedulers.id,
      name: outreachSchedulers.name,
      userId: outreachSchedulers.userId,
    })
    .from(outreachSchedulers);
  const map = new Map<number, { name: string; userId: string | null }>();
  for (const s of schedulers) map.set(s.id, { name: s.name, userId: s.userId });
  return map;
}

const applySchema = z.object({
  apply: z.literal(true),
  mappings: z
    .array(z.object({ schedulerId: z.number().int(), userId: z.string().min(1) }))
    .optional()
    .default([]),
  backfillCaseIds: z.array(z.number().int()).optional().default([]),
});

export function registerCallListAuditRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  const adminOnly = requireRole("admin");

  // GET /api/admin/call-list-audit — full visibility report.
  app.get("/api/admin/call-list-audit", adminOnly, async (_req, res) => {
    try {
      const now = new Date();
      const [cases, schedulerById, mappingAudit] = await Promise.all([
        loadAuditCases(),
        buildSchedulerIndex(),
        buildSchedulerMappingAudit(),
      ]);

      const items = cases.map((row) => {
        const { status, blocker } = computeVisibility(row, schedulerById, now);
        const scheduler =
          row.assignedTeamMemberId != null
            ? schedulerById.get(row.assignedTeamMemberId) ?? null
            : null;
        return {
          executionCaseId: row.executionCaseId,
          patientScreeningId: row.patientScreeningId,
          patientName: row.patientName,
          facility: row.facilityId,
          assignedTeamMemberId: row.assignedTeamMemberId,
          schedulerName: scheduler?.name ?? null,
          schedulerUserId: scheduler?.userId ?? null,
          engagementStatus: row.engagementStatus,
          nextActionAt: row.nextActionAt ? row.nextActionAt.toISOString() : null,
          lastCallOutcome: row.lastCallOutcome,
          visibility: status,
          blocker,
        };
      });

      const counts = items.reduce<Record<string, number>>((acc, it) => {
        acc[it.visibility] = (acc[it.visibility] ?? 0) + 1;
        return acc;
      }, {});

      res.json({
        generatedAt: now.toISOString(),
        totalAssignedActive: items.length,
        counts,
        schedulerMapping: mappingAudit,
        items,
      });
    } catch (error: any) {
      console.error("[call-list-audit] error:", error?.message ?? error);
      res.status(500).json({ error: error?.message ?? "Failed to build audit" });
    }
  });

  // POST /api/admin/call-list-audit/repair/dry-run — proposals, no writes.
  app.post("/api/admin/call-list-audit/repair/dry-run", adminOnly, async (_req, res) => {
    try {
      const now = new Date();
      const [cases, schedulerById, mappingAudit] = await Promise.all([
        loadAuditCases(),
        buildSchedulerIndex(),
        buildSchedulerMappingAudit(),
      ]);

      // Proposal 1: unambiguous scheduler→user mapping links.
      const proposedMappings = mappingAudit
        .filter((m) => !m.mapped && m.suggestedUserId)
        .map((m) => ({
          schedulerId: m.schedulerId,
          schedulerName: m.schedulerName,
          userId: m.suggestedUserId,
          username: m.suggestedUsername,
          reason: m.suggestionReason,
        }));

      // Proposal 2: backfill next_action_at for assigned, otherwise-visible
      // cases that are missing it (mapped scheduler + present patient).
      const backfillNextAction: { executionCaseId: number; patientName: string | null }[] = [];
      // Report-only: orphan scheduler refs and missing patients (no auto-fix).
      const orphanSchedulerRefs: { executionCaseId: number; assignedTeamMemberId: number | null }[] = [];
      const missingPatients: { executionCaseId: number }[] = [];

      for (const row of cases) {
        const { status } = computeVisibility(row, schedulerById, now);
        if (status === "missing_next_action_at") {
          backfillNextAction.push({
            executionCaseId: row.executionCaseId,
            patientName: row.patientName,
          });
        } else if (status === "assigned_scheduler_missing") {
          orphanSchedulerRefs.push({
            executionCaseId: row.executionCaseId,
            assignedTeamMemberId: row.assignedTeamMemberId,
          });
        } else if (status === "missing_patient") {
          missingPatients.push({ executionCaseId: row.executionCaseId });
        }
      }

      res.json({
        dryRun: true,
        generatedAt: now.toISOString(),
        proposals: {
          mappings: proposedMappings,
          backfillNextActionAt: backfillNextAction,
        },
        reportOnly: {
          orphanSchedulerRefs,
          missingPatients,
        },
        howToApply:
          "POST /api/admin/call-list-audit/repair/apply with { apply: true, mappings: [{schedulerId,userId}], backfillCaseIds: [executionCaseId,...] }",
      });
    } catch (error: any) {
      console.error("[call-list-audit:dry-run] error:", error?.message ?? error);
      res.status(500).json({ error: error?.message ?? "Failed to build dry-run" });
    }
  });

  // POST /api/admin/call-list-audit/repair/apply — explicit, scoped writes.
  app.post("/api/admin/call-list-audit/repair/apply", adminOnly, async (req, res) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid body — apply:true and explicit mappings/backfillCaseIds required",
        code: "INVALID_REPAIR_REQUEST",
      });
    }
    const { mappings, backfillCaseIds } = parsed.data;
    try {
      const mappingResults: Array<{
        schedulerId: number;
        userId: string;
        ok: boolean;
        reason?: string;
      }> = [];
      for (const m of mappings) {
        const result = await applySchedulerUserMapping(m.schedulerId, m.userId);
        mappingResults.push({
          schedulerId: m.schedulerId,
          userId: m.userId,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
        });
      }

      let backfilled = 0;
      if (backfillCaseIds.length > 0) {
        const now = new Date();
        // Only backfill cases that are genuinely missing next_action_at, to
        // avoid clobbering pending callbacks even if a stale id is supplied.
        const updated = await db
          .update(patientExecutionCases)
          .set({ nextActionAt: now, updatedAt: now })
          .where(
            and(
              inArray(patientExecutionCases.id, backfillCaseIds),
              isNull(patientExecutionCases.nextActionAt),
              eq(patientExecutionCases.lifecycleStatus, "active"),
            ),
          )
          .returning({ id: patientExecutionCases.id });
        backfilled = updated.length;
      }

      res.json({
        applied: true,
        mappingResults,
        backfilledNextActionAt: backfilled,
      });
    } catch (error: any) {
      console.error("[call-list-audit:apply] error:", error?.message ?? error);
      res.status(500).json({ error: error?.message ?? "Failed to apply repairs" });
    }
  });
}

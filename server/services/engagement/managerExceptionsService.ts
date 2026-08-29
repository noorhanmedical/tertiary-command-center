// Manager exceptions aggregator (Phase 6D, req 24).
//
// A SINGLE manager-scoped read that surfaces the operational exceptions a
// manager needs to act on, drawn ENTIRELY from existing canonical sources —
// needs-coverage, call handoffs, plexus tasks, and team metrics. It is NOT a
// second manager system or a new store: it reads what already exists and
// applies the caller's ManagerScope. Counts + a small sample per category keep
// the payload light; the manager drills into the dedicated panels for detail.

import type { ManagerScope } from "../teams/managerScope";
import { schedulerIdsInScope } from "../teams/managerScope";
import { needsCoverageRepository } from "../../repositories/needsCoverage.repo";
import { callHandoffsRepository } from "../../repositories/callHandoffs.repo";
import { computeHandoffSla } from "./callHandoffService";
import { storage } from "../../storage";

export interface ManagerExceptionSummary {
  needsCoverage: { total: number; byCategory: Record<string, number> };
  // Failed redistributions are a distinct, high-signal slice of needs-coverage.
  failedRedistribution: number;
  unacknowledgedHandoffs: { total: number; overdue: number };
  tasksOwnedByInactiveUsers: number;
  overCapacityMembers: number;
  // Convenience total for a single badge.
  totalExceptions: number;
}

/**
 * Build the manager exception summary for the caller's scope. Admin sees the
 * whole org; a manager sees only their team(s)/facility scope. All numbers are
 * derived from canonical reads — nothing is invented or recomputed.
 */
export async function getManagerExceptions(
  scope: ManagerScope,
): Promise<ManagerExceptionSummary> {
  // ── Needs coverage (open) ──
  let ncItems = await needsCoverageRepository.listOpen({});
  if (!scope.isAdmin && scope.facilityIds.size > 0) {
    ncItems = ncItems.filter((i) => i.facilityId && scope.facilityIds.has(i.facilityId));
  }
  const byCategory: Record<string, number> = {};
  for (const i of ncItems) byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
  const failedRedistribution = byCategory["failed_redistribution"] ?? 0;

  // ── Unacknowledged / overdue P1-P2 handoffs (manager view, scoped) ──
  const now = new Date();
  const allHandoffs = await callHandoffsRepository.listForManager(300);
  const scopedHandoffs = scope.isAdmin
    ? allHandoffs
    : allHandoffs.filter(
        (h) =>
          (h.toUserId && scope.userIds.has(h.toUserId)) ||
          (h.fromUserId && scope.userIds.has(h.fromUserId)),
      );
  let unackTotal = 0;
  let unackOverdue = 0;
  for (const h of scopedHandoffs) {
    const sla = computeHandoffSla(h, now);
    if (sla.awaitingAck) {
      unackTotal += 1;
      if (sla.overdueForAck) unackOverdue += 1;
    }
  }

  // ── Tasks owned by INACTIVE users (in scope) ──
  // A deactivated user's PERSONAL (team-less) tasks stay assigned and must be
  // reassigned by a manager (6C flags them; here we count them for the badge).
  let tasksOwnedByInactive = 0;
  try {
    const managerTasks = await storage.getTasksForManager({}, 500);
    const scoped = scope.isAdmin
      ? managerTasks
      : managerTasks.filter(
          (t) =>
            (t.assignedToUserId && scope.userIds.has(t.assignedToUserId)) ||
            (t.createdByUserId && scope.userIds.has(t.createdByUserId)),
        );
    const owners = Array.from(
      new Set(scoped.map((t) => t.assignedToUserId).filter((id): id is string => !!id)),
    );
    const inactiveOwners = new Set<string>();
    await Promise.all(
      owners.map(async (id) => {
        const u = await storage.getUser(id);
        if (u && u.active === false) inactiveOwners.add(id);
      }),
    );
    tasksOwnedByInactive = scoped.filter(
      (t) =>
        t.assignedToUserId &&
        inactiveOwners.has(t.assignedToUserId) &&
        t.status !== "done" &&
        t.status !== "closed",
    ).length;
  } catch {
    // best-effort — a metrics hiccup never breaks the summary
  }

  // ── Over-capacity members (canonical team metrics, scoped) ──
  let overCapacityMembers = 0;
  try {
    const { getTeamMetrics } = await import("./teamMetricsService");
    const metrics = await getTeamMetrics();
    const idsInScope = await schedulerIdsInScope(scope);
    const members =
      idsInScope == null
        ? metrics.members
        : metrics.members.filter((m) => new Set(idsInScope).has(m.schedulerId));
    overCapacityMembers = members.filter((m) => (m.overCapacity ?? 0) > 0).length;
  } catch {
    // Metrics service optional to this summary; skip on any resolution issue.
  }

  const totalExceptions =
    ncItems.length + unackOverdue + tasksOwnedByInactive + overCapacityMembers;

  return {
    needsCoverage: { total: ncItems.length, byCategory },
    failedRedistribution,
    unacknowledgedHandoffs: { total: unackTotal, overdue: unackOverdue },
    tasksOwnedByInactiveUsers: tasksOwnedByInactive,
    overCapacityMembers,
    totalExceptions,
  };
}

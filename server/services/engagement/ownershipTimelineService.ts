// Ownership timeline (Phase 3E / decision K17).
//
// Manager-visible ownership history for one execution case, reconstructed from
// existing journey/audit data + call handoffs — NOT from the current owner
// alone. Each entry describes an ownership transition: who it went to/from,
// who initiated it, auto vs manual, reason, timestamp, and (for handoffs)
// priority + acknowledgement + completion.

import { listJourneyEvents, getExecutionCaseById } from "../../repositories/executionCase.repo";
import { journeyLookupFilter } from "./journeyLookupRules";
import { callHandoffsRepository } from "../../repositories/callHandoffs.repo";
import { storage } from "../../storage";
import type { CallHandoff } from "@shared/schema";

// Journey event sources that represent an OWNERSHIP transition (vs. call
// dispositions, documents, etc.).
const OWNERSHIP_EVENT_SOURCES = new Set([
  "scheduler_auto_assign",
  "engagement_distribution",
  "engagement_assignment_board",
  "absence_redistribution",
  "call_handoff",
  "deactivated_user_recovery",
]);
const OWNERSHIP_EVENT_TYPES = ["engagement_assignment_changed", "scheduler_assigned"];

export interface OwnershipTimelineEntry {
  at: string | null;
  kind: "assignment" | "handoff" | "release" | "recovery";
  source: string;
  // Auto (system) vs manual (a human initiated it).
  mode: "auto" | "manual";
  fromSchedulerId: number | null;
  toSchedulerId: number | null;
  actorName: string | null;
  reason: string | null;
  summary: string;
  // Handoff context (present only for handoff-linked entries).
  priorityLevel: string | null;
  handoffStatus: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
}

const MANUAL_SOURCES = new Set([
  "engagement_assignment_board",
  "call_handoff",
]);

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function getOwnershipTimeline(
  executionCaseId: number,
): Promise<{ executionCaseId: number; currentOwnerSchedulerId: number | null; entries: OwnershipTimelineEntry[] }> {
  const ec = await getExecutionCaseById(executionCaseId);
  if (!ec) {
    return { executionCaseId, currentOwnerSchedulerId: null, entries: [] };
  }

  const [events, handoffs] = await Promise.all([
    listJourneyEvents(
      {
        ...journeyLookupFilter({
          executionCaseId,
          patientName: ec.patientName,
          patientDob: ec.patientDob,
        }),
        eventTypes: OWNERSHIP_EVENT_TYPES,
      },
      500,
    ),
    callHandoffsRepository.listForExecutionCase(executionCaseId),
  ]);

  // Resolve actor + handoff ack info.
  const actorIds = Array.from(
    new Set(events.map((e) => e.actorUserId).filter((id): id is string => !!id)),
  );
  const actorNameById = new Map<string, string>();
  await Promise.all(
    actorIds.map(async (id) => {
      const u = await storage.getUser(id);
      if (u?.username) actorNameById.set(id, u.username);
    }),
  );

  // Index handoffs by their journey metadata.handoffId for enrichment.
  const handoffById = new Map<number, CallHandoff>();
  for (const h of handoffs) handoffById.set(h.id, h);

  const entries: OwnershipTimelineEntry[] = events
    .filter((e) => e.eventSource && OWNERSHIP_EVENT_SOURCES.has(e.eventSource))
    .map((e): OwnershipTimelineEntry => {
      const md = (e.metadata && typeof e.metadata === "object"
        ? (e.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const source = e.eventSource ?? "unknown";
      const isHandoff = source === "call_handoff";
      const isRelease =
        source === "absence_redistribution" || md.action === "release";
      const isRecovery = source === "deactivated_user_recovery";
      const linkedHandoff =
        typeof md.handoffId === "number" ? handoffById.get(md.handoffId) : undefined;

      return {
        at: iso(e.createdAt),
        kind: isRecovery
          ? "recovery"
          : isHandoff
            ? "handoff"
            : isRelease
              ? "release"
              : "assignment",
        source,
        mode: MANUAL_SOURCES.has(source) ? "manual" : "auto",
        fromSchedulerId: numOrNull(md.previousSchedulerId),
        toSchedulerId: numOrNull(md.newSchedulerId),
        actorName: e.actorUserId ? actorNameById.get(e.actorUserId) ?? null : null,
        reason: (md.reason as string) ?? null,
        summary: e.summary ?? "",
        priorityLevel:
          (md.priorityLevel as string) ?? linkedHandoff?.priorityLevel ?? null,
        handoffStatus: linkedHandoff?.status ?? null,
        acknowledgedAt: iso(linkedHandoff?.acknowledgedAt),
        completedAt: iso(linkedHandoff?.completedAt),
      };
    })
    // Oldest first — a readable chronological history.
    .sort((a, b) => {
      const at = a.at ? new Date(a.at).getTime() : 0;
      const bt = b.at ? new Date(b.at).getTime() : 0;
      return at - bt;
    });

  return {
    executionCaseId,
    currentOwnerSchedulerId: ec.assignedTeamMemberId ?? null,
    entries,
  };
}

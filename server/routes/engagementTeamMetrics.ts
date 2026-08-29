import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { patientScreenings } from "@shared/schema/screening";
import { getTeamMetrics } from "../services/engagement/teamMetricsService";
import { startOfTodayUtc } from "../services/engagement/callSettingsService";
import { listJourneyEvents } from "../repositories/executionCase.repo";
import {
  listCallResults,
  type CallResultsFilters,
} from "../services/engagement/callResultsService";
import { allowedFacilities } from "./portal";
import { subscribeLiveActivity } from "../services/engagement/liveActivityBus";

// Journey-event tokens that represent a canonical ownership / work-state
// change a Team Portal queue (or Engagement board / Call Results) should
// refetch on. Matched by token so naming variants are all covered
// (engagement_assignment_changed, engagement_assigned, call_result_logged,
// schedule_*, screening_committed, execution_case_*, …). PHI-free.
const QUEUE_REFRESH_TOKENS = ["assign", "call", "schedul", "engagement", "execution_case"];
function isQueueRefreshEvent(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return QUEUE_REFRESH_TOKENS.some((tok) => t.includes(tok));
}

// Engagement Center — Phase 3: Live Team Metrics + Activity Feed (admin-only).
//
// Two read-only endpoints, both derived ONLY from data we already have:
//   • GET /api/engagement/team-metrics  — today's per-member + team rollup
//     (disposition counts from the call log, targets reused from Call
//     Settings, active queue + carryover from the execution-case spine).
//   • GET /api/engagement/activity-feed — a chronological, day-scoped, team-
//     scoped, paginated merge of recent patient-journey events and call-log
//     entries.
//
// Neither endpoint invents RingCentral telemetry. The team-metrics payload is
// explicit that live dial/connect events are not connected
// (ringCentralLiveConnected: false).

type ActivityFeedItem = {
  id: string;
  kind: "journey" | "call";
  at: string; // ISO; never null (used as the pagination cursor anchor)
  title: string;
  detail: string | null;
  patientName: string | null;
  actorName: string | null;
  eventType: string | null;
};

// The activity feed surfaces team CALL/ASSIGNMENT/SCHEDULING activity only —
// not every journey-event type (e.g. document or billing events). We match by
// token so naming variants (scheduler_assigned, engagement_assignment_changed,
// schedule_cancelled, call_result_logged, …) are all included without having to
// enumerate every literal.
const RELEVANT_EVENT_TOKENS = ["call", "assign", "schedul"];

function isRelevantEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return RELEVANT_EVENT_TOKENS.some((tok) => t.includes(tok));
}

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Cursor: only return items strictly OLDER than this ISO timestamp.
  before: z.string().datetime().optional(),
});

const callResultsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  patientScreeningId: z.coerce.number().int().positive().optional(),
  staffUserId: z.string().trim().min(1).optional(),
  outcome: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  serviceType: z.string().trim().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  callbackStatus: z.enum(["with", "without"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function registerEngagementTeamMetricsRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  // ─── Live team metrics (admin = all; manager = own team scope) ──────────
  app.get(
    "/api/engagement/team-metrics",
    async (req: Request, res: Response) => {
      try {
        const { resolveManagerScope, isManagerOrAdmin, schedulerIdsInScope } =
          await import("../services/teams/managerScope");
        const session = (req as { session?: { userId?: string; role?: string } }).session;
        const scope = await resolveManagerScope(session?.userId ?? null, session?.role ?? null);
        if (!isManagerOrAdmin(scope)) {
          return res.status(403).json({ error: "Requires admin or a team-manager role" });
        }
        const metrics = await getTeamMetrics();
        // Manager sees only members in their scope (admin: all).
        const scopedIds = await schedulerIdsInScope(scope);
        if (scopedIds != null) {
          const allow = new Set(scopedIds);
          metrics.members = metrics.members.filter((m) => allow.has(m.schedulerId));
        }
        res.json(metrics);
      } catch (error: unknown) {
        console.error(
          "[engagement/team-metrics:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load team metrics",
          code: "internal_error",
        });
      }
    },
  );

  // ─── Call Results record list (operational, searchable) ─────────────────
  // The Engagement Center "Call Results" tab record list. Primary source is
  // outreach_calls, enriched with canonical execution-case + patient context.
  // Permissions (server-authoritative, §13):
  //   • admin       → all facilities (unrestricted scope);
  //   • non-admin   → limited to their facility allow-list AND to calls they
  //                   are attributed to (their own scheduler_user_id). Staff
  //                   cannot browse other members' call records.
  // Not admin-gated at the route level: staff read their own scope.
  app.get(
    "/api/engagement/call-results-list",
    async (req: Request, res: Response) => {
      const userId = (req.session as { userId?: string } | undefined)?.userId ?? null;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated", code: "unauthenticated" });
      }
      const parsed = callResultsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid query",
          code: "bad_request",
        });
      }
      const q = parsed.data;
      const isAdmin = (req.session.role ?? "") === "admin";

      try {
        const filters: CallResultsFilters = {
          search: q.search,
          patientScreeningId: q.patientScreeningId,
          outcome: q.outcome,
          channel: q.channel,
          startDate: q.startDate,
          endDate: q.endDate,
          callbackStatus: q.callbackStatus,
          serviceType: q.serviceType,
        };

        // Facility scope — admin: unrestricted (undefined). Non-admin: the
        // resolved allow-list (empty set → returns nothing, honest).
        if (!isAdmin) {
          const scope = await allowedFacilities(req);
          filters.facilities = scope.all ? undefined : Array.from(scope.facilities);
          // Staff may only see their own attributed calls.
          filters.staffUserId = userId;
        } else if (q.staffUserId) {
          // Admin may optionally narrow to a specific staff member.
          filters.staffUserId = q.staffUserId;
        }

        const page = await listCallResults(filters, q.limit ?? 50, q.offset ?? 0);
        res.json(page);
      } catch (error: unknown) {
        console.error(
          "[engagement/call-results-list:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to load call results",
          code: "internal_error",
        });
      }
    },
  );

  // ─── Portal-accessible activity stream (SSE) ────────────────────────────
  // Reuses the SAME liveActivityBus as the admin distribution stream — this is
  // NOT a second realtime system. It exists because the admin stream is
  // requireRole("admin") and Team Portal STAFF (liaison/technician) must also
  // receive queue-refresh nudges for cross-user ownership/work-state changes
  // (reassignment, absence redistribution, call disposition by a manager…).
  //
  // Security (§18): the payload carries ONLY the PHI-free eventType literal.
  // Clients still fetch their authorized canonical data through the normal
  // scoped endpoints (the server remains authoritative); this stream only says
  // "something changed — refetch your queue." Any authenticated user may
  // subscribe; the data they can then read is still scope-enforced.
  app.get("/api/engagement/activity-stream", (req: Request, res: Response) => {
    const userId = (req.session as { userId?: string } | undefined)?.userId ?? null;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated", code: "unauthenticated" });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const unsubscribe = subscribeLiveActivity((signal) => {
      // Forward queue-refresh events AND the PHI-safe notification nudge
      // (Phase 6A) so the Team Portal notification center refetches within ~1s.
      const relevant =
        isQueueRefreshEvent(signal.eventType) ||
        signal.eventType === "notification_created";
      if (!relevant) return;
      res.write(
        `event: activity\ndata: ${JSON.stringify({ eventType: signal.eventType })}\n\n`,
      );
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  });

  // ─── Activity feed (admin-only) ─────────────────────────────────────────
  // Day-scoped (today), team-scoped (roster-linked actors), relevant event
  // types only, chronological (newest first), paginated via a `before` cursor.
  app.get(
    "/api/engagement/activity-feed",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const parsed = feedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid query",
          code: "bad_request",
        });
      }
      const limit = parsed.data.limit ?? 50;
      const before = parsed.data.before ? new Date(parsed.data.before) : null;

      try {
        const now = new Date();
        const dayStart = startOfTodayUtc(now);
        // Upper bound for both sources: the cursor if paginating, else now.
        const upper = before && before < now ? before : now;

        // Team = roster members linked to a user account. When no roster row
        // is linked to a user (possible in this environment), we cannot
        // attribute activity to a member, so we day-scope only and flag it.
        const schedulers = await storage.getOutreachSchedulers();
        const teamUserIds = Array.from(
          new Set(
            schedulers
              .map((s) => s.userId)
              .filter((id): id is string => !!id),
          ),
        );
        const teamScoped = teamUserIds.length > 0;
        const teamUserIdSet = new Set(teamUserIds);

        const [journey, calls, users] = await Promise.all([
          listJourneyEvents(
            {
              createdAfter: dayStart,
              createdBefore: upper,
              // Restrict to roster actors when we have a mapping.
              ...(teamScoped ? { actorUserIds: teamUserIds } : {}),
            },
            500,
          ),
          storage.listOutreachCallsInRange(dayStart, upper),
          storage.getAllUsers(),
        ]);

        const userNameById = new Map(users.map((u) => [u.id, u.username]));

        // Bulk-resolve patient names for the call rows.
        const screeningIds = Array.from(
          new Set(calls.map((c) => c.patientScreeningId)),
        );
        const nameByScreeningId = new Map<number, string>();
        if (screeningIds.length > 0) {
          const rows = await db
            .select({ id: patientScreenings.id, name: patientScreenings.name })
            .from(patientScreenings)
            .where(inArray(patientScreenings.id, screeningIds));
          for (const r of rows) nameByScreeningId.set(r.id, r.name);
        }

        const journeyItems: ActivityFeedItem[] = journey
          .filter((e) => isRelevantEventType(e.eventType))
          .filter((e) => e.createdAt != null)
          .map((e) => ({
            id: `journey-${e.id}`,
            kind: "journey" as const,
            at: new Date(e.createdAt as unknown as string).toISOString(),
            title: e.summary ?? e.eventType,
            detail: e.eventSource ?? null,
            patientName: e.patientName ?? null,
            actorName: e.actorUserId
              ? userNameById.get(e.actorUserId) ?? null
              : null,
            eventType: e.eventType,
          }));

        const callItems: ActivityFeedItem[] = calls
          // Team-scope calls to roster members when we have a mapping.
          .filter((c) =>
            teamScoped
              ? c.schedulerUserId != null && teamUserIdSet.has(c.schedulerUserId)
              : true,
          )
          .filter((c) => c.startedAt != null)
          .map((c) => ({
            id: `call-${c.id}`,
            kind: "call" as const,
            at: new Date(c.startedAt as unknown as string).toISOString(),
            title: `Call logged — ${c.outcome}`,
            detail: c.notes ?? null,
            patientName: nameByScreeningId.get(c.patientScreeningId) ?? null,
            actorName: c.schedulerUserId
              ? userNameById.get(c.schedulerUserId) ?? null
              : null,
            eventType: c.outcome,
          }));

        // Merge, drop anything at/after the cursor, sort newest-first with a
        // stable tie-breaker (timestamp desc, then id desc) so pagination is
        // deterministic across same-timestamp items.
        const merged = [...journeyItems, ...callItems]
          .filter((it) => (before ? new Date(it.at).getTime() < before.getTime() : true))
          .sort((a, b) => {
            const ta = new Date(a.at).getTime();
            const tb = new Date(b.at).getTime();
            if (tb !== ta) return tb - ta;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
          });

        const page = merged.slice(0, limit);
        const hasMore = merged.length > limit;
        const nextCursor = hasMore ? page[page.length - 1]?.at ?? null : null;

        res.json({
          items: page,
          limit,
          hasMore,
          nextCursor,
          teamScoped,
          dayStart: dayStart.toISOString(),
          ringCentralLiveConnected: false,
          generatedAt: now.toISOString(),
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/activity-feed:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load activity feed",
          code: "internal_error",
        });
      }
    },
  );
}
